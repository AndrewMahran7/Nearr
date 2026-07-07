/**
 * Onboarding completion state (Stage 0/1).
 *
 * Source of truth for whether a user has finished the first-run onboarding
 * flow (`app/(onboarding)`). Backed by AsyncStorage, per-user, versioned so a
 * future flow revision can re-trigger onboarding by bumping the key version.
 *
 * Design rules:
 *   - **Fail open, forward.** A full-screen onboarding route cannot be
 *     "dismissed past", so if we cannot READ the flag we treat the user as
 *     already onboarded (never trap them). This is the opposite of the
 *     dismissible `HowNearrWorksModal`, which fails open by re-showing.
 *   - Write failures are logged but never block the user.
 *   - No network call. Existing-user detection uses the local saved-places
 *     cache only.
 *   - No Supabase column — this is intentionally per-install for now.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

import { hasSeenHowNearrWorks } from '@/components/HowNearrWorksModal';
import { readSavedPlacesCache } from '@/lib/savedPlacesCache';

export type OnboardingStatus = 'required' | 'complete';

const COMPLETED_KEY_PREFIX = 'nearr:onboarding:completed:v1:';

function completedKey(userId: string): string {
  return `${COMPLETED_KEY_PREFIX}${userId}`;
}

// ---------------------------------------------------------------------------
// In-memory completion cache + pub/sub.
//
// When a user finishes onboarding, every mounted `useOnboardingStatus`
// instance (AuthGate + app/index) must see completion IMMEDIATELY — otherwise
// AuthGate would still read the stale AsyncStorage-derived 'required' state
// and bounce the user straight back into onboarding. This synchronous memory
// cache closes that gap; AsyncStorage is the durable backing store.
// ---------------------------------------------------------------------------
const completedMemory = new Set<string>();
type Listener = () => void;
const listeners = new Set<Listener>();

function notifyListeners(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      // A listener throwing must never break completion or other listeners.
    }
  });
}

/** Subscribe to completion/reset changes. Returns an unsubscribe function. */
export function subscribeOnboarding(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Synchronous check for a completion recorded during this app session. */
export function isOnboardingCompleteInMemory(userId: string): boolean {
  return completedMemory.has(userId);
}

// ---------------------------------------------------------------------------
// Dev-only onboarding preview.
//
// AuthGate normally routes dev/demo sessions away from `/(onboarding)`. When a
// developer manually opens the flow from the Settings QA button, this flag
// lets AuthGate keep them on the onboarding route for that one preview. It is
// ONLY ever set by the `__DEV__`-gated Settings button, so production gating is
// unaffected.
// ---------------------------------------------------------------------------
let previewActive = false;

/** Enable/disable the manual dev onboarding preview (Settings QA only). */
export function setOnboardingPreview(active: boolean): void {
  previewActive = active;
}

/** Whether a manual dev onboarding preview is currently requested. */
export function isOnboardingPreviewActive(): boolean {
  return previewActive;
}


/**
 * Resolve onboarding status for a user.
 *
 * Order of precedence:
 *   1. In-memory completion (just finished this session).
 *   2. Persisted new flag `nearr:onboarding:completed:v1:<userId>`.
 *      (Read failure → fail open to 'complete'.)
 *   3. Legacy migration: if the old `HowNearrWorks` "seen" flag is set,
 *      treat as complete and write the new flag.
 *   4. Existing user: if `hasSavedPlaces` was passed true, or the local
 *      saved-places cache has ≥1 row, treat as complete and write the flag.
 *   5. Otherwise → 'required'.
 */
export async function getOnboardingStatus(
  userId: string,
  hasSavedPlaces?: boolean,
): Promise<OnboardingStatus> {
  if (!userId) {
    // No user to key against — never trap; treat as complete.
    return 'complete';
  }

  if (completedMemory.has(userId)) return 'complete';

  // 1. New flag (fail open, forward, on read error).
  let completedRaw: string | null = null;
  try {
    completedRaw = await AsyncStorage.getItem(completedKey(userId));
  } catch (err) {
    console.warn('[onboarding] status_read_failed_failing_open', err);
    completedMemory.add(userId);
    return 'complete';
  }
  if (completedRaw === 'true') {
    completedMemory.add(userId);
    return 'complete';
  }

  // 2. Legacy migration from the HowNearrWorks "seen" flag.
  try {
    if (await hasSeenHowNearrWorks(userId)) {
      console.log('[onboarding] migrated_legacy_flag');
      await markOnboardingComplete(userId);
      return 'complete';
    }
  } catch (err) {
    // hasSeenHowNearrWorks already fails open to false; defensive guard only.
    console.warn('[onboarding] legacy_flag_check_failed', err);
  }

  // 3. Existing user with saved places (local cache only — no network).
  let onboardedBySaves = hasSavedPlaces === true;
  if (!onboardedBySaves) {
    try {
      const cached = await readSavedPlacesCache(userId);
      onboardedBySaves = !!cached && cached.data.length > 0;
    } catch {
      onboardedBySaves = false;
    }
  }
  if (onboardedBySaves) {
    console.log('[onboarding] complete_existing_saves');
    await markOnboardingComplete(userId);
    return 'complete';
  }

  // 4. Truly new, empty user.
  return 'required';
}

/**
 * Record onboarding as complete. Updates the in-memory cache and notifies
 * subscribers synchronously (so routing reacts immediately), then persists to
 * AsyncStorage. A write failure is logged but does not block the user — the
 * in-memory flag still lets them out of onboarding for this session.
 */
export async function markOnboardingComplete(userId: string): Promise<void> {
  if (!userId) return;
  completedMemory.add(userId);
  notifyListeners();
  try {
    await AsyncStorage.setItem(completedKey(userId), 'true');
  } catch (err) {
    console.warn('[onboarding] mark_complete_failed', err);
  }
}

/** Clear onboarding completion for a user (dev/QA helper). Best-effort. */
export async function resetOnboarding(userId: string): Promise<void> {
  if (!userId) return;
  completedMemory.delete(userId);
  notifyListeners();
  try {
    await AsyncStorage.removeItem(completedKey(userId));
  } catch (err) {
    console.warn('[onboarding] reset_failed', err);
  }
}
