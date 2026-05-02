/**
 * lib/sharedAuth.ts
 *
 * Thin wrapper around the local `nearr-shared-auth` Expo Module that
 * persists the current Supabase access token into the App Group's shared
 * UserDefaults so the iOS Share Extension can read it.
 *
 * Why a wrapper:
 *   - Re-exports a single `sharedAuth` object so callers don't import the
 *     module directly (cleaner refactor target if we ever swap the
 *     transport, e.g. to Keychain Access Groups).
 *   - Provides safe no-op behavior on Android, in Expo Go, in unit
 *     tests, or before the user has run `expo prebuild --clean` to
 *     autolink the local module.
 *   - Centralizes logging so we can see in dev whether the token write
 *     actually reached native (without ever logging the token itself).
 */

import { Platform } from 'react-native';

import nativeSharedAuth from '../modules/nearr-shared-auth';

const PLATFORM_OK = Platform.OS === 'ios';

export const sharedAuth = {
  /** True if the native module is available on this platform/build. */
  isAvailable(): boolean {
    return PLATFORM_OK && nativeSharedAuth.isAvailable();
  },

  /**
   * Persist the current access token into the App Group container.
   * Pass `null` to clear (e.g. on sign-out). Returns true if the write
   * reached native; false on platform / linkage / runtime failure.
   */
  setToken(token: string | null): boolean {
    if (!PLATFORM_OK) return false;
    const ok = nativeSharedAuth.setToken(token);
    if (__DEV__) {
      // Never log the token itself — only presence.
      console.debug('[sharedAuth] setToken ok=', ok, 'present=', !!token);
    } else if (!ok) {
      // Log failures outside dev so we can see them in production crash
      // reporters. Causes: App Group not provisioned, native module not
      // linked, or AppGroup key missing from host app Info.plist.
      console.warn('[sharedAuth] setToken failed: App Group write returned false');
    }
    return ok;
  },

  /** Read the token previously written by the host app. */
  getToken(): string | null {
    if (!PLATFORM_OK) return null;
    return nativeSharedAuth.getToken();
  },

  /** Convenience for sign-out. */
  clearToken(): boolean {
    if (!PLATFORM_OK) return false;
    const ok = nativeSharedAuth.clearToken();
    if (__DEV__) console.debug('[sharedAuth] clearToken ok=', ok);
    return ok;
  },

  /** Returns the App Group identifier read from Info.plist (debug only). */
  getAppGroup(): string | null {
    if (!PLATFORM_OK) return null;
    return nativeSharedAuth.getAppGroup();
  },
};

export default sharedAuth;
