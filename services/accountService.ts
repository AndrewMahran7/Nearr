/**
 * Account deletion — client service.
 *
 * Two responsibilities, kept separate so the caller controls ordering:
 *
 *   1. `deleteAccount()` — call the protected `delete-account` Edge
 *      Function with the current session's access token. Returns a typed
 *      success/failure result and NEVER performs local cleanup itself.
 *      Duplicate/racing calls are coalesced onto a single request.
 *
 *   2. `cleanupAfterAccountDeletion()` — best-effort teardown of local
 *      state, run ONLY after the server confirms success. Stops geofences
 *      and background location, cancels local notifications, clears caches
 *      and onboarding/setup flags, and clears the Supabase session.
 *
 * Security: the deletion authority is the access token only. We never send
 * a user id as the account to delete (see the Edge Function + authToken.ts).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

import { supabase } from '@/lib/supabase';
import {
  classifyDeletionError,
  createSingleFlightGuard,
  DELETE_ACCOUNT_FAILURE_MESSAGE,
  type AccountDeletionResult,
} from '@/lib/accountDeletionCore';
import { clearSavedPlacesCache } from '@/lib/savedPlacesCache';
import { clearOfflineUserData } from '@/lib/offlineIdentity';
import { resetOnboarding } from '@/lib/onboarding';
import { clearOnboardingAccountTransferAfterDeletion } from '@/lib/anonymousOnboarding';
import { rotateOnboardingFunnelId } from '@/lib/onboardingFunnelIdentity';
import { resetOnboardingV2AfterAccountDeletion } from '@/lib/onboardingV2';
import { getHowNearrWorksStorageKey } from '@/components/HowNearrWorksModal';
import { PLACE_NOTIFICATION_DEDUPE_STORAGE_KEY } from '@/lib/placeNotificationDedupe';
import { stopNearrGeofencing } from '@/lib/geofencing';
import { stopProximityWatch } from '@/lib/notifications';
import { signOut } from '@/services/auth';

const DELETE_ACCOUNT_FUNCTION = 'delete-account';

// Unscoped legacy keys and global stores that should be wiped for the
// deleted user on this device.
const SHARE_FAV_DONE_KEY = 'nearr:setupShareFavDone';
const LEGACY_HOW_NEARR_WORKS_KEY = 'nearr:hasSeenHowItWorks';

// Module-level guard so rapid repeated taps (or a Sign-out racing a Delete)
// only ever produce one in-flight deletion request.
const deletionGuard = createSingleFlightGuard<AccountDeletionResult>();

/** True while a deletion request is in flight (for disabling UI). */
export function isAccountDeletionInProgress(): boolean {
  return deletionGuard.isRunning();
}

/**
 * Permanently delete the authenticated user's account via the Edge
 * Function. Does NOT touch local state — on success the caller must run
 * `cleanupAfterAccountDeletion()`. On failure the user remains signed in.
 */
export async function deleteAccount(): Promise<AccountDeletionResult> {
  return deletionGuard.run(async () => {
    // Current, valid session token is the sole deletion authority.
    let accessToken: string | null = null;
    try {
      const { data } = await supabase.auth.getSession();
      accessToken = data.session?.access_token ?? null;
    } catch (err) {
      return {
        ok: false,
        reason: classifyDeletionError(err),
        message: DELETE_ACCOUNT_FAILURE_MESSAGE,
      };
    }

    if (!accessToken) {
      return {
        ok: false,
        reason: 'unauthorized',
        message: DELETE_ACCOUNT_FAILURE_MESSAGE,
      };
    }

    try {
      const { data, error } = await supabase.functions.invoke(
        DELETE_ACCOUNT_FUNCTION,
        {
          method: 'POST',
          // Explicit Authorization header — the account to delete is derived
          // from this token server-side. No user id is ever sent.
          headers: { Authorization: `Bearer ${accessToken}` },
          body: {},
        },
      );

      if (error) {
        // supabase-js FunctionsHttpError exposes `.context` (the Response).
        const status: number | undefined = (error as { context?: { status?: number } })
          ?.context?.status;
        console.warn('[account] delete function error', status ?? 'unknown');
        return {
          ok: false,
          reason: classifyDeletionError(error, status),
          message: DELETE_ACCOUNT_FAILURE_MESSAGE,
        };
      }

      if (!data || (data as { ok?: boolean }).ok !== true) {
        console.warn('[account] delete function returned non-ok payload');
        return {
          ok: false,
          reason: 'server',
          message: DELETE_ACCOUNT_FAILURE_MESSAGE,
        };
      }

      return { ok: true };
    } catch (err) {
      console.warn('[account] delete request threw');
      return {
        ok: false,
        reason: classifyDeletionError(err),
        message: DELETE_ACCOUNT_FAILURE_MESSAGE,
      };
    }
  });
}

