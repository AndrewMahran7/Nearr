import * as Haptics from 'expo-haptics';

/**
 * Thin, crash-safe wrappers around expo-haptics.
 *
 * Haptics are a "nice to have" affordance: every call is fire-and-forget and
 * wrapped so a platform without a haptics engine (web, some Android devices,
 * or a build where the native module is unavailable) simply does nothing
 * instead of throwing. Never await these.
 */

/** Light selection tick — for tapping a demo target. */
export function hapticSelection(): void {
  try {
    void Haptics.selectionAsync();
  } catch {
    // no-op where unsupported
  }
}

/** Light impact — for a committed action like "Save". */
export function hapticImpact(): void {
  try {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  } catch {
    // no-op where unsupported
  }
}

/** Success notification — for a completed save / pin drop. */
export function hapticSuccess(): void {
  try {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  } catch {
    // no-op where unsupported
  }
}
