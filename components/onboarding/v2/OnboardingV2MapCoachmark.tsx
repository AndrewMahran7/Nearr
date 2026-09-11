import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

import { useAuth } from '@/hooks/useAuth';
import { useOnboardingTutorialJobs } from '@/hooks/useOnboardingTutorialJobs';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { isOnboardingV2Phase1Only } from '@/lib/featureFlags';
import {
  deferOnboardingV2Practice,
  dismissOnboardingV2PracticeRecovery,
  failOnboardingV2PendingSave,
  openOnboardingV2Starter,
  recordOnboardingV2PracticeHelpOpened,
  recordOnboardingV2ReturnedWithoutShare,
  setOnboardingV2PracticeFixture,
  setOnboardingV2PracticeFixtureError,
  observeOnboardingV2ShareReceived,
  resumeOnboardingV2DeferredPractice,
} from '@/lib/onboardingV2';
import {
  isShareJobForTutorialFixture,
  loadOnboardingPracticeFixture,
} from '@/lib/onboardingTutorialFixture';
import { onboardingTutorialPreviewUrl } from '@/lib/onboardingTutorialPreview';
import {
  isOnboardingV2Phase2MapState,
  planOnboardingPracticeRecovery,
} from '@/lib/onboardingV2Core';

export function OnboardingV2MapCoachmark({ topOffset }: { topOffset: number }) {
  const { state } = useOnboardingV2();
  const { session } = useAuth();
  const [opening, setOpening] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const loadInFlightRef = useRef(false);
  const appStateRef = useRef(AppState.currentState);
  const backgroundedAtRef = useRef<string | null>(null);
  const phase1Only = isOnboardingV2Phase1Only();
  const practiceActive = !!state && !phase1Only && isOnboardingV2Phase2MapState(state) &&
    state.independentSaves.length === 0 &&
    ['practice_ready', 'first_independent_external_video_opened', 'first_independent_share_returned'].includes(state.stage);
  const deferredPracticeAvailable = !!state && !phase1Only && state.stage === 'onboarding_complete' &&
    !state.practiceCompletedAt && state.independentSaves.length === 0;
  const fixture = state?.practiceFixture ?? null;
  const independentPending = state?.pendingShare?.kind === 'independent_1';
  const { jobs, refresh } = useOnboardingTutorialJobs(
    state?.practiceLaunchedAt ?? state?.practiceOfferedAt ?? null,
    practiceActive && !!session?.user.id,
  );

  useEffect(() => {
    if (!practiceActive || state?.stage !== 'practice_ready' || fixture || state?.practiceFixtureError || !state?.funnelSessionId || loadInFlightRef.current) return;
    loadInFlightRef.current = true;
    void loadOnboardingPracticeFixture({
      preferredPlatform: state.preferredPlatform,
      onboardingSessionId: state.funnelSessionId,
    }).then(setOnboardingV2PracticeFixture)
      .catch((error) => setOnboardingV2PracticeFixtureError(error instanceof Error ? error.message : 'practice_fixture_unavailable'))
      .finally(() => { loadInFlightRef.current = false; });
  }, [fixture, practiceActive, state?.funnelSessionId, state?.practiceFixtureError, state?.preferredPlatform, state?.stage]);

  useEffect(() => {
    if (!fixture || !independentPending) return;
    const intended = jobs.find((job) => isShareJobForTutorialFixture(job, fixture));
    if (intended) void observeOnboardingV2ShareReceived(intended.canonical_url || intended.source_url);
  }, [fixture, independentPending, jobs]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offerRecovery = (returnedAt: string) => {
      const pending = state?.pendingShare ?? null;
      const plan = planOnboardingPracticeRecovery({ pendingShare: pending, backgroundedAt: backgroundedAtRef.current, returnedAt, now: new Date().toISOString() });
      if (plan.status === 'wait') timer = setTimeout(() => offerRecovery(returnedAt), plan.delayMs);
      else if (plan.status === 'offer' && pending) void recordOnboardingV2ReturnedWithoutShare({ attemptId: pending.attemptId, returnedAt: plan.returnedAt, helpEligibleAt: plan.helpEligibleAt });
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'background') backgroundedAtRef.current = new Date().toISOString();
      if (/inactive|background/.test(previous) && nextState === 'active') {
        void refresh();
        offerRecovery(new Date().toISOString());
      }
    });
    return () => { if (timer) clearTimeout(timer); subscription.remove(); };
  }, [refresh, state?.pendingShare]);

  if (!practiceActive) {
    if (!deferredPracticeAvailable) return null;
    return <Pressable style={[styles.practicePill, { top: topOffset }]} onPress={() => void resumeOnboardingV2DeferredPractice()} accessibilityRole="button" accessibilityLabel="Practice sharing a selected post"><Feather name="share-2" size={16} color="#FFFFFF" /><Text style={styles.practicePillText}>Practice sharing</Text></Pressable>;
  }
  if (!fixture) return <View style={[styles.dock, { top: topOffset }]}><Text style={styles.eyebrow}>YOUR TURN</Text><Text style={styles.title}>{state?.practiceFixtureError ? 'Practice is unavailable right now.' : 'Choosing a post for you…'}</Text><Text style={styles.body}>{state?.practiceFixtureError ? 'Your first place is safe. Continue now and try a practice share later.' : 'Your saved card and map stay available while this loads.'}</Text>{state?.practiceFixtureError ? <Pressable style={styles.quiet} onPress={() => void deferOnboardingV2Practice()}><Text style={styles.quietText}>Try later</Text></Pressable> : null}</View>;

  const platform = fixture.platform === 'instagram' ? 'Instagram' : fixture.platform === 'youtube' ? 'YouTube' : fixture.platform;
  const requestedPlatform = state?.preferredPlatform === 'youtube' ? 'YouTube' : state?.preferredPlatform === 'instagram' ? 'Instagram' : state?.preferredPlatform;
  const isExplicitAlternative = !!requestedPlatform && state?.preferredPlatform !== fixture.platform;
  const previewUrl = onboardingTutorialPreviewUrl(fixture.platform, fixture.contentId, fixture.thumbnailUrl);
  const recoveryVisible = !!state?.practiceRecovery && !state.practiceRecovery.dismissedAt;

  async function openSource() {
    if (!fixture || opening) return;
    setOpening(true);
    try {
      const next = await openOnboardingV2Starter({ contentId: fixture.contentId, sourceUrl: fixture.canonicalUrl });
      if (next.pendingShare?.contentId !== fixture.contentId) return;
      await Linking.openURL(fixture.launchUrl);
    } catch {
      void failOnboardingV2PendingSave('source_unavailable');
    } finally { setOpening(false); }
  }

  if (recoveryVisible) return <View style={[styles.dock, { top: topOffset }]}><Text style={styles.title}>Did the share go through?</Text><Text style={styles.body}>Return to the exact post, tap Send or Share, choose More if needed, then Nearr. A delayed save can still arrive.</Text><View style={styles.row}><Pressable style={styles.primaryCompact} onPress={() => void openSource()}><Text style={styles.primaryText}>Open again</Text></Pressable><Pressable style={styles.quiet} onPress={() => void dismissOnboardingV2PracticeRecovery()}><Text style={styles.quietText}>Keep waiting</Text></Pressable></View><Pressable onPress={() => { void recordOnboardingV2PracticeHelpOpened(); setHelpOpen(!helpOpen); }}><Text style={styles.helpLink}>{helpOpen ? 'Hide steps' : 'Show sharing steps'}</Text></Pressable>{helpOpen ? <Text style={styles.helpText}>In {platform}: Send/Share → Share to… or More → Nearr. Return to Nearr yourself if the source app stays open.</Text> : null}</View>;

  return <View style={[styles.dock, { top: topOffset }]}>
    <Text style={styles.eyebrow}>{independentPending ? 'WAITING FOR THIS POST' : isExplicitAlternative ? `${String(requestedPlatform).toUpperCase()} PRACTICE UNAVAILABLE` : 'YOUR TURN · ONE PRACTICE SAVE'}</Text>
    <View style={styles.preview}>{previewUrl ? <Image source={{ uri: previewUrl }} style={styles.poster} resizeMode="cover" accessibilityLabel={`Preview from the exact ${platform} practice post`} /> : <View style={[styles.poster, styles.posterFallback]}><Feather name="play" size={26} color="#FFFFFF" /></View>}<View style={styles.previewCopy}><View style={styles.platformRow}><Ionicons name={fixture.platform === 'instagram' ? 'logo-instagram' : 'logo-youtube'} size={15} color="#FF8A38" /><Text style={styles.platform}>{platform}</Text></View><Text style={styles.previewTitle}>Save this food find</Text><Text style={styles.previewMeta}>A different post and place from your demo</Text></View></View>
    <Text style={styles.body}>{independentPending ? 'Use the source app’s real share sheet and choose Nearr. Then return here; your exact task is saved.' : isExplicitAlternative ? `A verified ${String(requestedPlatform)} practice pair is not available yet. You can use this clearly labeled ${platform} alternative or try later.` : `Open this exact ${platform} post, share it to Nearr, then return to see your map grow.`}</Text>
    <Pressable style={styles.primary} onPress={() => void openSource()} accessibilityRole="button" accessibilityLabel={`${independentPending ? 'Open again in' : 'Open'} ${platform}`}><Text style={styles.primaryText}>{opening ? 'Opening…' : independentPending ? `Open again in ${platform}` : `Open in ${platform}`}</Text></Pressable>
    {!independentPending ? <Pressable style={styles.quiet} onPress={() => void deferOnboardingV2Practice()} accessibilityRole="button"><Text style={styles.quietText}>Try later</Text></Pressable> : null}
  </View>;
}

