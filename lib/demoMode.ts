/**
 * Demo Mode — fully self-contained UX testing mode.
 *
 * Enabled by `EXPO_PUBLIC_DEMO_MODE=true` AND `__DEV__ === true`. When
 * enabled:
 *   - Auth is bypassed with a fake `demo-user` (see `hooks/useAuth.ts`).
 *   - All Supabase calls are short-circuited to local in-memory /
 *     AsyncStorage-backed implementations (see `services/demo/*`).
 *   - Google Places search returns local mock candidates.
 *   - Background location, notifications, and the share-link metadata
 *     fetch are mocked so the app runs with zero external API keys.
 *
 * Production safety:
 *   - `__DEV__` is false in production EAS / `expo export` builds, so this
 *     flag is a no-op there even if the env var leaks.
 *   - If `EXPO_PUBLIC_DEMO_MODE=true` is set in a non-dev build, we log a
 *     warning and ignore it.
 */

const RAW = process.env.EXPO_PUBLIC_DEMO_MODE;
const REQUESTED = RAW === 'true' || RAW === '1';

let warnedProdLeak = false;

export const DEMO_USER = {
  id: 'demo-user',
  email: 'demo@nearr.local',
} as const;

export function isDemoMode(): boolean {
  if (!REQUESTED) return false;
  if (!__DEV__) {
    if (!warnedProdLeak) {
      // eslint-disable-next-line no-console
      console.warn(
        '[demoMode] EXPO_PUBLIC_DEMO_MODE=true was set in a non-dev build — ignoring.',
      );
      warnedProdLeak = true;
    }
    return false;
  }
  return true;
}

/** Returns true if the env var was set (regardless of whether it took effect). */
export function isDemoModeRequested(): boolean {
  return REQUESTED;
}
