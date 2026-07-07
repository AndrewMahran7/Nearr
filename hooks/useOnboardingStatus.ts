import { useEffect, useState } from 'react';

import { getSavedPlacesCacheSnapshot } from '@/hooks/useSavedPlaces';
import {
  getOnboardingStatus,
  isOnboardingCompleteInMemory,
  subscribeOnboarding,
} from '@/lib/onboarding';

export type OnboardingGateStatus = 'unknown' | 'required' | 'complete';

/**
 * Resolve whether the signed-in user still needs onboarding.
 *
 * Returns:
 *   - `'unknown'`   — not yet resolved (no user, or resolution in flight).
 *                     Callers should WAIT and not route to the map yet.
 *   - `'required'`  — brand-new empty user; show onboarding.
 *   - `'complete'`  — onboarded (or dev/demo session).
 *
 * Dev/demo sessions always resolve to `'complete'`. Re-resolves whenever the
 * user id changes, and reacts instantly to completion/reset from anywhere via
 * the `lib/onboarding` subscription (prevents an AuthGate bounce right after
 * the user finishes the flow).
 */
export function useOnboardingStatus(
  userId: string | null,
  isDevSession: boolean,
): OnboardingGateStatus {
  const [status, setStatus] = useState<OnboardingGateStatus>('unknown');

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setStatus('unknown');
      return () => {
        cancelled = true;
      };
    }

    if (isDevSession) {
      setStatus('complete');
      return () => {
        cancelled = true;
      };
    }

    // Read the local saved-places snapshot (non-blocking, no network) so an
    // existing user is treated as onboarded on cold start.
    const readHasSavedPlaces = () => {
      const snapshot = getSavedPlacesCacheSnapshot();
      return !!snapshot && snapshot.length > 0;
    };

    // Immediate short-circuit if completion was recorded this session.
    setStatus(isOnboardingCompleteInMemory(userId) ? 'complete' : 'unknown');

    void (async () => {
      const resolved = await getOnboardingStatus(userId, readHasSavedPlaces());
      if (!cancelled) setStatus(resolved);
    })();

    const unsubscribe = subscribeOnboarding(() => {
      if (cancelled) return;
      if (isOnboardingCompleteInMemory(userId)) {
        // Completed elsewhere (e.g. finishing the flow) — apply immediately.
        setStatus('complete');
      } else {
        // Reset — re-resolve from storage.
        void getOnboardingStatus(userId, readHasSavedPlaces()).then((resolved) => {
          if (!cancelled) setStatus(resolved);
        });
      }
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [userId, isDevSession]);

  return status;
}
