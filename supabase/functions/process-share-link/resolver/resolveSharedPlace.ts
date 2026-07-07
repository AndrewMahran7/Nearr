// supabase/functions/process-share-link/resolver/resolveSharedPlace.ts
//
// Main resolver entry point. Inputs: evidence + env. Output:
// ResolverResult.
//
// Path order:
//   1. Address-first verification — if the caption carries a US
//      street address, try `verifyPlaceAtAddressServer` BEFORE any
//      generic text search. This is what fixes the
//      gemini_timeout regressions in the gold set.
//   2. Text search ladder — buildQueryPlan produces an ordered list
//      of cleaned queries; we try each until one returns
//      candidates, then score+rank them.
//   3. Decision policy — translates the ranked list into a
//      ResolverDecision.

// @ts-nocheck — Deno runtime.

import type { Evidence } from '../evidence/extractEvidence.ts';
import type { Env } from '../env.ts';
import type {
  ResolverResult,
  ResolvedCandidate,
  SearchBias,
} from '../types.ts';
import { buildQueryPlan } from './queryBuilder.ts';
import { scoreCandidates, toResolvedCandidate } from './placeScoring.ts';
import { decide } from './decisionPolicy.ts';
import {
  searchPlaces,
  verifyPlaceAtAddressServer,
  geocodeContextText,
  type PlacesCandidate,
} from '../places/googlePlaces.ts';
import { Timings, logShareDebug } from '../diagnostics/logger.ts';

// Score gap below which two tagged-location candidates are treated as an
// ambiguous picker rather than a single confirmation.
const TAGGED_PICKER_BAND = 8;

