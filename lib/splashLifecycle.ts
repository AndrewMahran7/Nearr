import * as SplashScreen from 'expo-splash-screen';

import {
  createSplashLifecycleController,
  type SplashLifecycleEvent,
} from './splashLifecycleCore';

const reportedEvents = new Set<SplashLifecycleEvent>();

const controller = createSplashLifecycleController({
  preventAutoHide: () => SplashScreen.preventAutoHideAsync(),
  hide: () => SplashScreen.hideAsync(),
  onEvent: (event, reason) => {
    if (!__DEV__ || event.endsWith('_replay') || reportedEvents.has(event)) return;
    reportedEvents.add(event);
    console.log('[splash-lifecycle]', { event, ...(reason ? { reason } : {}) });
  },
  onUnexpectedError: (operation, error) => {
    console.warn('[splash-lifecycle] native_call_failed', {
      operation,
      reason: error instanceof Error ? error.message : 'unknown',
    });
  },
});

/** Runs during entry-module evaluation, before Expo Router's delayed prevent. */
export function beginNativeSplashLifecycle(): Promise<void> {
  return controller.begin();
}

/** Called when the root React Native surface completes its first layout. */
export function hideNativeSplashWhenReady(): Promise<void> {
  return controller.hideWhenReady();
}

// Module evaluation is the one startup boundary for this JS runtime. The
// promise is intentionally handled inside the controller and never rejects.
void beginNativeSplashLifecycle();
