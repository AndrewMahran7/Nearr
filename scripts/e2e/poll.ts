/**
 * scripts/e2e/poll.ts
 *
 * Bounded state polling + the stage timeout budget.
 *
 * A fixed sleep is a lie about a distributed system: it either wastes time or
 * fails a pipeline that was merely slow. Every wait in this suite therefore
 * polls real observable state, returns the moment the predicate holds, and on
 * timeout hands back the LAST OBSERVED value so the failure can say what the
 * system actually looked like rather than only that it took too long.
 */

export type PollOutcome<T> =
  | { ok: true; value: T; elapsedMs: number; attempts: number }
  | { ok: false; last: T | null; elapsedMs: number; attempts: number; error?: string };

export type PollOptions = {
  timeoutMs: number;
  /** Interval between observations. Kept modest: these are cheap PostgREST reads. */
  intervalMs?: number;
  /** Abort early (and fail) when this returns a reason — e.g. a terminal state. */
  abortWhen?: (value: unknown) => string | null;
};

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Observe `read` until `done` accepts the value or the budget expires.
 *
 * `read` returning null means "not visible yet" and is never an error: a row
 * that has not been created is a legitimate intermediate state.
 */
export async function pollUntil<T>(
  read: () => Promise<T | null>,
  done: (value: T) => boolean,
  options: PollOptions,
): Promise<PollOutcome<T>> {
  const startedAt = Date.now();
  const interval = options.intervalMs ?? 1_000;
  let last: T | null = null;
  let attempts = 0;

  for (;;) {
    attempts += 1;
    let observed: T | null = null;
    let readError: string | undefined;
    try {
      observed = await read();
    } catch (err) {
      readError = err instanceof Error ? err.message : String(err);
    }
    if (observed !== null && observed !== undefined) {
      last = observed;
      if (done(observed)) {
        return { ok: true, value: observed, elapsedMs: Date.now() - startedAt, attempts };
      }
      const abort = options.abortWhen?.(observed);
      if (abort) {
        return { ok: false, last, elapsedMs: Date.now() - startedAt, attempts, error: abort };
      }
    }
    const remaining = options.timeoutMs - (Date.now() - startedAt);
    if (remaining <= 0) {
      return { ok: false, last, elapsedMs: Date.now() - startedAt, attempts, error: readError };
    }
    // Clamp to the remaining budget. Sleeping a full interval near the deadline
    // would overshoot the stated timeout by up to one interval, which makes the
    // reported elapsed time disagree with the budget the failure message names.
    await sleep(Math.min(interval, remaining));
  }
}

/**
 * Stage timeout budget.
 *
 * These are derived from the real architecture, not guessed:
 *
 *  - `createJob`      one authenticated Edge round trip.
 *  - `edgeClaim`      `process-share-jobs` is dispatched by a pg_net kick with a
 *                     per-minute pg_cron backstop, so the worst honest case is
 *                     one missed kick plus a full cron period.
 *  - `mediaTask`      the enqueue happens inside the same Edge invocation that
 *                     finished metadata, so it follows within seconds.
 *  - `railwayClaim`   same hybrid dispatch as above (pg_net kick + per-minute
 *                     cron sweep), against a container that may be cold.
 *  - `workerStage`    media acquisition up to the first controlled stop.
 *  - `finalize`       the worker callback into `process-share-jobs` plus the
 *                     deterministic resolver + save path.
 *  - `terminal`       the parent job reaching a terminal status.
 *
 * Every one is overridable so a slow day does not require a code change:
 * NEARR_E2E_TIMEOUT_<STAGE>_MS, e.g. NEARR_E2E_TIMEOUT_RAILWAYCLAIM_MS=180000.
 */
export const DEFAULT_TIMEOUTS = {
  createJob: 20_000,
  edgeClaim: 90_000,
  mediaTask: 60_000,
  railwayClaim: 150_000,
  workerStage: 120_000,
  finalize: 120_000,
  terminal: 240_000,
} as const;

export type StageName = keyof typeof DEFAULT_TIMEOUTS;

export function timeoutFor(stage: StageName): number {
  const override = process.env[`NEARR_E2E_TIMEOUT_${stage.toUpperCase()}_MS`];
  const parsed = Number(override);
  if (Number.isFinite(parsed) && parsed >= 1_000) return Math.floor(parsed);
  return DEFAULT_TIMEOUTS[stage];
}
