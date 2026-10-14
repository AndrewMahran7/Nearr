export const MISSING_NATIVE_SPLASH_MESSAGE =
  'No native splash screen registered for given view controller.';

export type SplashLifecycleEvent =
  | 'prevent_requested'
  | 'prevent_succeeded'
  | 'prevent_native_unavailable'
  | 'prevent_failed'
  | 'prevent_replay'
  | 'hide_requested'
  | 'hide_succeeded'
  | 'hide_native_unavailable'
  | 'hide_failed'
  | 'hide_replay';

type SplashLifecycleOptions = {
  preventAutoHide: () => Promise<unknown>;
  hide: () => Promise<unknown>;
  onEvent?: (event: SplashLifecycleEvent, reason?: string) => void;
  onUnexpectedError?: (operation: 'prevent' | 'hide', error: unknown) => void;
};

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isMissingNativeSplashError(error: unknown): boolean {
  return reasonOf(error).includes(MISSING_NATIVE_SPLASH_MESSAGE);
}

/**
 * One process-level owner for the native splash lifecycle.
 *
 * The controller deliberately settles every native promise. A JS reload can
 * start against an iOS view controller whose launch splash has already been
 * removed; that is an unavailable startup surface, not an unhandled runtime
 * failure. Unexpected native failures remain observable through the supplied
 * callback.
 */
export function createSplashLifecycleController(options: SplashLifecycleOptions) {
  let preventPromise: Promise<void> | null = null;
  let hidePromise: Promise<void> | null = null;
  let preventCalls = 0;
  let hideCalls = 0;

  const handleFailure = (
    operation: 'prevent' | 'hide',
    error: unknown,
  ): void => {
    if (isMissingNativeSplashError(error)) {
      options.onEvent?.(`${operation}_native_unavailable`);
      return;
    }
    options.onEvent?.(`${operation}_failed`, reasonOf(error));
    options.onUnexpectedError?.(operation, error);
  };

  const begin = (): Promise<void> => {
    if (preventPromise) {
      options.onEvent?.('prevent_replay');
      return preventPromise;
    }

    preventCalls += 1;
    options.onEvent?.('prevent_requested');
    try {
      preventPromise = Promise.resolve(options.preventAutoHide()).then(
        () => options.onEvent?.('prevent_succeeded'),
        (error) => handleFailure('prevent', error),
      );
    } catch (error) {
      handleFailure('prevent', error);
      preventPromise = Promise.resolve();
    }
    return preventPromise;
  };

  const hideWhenReady = (): Promise<void> => {
    if (hidePromise) {
      options.onEvent?.('hide_replay');
      return hidePromise;
    }

    options.onEvent?.('hide_requested');
    hidePromise = begin().then(() => {
      hideCalls += 1;
      try {
        return Promise.resolve(options.hide()).then(
          () => options.onEvent?.('hide_succeeded'),
          (error) => handleFailure('hide', error),
        );
      } catch (error) {
        handleFailure('hide', error);
        return undefined;
      }
    });
    return hidePromise;
  };

  return {
    begin,
    hideWhenReady,
    snapshot: () => ({
      preventCalls,
      hideCalls,
      preventStarted: preventPromise !== null,
      hideStarted: hidePromise !== null,
    }),
  };
}
