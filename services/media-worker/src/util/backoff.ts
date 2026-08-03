// services/media-worker/src/util/backoff.ts
//
// Bounded exponential backoff for media-task retries. Pure + unit-tested.
//
// With base=30, max=900 the schedule (by post-claim attempt number) is:
//   attempt 1 -> 30s, 2 -> 60s, 3 -> 120s, 4 -> 240s, 5 -> 480s, 6+ -> 900s.
// The cap prevents an unbounded wait; combined with the DB `max_attempts` gate
// this guarantees a task can never retry forever and pg_cron can never hot-loop
// on it (a queued task with a future next_attempt_at is skipped by the claim).

export function computeBackoffSeconds(
  attempts: number,
  baseSeconds = 30,
  maxSeconds = 900,
): number {
  const n = Math.max(1, Math.floor(attempts));
  const base = Math.max(1, Math.floor(baseSeconds));
  const cap = Math.max(base, Math.floor(maxSeconds));
  // 2^(n-1) can overflow for large n; clamp the exponent.
  const exp = Math.min(n - 1, 30);
  const raw = base * 2 ** exp;
  return Math.min(cap, raw);
}

export function computeRetryDelaySeconds(
  attempts: number,
  baseSeconds = 30,
  maxSeconds = 900,
  retryAfterSeconds?: number,
  random = Math.random,
): number {
  const cap = Math.max(1, Math.floor(maxSeconds));
  const exponential = computeBackoffSeconds(attempts, baseSeconds, cap);
  const jitter = Math.max(0, Math.min(1, random())) * 0.2;
  const jittered = Math.min(cap, Math.ceil(exponential * (1 + jitter)));
  const retryAfter = Number.isFinite(retryAfterSeconds)
    ? Math.max(0, Math.floor(retryAfterSeconds!))
    : 0;
  return Math.min(cap, Math.max(jittered, retryAfter));
}

export function parseRetryAfterSeconds(value: string | null, nowMs = Date.now()): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds);
  const dateMs = Date.parse(value);
  if (!Number.isFinite(dateMs)) return undefined;
  return Math.max(0, Math.ceil((dateMs - nowMs) / 1000));
}
