/**
 * Pure, React-Native-free core for the in-app account-deletion flow.
 *
 * Everything here is deterministic and dependency-free so it can be unit
 * tested with ts-node (see scripts/testAccountDeletion.ts). The RN pieces
 * (native Alert confirmation, navigation reset, AsyncStorage cleanup) live
 * in services/accountService.ts and app/(tabs)/settings.tsx.
 *
 * The exact confirmation copy is centralized here because Apple App Review
 * (Guideline 5.1.1(v)) requires a clear, deliberate deletion flow — the
 * strings are asserted verbatim in tests so they cannot silently drift.
 */

// ---------------------------------------------------------------------------
// Confirmation copy (two-step, deliberate)
// ---------------------------------------------------------------------------

export const DELETE_ACCOUNT_FIRST_CONFIRM = {
  title: 'Delete your account?',
  body: 'This permanently deletes your Nearr account, saved places, notes, reminder history, and other account data. This cannot be undone.',
  cancelLabel: 'Cancel',
  continueLabel: 'Continue',
} as const;

export const DELETE_ACCOUNT_FINAL_CONFIRM = {
  title: 'Permanently delete account?',
  body: 'This action cannot be undone.',
  cancelLabel: 'Cancel',
  confirmLabel: 'Delete my account',
} as const;

/** Shown when server deletion fails; the user stays signed in and can retry. */
export const DELETE_ACCOUNT_FAILURE_MESSAGE =
  "We couldn't delete your account. Please try again.";

// ---------------------------------------------------------------------------
// Result + error classification
// ---------------------------------------------------------------------------

export type AccountDeletionFailureReason =
  | 'unauthorized'
  | 'network'
  | 'server'
  | 'in_progress';

export type AccountDeletionResult =
  | { ok: true }
  | { ok: false; reason: AccountDeletionFailureReason; message: string };

/**
 * Map an arbitrary thrown value / status into a stable failure reason.
 * Never throws. Used by the client service so the UI can decide whether to
 * keep the user signed in (always, on any failure) and what to surface.
 */
export function classifyDeletionError(
  err: unknown,
  httpStatus?: number,
): AccountDeletionFailureReason {
  if (httpStatus === 401 || httpStatus === 403) return 'unauthorized';
  if (typeof httpStatus === 'number' && httpStatus >= 500) return 'server';

  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : (err as { message?: unknown })?.message;
  const lower = typeof message === 'string' ? message.toLowerCase() : '';

  if (
    lower.includes('network request failed') ||
    lower.includes('failed to fetch') ||
    lower.includes('networkerror') ||
    lower.includes('network error') ||
    lower.includes('timeout') ||
    lower.includes('offline')
  ) {
    return 'network';
  }
  if (lower.includes('unauthorized') || lower.includes('401')) {
    return 'unauthorized';
  }
  return 'server';
}

// ---------------------------------------------------------------------------
// Single-flight guard (duplicate-tap / racing-call protection)
// ---------------------------------------------------------------------------

export type SingleFlightGuard<T> = {
  /** Run `fn` unless a call is already in flight, in which case reuse it. */
  run(fn: () => Promise<T>): Promise<T>;
  isRunning(): boolean;
};

/**
 * Create a guard that coalesces concurrent calls onto a single in-flight
 * promise. Rapid repeated taps therefore invoke the underlying operation
 * exactly once until it settles.
 */
export function createSingleFlightGuard<T>(): SingleFlightGuard<T> {
  let inflight: Promise<T> | null = null;
  return {
    run(fn) {
      if (inflight) return inflight;
      inflight = (async () => {
        try {
          return await fn();
        } finally {
          inflight = null;
        }
      })();
      return inflight;
    },
    isRunning() {
      return inflight !== null;
    },
  };
}
