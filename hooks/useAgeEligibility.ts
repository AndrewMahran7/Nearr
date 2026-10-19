import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';

export type AgeEligibilityState = 'loading' | 'pending' | 'adult' | 'under_18' | 'revoked' | 'error';

function fromServerStatus(status: unknown): AgeEligibilityState {
  if (status == null) return 'pending';
  if (status === 'adult_self_declared') return 'adult';
  if (status === 'under_18' || status === 'revoked') return status;
  return 'error';
}

/** Server state only. A local boolean is never used as authorization. */
export function useAgeEligibility(userId: string | null, refreshKey: string | null = null) {
  const [snapshot, setSnapshot] = useState<{ userId: string | null; status: AgeEligibilityState }>({
    userId: null,
    status: 'loading',
  });
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const status = snapshot.userId === userId ? snapshot.status : 'loading';

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setSnapshot((previous) => previous.userId === userId
      ? previous
      : { userId, status: 'loading' });
    void (async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const { data, error } = await supabase.from('account_age_eligibility')
          .select('status').eq('user_id', userId).abortSignal(controller.signal).maybeSingle();
        if (!cancelled) setSnapshot({ userId, status: error ? 'error' : fromServerStatus(data?.status) });
      } catch {
        if (!cancelled) setSnapshot({ userId, status: 'error' });
      } finally {
        clearTimeout(timeout);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, attempt, refreshKey]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!userId) return;
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') retry();
    });
    return () => subscription.remove();
  }, [userId, retry]);
  const declare = useCallback(async (atLeast18: boolean): Promise<boolean> => {
    if (!userId || submitting) return false;
    setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const { data, error } = await supabase.rpc('declare_age_eligibility_18_plus', {
        p_at_least_18: atLeast18,
      }).abortSignal(controller.signal);
      if (error || typeof data !== 'string') {
        retry();
        return false;
      }
      setSnapshot({ userId, status: fromServerStatus(data) });
      return true;
    } catch {
      retry();
      return false;
    } finally {
      clearTimeout(timeout);
      setSubmitting(false);
    }
  }, [userId, submitting, retry]);

  return { status, submitting, retry, declare };
}
