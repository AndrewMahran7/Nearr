// services/media-worker/src/pipeline/verifyPlaceEvidence.ts
//
// Hand proposed evidence to Nearr's EXISTING deterministic resolver by calling
// the process-share-jobs finalize endpoint. The worker never verifies against
// Google Places or decides safeToAutoSave itself — that stays in one place.
//
// A dedicated MEDIA_FINALIZE_SECRET authenticates this server-to-server call —
// NOT the Supabase service-role key, so a service-role rotation can never
// silently break this callback. It is used INTERNALLY only and is never
// logged, returned to clients, or sent via pg_net.

import type { WorkerConfig } from '../config/env.js';
import type { MediaPlaceEvidence } from '../types/evidence.js';

export type FinalizeOutcome = 'evidence' | 'insufficient_evidence' | 'unavailable' | 'failed';

/**
 * Bounded PUBLIC post metadata the media resolver already obtained during
 * retrieval (yt-dlp's `-j` probe). Forwarded so the resolver sees the SAME
 * first-party identity evidence the ordinary metadata path would have had.
 *
 * Why this exists: when Instagram's own metadata endpoint fails, the job falls
 * back to media — but the fallback used to hand the resolver ONLY the model's
 * structured places, so a caption naming the venue (`@santafeimporters1947`)
 * was used to prompt the model and then discarded. A post whose venue is named
 * in text degraded into an address-only guess. No extra network request: this
 * is metadata the download already fetched.
 */
export type MediaSourceMetadata = {
  title?: string | null;
  description?: string | null;
  /** The post author's handle — sent so the resolver can EXCLUDE it, never to
   *  be used as a venue name. */
  creatorHandle?: string | null;
  postId?: string | null;
  sourceId?: string | null;
  creatorName?: string | null;
  creatorId?: string | null;
};

export type FinalizeArgs = {
  taskId: string;
  /** Internal places.id used to generate targeted evidence. */
  targetPlaceId?: string | null;
  /** Canonical source URL used for this generation snapshot. */
  targetSourceUrl?: string | null;
  outcome: FinalizeOutcome;
  evidence?: MediaPlaceEvidence;
  sourceMetadata?: MediaSourceMetadata;
  /** Stronger exact source URL discovered during public media retrieval. */
  canonicalUrl?: string | null;
  diagnostics?: Record<string, unknown>;
  signal: AbortSignal;
};

export type FinalizeResponse = {
  ok: boolean;
  status: number;
  route?: string;
  enriched?: boolean;
  reason?: string;
  disposition?: string;
  retryAfterSeconds?: number;
};

export async function verifyPlaceEvidence(
  cfg: WorkerConfig,
  args: FinalizeArgs,
  fetchImpl: typeof fetch = fetch,
): Promise<FinalizeResponse> {
  const res = await fetchImpl(cfg.finalizeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.mediaFinalizeSecret}`,
    },
    body: JSON.stringify({
      mode: 'finalize_media_task',
      taskId: args.taskId,
      targetPlaceId: args.targetPlaceId ?? undefined,
      targetSourceUrl: args.targetSourceUrl ?? undefined,
      outcome: args.outcome,
      evidence: args.outcome === 'evidence' ? args.evidence : undefined,
      // Sent on EVERY outcome, not just `evidence`. The caption can name a
      // venue even when the model found no structured place at all.
      sourceMetadata: args.sourceMetadata,
      canonicalUrl: args.canonicalUrl,
      diagnostics: args.diagnostics ?? {},
    }),
    signal: args.signal,
  });

  let route: string | undefined;
  let enriched: boolean | undefined;
  let reason: string | undefined;
  let disposition: string | undefined;
  try {
    const body = (await res.json()) as {
      route?: unknown;
      enriched?: unknown;
      reason?: unknown;
      disposition?: unknown;
    };
    route = typeof body?.route === 'string' ? body.route.slice(0, 120) : undefined;
    enriched = typeof body?.enriched === 'boolean' ? body.enriched : undefined;
    reason = typeof body?.reason === 'string' ? body.reason.slice(0, 200) : undefined;
    disposition = typeof body?.disposition === 'string' ? body.disposition.slice(0, 120) : undefined;
  } catch {
    /* ignore body parse errors */
  }
  const retryAfter = res.headers.get('retry-after');
  const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter)
    ? Number(retryAfter)
    : undefined;
  return { ok: res.ok, status: res.status, route, enriched, reason, disposition, retryAfterSeconds };
}