export async function resolveSharedPlace(args: {
  evidence: Evidence;
  env: Env;
  /** Optional caller-supplied search bias (rare). */
  bias?: SearchBias | null;
}): Promise<ResolverResult> {
  const { evidence, env } = args;
  const timings = new Timings();
  const warnings: string[] = [];
  const diagnostics: Record<string, unknown> = {};
  const evidenceUsed = [...evidence.keys];

  // ---- 0. Tagged-location evidence (highest priority) ------------
  // A platform-tagged place/location (YouTube recordingDetails, TikTok POI,
  // IG location tag) is the strongest signal we can get. We STILL verify it
  // against Google Places and NEVER auto-save on the tag alone — Places can
  // land on the wrong nearby unit. Dormant until a provider is wired
  // (`extractTaggedLocation` returns null today), so this preserves current
  // behavior.
  if (evidence.taggedLocation) {
    logShareDebug('tagged-location:present', {
      platform: evidence.taggedLocation.sourcePlatform,
      confidence: evidence.taggedLocation.confidence,
      hasName: !!evidence.taggedLocation.placeName,
      hasAddress: !!evidence.taggedLocation.address,
      hasCoords:
        Number.isFinite(evidence.taggedLocation.latitude) &&
        Number.isFinite(evidence.taggedLocation.longitude),
      hasExternalId: !!evidence.taggedLocation.externalPlaceId,
    });
    const taggedResult = await resolveFromTaggedLocation({
      evidence,
      env,
      warnings,
      diagnostics,
    });
    if (taggedResult) {
      logShareDebug('resolver:evidence_source', {
        source: 'tagged_location',
        decision: taggedResult.decision,
        candidates: taggedResult.candidates.length,
      });
      return taggedResult;
    }
    // Tag present but unverifiable → fall through to the normal
    // caption/address pipeline (do not fail on account of a bad tag).
    warnings.push('tagged_location_fell_through_to_caption');
  }

  // ---- 0. Multi-address verification -----------------------------
  // When the caption contains ≥2 distinct US street addresses, try
  // to verify each independently. If two or more resolve to real
  // Places, surface them as a multi-candidate confirmation — never
  // auto-save.
  if (evidence.addresses.length >= 2) {
    const placeNameHint =
      evidence.venueNameHints[0] ??
      evidence.handles.posterNameHint ??
      null;
    const fallbackCity = evidence.cityState?.city ?? null;
    const fallbackState = evidence.cityState?.state ?? null;
    const multiResolved: ResolvedCandidate[] = [];
    const seenIds = new Set<string>();
    const seenAddrs = new Set<string>();
    const perAddress: Array<{
      query: string;
      status: string;
      candidateCount: number;
    }> = [];
    for (const addr of evidence.addresses) {
      const city = addr.city ?? fallbackCity;
      const state = addr.state ?? fallbackState;
      const addrStr = [addr.raw, city, state].filter(Boolean).join(', ');
      let status = 'failed';
      let added = 0;
      try {
        const ver = await verifyPlaceAtAddressServer(
          addrStr,
          placeNameHint,
          env.googlePlacesKey,
        );
        status = ver.status;
        const verifiedList =
          ver.status === 'verified'
            ? [ver.candidate]
            : ver.status === 'ambiguous'
            ? ver.candidates
            : [];
        for (const cand of verifiedList) {
          const idKey = cand.googlePlaceId ?? '';
          const addrKey = normalizeAddrKey(cand.formattedAddress ?? '');
          if (idKey && seenIds.has(idKey)) continue;
          if (!idKey && addrKey && seenAddrs.has(addrKey)) continue;
          if (idKey) seenIds.add(idKey);
          if (addrKey) seenAddrs.add(addrKey);
          const resolved = toResolvedCandidate(
            {
              candidate: cand,
              score: ver.status === 'verified' ? 45 : 35,
              reasons: [
                ver.status === 'verified'
                  ? 'address_verified_multi'
                  : 'address_verified_multi_ambiguous',
              ],
              rejected: false,
              rejectionReason: null,
            },
            [...evidenceUsed, 'address_verified', 'caption_multiple_addresses'],
          );
          multiResolved.push(resolved);
          added += 1;
          if (multiResolved.length >= 10) break;
        }
      } catch (err) {
        warnings.push('multi_address_verify_threw');
        diagnostics.multiVerifyError = (err as Error)?.message;
      }
      perAddress.push({ query: addrStr, status, candidateCount: added });
      if (multiResolved.length >= 10) break;
    }
    timings.mark('multi_address_verify');
    diagnostics.multiAddressVerification = {
      addressCount: evidence.addresses.length,
      perAddress,
      resolvedCount: multiResolved.length,
    };
    // Only fire the multi-candidate path when ≥2 distinct real-world
    // places resolved. One match → fall through to the normal
    // single-address path so safety + verification flags apply.
    if (multiResolved.length >= 2) {
      logShareDebug('resolver:multi_address_resolved', {
        addressCount: evidence.addresses.length,
        candidateCount: multiResolved.length,
      });
      return finalize(
        {
          decision: 'multi_candidate_confirmation',
          primaryCandidate: multiResolved[0],
          candidates: multiResolved,
          safeToAutoSave: false,
          confidence: 'medium',
          reasons: ['multi_address_resolved'],
        },
        {
          cleanSearchQuery: perAddress.map((p) => p.query).join(' | '),
          warnings,
          diagnostics,
          evidenceUsed,
          timings,
        },
      );
    }
  }

  // ---- 1. Address-first verification -----------------------------
  if (evidence.address) {
    const placeName =
      evidence.venueNameHints[0] ??
      evidence.handles.posterNameHint ??
      null;
    // Address-extractor sometimes returns city/state inline, but
    // often only the street portion. Augment with the cityState
    // anchor so Google can geocode the address — without a city,
    // "415 Seabright Ave" matches every street of that name in
    // the country and verify returns no_business_near_address.
    const city = evidence.address.city ?? evidence.cityState?.city ?? null;
    const state = evidence.address.state ?? evidence.cityState?.state ?? null;
    const addrStr = [evidence.address.raw, city, state]
      .filter(Boolean)
      .join(', ');

    try {
      const verification = await verifyPlaceAtAddressServer(
        addrStr,
        placeName,
        env.googlePlacesKey,
      );
      timings.mark('address_verify');
      diagnostics.addressVerification = {
        status: verification.status,
        reason: (verification as any).reason ?? null,
      };
      if (verification.status === 'verified') {
        const resolved = toResolvedCandidate(
          { candidate: verification.candidate, score: 50, reasons: ['address_verified'], rejected: false, rejectionReason: null },
          [...evidenceUsed, 'address_verified'],
        );
        const decision = decide({
          evidence,
          candidates: [resolved],
          addressVerified: true,
        });
        return finalize(decision, {
          cleanSearchQuery: addrStr,
          warnings,
          diagnostics,
          evidenceUsed,
          timings,
        });
      }
      if (verification.status === 'ambiguous') {
        const resolved = verification.candidates.map((c) =>
          toResolvedCandidate(
            { candidate: c, score: 40, reasons: ['address_verified_ambiguous'], rejected: false, rejectionReason: null },
            [...evidenceUsed, 'address_verified'],
          ),
        );
        const decision = decide({
          evidence,
          candidates: resolved,
          addressVerified: true,
        });
        return finalize(decision, {
          cleanSearchQuery: addrStr,
          warnings,
          diagnostics,
          evidenceUsed,
          timings,
        });
      }
      // Fall through to text-search ladder.
      warnings.push(`address_verify_${verification.reason}`);
    } catch (err) {
      warnings.push('address_verify_threw');
      diagnostics.addressVerifyError = (err as Error)?.message;
    }
  }

  // ---- 2. Text-search ladder -------------------------------------
  const plan = buildQueryPlan(evidence);
  diagnostics.queryPlan = plan.queries;
  if (plan.queries.length === 0) {
    // No explicit place evidence (no address / venue hint / venue handle)
    // AND nothing but casual caption prose to search → do NOT query random
    // Places. This is a normal, safe manual-fallback outcome.
    if (!plan.hasExplicitPlaceEvidence) {
      warnings.push('generic_caption_query_blocked');
      warnings.push('manual_fallback_no_explicit_place_evidence');
      logShareDebug('resolver:no_explicit_place_evidence', {
        platform: evidence.platform,
      });
      return {
        decision: 'manual_fallback',
        candidates: [],
        safeToAutoSave: false,
        confidence: 'low',
        evidenceUsed,
        warnings,
        diagnostics,
        failureReason: 'manual_fallback_no_explicit_place_evidence',
      };
    }
    return {
      decision: 'failed',
      candidates: [],
      safeToAutoSave: false,
      confidence: 'low',
      evidenceUsed,
      warnings,
      diagnostics,
      failureReason: 'no_query',
    };
  }

  // Optional bias from the city/state context. Cheap geocode that
  // can fail silently.
  let bias: SearchBias | null = args.bias ?? null;
  if (!bias && evidence.cityState) {
    try {
      bias = await geocodeContextText(
        `${evidence.cityState.city}, ${evidence.cityState.state}`,
        env.googlePlacesKey,
      );
      timings.mark('context_geocode');
    } catch {
      // ignore — bias is optional
    }
  }

  let lastQuery: string | null = null;
  let candidates: PlacesCandidate[] = [];
  for (const q of plan.queries) {
    lastQuery = q;
    const r = await searchPlaces(q, env.googlePlacesKey, bias ?? undefined);
    if (!r.ok) {
      warnings.push(`places_${r.reason}`);
      diagnostics.placesError = { query: q, reason: r.reason, status: r.status };
      // Hard failure on first attempt — bail.
      if (candidates.length === 0) {
        return {
          decision: 'failed',
          candidates: [],
          safeToAutoSave: false,
          confidence: 'low',
          cleanSearchQuery: q,
          evidenceUsed,
          warnings,
          diagnostics,
          failureReason: 'places_error',
        };
      }
      continue;
    }
    if (r.results.length > 0) {
      candidates = r.results;
      break;
    }
  }
  timings.mark('places_search');
  diagnostics.searchAttempts = plan.queries.indexOf(lastQuery ?? '') + 1;

  if (candidates.length === 0) {
    return {
      decision: 'manual_fallback',
      candidates: [],
      safeToAutoSave: false,
      confidence: 'low',
      cleanSearchQuery: lastQuery ?? undefined,
      evidenceUsed,
      warnings,
      diagnostics,
      failureReason: 'no_candidates',
    };
  }

  // ---- 3. Score + rank + decide ---------------------------------
  const scored = scoreCandidates(candidates, evidence, plan.placeNameHint, bias);

  // Surface platform-noise rejections (TikTok "TikTok Inc." etc.) so they
  // are visible in remote diagnostics and can flip the outcome to manual.
  const noiseRejected = scored.filter(
    (s) => s.rejected && s.rejectionReason === 'platform_noise',
  );
  for (const s of noiseRejected) {
    warnings.push(`platform_noise_candidate_rejected:${s.candidate.name}`);
  }

  const ranked = scored
    .filter((s) => !s.rejected)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    const rejectedCount = scored.length - ranked.length;
    diagnostics.rejectedCount = rejectedCount;
    // If EVERY candidate was platform noise, say so explicitly and punt to
    // manual fallback — never surface a TikTok/company card as a place.
    const allNoise =
      noiseRejected.length > 0 && noiseRejected.length === scored.length;
    if (allNoise) {
      warnings.push('all_candidates_rejected_as_platform_noise');
    }
    return {
      decision: 'manual_fallback',
      candidates: [],
      safeToAutoSave: false,
      confidence: 'low',
      cleanSearchQuery: lastQuery ?? undefined,
      evidenceUsed,
      warnings,
      diagnostics,
      failureReason: allNoise
        ? 'all_candidates_rejected_as_platform_noise'
        : 'wrong_location_only',
    };
  }

  const resolved: ResolvedCandidate[] = ranked.map((s) =>
    toResolvedCandidate(s, evidenceUsed),
  );
  const decision = decide({ evidence, candidates: resolved, addressVerified: false });

  logShareDebug('resolver:done', {
    decision: decision.decision,
    confidence: decision.confidence,
    candidateCount: resolved.length,
    topScore: resolved[0]?.confidenceScore,
    addressFirst: !!evidence.address,
  });

  return finalize(decision, {
    cleanSearchQuery: lastQuery ?? undefined,
    warnings,
    diagnostics,
    evidenceUsed,
    timings,
  });
}

