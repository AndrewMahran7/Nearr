import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ONBOARDING_STARTER_CONTENT,
  ONBOARDING_PRACTICE_HELP_VIDEO,
  platformLabel,
  selectPracticeContent,
  starterContentById,
  type OnboardingStarterContent,
} from '@/constants/onboardingStarterContent';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { isOnboardingV2Phase1Only } from '@/lib/featureFlags';
import {
  acknowledgeOnboardingV2Graduation,
  advanceOnboardingV2PlaceTour,
  failOnboardingV2PendingSave,
  openOnboardingV2Starter,
  recordOnboardingV2StarterImpressions,
  recordOnboardingV2StarterPrompt,
  recordOnboardingV2StarterShelfOpened,
} from '@/lib/onboardingV2';
import type { SavedPlaceWithPlace } from '@/types';

type Props = {
  selected: SavedPlaceWithPlace | null;
  onDismissTutorialPlace: () => void;
};

export function OnboardingV2MapCoachmark({ selected, onDismissTutorialPlace }: Props) {
  const insets = useSafeAreaInsets();
  const { state } = useOnboardingV2();
  const [shelfOpen, setShelfOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [previewCard, setPreviewCard] = useState<OnboardingStarterContent | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [returnedWithoutShare, setReturnedWithoutShare] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  const excluded = useMemo(
    () => [
      state?.tutorialContentId,
      ...(state?.independentSaves.map((save) => save.contentId) ?? []),
    ].filter((id): id is string => !!id),
    [state?.independentSaves, state?.tutorialContentId],
  );
  const cards = useMemo(
    () => state
      ? selectPracticeContent({
          platform: state.preferredPlatform,
          interest: state.interest,
          excludeContentIds: excluded,
          limit: showAll ? ONBOARDING_STARTER_CONTENT.length : 3,
        })
      : [],
    [excluded, showAll, state],
  );

  const practiceReady = state?.stage === 'practice_ready' || state?.stage === 'first_independent_save_complete';
  const independentPending = state?.pendingShare?.kind === 'independent_1' || state?.pendingShare?.kind === 'independent_2';

  useEffect(() => {
    if (practiceReady) void recordOnboardingV2StarterPrompt();
  }, [practiceReady]);

  useEffect(() => {
    if (shelfOpen && cards.length > 0) {
      void recordOnboardingV2StarterImpressions(cards.map((card) => card.id));
    }
  }, [cards, shelfOpen]);

  useEffect(() => {
    let recoveryTimer: ReturnType<typeof setTimeout> | null = null;
    const subscription = AppState.addEventListener('change', (nextState) => {
      const returned = /inactive|background/.test(appStateRef.current) && nextState === 'active';
      appStateRef.current = nextState;
      if (!returned || !state?.pendingShare || state.pendingShare.shareReceivedAt) return;
      recoveryTimer = setTimeout(() => {
        setReturnedWithoutShare(true);
        void failOnboardingV2PendingSave('returned_without_share');
      }, 900);
    });
    return () => {
      if (recoveryTimer) clearTimeout(recoveryTimer);
      subscription.remove();
    };
  }, [state?.pendingShare]);

  async function openShelf() {
    await recordOnboardingV2StarterShelfOpened();
    setShelfOpen(true);
  }

  async function openCard(card: OnboardingStarterContent) {
    if (openingId) return;
    setOpeningId(card.id);
    try {
      await openOnboardingV2Starter({ contentId: card.id, sourceUrl: card.sourceUrl });
      setShelfOpen(false);
      setPreviewCard(null);
      setReturnedWithoutShare(false);
      setHelpOpen(false);
      await Linking.openURL(card.sourceUrl);
    } catch {
      void failOnboardingV2PendingSave('starter_link_open_failed');
      setShelfOpen(true);
      Alert.alert('Could not open this post', 'The link may have changed. Choose another starter video.');
    } finally {
      setOpeningId(null);
    }
  }

  if (!state || state.cohort !== 'new_user_v2') return null;

  if (state.stage === 'place_tour' && selected && selected.id === state.tutorialSave?.savedPlaceId) {
    const step = state.placeTourStep ?? 'found';
    const available = { aiNote: !!selected.ai_note?.trim(), source: !!selected.source_url?.trim() };
    const copy = tourCopy(step, selected);
    return (
      <View style={[styles.coach, { top: insets.top + 12 }]}>
        <Text style={styles.kicker}>YOUR FIRST PLACE</Text>
        <Text style={styles.title}>{copy.title}</Text>
        <Text style={styles.body}>{copy.body}</Text>
        {step === 'close' ? (
          <Pressable style={styles.primary} onPress={onDismissTutorialPlace}>
            <Text style={styles.primaryText}>Close place card</Text>
          </Pressable>
        ) : (
          <Pressable
            style={styles.primary}
            onPress={() => void advanceOnboardingV2PlaceTour(available)}
          >
            <Text style={styles.primaryText}>Next</Text>
          </Pressable>
        )}
      </View>
    );
  }

  // Phase 2/3 implementation remains unreachable in the Phase-1 production
  // rollout. Missing or invalid config also lands here and renders nothing.
  if (isOnboardingV2Phase1Only()) return null;

  if (state.behavioralCompletedAt && !state.graduationAcknowledgedAt) {
    return (
      <View style={[styles.coach, styles.readyCard, { top: insets.top + 90 }]}>
        <View style={styles.readyIcon}><Feather name="map" size={28} color="#FF6B00" /></View>
        <Text style={styles.title}>Your map is ready.</Text>
        <View style={styles.graduationProgress}>
          {[0, 1, 2].map((index) => <View key={index} style={styles.graduationDot}><Feather name="check" size={15} color="#101010" /></View>)}
        </View>
        <Text style={styles.body}>Three real places are on your map. Keep sending Nearr the ones you want to remember.</Text>
        <View style={styles.challengeCard}>
          <Feather name="flag" size={18} color="#FF6B00" />
          <Text style={styles.challengeText}>Optional next challenge: save 3 places for your next free weekend.</Text>
        </View>
        <Pressable style={styles.primary} onPress={() => void acknowledgeOnboardingV2Graduation()}>
          <Text style={styles.primaryText}>Explore your map</Text>
        </Pressable>
      </View>
    );
  }

  if (independentPending && state.pendingShare) {
    const content = starterContentById(state.pendingShare.contentId);
    return (
      <View style={[styles.coach, { top: insets.top + 90 }]}>
        <Text style={styles.kicker}>{1 + state.independentSaves.length} OF 3 PLACES SAVED</Text>
        <Text style={styles.title}>{returnedWithoutShare ? 'Need more help?' : 'Finish the real share.'}</Text>
        <Text style={styles.body}>
          {returnedWithoutShare
            ? 'It looks like Nearr did not receive that post. Your progress is safe.'
            : 'Nothing is counted until Nearr receives this exact post and the place is really saved.'}
        </Text>
        {content ? (
          <Pressable style={styles.primary} onPress={() => void openCard(content)}>
            <Text style={styles.primaryText}>Open source video again</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.secondary} onPress={() => returnedWithoutShare ? setHelpOpen(true) : void openShelf()}>
          <Text style={styles.secondaryText}>{returnedWithoutShare ? 'Yes, show me the steps' : 'Choose another video'}</Text>
        </Pressable>
        {helpOpen ? <PracticeHelp onClose={() => setHelpOpen(false)} /> : null}
      </View>
    );
  }

  if (!practiceReady) return null;

  const visualCount = Math.min(3, 1 + state.independentSaves.length);
  return (
    <>
      <View style={[styles.coach, { top: insets.top + 90 }]}>
        <Text style={styles.kicker}>{visualCount} OF 3 PLACES SAVED</Text>
        <Text style={styles.title}>
          {state.independentSaves.length === 0 ? "Your map looks a bit empty. Let's change that." : 'One more place to go.'}
        </Text>
        <Text style={styles.body}>Nearr becomes useful when you send it places you actually want to remember.</Text>
        <Pressable style={styles.primary} onPress={() => void openShelf()}>
          <Text style={styles.primaryText}>
            {state.independentSaves.length === 0 ? 'Add 2 real places' : 'Add one more real place'}
          </Text>
        </Pressable>
      </View>

      {shelfOpen ? (
        <View style={styles.shelfBackdrop}>
          <View style={[styles.shelf, { paddingBottom: Math.max(insets.bottom, 18) }]}>
            <View style={styles.shelfHeader}>
              <View>
                <Text style={styles.kicker}>STARTER VIDEOS</Text>
                <Text style={styles.shelfTitle}>Pick a place to practice with</Text>
              </View>
              <Pressable onPress={() => setShelfOpen(false)} hitSlop={10}>
                <Feather name="x" size={24} color="#FFFFFF" />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false}>
              {cards.map((card) => (
                <Pressable
                  key={card.id}
                  onPress={() => setPreviewCard(card)}
                  style={({ pressed }) => [styles.starterCard, pressed && { opacity: 0.78 }]}
                >
                  <View style={styles.cardIcon}><Feather name="play" size={18} color="#FF6B00" /></View>
                  <View style={styles.cardCopy}>
                    <Text style={styles.cardTitle}>{card.title}</Text>
                    <Text style={styles.cardMeta}>{card.knownPlace?.locality ?? platformLabel(card.platform)} · Preview first</Text>
                  </View>
                  <Feather name="external-link" size={18} color="#888888" />
                </Pressable>
              ))}
              {!showAll && ONBOARDING_STARTER_CONTENT.length > cards.length ? (
                <Pressable onPress={() => setShowAll(true)} style={styles.seeMore}>
                  <Text style={styles.seeMoreText}>See more</Text>
                </Pressable>
              ) : null}
              <Text style={styles.shelfHelp}>You will preview the place before Nearr opens the real source video.</Text>
            </ScrollView>
          </View>
        </View>
      ) : null}
      {previewCard ? (
        <View style={styles.previewBackdrop}>
          <View style={styles.previewModal}>
            <Pressable onPress={() => setPreviewCard(null)} style={styles.previewClose} accessibilityLabel="Close preview">
              <Feather name="x" size={22} color="#FFFFFF" />
            </Pressable>
            <View style={styles.previewVisual}>
              <Feather name={previewCard.category === 'beaches' ? 'wind' : 'map-pin'} size={38} color="#FFFFFF" />
            </View>
            <Text style={styles.kicker}>PLACE PREVIEW</Text>
            <Text style={styles.title}>{previewCard.knownPlace?.name ?? previewCard.title}</Text>
            <Text style={styles.body}>{previewCard.knownPlace?.locality ?? 'A real place from Nearr’s starter library'}</Text>
            <View style={styles.previewNote}>
              <Feather name="external-link" size={17} color="#FF6B00" />
              <Text style={styles.previewNoteText}>The next tap leaves Nearr and opens the real source video.</Text>
            </View>
            <Pressable style={styles.primary} onPress={() => void openCard(previewCard)}>
              <Text style={styles.primaryText}>{openingId === previewCard.id ? 'Opening…' : `Open in ${platformLabel(previewCard.platform)}`}</Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </>
  );
}

function tourCopy(step: string, selected: SavedPlaceWithPlace): { title: string; body: string } {
  if (step === 'ai_note') {
    return { title: 'Remember why it caught your eye.', body: selected.ai_note?.trim() ?? 'The video note is still being prepared, so this step can wait.' };
  }
  if (step === 'source') {
    return { title: 'The original post stays attached.', body: 'Use the source action on this real place card whenever you want to watch it again.' };
  }
  if (step === 'directions') {
    return { title: 'Turn a saved place into a plan.', body: 'Directions opens your maps app using this place.' };
  }
  if (step === 'close') {
    return { title: 'Back to your map.', body: 'Close this real place card to start using Nearr.' };
  }
  return { title: 'Found it.', body: `Nearr found ${selected.place.name} and saved it to your map.` };
}

function PracticeHelp({ onClose }: { onClose: () => void }) {
  return (
    <View style={styles.helpCard}>
      <View style={styles.helpHeader}>
        <Text style={styles.helpTitle}>Real-share refresher</Text>
        <Pressable onPress={onClose} accessibilityLabel="Close help"><Feather name="x" size={20} color="#FFFFFF" /></Pressable>
      </View>
      <Text style={styles.helpAsset}>
        {ONBOARDING_PRACTICE_HELP_VIDEO.uri ? 'HELP VIDEO READY' : 'HELP VIDEO SLOT · ASSET PENDING'}
      </Text>
      {['Tap Share on the source video', 'Tap More / Other if Nearr is hidden', 'Choose Nearr and finish the share'].map((label, index) => (
        <View key={label} style={styles.helpStep}>
          <View style={styles.helpNumber}><Text style={styles.helpNumberText}>{index + 1}</Text></View>
          <Text style={styles.helpStepText}>{label}</Text>
        </View>
      ))}
      <Text style={styles.helpFootnote}>The product hook is ready for Andrew’s future help/demo video asset.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  coach: {
    position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12,
    padding: 20, borderRadius: 22, backgroundColor: '#111111', borderWidth: 1, borderColor: '#303030',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 18, shadowOffset: { width: 0, height: 8 },
  },
  readyCard: { alignItems: 'stretch' },
  readyIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: '#1E1E1E', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  graduationProgress: { flexDirection: 'row', gap: 8, marginTop: 16 },
  graduationDot: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#55D98B' },
  challengeCard: { flexDirection: 'row', gap: 10, marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: '#1B1B1B' },
  challengeText: { flex: 1, color: '#B0B0B0', fontSize: 12, lineHeight: 18 },
  kicker: { color: '#FF6B00', fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: '#FFFFFF', fontSize: 23, lineHeight: 28, fontWeight: '800', marginTop: 8 },
  body: { color: '#A0A0A0', fontSize: 14, lineHeight: 20, marginTop: 8 },
  primary: { minHeight: 48, marginTop: 16, borderRadius: 15, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryText: { color: '#090909', fontSize: 15, fontWeight: '800' },
  secondary: { minHeight: 42, alignItems: 'center', justifyContent: 'center', marginTop: 6 },
  secondaryText: { color: '#FF6B00', fontSize: 14, fontWeight: '800' },
  shelfBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 100, elevation: 20, backgroundColor: 'rgba(0,0,0,0.58)', justifyContent: 'flex-end' },
  shelf: { maxHeight: '78%', backgroundColor: '#101010', borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 18, paddingTop: 20 },
  shelfHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  shelfTitle: { color: '#FFFFFF', fontSize: 22, fontWeight: '800', marginTop: 5 },
  starterCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginBottom: 10, borderRadius: 18, backgroundColor: '#1B1B1B', borderWidth: 1, borderColor: '#2B2B2B' },
  cardIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#252525' },
  cardCopy: { flex: 1 },
  cardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  cardMeta: { color: '#8C8C8C', fontSize: 12, marginTop: 4 },
  seeMore: { alignItems: 'center', padding: 14 },
  seeMoreText: { color: '#FF6B00', fontWeight: '800' },
  shelfHelp: { color: '#888888', fontSize: 12, lineHeight: 18, textAlign: 'center', paddingVertical: 14 },
  previewBackdrop: { ...StyleSheet.absoluteFillObject, zIndex: 120, elevation: 24, justifyContent: 'center', padding: 18, backgroundColor: 'rgba(0,0,0,0.78)' },
  previewModal: { padding: 20, borderRadius: 28, backgroundColor: '#111111', borderWidth: 1, borderColor: '#303030' },
  previewClose: { position: 'absolute', right: 14, top: 14, zIndex: 2, width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  previewVisual: { height: 150, marginBottom: 18, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3A2519', overflow: 'hidden' },
  previewNote: { flexDirection: 'row', gap: 10, marginTop: 16, padding: 12, borderRadius: 14, backgroundColor: '#1A1A1A' },
  previewNoteText: { flex: 1, color: '#A5A5A5', fontSize: 12, lineHeight: 18 },
  helpCard: { marginTop: 14, padding: 14, borderRadius: 16, backgroundColor: '#1B1B1B', borderWidth: 1, borderColor: '#3A3A3A' },
  helpHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  helpTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  helpAsset: { color: '#FF6B00', fontSize: 10, fontWeight: '900', letterSpacing: 0.8, marginTop: 10, marginBottom: 12 },
  helpStep: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 8 },
  helpNumber: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B2B2B' },
  helpNumberText: { color: '#FF6B00', fontSize: 11, fontWeight: '900' },
  helpStepText: { flex: 1, color: '#CECECE', fontSize: 12 },
  helpFootnote: { color: '#777777', fontSize: 10, lineHeight: 15, marginTop: 12 },
});
