/**
 * lib/shareJobsDedupe.ts
 *
 * PURE defensive dedupe for the in-app share-job queue. The database is the
 * source of truth, but repeated realtime events, a realtime insert arriving
 * during the initial fetch, or an accidental duplicate row must never render
 * the same job twice (or crash the list). This collapses by STABLE job id,
 * keeps the freshest copy (by updated_at), preserves first-seen order, and
 * drops malformed / id-less rows so the queue only shows intended jobs.
 *
 * Dependency-free — runnable under ts-node.
 */

type MinimalJob = { id?: unknown; updated_at?: unknown };

/** Parse an ISO timestamp to epoch ms, or NaN. */
function ts(value: unknown): number {
  if (typeof value !== 'string' || !value) return NaN;
  return Date.parse(value);
}

/**
 * Dedupe jobs by `id`, keeping the freshest by `updated_at` (falling back to
 * the latest-seen). Rows without a string id are dropped. Input order is
 * preserved by first occurrence, so the caller's sort is respected.
 */
export function dedupeJobsById<T extends MinimalJob>(jobs: readonly T[] | null | undefined): T[] {
  if (!Array.isArray(jobs)) return [];
  const byId = new Map<string, T>();
  const order: string[] = [];
  for (const job of jobs) {
    if (!job || typeof job !== 'object') continue;
    const id = typeof (job as MinimalJob).id === 'string' ? ((job as MinimalJob).id as string) : null;
    if (!id) continue;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, job);
      order.push(id);
      continue;
    }
    const a = ts(existing.updated_at);
    const b = ts(job.updated_at);
    // Keep the existing row ONLY when it is strictly newer than the incoming
    // one. Otherwise the later-seen row wins (fresher realtime data, a tie, or
    // when timestamps are missing/unparseable) so the queue reflects the most
    // recent state without an older duplicate clobbering a newer one.
    if (Number.isFinite(a) && Number.isFinite(b) && a > b) {
      // keep existing
    } else {
      byId.set(id, job);
    }
  }
  return order.map((id) => byId.get(id) as T);
}

/**
 * Merge a realtime-updated job into an existing list without duplicating it:
 * replaces the row with the same id (keeping list position) or appends it.
 * Returns a new array; never mutates the input.
 */
export function upsertJobById<T extends MinimalJob>(jobs: readonly T[], incoming: T): T[] {
  const id = typeof (incoming as MinimalJob).id === 'string' ? ((incoming as MinimalJob).id as string) : null;
  if (!id) return Array.isArray(jobs) ? [...jobs] : [];
  let replaced = false;
  const next = (Array.isArray(jobs) ? jobs : []).map((job) => {
    if (typeof (job as MinimalJob).id === 'string' && (job as MinimalJob).id === id) {
      replaced = true;
      return incoming;
    }
    return job;
  });
  if (!replaced) next.push(incoming);
  return next;
}
