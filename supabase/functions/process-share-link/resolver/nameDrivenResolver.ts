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
} from '../places/placeNormalization.ts';
import {
  isWrongLocationCandidate,
  extractStateFromFormattedAddress,
} from '../places/locationGuards.ts';
import { compactNameMatches } from '../../../../lib/shareAgent/recoveryHints.ts';
import { isPlatformNoiseName } from '../../../../lib/shareAgent/platformNoise.ts';

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

export type MentionResult = {
  mentionId: string;
  displayName: string;
  outcome: MentionOutcome;
  /** The Google Places text query issued for this mention (diagnostics). */
  query: string;
  /** Preserved candidates (verified → 1; ambiguous → top N). */
  candidates: ResolvedCandidate[];
  /** Per-candidate deterministic scoring explanation (diagnostics). */
  scoring: MentionScoreExplanation[];
  /** Venue-in-host relationship context (present only for a merged mention). */
  primaryVenueName?: string;
  hostVenueName?: string;
  relationshipType?: string;
  providerError?: string;
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
  opts: { expectedState: string | null; bias: { lat: number; lng: number } | null; platform: string },
): ScoredMentionCandidate {
  const reasons: string[] = [];
  let score = 0;

  // Platform-noise hard veto (e.g. "TikTok Inc." for a TikTok post).
  if (isPlatformNoiseName(candidate.name, opts.platform)) {
    return { candidate, rawScore: REJECT_SCORE, reasons: ['platform_noise_rejected'], rejected: true, rejectionReason: 'platform_noise' };
  }

  // Wrong-location hard veto (candidate sits in a different asserted state).
  if (opts.expectedState && isWrongLocationCandidate(candidate.formattedAddress ?? null, opts.expectedState)) {
    return { candidate, rawScore: REJECT_SCORE, reasons: ['wrong_location_rejected'], rejected: true, rejectionReason: 'wrong_location' };
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
  const candNorm = normalizeName(candidate.name);
  const candTokens = new Set(candNorm.split(' ').filter(Boolean));
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
} {
  const ranked = scored.filter((s) => !s.rejected).sort((a, b) => b.rawScore - a.rawScore);
  if (ranked.length === 0) return { outcome: 'no_match', ranked: [] };

  const top = ranked[0]!;
  const topNorm = normalizeRawScore(top.rawScore);
  // A candidate that matched only on business-type / state (no name evidence)
  // is NOT a verification of the named venue.
  if (!hasNameEvidence(top.reasons) || topNorm < PLAUSIBLE_FLOOR) {
    return { outcome: 'no_match', ranked };
  }

  const second = ranked[1];
  const clearLead = !second || topNorm - normalizeRawScore(second.rawScore) >= AMBIGUITY_MARGIN;

  if (topNorm >= ACCEPT_SCORE && clearLead) {
    return { outcome: 'verified_single', ranked };
  }
  // Plausible but not a clear single winner → user selects.
  return { outcome: 'ambiguous_candidates', ranked };
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
  geocode?: (text: string, key: string) => Promise<{ lat: number; lng: number } | null>;
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
  return parts.filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
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

  const expectedState = normalizeStateToAbbr(geoContext.region);

  // One optional coordinate bias, only when a CITY is explicitly present
  // (a state-only context is too broad to bias by coordinates — we rely on
  // state matching instead). Geocoded once, reused for every mention.
  let bias: { lat: number; lng: number } | null = null;
  if (geoContext.city) {
    try {
      bias = await geocode(`${geoContext.city}, ${geoContext.region ?? ''}`.trim(), env.googlePlacesKey);
    } catch {
      bias = null;
    }
  }

  // Per-task cache so identical queries aren't searched twice.
  const cache = new Map<string, SearchPlacesResult>();
  let requestCount = 0;

  const mentionResults: MentionResult[] = [];
  for (const mention of mentions) {
    const query = buildMentionQuery(mention, geoContext);
    const relFields = mention.hostVenueName
      ? { primaryVenueName: mention.primaryVenueName, hostVenueName: mention.hostVenueName, relationshipType: mention.relationshipType }
      : {};
    // Defensive: a mention with no distinctive token should never have been
    // built, but never search one if it slips through.
    if (mention.distinctiveTokens.length === 0) {
      mentionResults.push({ mentionId: mention.id, displayName: mention.displayName, outcome: 'rejected_insufficient_evidence', query, candidates: [], scoring: [], ...relFields });
      continue;
    }

    let result: SearchPlacesResult;
    const cached = cache.get(query);
    if (cached) {
      result = cached;
    } else if (requestCount >= globalLimit) {
      // Budget exhausted — treat remaining mentions as provider_error (bounded).
      mentionResults.push({ mentionId: mention.id, displayName: mention.displayName, outcome: 'provider_error', query, candidates: [], scoring: [], providerError: 'request_limit_reached', ...relFields });
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

    if (!result.ok) {
      mentionResults.push({
        mentionId: mention.id,
        displayName: mention.displayName,
        outcome: 'provider_error',
        query,
        candidates: [],
        scoring: [],
        providerError: result.reason,
        providerRetryAfterSeconds: result.retryAfterSeconds,
        ...relFields,
      });
      continue;
    }

    const scored = result.results.map((c) => scoreMentionCandidate(c, mention, { expectedState, bias, platform }));
    const classified = classifyMention(scored);
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
      candidates,
      scoring: scored.map(toExplanation).slice(0, 8),
      ...relFields,
    });
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

  return {
    mentionResults,
    aggregateCandidates,
    verifiedCount: mentionResults.filter((m) => m.outcome === 'verified_single').length,
    ambiguousCount: mentionResults.filter((m) => m.outcome === 'ambiguous_candidates').length,
    noMatchCount: mentionResults.filter((m) => m.outcome === 'no_match').length,
    providerErrorCount: mentionResults.filter((m) => m.outcome === 'provider_error').length,
    rejectedCount: mentionResults.filter((m) => m.outcome === 'rejected_insufficient_evidence').length,
    requestCount,
  };
}