function finalize(
  decision: ReturnType<typeof decide> | {
    decision: ResolverResult['decision'];
    primaryCandidate?: ResolvedCandidate;
    candidates: ResolvedCandidate[];
    safeToAutoSave: boolean;
    confidence: ResolverResult['confidence'];
    reasons: string[];
  },
  ctx: {
    cleanSearchQuery?: string;
    warnings: string[];
    diagnostics: Record<string, unknown>;
    evidenceUsed: string[];
    timings: Timings;
  },
): ResolverResult {
  return {
    decision: decision.decision,
    primaryCandidate: decision.primaryCandidate,
    candidates: decision.candidates,
    cleanSearchQuery: ctx.cleanSearchQuery,
    safeToAutoSave: decision.safeToAutoSave,
    confidence: decision.confidence,
    evidenceUsed: ctx.evidenceUsed,
    warnings: ctx.warnings,
    diagnostics: {
      ...ctx.diagnostics,
      decisionReasons: decision.reasons,
      timings: ctx.timings.toJSON(),
    },
  };
}

// Normalize a Google `formatted_address` for dedupe-by-address.
// Lowercase, strip trailing ", USA"/", United States", collapse
// whitespace + punctuation. Conservative — only used as a fallback
// when googlePlaceId is missing.
function normalizeAddrKey(addr: string): string {
  if (!addr) return '';
  return String(addr)
    .toLowerCase()
    .replace(/,\s*(usa|united states)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Resolve a place from a first-class tagged-location signal. The tag is the
// highest-priority evidence source, but it is NOT trusted blindly:
//   - we build the strongest possible Places query from the tag's
//     name/address/rawText and bias the search to the tag's coordinates,
//   - we score the returned Places candidates against the full evidence,
//   - we NEVER auto-save (safeToAutoSave stays false) — a tag can still point
//     at the wrong nearby unit, so the user confirms in one tap,
//   - multiple close candidates surface a picker (preserve confirmation).
// Returns null when the tag cannot be verified against Places, so the caller
// falls back to the normal caption/address pipeline.
async function resolveFromTaggedLocation(args: {
  evidence: Evidence;
  env: Env;
  warnings: string[];
  diagnostics: Record<string, unknown>;
}): Promise<ResolverResult | null> {
  const { evidence, env, warnings, diagnostics } = args;
  const tag = evidence.taggedLocation;
  if (!tag) return null;

  const query = [tag.placeName, tag.address, tag.rawText]
    .filter(Boolean)
    .join(', ')
    .replace(/\s+/g, ' ')
    .trim();
  const bias =
    Number.isFinite(tag.latitude) && Number.isFinite(tag.longitude)
      ? { lat: tag.latitude as number, lng: tag.longitude as number }
      : null;

  // A tag with no usable query text AND no coordinates can't be verified.
  if (!query && !bias) {
    warnings.push('tagged_location_no_verifiable_fields');
    return null;
  }

  const search = await searchPlaces(
    query || (tag.placeName ?? ''),
    env.googlePlacesKey,
    bias ?? undefined,
  );
  if (!search.ok || search.results.length === 0) {
    warnings.push('tagged_location_places_no_match');
    return null;
  }

  const scored = scoreCandidates(search.results, evidence, tag.placeName ?? null, bias)
    .filter((c) => !c.rejected)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) {
    warnings.push('tagged_location_all_candidates_rejected');
    return null;
  }

  // `tagged_location_verified` marks that a real Google Place backs the tag.
  const taggedKeys = ['tagged_location', 'tagged_location_verified'];
  const resolved = scored.map((s) => toResolvedCandidate(s, taggedKeys));
  const primary = resolved[0];
  const ambiguous =
    scored.length > 1 && scored[0].score - scored[1].score < TAGGED_PICKER_BAND;

  diagnostics.evidenceSourceWon = 'tagged_location';
  diagnostics.taggedLocationQuery = query || null;
  diagnostics.taggedLocationConfidence = tag.confidence;

  return {
    decision: ambiguous ? 'candidate_picker' : 'candidate_confirmation',
    primaryCandidate: primary,
    candidates: resolved,
    cleanSearchQuery: query || undefined,
    // Never auto-save on a tag alone — Places verification is not proof the
    // unit is exactly right. The user confirms in one tap.
    safeToAutoSave: false,
    confidence: 'high',
    evidenceUsed: [...evidence.keys, ...taggedKeys],
    warnings,
    diagnostics,
  };
}
