import { useEffect, useState } from 'react';

import {
  getOnboardingV2Snapshot,
  getOnboardingV2State,
  recoverOnboardingV2ToWelcome,
  subscribeOnboardingV2,
} from '@/lib/onboardingV2';
import type { OnboardingV2State } from '@/lib/onboardingV2Core';

export function useOnboardingV2(): {
  state: OnboardingV2State | null;
  loading: boolean;
} {
  const [state, setState] = useState<OnboardingV2State | null>(getOnboardingV2Snapshot());

  useEffect(() => {
    let cancelled = false;
    const unsubscribe = subscribeOnboardingV2((next) => {
      if (!cancelled) setState(next);
    });
    void getOnboardingV2State()
      .then((next) => {
        if (!cancelled) setState(next);
      })
      .catch(async (error) => {
        console.warn('[onboarding-v2] startup_hydration_rejected', error);
        const recovered = await recoverOnboardingV2ToWelcome('startup_hydration_rejected');
        if (!cancelled) setState(recovered);
      })
      .catch((error) => {
        // The recovery path itself is best-effort, but the promise chain must
        // always terminate here so React Native never reports an unhandled
        // startup rejection.
        console.warn('[onboarding-v2] startup_recovery_rejected', error);
      });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { state, loading: !state };
}
