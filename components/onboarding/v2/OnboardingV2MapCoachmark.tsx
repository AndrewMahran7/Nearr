import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import {
  getNextPracticeSource,
  ONBOARDING_PRACTICE_HELP_VIDEO,
  platformLabel,
  starterContentById,
  type OnboardingStarterContent,
} from '@/constants/onboardingStarterContent';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { isOnboardingV2Phase1Only } from '@/lib/featureFlags';
import {
  acknowledgeOnboardingV2Graduation,
  dismissOnboardingV2PracticeRecovery,
  failOnboardingV2PendingSave,
  openOnboardingV2Starter,
  recordOnboardingV2PracticeHelpOpened,
  recordOnboardingV2ReturnedWithoutShare,
  recordOnboardingV2StarterImpressions,
  recordOnboardingV2StarterPrompt,
  selectOnboardingV2PracticeSource,
} from '@/lib/onboardingV2';
import {
  isOnboardingV2Phase2MapState,
  onboardingV2SavedPlaceProgress,
  planOnboardingPracticeRecovery,
  resolveOnboardingV2VisibleOwner,
} from '@/lib/onboardingV2Core';

export function OnboardingV2MapCoachmark({ topOffset }: { topOffset: number }) {
  const { state } = useOnboardingV2();
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [poolExhausted, setPoolExhausted] = useState(false);
  const appStateRef = useRef(AppState.currentState);
  const backgroundedAtRef = useRef<string | null>(null);

  const phase1Only = isOnboardingV2Phase1Only();
  const practiceReady = !!state && isOnboardingV2Phase2MapState(state) && !state.behavioralCompletedAt;
  const slot = state?.independentSaves.length ?? 0;
  const selectedId = state?.practiceContentIds[slot] ?? null;
  const selected = starterContentById(selectedId);
  const retrySource = starterContentById(state?.pendingShare?.contentId ?? selectedId);
  const independentPending = state?.pendingShare?.kind === 'independent_1' || state?.pendingShare?.kind === 'independent_2';
  const recoveryVisible = !!state?.practiceRecovery && !state.practiceRecovery.dismissedAt;
  const progress = state ? onboardingV2SavedPlaceProgress(state) : { count: 0 as const, savedPlaceIds: [] };
  const visibleOwner = resolveOnboardingV2VisibleOwner({
    state,
    phase1Only,
    selectedSourceAvailable: !!selected,
    poolExhausted,
  });

  const excluded = useMemo(() => [
    state?.tutorialContentId,
    ...(state?.independentSaves.map((save) => save.contentId) ?? []),
    ...(state?.practiceAttemptedContentIds ?? []),
    ...(state?.practiceContentIds ?? []),
  ].filter((id): id is string => !!id), [
    state?.independentSaves,
    state?.practiceAttemptedContentIds,
    state?.practiceContentIds,
    state?.tutorialContentId,
  ]);

  useEffect(() => {
    if (!practiceReady || selectedId || !state) return;
    const next = getNextPracticeSource({
      platform: state.preferredPlatform,
      interest: state.interest,
      excludeContentIds: excluded,
      rotationKey: `${state.funnelSessionId ?? 'practice'}:${slot}`,
    });
    if (next.kind === 'FOUND') {
      setPoolExhausted(false);
      void selectOnboardingV2PracticeSource(next.source.id);
    } else {
      setPoolExhausted(true);
    }
  }, [excluded, practiceReady, selectedId, slot, state]);

  useEffect(() => {
    if (!practiceReady) return;
    void recordOnboardingV2StarterPrompt();
  }, [practiceReady]);

  useEffect(() => {
    if (selectedId) void recordOnboardingV2StarterImpressions([selectedId]);
  }, [selectedId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const offerRecovery = (returnedAt: string) => {
      const pending = state?.pendingShare ?? null;
      const plan = planOnboardingPracticeRecovery({
        pendingShare: pending,
        backgroundedAt: backgroundedAtRef.current,
        returnedAt,
        now: new Date().toISOString(),
      });
      if (plan.status === 'wait') {
        timer = setTimeout(() => offerRecovery(returnedAt), plan.delayMs);
      } else if (plan.status === 'offer' && pending) {
        void recordOnboardingV2ReturnedWithoutShare({
          attemptId: pending.attemptId,
          returnedAt: plan.returnedAt,
          helpEligibleAt: plan.helpEligibleAt,
        });
      }
    };
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (nextState === 'background') backgroundedAtRef.current = new Date().toISOString();
      if (/inactive|background/.test(previous) && nextState === 'active') {
        offerRecovery(new Date().toISOString());
      }
    });
    return () => {
      if (timer) clearTimeout(timer);
      subscription.remove();
    };
  }, [state?.pendingShare?.attemptId, state?.pendingShare?.shareReceivedAt]);

  async function openSource(card: OnboardingStarterContent) {
    if (openingId) return;
    setOpeningId(card.id);
    try {
      const next = await openOnboardingV2Starter({ contentId: card.id, sourceUrl: card.sourceUrl });
      if (next.pendingShare?.contentId !== card.id) return;
      setHelpOpen(false);
      await Linking.openURL(card.sourceUrl);
    } catch {
      void failOnboardingV2PendingSave('source_unavailable');
      Alert.alert('This post is unavailable', 'Your map progress is safe. Try another find.');
    } finally {
      setOpeningId(null);
    }
  }

  async function tryAnother() {
    if (!state) return;
    const next = getNextPracticeSource({
      platform: state.preferredPlatform,
      interest: state.interest,
      excludeContentIds: excluded,
      rotationKey: `${state.funnelSessionId ?? 'practice'}:${slot}:${excluded.length}`,
    });
    if (next.kind === 'FOUND') {
      setPoolExhausted(false);
      await selectOnboardingV2PracticeSource(next.source.id, true);
    } else {
      setPoolExhausted(true);
    }
  }

  async function retryCurrentSource() {
    if (!retrySource) return;
    setPoolExhausted(false);
    await openSource(retrySource);
  }

  async function showHelp() {
    await recordOnboardingV2PracticeHelpOpened();
    setHelpOpen(true);
  }

  if (!state || visibleOwner === 'none') return null;

  if (visibleOwner === 'graduation') {
    return (
      <View style={[styles.graduation, { top: topOffset }]}>
        <Progress count={3} />
        <Text style={styles.title}>Your map is ready.</Text>
        <Text style={styles.body}>Three real places are yours. Keep sending Nearr the finds worth remembering.</Text>
        <Pressable style={styles.primary} onPress={() => void acknowledgeOnboardingV2Graduation()}>
          <Text style={styles.primaryText}>Explore your map</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.dock, { top: topOffset }]}>
      <Progress count={progress.count} />
      {visibleOwner === 'practice_exhausted' ? (
        <>
          <Text style={styles.title}>No more suggestions right now</Text>
          <Text style={styles.body}>
            {retrySource
              ? 'Your progress is safe. Retry this find or return to the current practice step.'
              : 'Your progress is safe. Check again when more starter finds are available.'}
          </Text>
          <View style={styles.actionRow}>
            {retrySource ? (
              <>
                <Pressable style={styles.primaryCompact} onPress={() => void retryCurrentSource()}>
                  <Text style={styles.primaryText}>Retry current source</Text>
                </Pressable>
                <Pressable style={styles.quietButton} onPress={() => setPoolExhausted(false)}>
                  <Text style={styles.quietText}>Return</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.primaryCompact} onPress={() => void tryAnother()}>
                <Text style={styles.primaryText}>Check again</Text>
              </Pressable>
            )}
          </View>
        </>
      ) : visibleOwner === 'practice_recovery' && recoveryVisible ? (
        <>
          <Text style={styles.title}>Need more help?</Text>
          <Text style={styles.body}>No rush—your progress is safe, and that share may simply not have reached Nearr.</Text>
          <View style={styles.actionRow}>
            <Pressable style={styles.primaryCompact} onPress={() => void showHelp()}>
              <Text style={styles.primaryText}>Show me again</Text>
            </Pressable>
            <Pressable style={styles.quietButton} onPress={() => void dismissOnboardingV2PracticeRecovery()}>
              <Text style={styles.quietText}>I’m good</Text>
            </Pressable>
          </View>
          <Pressable style={styles.tryAnother} onPress={() => void tryAnother()}>
            <Text style={styles.quietText}>Try another</Text>
          </Pressable>
          {helpOpen ? <PracticeHelp onClose={() => setHelpOpen(false)} /> : null}
        </>
      ) : visibleOwner === 'practice_failure' ? (
        <>
          <Text style={styles.title}>That one didn’t land.</Text>
          <Text style={styles.body}>Your saved places still count. Pick a fresh find and keep going.</Text>
          <Pressable style={styles.primary} onPress={() => void tryAnother()}>
            <Text style={styles.primaryText}>Try another</Text>
          </Pressable>
        </>
      ) : visibleOwner === 'practice_pending' && independentPending && state.pendingShare ? (
        <>
          <Text style={styles.title}>Share it when it feels worth saving.</Text>
          <Text style={styles.body}>Use the social app’s Share menu and choose Nearr. We’ll keep this exact find ready.</Text>
          <View style={styles.actionRow}>
            {starterContentById(state.pendingShare.contentId) ? (
              <Pressable style={styles.primaryCompact} onPress={() => void openSource(starterContentById(state.pendingShare!.contentId)!)}>
                <Text style={styles.primaryText}>Open again</Text>
              </Pressable>
            ) : null}
            <Pressable style={styles.quietButton} onPress={() => void tryAnother()}>
              <Text style={styles.quietText}>Try another</Text>
            </Pressable>
          </View>
        </>
      ) : visibleOwner === 'practice_preview' && selected ? (
        <>
          <Text style={styles.eyebrow}>{progress.count === 1 ? 'TRY THIS ONE' : 'NICE SAVE · ONE MORE'}</Text>
          <View style={styles.preview}>
            <View style={styles.poster}>
              <Feather name={selected.category === 'beaches' ? 'sun' : 'map-pin'} size={28} color="#FFFFFF" />
              <Text style={styles.posterPlatform}>{platformLabel(selected.platform)}</Text>
            </View>
            <View style={styles.previewCopy}>
              <Text style={styles.previewTitle}>{selected.knownPlace?.name ?? selected.title}</Text>
              <Text style={styles.previewMeta}>{selected.knownPlace?.locality ?? selected.category} · {selected.creator ?? platformLabel(selected.platform)}</Text>
            </View>
          </View>
          <Text style={styles.body}>
            {progress.count === 1
              ? 'One place is already on your map. Two more good finds make it yours.'
              : 'That marker is in. One more find finishes your map.'}
          </Text>
          <Pressable style={styles.primary} onPress={() => void openSource(selected)}>
            <Text style={styles.primaryText}>{openingId === selected.id ? 'Opening…' : `Open in ${platformLabel(selected.platform)}`}</Text>
          </Pressable>
          <Pressable style={styles.tryAnother} onPress={() => void tryAnother()}>
            <Text style={styles.quietText}>Try another find</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.title}>Getting your next find ready…</Text>
          <Text style={styles.body}>Your first place is safe. Practice will stay here while Nearr prepares another source.</Text>
        </>
      )}
    </View>
  );
}

