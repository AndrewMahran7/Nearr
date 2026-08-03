// services/media-worker/src/cli/verifyEvidence.deno.ts
//
// DENO-ONLY, LOCAL-ONLY verification harness for media:inspect.
//
// Runs the EXISTING deterministic resolver + Google Places verification against
// media evidence JSON, WITHOUT any Supabase client, WITHOUT saving, and WITHOUT
// the DB-writing finalize callback. It reuses the identical production modules
// the Deno finalizer uses (renderMediaEvidenceCaption → extractEvidence →
// resolveSharedPlace) so verification is byte-identical to production; it just
// stops before the save step. safeToAutoSave is reported AS-IS, never weakened.
//
// Excluded from the Node tsconfig (see `src/**/*.deno.ts`). Validated with
// `deno check`. Invoked by the Node CLI only when a GOOGLE_PLACES_KEY is present
// and Deno is installed.
//
// Usage: deno run --allow-env --allow-net --allow-read verifyEvidence.deno.ts <evidence.json>
//
// Output: a single JSON line on stdout (sanitized — no keys, no signed URLs).

// @ts-nocheck — Deno runtime + Deno-side resolver types.

import { renderMediaEvidenceCaption } from '../../../../supabase/functions/process-share-jobs/mediaEvidence.ts';
import { buildVenueMentions } from '../../../../supabase/functions/process-share-jobs/mediaMentions.ts';
import { extractEvidence } from '../../../../supabase/functions/process-share-link/evidence/extractEvidence.ts';
import { resolveSharedPlace } from '../../../../supabase/functions/process-share-link/resolver/resolveSharedPlace.ts';
import { readEnv } from '../../../../supabase/functions/process-share-link/env.ts';

function out(obj: unknown): void {
  console.log(JSON.stringify(obj));
}

const file = Deno.args[0];
if (!file) {
  out({ ok: false, reason: 'usage_error' });
  Deno.exit(64);
}

let evidence: unknown;
try {
  evidence = JSON.parse(await Deno.readTextFile(file));
} catch {
  out({ ok: false, reason: 'evidence_read_failed' });
  Deno.exit(65);
}

const env = readEnv();
if (!env.googlePlacesKey) {
  // No key → cannot verify. NEVER contacts Supabase or saves.
  out({ ok: false, reason: 'no_google_places_key' });
  Deno.exit(0);
}

try {
  const rendered = renderMediaEvidenceCaption(evidence as any);
  const emptyHandles = { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null };
  const mediaEvidence = extractEvidence({
    platform: 'instagram',
    title: rendered.title,
    description: rendered.description,
    handles: emptyHandles,
    taggedLocation: null,
  });
  // Structured explicit venue-name mentions → name-driven multi-place path.
  const built = buildVenueMentions(evidence as any);
  const result: any = await resolveSharedPlace({
    evidence: mediaEvidence,
    env,
    mentions: built.mentions,
    geoContext: built.geoContext,
  });

  const mentionResults = Array.isArray(result?.diagnostics?.mentionResults)
    ? result.diagnostics.mentionResults
    : [];

  // Surface the actual rejected candidates (name + reason) so diagnostics never
  // say "not_surfaced_by_resolver_result".
  const rejectedCandidates: { mentionId: string | null; name: string | null; reason: string | null }[] = [];
  for (const m of mentionResults) {
    const scoring = Array.isArray(m?.scoring) ? m.scoring : [];
    for (const s of scoring) {
      if (s?.rejected) {
        rejectedCandidates.push({
          mentionId: m?.mentionId ?? null,
          name: typeof s?.name === 'string' ? s.name : null,
          reason: typeof s?.rejectionReason === 'string' ? s.rejectionReason : null,
        });
      }
    }
  }

  out({
    ok: true,
    renderedPlaces: rendered.renderedPlaces,
    decision: result?.decision ?? null,
    // Reported exactly as the resolver decided — never coerced/loosened.
    safeToAutoSave: result?.safeToAutoSave === true,
    confidence: result?.confidence ?? null,
    cleanSearchQuery: result?.cleanSearchQuery ?? null,
    resolverPath: result?.diagnostics?.resolverPath ?? null,
    evidenceUsed: Array.isArray(result?.evidenceUsed) ? result.evidenceUsed.slice(0, 24) : [],
    // Name-driven mention slots (sanitized). Populated for one OR many names.
    mentionCount: built.mentions.length,
    geoContext: built.geoContext,
    nameDriven: result?.diagnostics?.nameDrivenMultiPlace ?? null,
    rejectedCandidates: rejectedCandidates.slice(0, 20),
    mentionResults: mentionResults.slice(0, 12).map((m: any) => ({
      mentionId: m?.mentionId ?? null,
      displayName: typeof m?.displayName === 'string' ? m.displayName : null,
      outcome: m?.outcome ?? null,
      candidates: (Array.isArray(m?.candidates) ? m.candidates : []).slice(0, 5).map((c: any) => ({
        name: typeof c?.name === 'string' ? c.name : null,
        formattedAddress: typeof c?.formattedAddress === 'string' ? c.formattedAddress : null,
        googlePlaceId: typeof c?.googlePlaceId === 'string' ? c.googlePlaceId : null,
        confidenceScore: typeof c?.confidenceScore === 'number' ? c.confidenceScore : null,
      })),
    })),
    candidateCount: Array.isArray(result?.candidates) ? result.candidates.length : 0,
    candidates: (Array.isArray(result?.candidates) ? result.candidates : []).slice(0, 10).map((c: any) => ({
      name: typeof c?.name === 'string' ? c.name : null,
      formattedAddress: typeof c?.formattedAddress === 'string' ? c.formattedAddress : null,
      googlePlaceId: typeof c?.googlePlaceId === 'string' ? c.googlePlaceId : null,
      matchScore: typeof c?.matchScore === 'number' ? c.matchScore : null,
      confidenceScore: typeof c?.confidenceScore === 'number' ? c.confidenceScore : null,
    })),
  });
} catch (err) {
  out({ ok: false, reason: 'resolver_threw', detail: err instanceof Error ? err.message.slice(0, 200) : 'unknown' });
  Deno.exit(1);
}
