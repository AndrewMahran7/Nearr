/**
 * Legacy Local UI Mode (formerly "Dev Mode") auth bypass.
 *
 * This mode is now DISABLED BY DEFAULT. The persisted AsyncStorage flag is
 * cleared on app startup so the previous behavior — where signing out
 * would silently re-enter Local UI Mode — can no longer occur.
 *
 * The helpers below remain so a developer can flip ``ALLOW_LOCAL_UI_MODE``
 * in ``hooks/useAuth.ts`` and call ``enableDevAuth()`` programmatically
 * (e.g. from a Metro console) to test offline UI flows. There is no UI
 * entry point.
 *
 * Caveats (unchanged):
 *   - This does NOT create a real Supabase session. ``supabase.auth.getUser``
 *     still returns null. Anything that writes to Supabase will fail RLS.
 *   - The fake user id ('dev-user') is NOT a real ``auth.users.id``.
 *   - We do not bypass RLS, do not use the service role key, and do not
 *     hardcode any real credentials.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'nearr.devAuthEnabled';

export const DEV_USER = {
  id: 'dev-user',
  email: 'dev@nearr.local',
} as const;

let cached = false;
let loaded = false;
const listeners = new Set<(enabled: boolean) => void>();

/**
 * Always returns ``false``. Also clears any previously persisted flag so
 * old installs that had Local UI Mode enabled don't auto-resume it after
 * sign-out. Kept ``async`` to preserve the existing call-site shape.
 */
export async function loadDevAuth(): Promise<boolean> {
  cached = false;
  loaded = true;
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[devAuth] failed to clear legacy flag', e);
  }
  console.log('[devAuth] loaded enabled=false (Local UI Mode disabled)');
  return false;
}

/** Defensive one-shot wipe of the persisted flag. Safe to call any time. */
export async function clearDevAuth(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    console.warn('[devAuth] clear failed', e);
  }
  cached = false;
  loaded = true;
  listeners.forEach((l) => l(false));
}

export function isDevAuthEnabled(): boolean {
  return __DEV__ && cached;
}

export function isDevAuthLoaded(): boolean {
  return loaded;
}

export async function enableDevAuth(): Promise<void> {
  if (!__DEV__) {
    console.warn('[devAuth] enable called in production — ignored');
    return;
  }
  await AsyncStorage.setItem(STORAGE_KEY, '1');
  cached = true;
  loaded = true;
  console.log('[devAuth] enabled');
  listeners.forEach((l) => l(true));
}

export async function disableDevAuth(): Promise<void> {
  // Always allowed — production will be a no-op since cached is already false.
  await AsyncStorage.removeItem(STORAGE_KEY);
  cached = false;
  loaded = true;
  console.log('[devAuth] disabled');
  listeners.forEach((l) => l(false));
}

/** Subscribe to enable/disable changes. Returns an unsubscribe fn. */
export function subscribeDevAuth(fn: (enabled: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