const styles = StyleSheet.create({
  practicePill: { position: 'absolute', right: 16, zIndex: 80, minHeight: 44, paddingHorizontal: 14, borderRadius: 22, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: '#111111' }, practicePillText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' },
  dock: { position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12, padding: 16, borderRadius: 20, backgroundColor: '#111111', borderWidth: 1, borderColor: '#303030', shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  eyebrow: { color: '#FF6B00', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 }, title: { color: '#FFFFFF', fontSize: 19, lineHeight: 23, fontWeight: '900', marginTop: 10 }, body: { color: '#B1B1B1', fontSize: 13, lineHeight: 19, marginTop: 9 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 11 }, poster: { width: 86, height: 104, borderRadius: 15, backgroundColor: '#34281F' }, posterFallback: { alignItems: 'center', justifyContent: 'center' }, previewCopy: { flex: 1 }, platformRow: { flexDirection: 'row', gap: 6, alignItems: 'center' }, platform: { color: '#FF8A38', fontSize: 11, fontWeight: '900' }, previewTitle: { color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontWeight: '900', marginTop: 7 }, previewMeta: { color: '#929292', fontSize: 12, lineHeight: 17, marginTop: 4 },
  primary: { minHeight: 48, marginTop: 14, borderRadius: 14, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 }, primaryCompact: { flex: 1, minHeight: 46, borderRadius: 14, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center' }, primaryText: { color: '#111111', fontSize: 14, fontWeight: '900' }, quiet: { minHeight: 46, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }, quietText: { color: '#FF8A38', fontSize: 13, fontWeight: '800' }, row: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 13 }, helpLink: { color: '#FF8A38', textAlign: 'center', fontSize: 13, fontWeight: '800', paddingVertical: 10 }, helpText: { color: '#D0D0D0', fontSize: 12, lineHeight: 18, padding: 11, borderRadius: 12, backgroundColor: '#1E1E1E' },
});
