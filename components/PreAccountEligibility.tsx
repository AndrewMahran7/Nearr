import { useEffect, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AgeEligibilityGate } from './AgeEligibilityGate';
import { assessDeclaration, isDeclaration, type EligibilityDeclaration } from '../lib/globalEligibility';
import { hideNativeSplashWhenReady } from '../lib/splashLifecycle';
import type { AgeEligibilityState } from '../hooks/useAgeEligibility';
import { supabase } from '../lib/supabase';
import { LOCAL_ELIGIBILITY_KEY } from '../lib/localEligibility';

export { LOCAL_ELIGIBILITY_KEY } from '../lib/localEligibility';
/** Before mounting onboarding hooks. Rejected new users remain local:
 * no anonymous account, provider request, or fake parent approval. */
export function PreAccountEligibility({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AgeEligibilityState>('loading');
  const [busy, setBusy] = useState(false);
  const [existingAccount, setExistingAccount] = useState(false);
  useEffect(() => {
    let live = true;
    // Restore only an existing permanent session; this never creates an account.
    // Its server gate supplies saved-data/account-rights access even when the
    // local age answer is restricted. A new/anonymous identity cannot use it.
    const restore = (session: { user?: { is_anonymous?: boolean }; access_token?: string } | null) => {
      if (live) setExistingAccount(!!session?.access_token && session.user?.is_anonymous === false);
    };
    void supabase.auth.getSession().then(({ data }) => restore(data.session)).catch(() => {});
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => restore(session));
    return () => { live = false; subscription.subscription.unsubscribe(); };
  }, []);
  useEffect(() => { void AsyncStorage.getItem(LOCAL_ELIGIBILITY_KEY).then(raw => {
    const saved: unknown = raw ? JSON.parse(raw) : null;
    setStatus(isDeclaration(saved) ? assessDeclaration(saved).status : 'pending');
  }).catch(() => setStatus('pending')); }, []);
  if (status === 'eligible' || existingAccount) return <>{children}</>;
  async function declare(answer: EligibilityDeclaration) {
    setBusy(true);
    try {
      await AsyncStorage.setItem(LOCAL_ELIGIBILITY_KEY, JSON.stringify(answer));
      setStatus(assessDeclaration(answer).status); return true;
    } catch { return false; } finally { setBusy(false); }
  }
  return <SafeAreaProvider><View style={{ flex: 1 }} onLayout={() => { void hideNativeSplashWhenReady(); }}>
    <AgeEligibilityGate status={status} submitting={busy} onDeclare={declare} onRetry={() => setStatus('pending')} />
  </View></SafeAreaProvider>;
}
