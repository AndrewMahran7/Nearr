import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase } from '@/lib/supabase';
import type { EligibilityDeclaration } from '@/lib/globalEligibility';
import { readOwnedLocalDeclaration } from '@/lib/localEligibility';

export type AgeEligibilityState = 'loading' | 'pending' | 'eligible' | 'under_minimum' | 'region_unavailable' | 'revoked' | 'error';
export type GlobalAccess = { status: AgeEligibilityState; aiAllowed: boolean; aiReason: string; aiPermission: boolean; legalApproved: boolean; termsAccepted: boolean; noticeVersion: string; termsVersion: string };
const closed: GlobalAccess = { status: 'loading', aiAllowed: false, aiReason: 'eligibility_required', aiPermission: false, legalApproved: false, termsAccepted: false, noticeVersion: '', termsVersion: '' };
function parseAccess(value: unknown): GlobalAccess {
  if (!value || typeof value !== 'object') return { ...closed, status: 'error' };
  const row = value as Record<string, unknown>;
  const status = ['pending', 'eligible', 'under_minimum', 'region_unavailable', 'revoked'].includes(String(row.status)) ? row.status as AgeEligibilityState : 'error';
  return { status, aiAllowed: status === 'eligible' && row.aiAllowed === true,
    aiReason: typeof row.aiReason === 'string' ? row.aiReason : 'eligibility_required', aiPermission: row.aiPermission === true,
    legalApproved: row.legalApproved === true, termsAccepted: row.termsAccepted === true,
    noticeVersion: typeof row.noticeVersion === 'string' ? row.noticeVersion : '', termsVersion: typeof row.termsVersion === 'string' ? row.termsVersion : '' };
}

/** Server decision, refreshed on identity change and foreground. Never grants
 * provider access from the offline onboarding answer or a client boolean. */
export function useAgeEligibility(userId: string | null, refreshKey: string | null = null, isAnonymous = false) {
  const [snapshot, setSnapshot] = useState<{ userId: string | null; value: GlobalAccess }>({ userId: null, value: closed });
  const [attempt, setAttempt] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const currentUser = useRef(userId); currentUser.current = userId;
  const access = snapshot.userId === userId ? snapshot.value : closed;
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    setSnapshot({ userId, value: closed });
    void (async () => {
      try {
        let { data, error } = await supabase.rpc('get_my_global_access').abortSignal(controller.signal);
        if (!error && !cancelled && parseAccess(data).status === 'pending' && isAnonymous) {
          const answer = await readOwnedLocalDeclaration(userId);
          if (answer && !cancelled && currentUser.current === userId) {
            const declaration = await supabase.rpc('declare_global_eligibility', { p_age_band: answer.ageBand, p_country_code: answer.countryCode }).abortSignal(controller.signal);
            if (declaration.error) throw new Error('eligibility_check_delayed');
            ({ data, error } = await supabase.rpc('get_my_global_access').abortSignal(controller.signal));
          }
        }
        if (!cancelled) setSnapshot({ userId, value: error ? { ...closed, status: 'error' } : parseAccess(data) });
      } catch { if (!cancelled) setSnapshot({ userId, value: { ...closed, status: 'error' } }); }
      finally { clearTimeout(timeout); }
    })();
    return () => { cancelled = true; controller.abort(); clearTimeout(timeout); };
  }, [userId, attempt, refreshKey, isAnonymous]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') retry(); });
    return () => subscription.remove();
  }, [retry]);
  const declare = useCallback(async (answer: EligibilityDeclaration): Promise<boolean> => {
    if (!userId || submittingRef.current) return false;
    submittingRef.current = true; setSubmitting(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const { error } = await supabase.rpc('declare_global_eligibility', { p_age_band: answer.ageBand, p_country_code: answer.countryCode }).abortSignal(controller.signal);
      if (error || currentUser.current !== userId) return false;
      retry(); return true;
    } catch { return false; }
    finally { clearTimeout(timeout); submittingRef.current = false; setSubmitting(false); }
  }, [userId, retry]);
  return { ...access, submitting, retry, declare };
}
