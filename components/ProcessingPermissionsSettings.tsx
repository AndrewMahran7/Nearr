import { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Pressable, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { useTheme } from '../lib/theme';
import { useLocale } from '../hooks/useLocale';
import { t } from '../lib/i18n';
import { AI_NOTICE_VERSION, consentRpc, type ConsentTransport } from '../lib/aiSharingConsent';

async function currentSettingsTransport(): Promise<{ subject: string; transport: ConsentTransport }> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.user.id || !data.session.access_token) throw new Error('consent_auth_required');
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  return { subject: data.session.user.id, transport: { supabaseUrl: (process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '').replace(/\/$/, ''), publicKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '', accessToken: data.session.access_token } };
}

export function ProcessingPermissionsSettings() {
  useLocale(); const { colors } = useTheme();
  const [allowed, setAllowed] = useState<boolean | null>(null); const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); const owner = useRef<string | null>(null); const generation = useRef(0); const refreshIdentity = useRef<() => void>(() => undefined);
  useEffect(() => {
    let mounted = true; let authTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const epoch = ++generation.current; owner.current = null; busyRef.current = false; setAllowed(null); setBusy(false);
      void (async () => {
        const current = await currentSettingsTransport(); const data = await consentRpc(current.transport, 'get_my_global_access') as Record<string, unknown>; const latest = await currentSettingsTransport();
        if (!mounted || epoch !== generation.current || latest.subject !== current.subject) return;
        owner.current = current.subject; setAllowed(data?.aiPermission === true);
      })().catch(() => { if (mounted && epoch === generation.current) setAllowed(null); });
    };
    refreshIdentity.current = refresh; refresh();
    const foreground = AppState.addEventListener('change', status => { if (status === 'active') refresh(); });
    const auth = supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user.id ?? null) === owner.current) return;
      generation.current++; owner.current = null; busyRef.current = false; setAllowed(null); setBusy(false);
      if (authTimer) clearTimeout(authTimer); authTimer = setTimeout(() => { if (mounted) refresh(); }, 0);
    }).data.subscription;
    return () => { mounted = false; generation.current++; owner.current = null; refreshIdentity.current = () => undefined; if (authTimer) clearTimeout(authTimer); foreground.remove(); auth.unsubscribe(); };
  }, []);
  async function withdraw() {
    if (busyRef.current) return;
    const epoch = generation.current; const subject = owner.current; busyRef.current = true; setBusy(true);
    try {
      const current = await currentSettingsTransport(); if (epoch !== generation.current) return;
      if (subject && current.subject !== subject) { refreshIdentity.current(); return; }
      await consentRpc(current.transport, 'set_ai_sharing_permission', { p_allowed: false, p_notice_version: AI_NOTICE_VERSION });
      const latest = await currentSettingsTransport(); if (epoch !== generation.current) return;
      if (latest.subject !== current.subject) { refreshIdentity.current(); return; }
      owner.current = current.subject; setAllowed(false);
      Alert.alert(t('AI permission withdrawn'), t('New analysis is stopped. Your saved places remain available. Data already sent to a provider cannot be recalled by this setting.'));
    } catch { if (epoch === generation.current) Alert.alert(t('Could not update permission'), t('Please connect and try again.')); }
    finally { if (epoch === generation.current) { busyRef.current = false; setBusy(false); } }
  }
  return <View style={{ gap: 12, paddingVertical: 16 }}><Text style={{ color: colors.text, fontSize: 17, fontWeight: '700' }}>{t('AI sharing permission')}</Text><Text style={{ color: colors.textSecondary }}>{allowed === true ? t('Allowed for eligible recognition. You can withdraw it at any time.') : allowed === false ? t('AI sharing is off. You can review the notice when sharing a post.') : t('Connect to check your permissions.')}</Text><Pressable accessibilityRole="button" disabled={busy || allowed === false} onPress={() => void withdraw()} style={{ minHeight: 48, justifyContent: 'center', opacity: busy || allowed === false ? 0.5 : 1 }}><Text style={{ color: colors.primary, fontWeight: '700' }}>{t('Withdraw AI sharing permission')}</Text></Pressable><Text style={{ color: colors.textSecondary }}>{t('Optional usage analytics is off. Language changes do not translate your notes or video content.')}</Text></View>;
}
