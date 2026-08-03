/**
 * lib/onceLatch.ts
 *
 * A minimal, PURE one-shot latch. The first `acquire()` wins and returns true;
 * every later call returns false. Extracted so the "navigate exactly once"
 * invariant on the share-job confirmation screen (Step 6 of the crash audit)
 * is unit-testable without a React render harness.
 *
 * Why this exists: a boolean React ref works, but a double-tap, a late
 * realtime/poll update, or a retried save could each call the terminal
 * navigation. Routing to `/(tabs)/map` more than once from a screen that is
 * being torn down can leave a half-unmounted subtree behind the map and
 * surface as an intermittent crash on return. Gating navigation behind a latch
 * makes "at most one navigation per inbound action" explicit and testable.
 */

export type OnceLatch = {
  /** Acquire the latch. Returns true exactly once (the first call). */
  acquire(): boolean;
  /** Whether the latch has already been acquired. */
  acquired(): boolean;
};

export function createOnceLatch(): OnceLatch {
  let taken = false;
  return {
    acquire() {
      if (taken) return false;
      taken = true;
      return true;
    },
    acquired() {
      return taken;
    },
  };
}
