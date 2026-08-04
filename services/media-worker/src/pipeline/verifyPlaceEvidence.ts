// services/media-worker/src/pipeline/verifyPlaceEvidence.ts
//
// Hand proposed evidence to Nearr's EXISTING deterministic resolver by calling
// the process-share-jobs finalize endpoint. The worker never verifies against
// Google Places or decides safeToAutoSave itself — that stays in one place.
//
// The service-role key authenticates this server-to-server call. It is used
// INTERNALLY only and is never logged, returned to clients, or sent via pg_net.

import type { WorkerConfig } from '../config/env.js';
import type { MediaPlaceEvidence } from '../types/evidence.js';

export type FinalizeOutcome = 'evidence' | 'insufficient_evidence' | 'unavailable' | 'failed';

export type FinalizeArgs = {
  taskId: string;
  outcome: FinalizeOutcome;
  evidence?: MediaPlaceEvidence;
  diagnostics?: Record<string, unknown>;
  signal: AbortSignal;
};

export type FinalizeResponse = {
  ok: boolean;
  status: number;
  route?: string;
  retryAfterSeconds?: number;
};

export async function verifyPlaceEvidence(
  cfg: WorkerConfig,
  args: FinalizeArgs,
): Promise<FinalizeResponse> {
  const res = await fetch(cfg.finalizeUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${cfg.supabaseServiceRoleKey}`,
    },
    body: JSON.stringify({
      mode: 'finalize_media_task',
      taskId: args.taskId,
      outcome: args.outcome,
      evidence: args.outcome === 'evidence' ? args.evidence : undefined,
      diagnostics: args.diagnostics ?? {},
    }),
    signal: args.signal,
  });

  let route: string | undefined;
  try {
    const body = (await res.json()) as { route?: string };
    route = body?.route;
  } catch {
    /* ignore body parse errors */
  }
  const retryAfter = res.headers.get('retry-after');
  const retryAfterSeconds = retryAfter && /^\d+$/.test(retryAfter)
    ? Number(retryAfter)
    : undefined;
  return { ok: res.ok, status: res.status, route, retryAfterSeconds };
}
