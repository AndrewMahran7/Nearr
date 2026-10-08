/** A server-issued attempt/lease pair binds callbacks to the exact claimed
 * task generation. User-supplied confidence and job IDs are never authority. */
export function evaluateMediaClaimFence(task: {
  status?: unknown; attempts?: unknown; locked_at?: unknown;
}, presented: unknown): { allowed: boolean; reason: string } {
  if (['completed', 'needs_help', 'failed', 'cancelled'].includes(String(task.status))) {
    return { allowed: false, reason: 'task_terminal' };
  }
  if (task.status !== 'processing') return { allowed: false, reason: 'task_not_claimed' };
  const claim = presented && typeof presented === 'object' ? presented as Record<string, unknown> : {};
  if (!Number.isSafeInteger(claim.attempt) || Number(claim.attempt) < 1 ||
      typeof claim.lockedAt !== 'string' || !Number.isFinite(Date.parse(claim.lockedAt))) {
    return { allowed: false, reason: 'missing_claim_identity' };
  }
  if (claim.attempt !== task.attempts || typeof task.locked_at !== 'string' ||
      Date.parse(claim.lockedAt) !== Date.parse(task.locked_at)) {
    return { allowed: false, reason: 'superseded_claim' };
  }
  return { allowed: true, reason: 'current_claim' };
}
