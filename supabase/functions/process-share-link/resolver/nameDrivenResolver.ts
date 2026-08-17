// supabase/functions/process-share-link/resolver/nameDrivenResolver.ts
//
// NAME-DRIVEN multi-place verification (Phase 2).
//
// Turns a bounded list of ELIGIBLE explicit venue-name MENTIONS (built by
// process-share-jobs/mediaMentions.ts) into individually verified Google Places
// candidates. For each mention we:
//   1. run ONE text search (name + bounded geo/category context),
//   2. deterministically score each returned candidate,
//   3. classify the mention outcome (verified_single / ambiguous_candidates /
//      no_match / rejected_insufficient_evidence / provider_error),
// then aggregate across mentions, deduping by canonical Google Place ID while
// keeping DISTINCT physical locations (different Place IDs) separate.
//
// HARD RULES:
//   • Google Places is the ONLY source of Place ID / address / coordinates.
//     A model-generated name is a SEARCH SEED, never trusted as a fact.
//   • One failed mention NEVER discards the successfully verified ones.
//   • This module NEVER auto-saves and NEVER sets safeToAutoSave — the caller
//     wraps the aggregate in a `multi_candidate_confirmation` (user confirms).
//   • Global + per-mention request caps + a per-task search cache bound cost.
//
// The scoring core (`scoreMentionCandidate`, `classifyMention`) is PURE and
// unit-tested from Node with mocked candidates. The async orchestrator accepts
// injected `search`/`geocode` deps so tests never hit the network.

// @ts-nocheck — Deno runtime types; Node tests import the pure exports.

import type { Env } from '../env.ts';
import type { ResolvedCandidate } from '../types.ts';
import type { VenueMention, MediaGeoContext } from '../../process-share-jobs/mediaMentions.ts';
import {
  searchPlaces,
  geocodeContextText,
  type PlacesCandidate,
  type SearchPlacesResult,
  type PlacesApiPath,
  type PlacesFallbackReason,
} from '../places/googlePlaces.ts';
import { toResolvedCandidate } from './placeScoring.ts';
import {
  normalizeName,
  nameOverlapScore,
  hasStrongNameMatch,
  hasMeaningfulNameMatch,
  haversineMeters,
  BUSINESS_LIKE,
  isAddressLikeTypes,
  isLocalityLikeTypes,
  geographicContextTypeOf,
} from '../places/placeNormalization.ts';
import {
  isWrongLocationCandidate,
  extractStateFromFormattedAddress,
} from '../places/locationGuards.ts';
import { compactNameMatches } from '../../../../lib/shareAgent/recoveryHints.ts';
import { isPlatformNoiseName } from '../../../../lib/shareAgent/platformNoise.ts';
import { isNearrCategory, mapGoogleType } from '../../../../lib/placeCategory.ts';

export type MentionOutcome =
  | 'verified_single'
  | 'ambiguous_candidates'
  | 'no_match'
  | 'rejected_insufficient_evidence'
  | 'provider_error';

export type MentionScoreExplanation = {
  googlePlaceId: string;
  name: string;
  rawScore: number;
  normalizedScore: number;
  reasons: string[];
  rejected: boolean;
  rejectionReason: string | null;
};

/**
 * WHY a mention ended in `no_match`, as a closed vocabulary an audit can group
 * by. Derived from the stages that actually exist in this file — never invented
 * — so every value is reachable and each points at a different fix:
 *
 *   provider_empty        Google returned nothing. Our rules never ran.
 *   candidate_invalid     Every result was vetoed as platform noise.
 *   geographic_context_rejected
 *                         Venue mode: every result was a city/county/country.
 *   geographic_destination_type_rejected
 *                         Geographic mode: every result was a business. This is
 *                         the Rio/7-Mares guard doing its job.
 *   distance_or_geo_rejected
 *                         Every result sat in the wrong state or country.
 *   all_candidates_rejected
 *                         Several different guards each removed some results.
 *   name_match_failed     Results survived the guards, but the best one carried
 *                         no name evidence — it matched on type/state alone.
 *   score_below_acceptance
 *                         The best candidate DID match by name and still fell
 *                         under PLAUSIBLE_FLOOR.
 *
 * The first six mean "nothing usable came back"; the last two mean "something
 * came back and our scoring declined it". That split is the point.
 */
export type MentionNoMatchReason =
  | 'provider_empty'
  | 'candidate_invalid'
  | 'geographic_context_rejected'
  | 'geographic_destination_type_rejected'
  | 'distance_or_geo_rejected'
  | 'all_candidates_rejected'
  | 'name_match_failed'
  | 'score_below_acceptance';

/** Hard-veto `rejectionReason` values → the no-match code they justify. Keyed
 *  off the SAME strings the scorers emit, so a new veto that forgets to
 *  register here degrades to `all_candidates_rejected` rather than lying. */
const REJECTION_TO_NO_MATCH_REASON: Record<string, MentionNoMatchReason> = {
  platform_noise: 'candidate_invalid',
  wrong_location: 'distance_or_geo_rejected',
  geographic_context_only: 'geographic_context_rejected',
  not_a_geographic_entity: 'geographic_destination_type_rejected',
  geographic_country_mismatch: 'distance_or_geo_rejected',
};

/** Highest provider result count we will persist. Search asks for 8 and a
 *  category-biased second pass can merge in 8 more; 25 leaves headroom without
 *  letting an unexpected provider change grow the row. */
export const MAX_PERSISTED_PROVIDER_RESULTS = 25;
/** Cap on persisted per-mention traces. Matches MAX_MENTIONS in
 *  mediaMentions.ts — a post can never produce more mentions than that. */
export const MAX_FAILURE_TRACES = 10;

/**
 * Bounded, queryable explanation of ONE mention that produced no place.
 *
 * Every field is an integer, boolean, or closed-vocabulary label. No candidate
 * names, no addresses, no query text, no provider payload — the audit groups on
 * these, it does not read them as prose.
 */
