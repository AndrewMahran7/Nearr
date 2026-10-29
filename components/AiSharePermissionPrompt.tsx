import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { sharedAuth } from '../lib/sharedAuth';
import { decodeJwtClaims } from '../lib/sharedAuthSession';
import { AI_NOTICE_VERSION, allowAiSharing, consentRpc, type ConsentTransport } from '../lib/aiSharingConsent';
import { useLocale } from '../hooks/useLocale';
import { t } from '../lib/i18n';

export const AI_SHARE_PERMISSION_NOTICE = 'To find places and write a note about a saved video, Nearr sends the post link, captions, creator and location details, selected video frames, and sometimes audio to OpenAI. Allow this only for content you are permitted to share. You can withdraw permission in Settings.';
type Props = { onAllow: () => void; onCancel: () => void; compact?: boolean; isExtension?: boolean };

async function transportFor(isExtension: boolean): Promise<ConsentTransport> {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, string>;
  const supabaseUrl = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? extra.supabaseUrl ?? '').replace(/\/$/, '');
  const publicKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? extra.supabaseAnonKey ?? '';
  let accessToken = sharedAuth.getToken() ?? '';
  if (!isExtension) {
    const { supabase } = require('../lib/supabase') as typeof import('../lib/supabase');
    accessToken = (await supabase.auth.getSession()).data.session?.access_token ?? '';
  }
  return { supabaseUrl, publicKey, accessToken };
}

