import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { listOnboardingTutorialJobs, type ShareJob } from '@/services/shareJobsService';
import { recordOnboardingV2DevelopmentDiagnostic } from '@/lib/onboardingV2RouteDiagnostics';

const POLL_MS = 2_000;

export function useOnboardingTutorialJobs(sinceIso: string | null, enabled: boolean) {
  const [jobs, setJobs] = useState<ShareJob[]>([]);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const lastDiagnosticCountRef = useRef<number | null>(null);

  useEffect(() => () => { mountedRef.current = false; }, []);

  const load = useCallback(async () => {
    if (!enabled || !sinceIso) return;
    try {
      const next = await listOnboardingTutorialJobs(sinceIso);
      if (!mountedRef.current) return;
      setJobs(next);
      setError(null);
      if (lastDiagnosticCountRef.current !== next.length) {
        lastDiagnosticCountRef.current = next.length;
        recordOnboardingV2DevelopmentDiagnostic('practice_jobs_refreshed', {
          result: `jobs:${next.length}`,
        });
      }
    } catch (loadError) {
      if (mountedRef.current) setError(loadError instanceof Error ? loadError.message : 'job_read_failed');
    }
  }, [enabled, sinceIso]);

  useEffect(() => {
    if (!enabled || !sinceIso) {
      setJobs([]);
      setError(null);
      return;
    }
    void load();
    let interval: ReturnType<typeof setInterval> | null = null;
    const begin = () => {
      if (interval) return;
      interval = setInterval(() => void load(), POLL_MS);
    };
    const stop = () => {
      if (interval) clearInterval(interval);
      interval = null;
    };
    if (AppState.currentState === 'active') begin();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        void load();
        begin();
      } else stop();
    });
    return () => {
      stop();
      subscription.remove();
    };
  }, [enabled, load, sinceIso]);

  return { jobs, error, refresh: load };
}