export type MentionFailureTrace = {
  /** Stable per-task slot id (m1, m2, …). Not source text. */
  mentionId: string;
  resolutionMode: 'venue' | 'geographic';
  outcome: MentionOutcome;
  noMatchReason?: MentionNoMatchReason;
  providerSearchStatus: 'ok' | 'empty' | 'error' | 'not_attempted';
  /** Closed vocabulary from SearchPlacesResult (`http_error` / `api_error` /
   *  `request_limit_reached`). Never the provider's raw error text. */
  providerErrorKind?: string;
  providerStatusCode?: string;
  /** Which Google Places surface served this mention. `places_legacy` means the
   *  search ran WITHOUT `primaryType`, so a failure here is not comparable to
   *  one on the intended path. */
  providerApiPath?: PlacesApiPath;
  /** Distinct results the provider returned (both passes), capped. */
  providerResultCount: number;
  /** How many of those were actually scored. */
  candidatesConsidered: number;
  /** Whether the category-biased second search ran for this mention. */
  categoryBiasedSearchUsed: boolean;
  /** Tally of hard vetoes by their own `rejectionReason` string. */
  rejectionCounts: Record<string, number>;
  /** Candidates that survived every hard veto and were ranked. */
  survivingCandidates: number;
  /** Of the survivors, how many carried real name evidence. Name matching here
   *  is predicate-based, so this is a count, not a similarity score. */
  survivingWithNameEvidence: number;
  /** Best surviving candidate, when one existed. Absent when all were vetoed. */
  bestCandidateScore?: number;
  bestCandidatePassedName?: boolean;
  /** Provider type completeness — is missing type data costing us matches? */
  candidatesWithPrimaryType: number;
  candidatesWithTypesArray: number;
  candidatesWithoutAnyType: number;
  /** Structural facts about how the query was scoped. Never the query itself. */
  queryHadCity: boolean;
  queryHadRegion: boolean;
  queryHadCountry: boolean;
  countryFromMention: boolean;
  sharedCountryApplied: boolean;
  locationBiasApplied: boolean;
};

/** Aggregate counters so an audit can group 100 jobs without opening traces. */
export type ResolutionDiagnostics = {
  /** Which Places surface served this task's searches. `places_legacy` here
   *  means the WHOLE recognition ran degraded, without `primaryType` — the
   *  100-failure audit must separate those from failures on the intended path. */
  providerApiPath?: PlacesApiPath;
  providerFallbackUsed?: boolean;
  providerFallbackReason?: PlacesFallbackReason;
  attempts: number;
  verified: number;
  ambiguous: number;
  noMatch: number;
  providerError: number;
  insufficientEvidence: number;
  noMatchReasonCounts: Record<string, number>;
  failureTraces: MentionFailureTrace[];
};

export type MentionResult = {
  mentionId: string;
  displayName: string;
  outcome: MentionOutcome;
  /** The Google Places text query issued for this mention (diagnostics). */
  query: string;
  categoryBiasedQuery?: string;
  /** Preserved candidates (verified → 1; ambiguous → top N). */
  candidates: ResolvedCandidate[];
  /** Per-candidate deterministic scoring explanation (diagnostics). */
  scoring: MentionScoreExplanation[];
  /** Venue-in-host relationship context (present only for a merged mention). */
  primaryVenueName?: string;
  hostVenueName?: string;
  relationshipType?: string;
  providerError?: string;
  providerStatus?: string;
  providerRetryAfterSeconds?: number;
};

export type NameDrivenResult = {
  mentionResults: MentionResult[];
  /** Deduped verified+ambiguous candidates across mentions (cap 10). */
  aggregateCandidates: ResolvedCandidate[];
  verifiedCount: number;
  ambiguousCount: number;
  noMatchCount: number;
  providerErrorCount: number;
  rejectedCount: number;
  requestCount: number;
  /** Bounded, queryable explanation of every mention that produced no place.
   *  Observability only — nothing downstream reads it to make a decision. */
  resolutionDiagnostics: ResolutionDiagnostics;
};

/** Retry only a complete provider outage. Partial candidates and real
 * no-match outcomes remain actionable; request-budget exhaustion is local and
 * deterministic, so retrying it would repeat the same work. */
export function isRetryableNameDrivenProviderFailure(result: NameDrivenResult): boolean {
  if (result.aggregateCandidates.length > 0 || result.providerErrorCount === 0) return false;
  const attempted = result.mentionResults.filter(
    (mention) => mention.outcome !== 'rejected_insufficient_evidence',
  );
  return (
    attempted.length > 0 &&
    attempted.every(
      (mention) =>
        mention.outcome === 'provider_error' &&
        mention.providerError !== 'request_limit_reached',
    )
  );
}

/**
 * Map an aggregate name-driven result to a resolver decision. PURE — no I/O.
 * `safeToAutoSave` is ALWAYS false: a name-only match is never silently saved.
 *   • no canonical candidate            → manual_fallback (name preserved)
 *   • multi (≥2 mentions)               → multi_candidate_confirmation
 *   • single verified                   → candidate_confirmation (one canonical)
 *   • single ambiguous, ≥2 candidates   → multi_candidate_confirmation (pick one)
 *   • single ambiguous, exactly 1 cand  → candidate_confirmation (user confirms)
 */
export function nameDrivenDecision(
  result: NameDrivenResult,
  isSingle: boolean,
): {
  decision: 'multi_candidate_confirmation' | 'candidate_confirmation' | 'manual_fallback';
  confidence: 'low' | 'medium' | 'high';
  reason: string;
  safeToAutoSave: false;
} {
  const cands = result.aggregateCandidates.length;
  if (cands === 0) {
    return { decision: 'manual_fallback', confidence: 'low', reason: 'name_driven_no_verified_places', safeToAutoSave: false };
  }
  const verified = result.verifiedCount >= 1;
  if (!isSingle) {
    return { decision: 'multi_candidate_confirmation', confidence: verified ? 'medium' : 'low', reason: 'name_driven_multi_resolved', safeToAutoSave: false };
  }
  if (verified) {
    return { decision: 'candidate_confirmation', confidence: 'high', reason: 'name_driven_single_verified', safeToAutoSave: false };
  }
  if (cands >= 2) {
    return { decision: 'multi_candidate_confirmation', confidence: 'medium', reason: 'name_driven_single_ambiguous', safeToAutoSave: false };
  }
  return { decision: 'candidate_confirmation', confidence: 'low', reason: 'name_driven_single_ambiguous', safeToAutoSave: false };
}

