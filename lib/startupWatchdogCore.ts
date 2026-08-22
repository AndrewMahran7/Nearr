export const STARTUP_WATCHDOG_TIMEOUT_MS = 10_000;

export type StartupOwner =
  | 'AUTH'
  | 'ONBOARDING'
  | 'MAP'
  | 'QUEUE'
  | 'ERROR_RECOVERY';

export type StartupPresentation = {
  owner: StartupOwner;
  visible: true;
  mode: 'loading' | 'ready' | 'recovery';
};

/**
 * Pure launch invariant shared by the runtime and the release smoke test.
 * A pending dependency owns a visible loading surface immediately; once the
 * bounded deadline expires ownership moves to explicit recovery UI.
 */
export function resolveStartupPresentation(input: {
  pending: boolean;
  timedOut: boolean;
  readyOwner: Exclude<StartupOwner, 'ERROR_RECOVERY'>;
  pendingOwner?: 'AUTH' | 'ONBOARDING';
}): StartupPresentation {
  if (input.pending && input.timedOut) {
    return { owner: 'ERROR_RECOVERY', visible: true, mode: 'recovery' };
  }
  if (input.pending) {
    return {
      owner: input.pendingOwner ?? 'AUTH',
      visible: true,
      mode: 'loading',
    };
  }
  return { owner: input.readyOwner, visible: true, mode: 'ready' };
}

export function ownerForStartupRoute(route: string): Exclude<StartupOwner, 'ERROR_RECOVERY'> {
  if (route.startsWith('/(onboarding)') || route === '/activate') return 'ONBOARDING';
  if (route.startsWith('/share-jobs')) return 'QUEUE';
  if (route.startsWith('/(auth)') || route === '/auth-callback' || route === '/reset-password') {
    return 'AUTH';
  }
  return 'MAP';
}
