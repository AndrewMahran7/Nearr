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
  const ranked = scored
    .filter((s) => !s.rejected)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) {
    const rejectedCount = scored.length - ranked.length;
    diagnostics.rejectedCount = rejectedCount;
    return {
      decision: 'manual_fallback',
      candidates: [],
      safeToAutoSave: false,
      confidence: 'low',
      cleanSearchQuery: lastQuery ?? undefined,
      evidenceUsed,
      warnings,
      diagnostics,
      failureReason: 'wrong_location_only',
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
  decision: ReturnType<typeof decide>,
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