// ---- Tunable thresholds (normalized 0..1) ---------------------------------
export const ACCEPT_SCORE = 0.62; // verified_single needs to clearly exceed this
export const PLAUSIBLE_FLOOR = 0.4; // below this a candidate is not surfaced
export const AMBIGUITY_MARGIN = 0.1; // top-2 within this band → ambiguous
const MAX_CANDIDATES_PER_MENTION = 5;
const MAX_AGGREGATE_CANDIDATES = 10;
const DEFAULT_GLOBAL_REQUEST_LIMIT = 12;

const REJECT_SCORE = -1_000;

// Minimal US state-name → abbreviation map for region-based state matching.
// Regions already in 2-letter form pass through unchanged.
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
  'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK',
  oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI',
  wyoming: 'WY',
};

export function normalizeStateToAbbr(region: string | null): string | null {
  if (!region) return null;
  const t = region.trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return STATE_NAME_TO_ABBR[t.toLowerCase()] ?? null;
}

/** Same sigmoid normalization used by toResolvedCandidate (center 25). */
export function normalizeRawScore(raw: number): number {
  return 1 / (1 + Math.exp(-(raw - 25) / 15));
}

// ---------------------------------------------------------------------------
// Pure scoring
// ---------------------------------------------------------------------------

export type ScoredMentionCandidate = {
  candidate: PlacesCandidate;
  rawScore: number;
  reasons: string[];
  rejected: boolean;
  rejectionReason: string | null;
};

function expectedMentionCategory(mention: VenueMention): ReturnType<typeof mapGoogleType> {
  if (isNearrCategory(mention.category)) return mention.category;
  return mapGoogleType(mention.category);
}

function candidateNearrCategory(candidate: PlacesCandidate): ReturnType<typeof mapGoogleType> {
  const primary = mapGoogleType(candidate.primaryType);
  if (primary) return primary;
  for (const type of candidate.types ?? []) {
    const mapped = mapGoogleType(type);
    if (mapped) return mapped;
  }
  return null;
}

export function mergePlacesCandidates(
  neutral: PlacesCandidate[],
  categoryBiased: PlacesCandidate[],
): PlacesCandidate[] {
  const merged = new Map<string, PlacesCandidate>();
  for (const candidate of [...neutral, ...categoryBiased]) {
    if (!candidate.googlePlaceId || merged.has(candidate.googlePlaceId)) continue;
    merged.set(candidate.googlePlaceId, candidate);
  }
  return [...merged.values()];
}

/**
 * Score ONE Places candidate against a mention. Deterministic — no network, no
 * randomness. Combines name similarity, distinctive-token overlap, business
 * type, state consistency, permanently-closed demotion, wrong-location veto,
 * and an optional coordinate-distance penalty (only when a city-level bias is
 * available). Generic-only name matches are demoted so a bare cuisine token can
 * never verify a place.
 */
