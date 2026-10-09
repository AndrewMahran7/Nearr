import { AppState, Platform } from 'react-native';
import * as Haptics from 'expo-haptics';

let lastFeedbackAt = 0;

/** Optional foreground feedback. Bursts coalesce; lack of native support never blocks an action. */
function feedback(action: () => Promise<void>): void {
  if (Platform.OS === 'web' || AppState.currentState !== 'active') return;
  const now = Date.now();
  if (now - lastFeedbackAt < 600) return;
  lastFeedbackAt = now;
  try { void action().catch(() => undefined); } catch { /* Haptics are optional. */ }
}

export function hapticSelection(): void { feedback(() => Haptics.selectionAsync()); }
export function hapticImpact(): void { feedback(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)); }
/** Call only after the action has persisted, never when it starts. */
export function hapticSuccess(): void { feedback(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)); }
export function hapticError(): void { feedback(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)); }