function Progress({ count }: { count: number }) {
  return (
    <View style={styles.progressRow}>
      <View style={styles.dots}>
        {[0, 1, 2].map((index) => <View key={index} style={[styles.dot, index < count && styles.dotFilled]} />)}
      </View>
      <Text style={styles.progressText}>{count} of 3 saved</Text>
    </View>
  );
}

function PracticeHelp({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.helpCard}>
      <View style={styles.helpHeader}>
        <Text style={styles.helpTitle}>Share to Nearr</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close help"><Feather name="x" size={18} color="#FFFFFF" /></Pressable>
      </View>
      <Text style={styles.helpAsset}>{ONBOARDING_PRACTICE_HELP_VIDEO.uri ? 'VIDEO READY' : 'HELP VIDEO SLOT · ASSET PENDING'}</Text>
      <Text style={styles.helpSteps}>In the source app, tap Share. If Nearr is hidden, choose More or Other, then choose Nearr and finish the share.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12,
    padding: 14, borderRadius: 18, backgroundColor: '#111111', borderWidth: 1, borderColor: '#303030',
    shadowColor: '#000', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 7 },
  },
  graduation: {
    position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12,
    padding: 20, borderRadius: 22, backgroundColor: '#111111', borderWidth: 1, borderColor: '#303030',
  },
  progressRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 22, height: 6, borderRadius: 3, backgroundColor: '#383838' },
  dotFilled: { backgroundColor: '#FF6B00' },
  progressText: { color: '#A0A0A0', fontSize: 11, fontWeight: '800' },
  eyebrow: { color: '#FF6B00', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, marginTop: 12 },
  title: { color: '#FFFFFF', fontSize: 18, lineHeight: 22, fontWeight: '800', marginTop: 12 },
  body: { color: '#A4A4A4', fontSize: 13, lineHeight: 18, marginTop: 8 },
  preview: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 9 },
  poster: { width: 76, height: 76, borderRadius: 16, padding: 10, justifyContent: 'space-between', backgroundColor: '#5A321B' },
  posterPlatform: { color: '#FFFFFF', fontSize: 10, fontWeight: '800' },
  previewCopy: { flex: 1 },
  previewTitle: { color: '#FFFFFF', fontSize: 17, lineHeight: 21, fontWeight: '800' },
  previewMeta: { color: '#8F8F8F', fontSize: 12, lineHeight: 17, marginTop: 4, textTransform: 'capitalize' },
  primary: { minHeight: 46, marginTop: 12, borderRadius: 14, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryCompact: { flex: 1, minHeight: 42, borderRadius: 13, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  primaryText: { color: '#090909', fontSize: 14, fontWeight: '800' },
  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 },
  quietButton: { minHeight: 42, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  quietText: { color: '#FF8A38', fontSize: 13, fontWeight: '800' },
  tryAnother: { alignSelf: 'center', paddingHorizontal: 14, paddingTop: 11, paddingBottom: 2 },
  helpCard: { marginTop: 12, padding: 12, borderRadius: 14, backgroundColor: '#1B1B1B', borderWidth: 1, borderColor: '#393939' },
  helpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  helpTitle: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
  helpAsset: { color: '#FF6B00', fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginTop: 8 },
  helpSteps: { color: '#C4C4C4', fontSize: 12, lineHeight: 18, marginTop: 8 },
});