export function scoreMentionCandidate(
  candidate: PlacesCandidate,
  mention: VenueMention,
  opts: {
    expectedState: string | null;
    bias: { lat: number; lng: number } | null;
    platform: string;
    /** Country the mention must sit in, when one is established. Used only by
     *  the geographic path — ordinary venue scoring is unchanged. */
    expectedCountry?: string | null;
  },
): ScoredMentionCandidate {
  const reasons: string[] = [];
  let score = 0;

  // Platform-noise hard veto (e.g. "TikTok Inc." for a TikTok post).
  if (isPlatformNoiseName(candidate.name, opts.platform)) {
    return { candidate, rawScore: REJECT_SCORE, reasons: ['platform_noise_rejected'], rejected: true, rejectionReason: 'platform_noise' };
  }

  // A PEER GEOGRAPHIC DESTINATION (a city the post offers as a stop, not as the
  // container its other destinations sit in) resolves on a separate path with
  // the opposite admissibility rule. Kept entirely inside this branch so that
  // ordinary venue scoring below is untouched.
  if (mention.resolutionMode === 'geographic') {
    return scoreGeographicMentionCandidate(candidate, mention, opts);
  }

  // Wrong-location hard veto (candidate sits in a different asserted state).
  if (opts.expectedState && isWrongLocationCandidate(candidate.formattedAddress ?? null, opts.expectedState)) {
    return { candidate, rawScore: REJECT_SCORE, reasons: ['wrong_location_rejected'], rejected: true, rejectionReason: 'wrong_location' };
  }

  // Geographic-context hard veto — same semantic boundary the metadata path
  // uses. A mention that only resolves to a city/county/country is context,
  // not a venue, and must never survive as the single verified place.
  const geographicType = geographicContextTypeOf(candidate);
  if (geographicType) {
    return {
      candidate,
      rawScore: REJECT_SCORE,
      reasons: [`geographic_context_rejected:${geographicType}`],
      rejected: true,
      rejectionReason: 'geographic_context_only',
    };
  }

  // Type-based base.
  if (candidate.types?.some((t) => BUSINESS_LIKE.has(t))) {
    score += 25;
    reasons.push('business_type');
  }
  if (isAddressLikeTypes(candidate.types)) {
    score -= 30;
    reasons.push('address_like_type_penalty');
  }
  if (isLocalityLikeTypes(candidate.types)) {
    score -= 50;
    reasons.push('locality_like_type_penalty');
  }

  const expectedCategory = expectedMentionCategory(mention);
  const resolvedCategory = candidateNearrCategory(candidate);
  if (expectedCategory && resolvedCategory === expectedCategory) {
    score += 8;
    reasons.push('expected_category_match');
  } else if (expectedCategory && resolvedCategory && resolvedCategory !== expectedCategory) {
    score -= 2;
    reasons.push('expected_category_mismatch_soft');
  }

  // Name match against the mention display name.
  const hint = mention.displayName;
  let namedMatched = false;
  if (compactNameMatches(candidate.name, hint)) {
    score += 30;
    reasons.push('compact_name_match');
    namedMatched = true;
  } else if (hasStrongNameMatch(candidate.name, hint)) {
    score += 24;
    reasons.push('strong_name_match');
    namedMatched = true;
  } else if (hasMeaningfulNameMatch(candidate.name, hint)) {
    score += 10;
    reasons.push('meaningful_name_match');
    namedMatched = true;
  }
  score += nameOverlapScore(candidate.name, hint) * 6;

  // Distinctive-token overlap — the strongest guard that this is really the
  // named venue and not a generic-term coincidence.
  const candTokens = new Set(
    candidate.name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\+/g, '&')
      .split(/[\s\-]+/)
      .map((token) => token.replace(/[^a-z0-9]/g, ''))
      .filter(Boolean),
  );
  let distinctiveHits = 0;
  for (const tok of mention.distinctiveTokens) {
    const bare = tok.replace(/[^a-z0-9]/g, '');
    if (bare && candTokens.has(bare)) distinctiveHits += 1;
  }
  if (distinctiveHits > 0) {
    score += Math.min(24, distinctiveHits * 8);
    reasons.push('distinctive_token_match');
  } else if (namedMatched) {
    // Name "matched" but shares no distinctive token → it matched only on
    // generic words (pizza/restaurant/…). Demote so it can't verify.
    score -= 15;
    reasons.push('weak_generic_name_match');
  }

  // State consistency.
  if (opts.expectedState) {
    const candState = extractStateFromFormattedAddress(candidate.formattedAddress ?? null);
    if (candState === opts.expectedState) {
      score += 15;
      reasons.push('state_match');
    }
  }

  // Permanently-closed demotion.
  if (candidate.businessStatus === 'CLOSED_PERMANENTLY') {
    score -= 60;
    reasons.push('permanently_closed');
  }

  // Coordinate distance (only when a city-level bias exists).
  if (opts.bias && Number.isFinite(candidate.latitude) && Number.isFinite(candidate.longitude)) {
    const km = haversineMeters(opts.bias.lat, opts.bias.lng, candidate.latitude!, candidate.longitude!) / 1000;
    if (km > 250) {
      score -= 220;
      reasons.push('distance_far');
    } else if (km > 100) {
      score -= 120;
      reasons.push('distance_medium');
    } else if (km > 40) {
      score -= 60;
      reasons.push('distance_close');
    } else {
      score -= Math.min(30, km * 0.75);
      reasons.push('distance_nearby');
    }
  }

  return { candidate, rawScore: score, reasons, rejected: false, rejectionReason: null };
}

