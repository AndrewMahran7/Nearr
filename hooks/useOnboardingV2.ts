import { useEffect, useState } from 'react';

import {
  getOnboardingV2Snapshot,
  getOnboardingV2State,
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
    void getOnboardingV2State().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return { state, loading: !state };
}