export function AiSharePermissionPrompt({ onAllow, onCancel, compact = false, isExtension = false }: Props) {
  useLocale();
  const [state, setState] = useState<'loading' | 'unavailable' | 'guardian' | 'terms' | 'permission' | 'saving' | 'error'>('loading');
  const transport = useRef<ConsentTransport | null>(null);
  const legalVersions = useRef({ terms: '', privacy: '' });
  const busy = useRef(false);
  const owner = useRef<string | null>(null);
  const generation = useRef(0);
  const refreshIdentity = useRef<() => void>(() => undefined);
  useEffect(() => {
    let mounted = true;
    let authTimer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      const epoch = ++generation.current;
      owner.current = null; transport.current = null; busy.current = false; setState('loading');
      void (async () => {
        const value = await transportFor(isExtension);
        const subject = decodeJwtClaims(value.accessToken)?.sub;
        if (!subject) throw new Error('consent_auth_required');
        const access = await consentRpc(value, 'get_my_global_access') as Record<string, unknown>;
        const current = await transportFor(isExtension);
        if (!mounted || epoch !== generation.current) return;
        if (decodeJwtClaims(current.accessToken)?.sub !== subject) { setState('error'); return; }
        owner.current = subject; transport.current = current;
        legalVersions.current = { terms: String(access.termsVersion ?? ''), privacy: String(access.privacyVersion ?? '') };
        if (access.aiReason === 'guardian_authorization_required') setState('guardian');
        else if (access.status !== 'eligible' || access.legalApproved !== true || access.noticeVersion !== AI_NOTICE_VERSION || ['region_not_available', 'recognition_not_available'].includes(String(access.aiReason))) setState('unavailable');
        else setState(access.termsAccepted === true ? 'permission' : 'terms');
      })().catch(() => { if (mounted && epoch === generation.current) setState('error'); });
    };
    refreshIdentity.current = refresh; refresh();
    const foreground = AppState.addEventListener('change', status => { if (status === 'active') refresh(); });
    const auth = !isExtension ? (require('../lib/supabase') as typeof import('../lib/supabase')).supabase.auth.onAuthStateChange((_event, session) => {
      if ((session?.user.id ?? null) === owner.current) return;
      generation.current++; owner.current = null; transport.current = null; busy.current = false; setState('loading');
      if (authTimer) clearTimeout(authTimer);
      authTimer = setTimeout(() => { if (mounted) refresh(); }, 0);
    }).data.subscription : null;
    return () => { mounted = false; generation.current++; owner.current = null; transport.current = null; refreshIdentity.current = () => undefined; if (authTimer) clearTimeout(authTimer); foreground.remove(); auth?.unsubscribe(); };
  }, [isExtension]);
  async function currentBoundTransport(epoch: number): Promise<ConsentTransport> {
    const value = await transportFor(isExtension);
    if (epoch !== generation.current || !owner.current) throw new Error('consent_identity_changed');
    if (decodeJwtClaims(value.accessToken)?.sub !== owner.current) { refreshIdentity.current(); throw new Error('consent_identity_changed'); }
    return value;
  }
  async function acceptTerms() {
    if (!transport.current || busy.current) return;
    const epoch = generation.current;
    busy.current = true; setState('saving');
    try {
      const current = await currentBoundTransport(epoch);
      await consentRpc(current, 'record_global_terms_and_privacy', {
        p_terms_version: legalVersions.current.terms,
        p_privacy_version: legalVersions.current.privacy,
        p_expected_user_id: owner.current,
      });
      const refreshed = await currentBoundTransport(epoch);
      const access = await consentRpc(refreshed, 'get_my_global_access') as Record<string, unknown>;
      await currentBoundTransport(epoch);
      setState(access.termsAccepted === true ? 'permission' : 'unavailable');
    }
    catch { if (epoch === generation.current) setState('error'); }
    finally { if (epoch === generation.current) busy.current = false; }
  }
  async function allow() {
    if (!transport.current || busy.current) return;
    const epoch = generation.current; busy.current = true; setState('saving');
    try {
      const current = await currentBoundTransport(epoch); await allowAiSharing(current);
      const refreshed = await currentBoundTransport(epoch); const access = await consentRpc(refreshed, 'get_my_global_access') as Record<string, unknown>;
      await currentBoundTransport(epoch);
      if (access.aiAllowed !== true) { setState('unavailable'); return; }
      onAllow();
    } catch { if (epoch === generation.current) setState('error'); }
    finally { if (epoch === generation.current) busy.current = false; }
  }
  return <View style={styles.root}><ScrollView contentContainerStyle={[styles.content, compact && styles.compactContent]}>
    <Text style={styles.title}>{state === 'unavailable' || state === 'guardian' ? t('Recognition is not available for this account yet') : t('Analyze this post?')}</Text>
    {state === 'loading' || state === 'saving' ? <ActivityIndicator color="#246447" accessibilityLabel={t('Checking permissions')} /> : null}
    {state === 'unavailable' && <Text style={styles.body}>{t('Your saved places remain available. Open Nearr to review eligibility and permissions. This post has not been sent for analysis.')}</Text>}
    {state === 'guardian' && <Text style={styles.body}>{t('Guardian authorization has not been verified for this account. Your saved places remain available.')}</Text>}
    {state === 'error' && <Text style={styles.body}>{t('We could not verify permissions. Open Nearr and try again. This post has not been sent for analysis.')}</Text>}
    {state === 'terms' && <><Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://nearrapp.com/terms')} style={styles.cancelButton}><Text style={styles.cancelText}>{t('Terms of Service')}</Text></Pressable><Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://andrewmahran7.github.io/nearr-legal/privacy')} style={styles.cancelButton}><Text style={styles.cancelText}>{t('Privacy Policy')}</Text></Pressable><Text style={styles.body}>{t('Review the current Terms of Service and Privacy Policy in Nearr before continuing. Agreeing to Terms is separate from allowing AI analysis.')}</Text><Pressable accessibilityRole="button" onPress={() => void acceptTerms()} style={styles.allowButton}><Text style={styles.allowText}>{t('I agree to the Terms of Service and acknowledge the Privacy Policy.')}</Text></Pressable></>}
    {state === 'permission' && <><Text style={styles.body}>{t(AI_SHARE_PERMISSION_NOTICE)}</Text><Pressable accessibilityRole="button" accessibilityLabel={t('Allow third-party AI analysis of this post')} onPress={() => void allow()} style={styles.allowButton}><Text style={styles.allowText}>{t('Allow AI analysis')}</Text></Pressable></>}
    <Pressable accessibilityRole="button" disabled={state === 'saving'} accessibilityLabel={t('Cancel share without analyzing this post')} onPress={onCancel} style={styles.cancelButton}><Text style={styles.cancelText}>{t('Cancel share')}</Text></Pressable>
  </ScrollView></View>;
}
const styles = StyleSheet.create({ root: { flex: 1, backgroundColor: '#F7F4EE' }, content: { flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }, compactContent: { padding: 20 }, title: { color: '#24392F', fontSize: 25, fontWeight: '800' }, body: { color: '#3E4C45', fontSize: 15, lineHeight: 22 }, allowButton: { minHeight: 52, borderRadius: 14, backgroundColor: '#246447', alignItems: 'center', justifyContent: 'center', padding: 14 }, allowText: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' }, cancelButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, cancelText: { color: '#24392F', fontSize: 15, fontWeight: '700' } });