/** Fold a place/country label for comparison. Comparison only. */
function foldGeoLabel(value: string): string {
  // Reuses normalizeName so accent handling has ONE definition in this module.
  return normalizeName(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

/**
 * Score a candidate for a PEER GEOGRAPHIC DESTINATION.
 *
 * This is the inverse of the ordinary rule and the reason task B is safe. In
 * venue mode a locality is vetoed and a business is welcome; here a business is
 * vetoed and only a geographic entity may satisfy the mention. That is what
 * makes "a city can be a destination" incapable of reopening the closed P0:
 *
 *   Rio de Janeiro, if it were ever resolved as a city destination, could match
 *   the Rio locality and NOTHING else. "7 Mares - Passeio de Lancha Rio de
 *   Janeiro" is a tour_agency, so it is rejected outright here — it cannot be
 *   substituted for the city no matter how well its name scores.
 *
 * A country consistency check is applied ONLY on this path, and only when a
 * country is actually established (mention-specific first, then a STRONG shared
 * country from task A). It is what keeps "Granada" inside Nicaragua rather than
 * accepting the more globally prominent Granada, Spain, without relying on
 * provider ordering. No general threshold is touched.
 */
function scoreGeographicMentionCandidate(
  candidate: PlacesCandidate,
  mention: VenueMention,
  opts: { expectedCountry?: string | null; bias: { lat: number; lng: number } | null },
): ScoredMentionCandidate {
  // Only a geographic entity may satisfy a geographic mention. `isLocalityLike`
  // already returns false when any business type is present, so an establishment
  // whose name contains the city can never pass.
  if (!isLocalityLikeTypes(candidate.types)) {
    return {
      candidate,
      rawScore: REJECT_SCORE,
      reasons: ['geographic_mention_requires_geographic_entity'],
      rejected: true,
      rejectionReason: 'not_a_geographic_entity',
    };
  }

  // Country consistency — the ambiguity this whole path exists to resolve.
  const expected = foldGeoLabel(opts.expectedCountry ?? '');
  if (expected) {
    const address = foldGeoLabel(candidate.formattedAddress ?? '');
    if (address && !address.split(' ').join(' ').includes(expected)) {
      return {
        candidate,
        rawScore: REJECT_SCORE,
        reasons: [`geographic_country_mismatch`],
        rejected: true,
        rejectionReason: 'geographic_country_mismatch',
      };
    }
  }

  const reasons: string[] = ['geographic_entity'];
  let score = 25;

  const hint = mention.displayName;
  if (compactNameMatches(candidate.name, hint)) {
    score += 30;
    reasons.push('compact_name_match');
  } else if (hasStrongNameMatch(candidate.name, hint)) {
    score += 24;
    reasons.push('strong_name_match');
  } else if (hasMeaningfulNameMatch(candidate.name, hint)) {
    score += 10;
    reasons.push('meaningful_name_match');
  }
  score += nameOverlapScore(candidate.name, hint) * 6;

  const candTokens = new Set(foldGeoLabel(candidate.name).split(' ').filter(Boolean));
  let distinctiveHits = 0;
  for (const tok of mention.distinctiveTokens) {
    const bare = tok.replace(/[^a-z0-9]/g, '');
    if (bare && candTokens.has(bare)) distinctiveHits += 1;
  }
  if (distinctiveHits > 0) {
    score += Math.min(24, distinctiveHits * 8);
    reasons.push('distinctive_token_match');
  }

  if (expected) {
    score += 15;
    reasons.push('geographic_country_match');
  }

  return { candidate, rawScore: score, reasons, rejected: false, rejectionReason: null };
}

function hasNameEvidence(reasons: string[]): boolean {
  return (
    reasons.includes('compact_name_match') ||
    reasons.includes('strong_name_match') ||
    reasons.includes('meaningful_name_match') ||
    reasons.includes('distinctive_token_match')
  );
}

/** A host can narrow the search but cannot prove the primary venue identity. */
export function isHostOnlyCandidate(
  candidateName: string,
  mention: Pick<VenueMention, 'primaryVenueName' | 'hostVenueName'>,
): boolean {
  if (!mention.primaryVenueName || !mention.hostVenueName) return false;
  return (
    compactNameMatches(candidateName, mention.hostVenueName) &&
    !compactNameMatches(candidateName, mention.primaryVenueName)
  );
}

/**
 * Classify a mention from its scored candidates. PURE.
 *   • verified_single: one candidate with real name evidence that clearly
 *     exceeds ACCEPT_SCORE and leads the runner-up by ≥ AMBIGUITY_MARGIN.
 *   • ambiguous_candidates: ≥1 plausible candidate that isn't a clear winner.
 *   • no_match: nothing plausible (or matches only on generic/business signal).
 */
export function classifyMention(scored: ScoredMentionCandidate[]): {
  outcome: MentionOutcome;
  ranked: ScoredMentionCandidate[];
  /** Why this ended in no_match. Null for every other outcome. Produced HERE,
   *  by the function that makes the decision, so an audit can never read a
   *  reason that disagrees with what the resolver actually did. */
  noMatchReason: MentionNoMatchReason | null;
} {
  const ranked = scored.filter((s) => !s.rejected).sort((a, b) => b.rawScore - a.rawScore);
  if (ranked.length === 0) {
    return { outcome: 'no_match', ranked: [], noMatchReason: reasonForFullyRejected(scored) };
  }

  const top = ranked[0]!;
  const topNorm = normalizeRawScore(top.rawScore);
  // A candidate that matched only on business-type / state (no name evidence)
  // is NOT a verification of the named venue. Split into two branches purely so
  // the two causes are distinguishable — both still return no_match, exactly as
  // the single combined condition did.
  if (!hasNameEvidence(top.reasons)) {
    return { outcome: 'no_match', ranked, noMatchReason: 'name_match_failed' };
  }
  if (topNorm < PLAUSIBLE_FLOOR) {
    return { outcome: 'no_match', ranked, noMatchReason: 'score_below_acceptance' };
  }

  const second = ranked[1];
  const clearLead = !second || topNorm - normalizeRawScore(second.rawScore) >= AMBIGUITY_MARGIN;

  if (topNorm >= ACCEPT_SCORE && clearLead) {
    return { outcome: 'verified_single', ranked, noMatchReason: null };
  }
  // Plausible but not a clear single winner → user selects.
  return { outcome: 'ambiguous_candidates', ranked, noMatchReason: null };
}

/**
 * Why a mention died when EVERY candidate was hard-vetoed.
 *
 * One dominant veto names itself, because that is the actionable case: "all
 * eight results were localities" and "all eight were in the wrong country" call
 * for different fixes. Mixed vetoes stay `all_candidates_rejected` — no single
 * reason would be true — and `rejectionCounts` on the trace preserves the split.
 */
function reasonForFullyRejected(scored: ScoredMentionCandidate[]): MentionNoMatchReason {
  if (scored.length === 0) return 'provider_empty';
  const distinct = new Set(scored.map((s) => s.rejectionReason ?? 'unknown'));
  if (distinct.size === 1) {
    const only = [...distinct][0]!;
    return REJECTION_TO_NO_MATCH_REASON[only] ?? 'all_candidates_rejected';
  }
  return 'all_candidates_rejected';
}

/**
 * Build the bounded trace for one mention.
 *
 * PURE, and deliberately derivative: it is handed the SAME `scored` array the
 * resolver classified and only counts what is already there. It re-runs no
 * guard and re-decides nothing, which is what keeps diagnostics from drifting
 * away from behavior as the scorers change.
 *
 * Note this reads the FULL scored array, not the 8-item `scoring` slice that
 * `MentionResult` carries — otherwise every count would silently cap at 8.
 */
export function buildMentionFailureTrace(args: {
  mentionId: string;
  resolutionMode: 'venue' | 'geographic';
  outcome: MentionOutcome;
  noMatchReason: MentionNoMatchReason | null;
  providerSearchStatus: MentionFailureTrace['providerSearchStatus'];
  providerErrorKind?: string;
  providerStatusCode?: string;
  providerResultCount: number;
  scored: ScoredMentionCandidate[];
  ranked: ScoredMentionCandidate[];
  categoryBiasedSearchUsed: boolean;
  providerApiPath?: PlacesApiPath;
  queryHadCity: boolean;
  queryHadRegion: boolean;
  queryHadCountry: boolean;
  countryFromMention: boolean;
  sharedCountryApplied: boolean;
  locationBiasApplied: boolean;
}): MentionFailureTrace {
  const rejectionCounts: Record<string, number> = {};
  let withPrimaryType = 0;
  let withTypesArray = 0;
  let withoutAnyType = 0;
  for (const s of args.scored) {
    if (s.rejected) {
      const key = s.rejectionReason ?? 'unknown';
      rejectionCounts[key] = (rejectionCounts[key] ?? 0) + 1;
    }
    const hasPrimary = typeof s.candidate.primaryType === 'string' && !!s.candidate.primaryType;
    const hasTypes = Array.isArray(s.candidate.types) && s.candidate.types.length > 0;
    if (hasPrimary) withPrimaryType += 1;
    if (hasTypes) withTypesArray += 1;
    if (!hasPrimary && !hasTypes) withoutAnyType += 1;
  }

  const best = args.ranked[0];
  const trace: MentionFailureTrace = {
    mentionId: args.mentionId,
    resolutionMode: args.resolutionMode,
    outcome: args.outcome,
    providerSearchStatus: args.providerSearchStatus,
    providerResultCount: Math.min(args.providerResultCount, MAX_PERSISTED_PROVIDER_RESULTS),
    candidatesConsidered: Math.min(args.scored.length, MAX_PERSISTED_PROVIDER_RESULTS),
    categoryBiasedSearchUsed: args.categoryBiasedSearchUsed,
    rejectionCounts,
    survivingCandidates: args.ranked.length,
    survivingWithNameEvidence: args.ranked.filter((s) => hasNameEvidence(s.reasons)).length,
    candidatesWithPrimaryType: withPrimaryType,
    candidatesWithTypesArray: withTypesArray,
    candidatesWithoutAnyType: withoutAnyType,
    queryHadCity: args.queryHadCity,
    queryHadRegion: args.queryHadRegion,
    queryHadCountry: args.queryHadCountry,
    countryFromMention: args.countryFromMention,
    sharedCountryApplied: args.sharedCountryApplied,
    locationBiasApplied: args.locationBiasApplied,
  };
  if (args.providerApiPath) trace.providerApiPath = args.providerApiPath;
  if (args.noMatchReason) trace.noMatchReason = args.noMatchReason;
  if (args.providerErrorKind) trace.providerErrorKind = args.providerErrorKind;
  if (args.providerStatusCode) trace.providerStatusCode = args.providerStatusCode;
  if (best) {
    trace.bestCandidateScore = Number(normalizeRawScore(best.rawScore).toFixed(4));
    trace.bestCandidatePassedName = hasNameEvidence(best.reasons);
  }
  return trace;
}

function toExplanation(s: ScoredMentionCandidate): MentionScoreExplanation {
  return {
    googlePlaceId: s.candidate.googlePlaceId,
    name: s.candidate.name,
    rawScore: s.rawScore,
    normalizedScore: Number(normalizeRawScore(s.rawScore).toFixed(4)),
    reasons: s.reasons,
    rejected: s.rejected,
    rejectionReason: s.rejectionReason,
  };
}

// ---------------------------------------------------------------------------
// Async orchestration
// ---------------------------------------------------------------------------

export type NameDrivenDeps = {
  search?: (query: string, key: string, bias?: { lat: number; lng: number }) => Promise<SearchPlacesResult>;
  geocode?: (text: string, key: string) => Promise<{ lat: number; lng: number; region?: string } | null>;
  /** Max total Places text searches across all mentions. */
  globalRequestLimit?: number;
};

function buildMentionQuery(mention: VenueMention, geo: MediaGeoContext): string {
  // Name + bounded geo + a light category hint. Geo/category are RANKING
  // hints only — the name is the anchor. For a venue-in-host relationship,
  // search the PRIMARY venue with the HOST as bounded context ("X Eats Brewery
  // X") rather than the "X Eats at Brewery X" label.
  const parts: string[] = [];
  if (mention.hostVenueName && mention.primaryVenueName) {
    parts.push(mention.primaryVenueName, mention.hostVenueName);
  } else {
    parts.push(mention.displayName);
  }
  const city = mention.geo.city ?? geo.city;
  const region = mention.geo.region ?? geo.region;
  if (city) parts.push(city);
  if (region) parts.push(region);
  const country = mentionQueryCountry(mention, geo);
  if (country) parts.push(country);
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Which country, if any, may scope this mention's search.
 *
 * PRECEDENCE. The mention's OWN country always wins — an explicit "Granada,
 * Spain" keeps Spain even in a post that otherwise establishes Nicaragua, and a
 * Costa Rican hotel is never dragged into a neighbouring country by its
 * siblings. Only when a mention says nothing about its own country may the
 * post-level shared country apply, and only when that shared country is STRONG.
 *
 * `weak` and `conflicted` shared context is deliberately unusable here: a
 * Spain-and-Portugal road trip must not force either country onto the other's
 * places, and one quietly inferred model field must not decide a search. When
 * context is uncertain we keep today's behaviour and let the existing 0/1/2+
 * policy ask, which is always better than confidently resolving the wrong country.
 */
function mentionQueryCountry(mention: VenueMention, geo: MediaGeoContext): string | null {
  const own = (mention.geo.country ?? '').trim();
  if (own) return own;
  if (geo.countryStrength !== 'strong') return null;
  return (geo.country ?? '').trim() || null;
}

/**
 * Verify each eligible mention against Google Places and aggregate. Never
 * throws; a per-mention provider error is captured as `provider_error` and does
 * NOT abort the other mentions.
 */
export async function resolveVenueMentions(args: {
  mentions: VenueMention[];
  geoContext: MediaGeoContext;
  env: Env;
  platform: string;
  deps?: NameDrivenDeps;
}): Promise<NameDrivenResult> {
  const { mentions, geoContext, env, platform } = args;
  const search = args.deps?.search ?? searchPlaces;
  const geocode = args.deps?.geocode ?? geocodeContextText;
  const globalLimit = args.deps?.globalRequestLimit ?? DEFAULT_GLOBAL_REQUEST_LIMIT;

  let expectedState = normalizeStateToAbbr(geoContext.region);

  // One optional coordinate bias, only when a CITY is explicitly present
  // (a state-only context is too broad to bias by coordinates — we rely on
  // state matching instead). Geocoded once, reused for every mention.
  let bias: { lat: number; lng: number } | null = null;
  if (geoContext.city) {
    try {
      // The country is included whenever the post stated one — no strength gate.
      // This does not add a constraint, it DISAMBIGUATES one we already apply:
      // a bare "Granada" geocoded to Granada, SPAIN and biased every sibling of
      // a Nicaragua reel toward Spanish results (production job 10ce36b5).
      // Naming the country makes an existing signal accurate rather than making
      // it stronger — and a country we already trusted for city/region is not a
      // new kind of trust.
      const biasText = [geoContext.city, geoContext.region, geoContext.country]
        .map((part) => (part ?? '').trim())
        .filter(Boolean)
        .join(', ');
      bias = await geocode(biasText, env.googlePlacesKey);
      if (!expectedState) expectedState = normalizeStateToAbbr(bias?.region ?? null);
    } catch {
      bias = null;
    }
  }

  // Per-task cache so identical queries aren't searched twice.
  const cache = new Map<string, SearchPlacesResult>();
  let requestCount = 0;
  // Which Places surface actually served this task. Degraded wins: if ANY
  // search fell back, the task's recognition was not run on the intended
  // provider and the audit must be able to see that from one field.
  let providerApiPath: PlacesApiPath | undefined;
  let providerFallbackReason: PlacesFallbackReason | undefined;
  const notePath = (r: SearchPlacesResult | undefined): void => {
    if (!r?.apiPath) return;
    if (r.apiPath === 'places_legacy') {
      providerApiPath = 'places_legacy';
      providerFallbackReason = r.fallbackReason;
    } else if (providerApiPath !== 'places_legacy') {
      providerApiPath = r.apiPath;
    }
  };

  const mentionResults: MentionResult[] = [];
  const failureTraces: MentionFailureTrace[] = [];
  // Observability must never be able to fail a share. A malformed provider
  // entity that slipped past scoring costs us one trace, not the recognition.
  const recordFailure = (
    build: () => Parameters<typeof buildMentionFailureTrace>[0],
  ): void => {
    if (failureTraces.length >= MAX_FAILURE_TRACES) return;
    try {
      failureTraces.push(buildMentionFailureTrace(build()));
    } catch {
      // Non-critical by construction — drop this trace and carry on.
    }
  };

  for (const mention of mentions) {
    const query = buildMentionQuery(mention, geoContext);
    // Structural facts about how this query was scoped, captured BEFORE the
    // search so a failed mention still explains what context it had. These are
    // booleans about the same inputs `buildMentionQuery` used — never the query.
    const resolvedCountry = mentionQueryCountry(mention, geoContext);
    const queryContext = {
      resolutionMode: (mention.resolutionMode === 'geographic' ? 'geographic' : 'venue') as
        | 'venue'
        | 'geographic',
      queryHadCity: !!(mention.geo.city ?? geoContext.city),
      queryHadRegion: !!(mention.geo.region ?? geoContext.region),
      queryHadCountry: !!resolvedCountry,
      countryFromMention: !!(mention.geo.country ?? '').trim(),
      sharedCountryApplied:
        !(mention.geo.country ?? '').trim() && !!resolvedCountry,
      locationBiasApplied: !!bias,
    };
    const relFields = mention.hostVenueName
      ? { primaryVenueName: mention.primaryVenueName, hostVenueName: mention.hostVenueName, relationshipType: mention.relationshipType }
      : {};
    // Defensive: a mention with no distinctive token should never have been
    // built, but never search one if it slips through.
    if (mention.distinctiveTokens.length === 0) {
      mentionResults.push({ mentionId: mention.id, displayName: mention.displayName, outcome: 'rejected_insufficient_evidence', query, candidates: [], scoring: [], ...relFields });
      recordFailure(() => ({
        mentionId: mention.id,
        outcome: 'rejected_insufficient_evidence',
        noMatchReason: null,
        providerSearchStatus: 'not_attempted',
        providerResultCount: 0,
        scored: [],
        ranked: [],
        categoryBiasedSearchUsed: false,
        ...queryContext,
      }));
      continue;
    }

    let result: SearchPlacesResult;
    const cached = cache.get(query);
    if (cached) {
      result = cached;
    } else if (requestCount >= globalLimit) {
      // Budget exhausted — treat remaining mentions as provider_error (bounded).
      mentionResults.push({ mentionId: mention.id, displayName: mention.displayName, outcome: 'provider_error', query, candidates: [], scoring: [], providerError: 'request_limit_reached', ...relFields });
      recordFailure(() => ({
        mentionId: mention.id,
        outcome: 'provider_error',
        noMatchReason: null,
        // The budget stopped us before Google was ever asked. Recording this as
        // "not_attempted" keeps a local cost cap from reading like an outage.
        providerSearchStatus: 'not_attempted',
        providerErrorKind: 'request_limit_reached',
        providerResultCount: 0,
        scored: [],
        ranked: [],
        categoryBiasedSearchUsed: false,
        ...queryContext,
      }));
      continue;
    } else {
      requestCount += 1;
      try {
        result = await search(query, env.googlePlacesKey, bias ?? undefined);
      } catch (err) {
        result = { ok: false, reason: 'http_error', error: (err as Error)?.message };
      }
      cache.set(query, result);
    }
    notePath(result);

    if (!result.ok) {
      mentionResults.push({
        mentionId: mention.id,
        displayName: mention.displayName,
        outcome: 'provider_error',
        query,
        candidates: [],
        scoring: [],
        providerError: result.reason,
        providerStatus: result.status,
        providerRetryAfterSeconds: result.retryAfterSeconds,
        ...relFields,
      });
      recordFailure(() => ({
        mentionId: mention.id,
        outcome: 'provider_error',
        noMatchReason: null,
        // A real provider failure. Deliberately NOT collapsed into "returned
        // nothing" — an outage and an empty result set need different fixes.
        providerSearchStatus: 'error',
        providerErrorKind: result.reason,
        providerStatusCode: result.status,
        providerResultCount: 0,
        scored: [],
        ranked: [],
        categoryBiasedSearchUsed: false,
        ...queryContext,
      }));
      continue;
    }

    let candidatesToScore = result.results;
    let scored = candidatesToScore.map((c) => scoreMentionCandidate(c, mention, { expectedState, bias, platform, expectedCountry: mentionQueryCountry(mention, geoContext) }));
    let classified = classifyMention(scored);
    let categoryBiasedQuery: string | undefined;
    const categoryHint = expectedMentionCategory(mention);
    // A geographic mention is never category-biased: a venue category hint
    // could only surface businesses, which the geographic path rejects anyway.
    if (classified.outcome !== 'verified_single' && categoryHint && mention.resolutionMode !== 'geographic') {
      categoryBiasedQuery = `${query} ${categoryHint.replace(/_/g, ' ')}`.replace(/\s+/g, ' ').trim();
      let biased = cache.get(categoryBiasedQuery);
      if (!biased && requestCount < globalLimit) {
        requestCount += 1;
        try {
          biased = await search(categoryBiasedQuery, env.googlePlacesKey, bias ?? undefined);
        } catch (err) {
          biased = { ok: false, reason: 'http_error', error: (err as Error)?.message };
        }
        cache.set(categoryBiasedQuery, biased);
      }
      notePath(biased);
      if (biased?.ok) {
        candidatesToScore = mergePlacesCandidates(candidatesToScore, biased.results);
        scored = candidatesToScore.map((c) => scoreMentionCandidate(c, mention, { expectedState, bias, platform, expectedCountry: mentionQueryCountry(mention, geoContext) }));
        classified = classifyMention(scored);
      }
    }
    const ranked = classified.ranked;
    const outcome =
      classified.outcome === 'verified_single' &&
      ranked[0] &&
      isHostOnlyCandidate(ranked[0].candidate.name, mention)
        ? 'ambiguous_candidates'
        : classified.outcome;
    const kept =
      outcome === 'verified_single'
        ? ranked.slice(0, 1)
        : outcome === 'ambiguous_candidates'
        ? ranked.filter((s) => normalizeRawScore(s.rawScore) >= PLAUSIBLE_FLOOR).slice(0, MAX_CANDIDATES_PER_MENTION)
        : [];
    const candidates = kept.map((s) =>
      toResolvedCandidate(
        { candidate: s.candidate, score: s.rawScore, reasons: s.reasons, rejected: false, rejectionReason: null },
        ['media_name_mention', `mention:${mention.id}`, ...(outcome === 'verified_single' ? ['name_verified_single'] : ['name_ambiguous_candidate'])],
      ),
    );
    mentionResults.push({
      mentionId: mention.id,
      displayName: mention.displayName,
      outcome,
      query,
      categoryBiasedQuery,
      candidates,
      scoring: scored.map(toExplanation).slice(0, 8),
      ...relFields,
    });
    // Only failures are traced. A resolved mention already explains itself
    // through its candidates, and tracing every success would double the
    // diagnostics payload of an ordinary share for no audit value.
    if (outcome === 'no_match') {
      recordFailure(() => ({
        mentionId: mention.id,
        outcome,
        noMatchReason: classified.noMatchReason,
        providerSearchStatus: candidatesToScore.length === 0 ? 'empty' : 'ok',
        providerApiPath,
        providerResultCount: candidatesToScore.length,
        scored,
        ranked,
        categoryBiasedSearchUsed: !!categoryBiasedQuery,
        ...queryContext,
      }));
    }
  }

  // Aggregate + dedupe by canonical Place ID (distinct locations stay distinct).
  const aggregateCandidates: ResolvedCandidate[] = [];
  const seen = new Set<string>();
  // Verified first (they should be preselectable), then ambiguous.
  const ordered = [
    ...mentionResults.filter((m) => m.outcome === 'verified_single'),
    ...mentionResults.filter((m) => m.outcome === 'ambiguous_candidates'),
  ];
  for (const m of ordered) {
    for (const c of m.candidates) {
      if (!c.googlePlaceId || seen.has(c.googlePlaceId)) continue;
      seen.add(c.googlePlaceId);
      aggregateCandidates.push(c);
      if (aggregateCandidates.length >= MAX_AGGREGATE_CANDIDATES) break;
    }
    if (aggregateCandidates.length >= MAX_AGGREGATE_CANDIDATES) break;
  }

  const verifiedCount = mentionResults.filter((m) => m.outcome === 'verified_single').length;
  const ambiguousCount = mentionResults.filter((m) => m.outcome === 'ambiguous_candidates').length;
  const noMatchCount = mentionResults.filter((m) => m.outcome === 'no_match').length;
  const providerErrorCount = mentionResults.filter((m) => m.outcome === 'provider_error').length;
  const rejectedCount = mentionResults.filter((m) => m.outcome === 'rejected_insufficient_evidence').length;

  const noMatchReasonCounts: Record<string, number> = {};
  for (const trace of failureTraces) {
    if (!trace.noMatchReason) continue;
    noMatchReasonCounts[trace.noMatchReason] = (noMatchReasonCounts[trace.noMatchReason] ?? 0) + 1;
  }

  return {
    mentionResults,
    aggregateCandidates,
    verifiedCount,
    ambiguousCount,
    noMatchCount,
    providerErrorCount,
    rejectedCount,
    requestCount,
    resolutionDiagnostics: {
      providerApiPath,
      providerFallbackUsed: providerApiPath === 'places_legacy',
      providerFallbackReason,
      attempts: mentionResults.length,
      verified: verifiedCount,
      ambiguous: ambiguousCount,
      noMatch: noMatchCount,
      providerError: providerErrorCount,
      insufficientEvidence: rejectedCount,
      noMatchReasonCounts,
      failureTraces,
    },
  };
}
