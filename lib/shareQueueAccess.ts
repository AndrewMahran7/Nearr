/**
 * lib/shareQueueAccess.ts
 *
 * "Can this user reach their share queue?" — deliberately a DIFFERENT question
 * from "should new shares be processed asynchronously?".
 *
 * Those two were the same boolean, `isAsyncShareJobsEnabled()`, and that is how
 * the Queue button vanished from a shipped build. The flag resolves from
 * `EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED` at BUNDLE time (falling back to
 * `extra.asyncShareJobsEnabled`, which app.config.js sets from the same env
 * var). A bundle built in an environment without that variable — an OTA update
 * published from a checkout that has no such entry in `.env` — resolves it to
 * false, and `ShareQueueButton` returned `null` before any layout ran. No
 * amount of repositioning the overlay could make an unmounted node visible.
 *
 * Reachability is now about the user, not the rollout: a signed-in real account
 * can always open its own queue and read its own jobs (RLS-scoped, and empty is
 * a perfectly good answer). The async WRITE path — app/share.tsx and
 * ShareExtension.tsx deciding to create a share job instead of resolving
 * synchronously — stays gated on `isAsyncShareJobsEnabled()` exactly as before,
 * because that IS a rollout decision.
 *
 * PURE — no React, no expo-constants, no I/O. Unit-tested from ts-node.
 */

export type ShareQueueAccessInput = {
  /** A real Supabase session exists. */
  signedIn: boolean;
  /** Local dev-auth session — no server rows to read. */
  isDevSession: boolean;
  /** Demo mode renders seeded data and must never hit the network. */
  isDemoMode: boolean;
};

/**
 * True when the queue is a real place the user can go. Fetching, the badge
 * count, and the map entry point all follow this — so the button can never be
 * offered when the screen behind it would be dead, and can never disappear
 * while there is still something to read.
 */
export function canReachShareQueue(input: ShareQueueAccessInput): boolean {
  if (!input.signedIn) return false;
  if (input.isDevSession) return false;
  if (input.isDemoMode) return false;
  return true;
}
