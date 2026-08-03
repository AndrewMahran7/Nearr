import { Platform, Vibration } from 'react-native';

/**
 * Thin, crash-safe "haptic-ish" feedback helpers.
 *
 * Implemented with React Native built-ins ONLY — there is intentionally no
 * native haptics dependency (expo-haptics was removed so onboarding can be
 * tested without a native rebuild). These are a "nice to have" affordance:
 * every call is fire-and-forget and wrapped so it can never throw.
 *
 * Behaviour:
 *   - Android: a very brief `Vibration.vibrate` tick.
 *   - iOS (and web/other): safe no-op — a plain `Vibration` call on iOS is a
 *     long buzz, which is worse than nothing here, so we skip it until a real
 *     haptics engine is wired back in.
 *
 * The exported function names/signatures are unchanged so no caller needs to
 * change. Never await these.
 */

/** Very brief Android vibration tick; no-op elsewhere. Never throws. */
function briefVibrate(durationMs: number): void {
  if (Platform.OS !== 'android') return;
  try {
    Vibration.vibrate(durationMs);
  } catch {
    // never throw — feedback is optional
  }
}

/** Light selection tick — for tapping a demo target. */
export function hapticSelection(): void {
  briefVibrate(8);
}

/** Light impact — for a committed action like "Save". */
export function hapticImpact(): void {
  briefVibrate(12);
}

/** Success notification — for a completed save / pin drop. */
export function hapticSuccess(): void {
  briefVibrate(18);
}