/**
 * Best-effort local teardown after a CONFIRMED server-side deletion. Every
 * step is wrapped so a single failure never prevents the others or blocks
 * the return to the pre-auth flow. Always ends by clearing the Supabase
 * session so the app cannot navigate back into authenticated tabs.
 */
export async function cleanupAfterAccountDeletion(
  userId: string | null | undefined,
): Promise<void> {
  // Stop OS-level tracking first so the device isn't left watching regions
  // for a user that no longer exists.
  try {
    await stopNearrGeofencing();
  } catch (err) {
    console.warn('[account] cleanup: stopNearrGeofencing failed', err);
  }
  try {
    await stopProximityWatch();
  } catch (err) {
    console.warn('[account] cleanup: stopProximityWatch failed', err);
  }

  // Cancel any locally scheduled/delivered notifications.
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch (err) {
    console.warn('[account] cleanup: cancel scheduled failed', err);
  }
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch (err) {
    console.warn('[account] cleanup: dismiss delivered failed', err);
  }

  // Saved-place cache (scoped to the deleted user).
  try {
    await clearSavedPlacesCache(userId);
  } catch (err) {
    console.warn('[account] cleanup: clearSavedPlacesCache failed', err);
  }

  // Offline reminder snapshot + the identity pointer that unlocks the local
  // caches. Without this a deleted account could still drive offline nearby
  // reminders from data the server no longer has.
  try {
    await clearOfflineUserData(userId);
  } catch (err) {
    console.warn('[account] cleanup: clearOfflineUserData failed', err);
  }

  // Onboarding completion flag (scoped to the deleted user).
  try {
    if (userId) await resetOnboarding(userId);
  } catch (err) {
    console.warn('[account] cleanup: resetOnboarding failed', err);
  }

  // Account deletion is a hard identity boundary. Replace the V2 snapshot in
  // memory and storage, remove any one-time transfer grant, and rotate the
  // device funnel before auth changes can mount the signed-out onboarding UI.
  try {
    await resetOnboardingV2AfterAccountDeletion();
  } catch (err) {
    console.warn('[account] cleanup: resetOnboardingV2AfterAccountDeletion failed', err);
  }
  try {
    await clearOnboardingAccountTransferAfterDeletion();
  } catch (err) {
    console.warn('[account] cleanup: clear onboarding transfer failed', err);
  }
  try {
    await rotateOnboardingFunnelId();
  } catch (err) {
    console.warn('[account] cleanup: rotate onboarding funnel failed', err);
  }

  // Onboarding/setup flags + global dedupe store.
  try {
    const keys = [
      SHARE_FAV_DONE_KEY,
      LEGACY_HOW_NEARR_WORKS_KEY,
      PLACE_NOTIFICATION_DEDUPE_STORAGE_KEY,
    ];
    if (userId) keys.push(getHowNearrWorksStorageKey(userId));
    await AsyncStorage.multiRemove(keys);
  } catch (err) {
    console.warn('[account] cleanup: flag removal failed', err);
  }

  // Finally clear the local Supabase session. This flips `useAuth` to
  // signed-out and lets AuthGate route back to the pre-auth flow.
  try {
    await signOut();
  } catch (err) {
    console.warn('[account] cleanup: signOut failed', err);
  }
}
