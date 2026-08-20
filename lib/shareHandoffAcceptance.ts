/**
 * Resolve the indeterminate "request sent, acknowledgement lost" boundary.
 *
 * create-share-job stores clientRequestId unchanged as the owner-scoped,
 * unique share_jobs.idempotency_key. A timeout/network error after dispatch is
 * therefore not definitive: if that durable row exists, queue acceptance is
 * already complete and must win over the transport failure.
 *
 * Pure/injectable so the real async lifecycle is covered without importing the
 * host Supabase singleton into tests. Never logs or returns lookup errors.
 */

import type { CreateShareJobResult } from './shareJobClient';

export type DurableShareJob = { id: string; status?: string | null };

export async function reconcileDurableShareAcceptance(args: {
  result: CreateShareJobResult;
  clientRequestId: string;
  findByClientRequestId: (clientRequestId: string) => Promise<DurableShareJob | null>;
}): Promise<CreateShareJobResult> {
  if (args.result.ok) return args.result;
  if (args.result.reason !== 'timeout' && args.result.reason !== 'network') {
    return args.result;
  }
  if (!args.clientRequestId) return args.result;

  try {
    const durable = await args.findByClientRequestId(args.clientRequestId);
    if (!durable || typeof durable.id !== 'string' || !durable.id) return args.result;
    return {
      ok: true,
      jobId: durable.id,
      status: typeof durable.status === 'string' ? durable.status : 'queued',
      // The response acknowledgement was lost, so created-vs-existing cannot
      // be distinguished. Treat it as an idempotent acceptance.
      duplicate: true,
    };
  } catch {
    return args.result;
  }
}
