import { useMemo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { StartupSurface } from '@/components/StartupSurface';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton, usePhase1Colors } from '@/components/onboarding/v2/Phase1Visuals';
import { NearrSparkleMark, SocialToMapIllustration, useOnboardingReduceMotion } from '@/components/onboarding/v2/OnboardingVisualLanguage';
import { OnboardingV2SecondHalf } from '@/components/onboarding/v2/OnboardingV2SecondHalf';
import { OnboardingV2RealPractice } from '@/components/onboarding/v2/OnboardingV2RealPractice';
import { ImmersiveGuidedSave } from '@/components/onboarding/v2/ImmersiveGuidedSave';
import { FieldnotesPracticeScene } from '@/components/onboarding/v2/FieldnotesPracticeScene';
import { OfflineFixtureVideo } from '@/components/onboarding/v2/OfflineFixtureVideo';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useStartupWatchdog } from '@/hooks/useStartupWatchdog';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import { offlineOnboardingAsset, offlineOnboardingMedia } from '@/onboarding/assets/offlineOnboardingAssets';
import { bootstrapAnonymousOnboarding } from '@/lib/anonymousOnboarding';
import { beginExistingAccountSignIn } from '@/lib/existingAccountSignIn';
import {
  buildOfflineOnboardingResult,
  offlineFixtureById,
  OFFLINE_ONBOARDING_TIMING_MS,
  selectOfflineOnboardingFixture,
  toOnboardingTutorialFixture,
} from '@/onboarding/fixtures/offlineOnboardingFixtures';
import {
  completeOnboardingV2Interests, completeOnboardingV2Platforms,
  chooseOnboardingV2PrimaryPlatform, continueOnboardingV2FromPersonalizedPayoff,
  beginOnboardingV2InAppTutorialResolution,
  beginOnboardingV2SharingRehearsal,
  advanceOnboardingV2SharingRehearsal,
  confirmOnboardingV2FirstMagicMoment,
  beginOnboardingV2RealPractice,
  markOnboardingV2PracticeWaitingForShare,
  openOnboardingV2Starter,
  deferOnboardingV2Practice,
  beginOnboardingV2SecondHalf,
  finishOnboardingV2FirstMagicMoment, goBackOnboardingV2,
  migrateInterruptedOnboardingV2ToFirstMagic,
  recordOnboardingV2PlaceTourOpened, closeOnboardingV2PlaceTour,
  recordOnboardingV2CelebrationShown, recordOnboardingV2GetStarted,
  repairOnboardingV2PreShareTutorialFixture,
  resolveOnboardingV2TutorialResult,
  setOnboardingV2DesiredValue, setOnboardingV2PainPoint,
  setOnboardingV2TutorialFixture,
  toggleOnboardingV2Interest,
} from '@/lib/onboardingV2';
import { onboardingPhase2PracticeForInterest, onboardingPhase2PracticeFromFixtureId } from '@/lib/onboardingPhase2Practice';
import { openOnboardingPracticePost } from '@/services/onboardingPracticeLauncher';
import { recordOnboardingV2RenderDiagnostic } from '@/lib/onboardingV2RouteDiagnostics';
import type { OnboardingDesiredValue, OnboardingInterest, OnboardingPainPoint, OnboardingPlatform, OnboardingTutorialFixture, OnboardingV2State } from '@/lib/onboardingV2Core';

const PLATFORMS: Array<{ value: Exclude<OnboardingPlatform, 'other'>; label: string; icon: keyof typeof Ionicons.glyphMap; tint: string }> = [
  { value: 'instagram', label: 'Instagram', icon: 'logo-instagram', tint: '#F173AE' },
  { value: 'tiktok', label: 'TikTok', icon: 'logo-tiktok', tint: '#6FE7E2' },
  { value: 'facebook', label: 'Facebook', icon: 'logo-facebook', tint: '#79A9FF' },
  { value: 'youtube', label: 'YouTube', icon: 'logo-youtube', tint: '#FF6969' },
];
const INTERESTS: Array<{ value: OnboardingInterest; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { value: 'outdoors', label: 'Outdoors', icon: 'sun' }, { value: 'food', label: 'Food', icon: 'map-pin' },
  { value: 'cafes', label: 'Cafes', icon: 'coffee' }, { value: 'travel', label: 'Travel', icon: 'navigation' },
  { value: 'things_to_do', label: 'Things to do', icon: 'activity' }, { value: 'shopping', label: 'Shops', icon: 'shopping-bag' },
  { value: 'anything', label: 'Anything interesting', icon: 'compass' },
];
const PAIN_POINTS: Array<{ value: OnboardingPainPoint; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { value: 'saved_and_forgotten', label: 'I save the post and forget about it', icon: 'bookmark' },
  { value: 'cannot_find_place', label: "I can't figure out where the place is", icon: 'search' },
  { value: 'saved_posts_mess', label: 'My saved posts are a mess', icon: 'layers' },
  { value: 'send_to_friends', label: 'I send it to friends', icon: 'send' },
  { value: 'screenshot', label: 'I screenshot it', icon: 'camera' },
];
const DESIRED_VALUES: Array<{ value: OnboardingDesiredValue; label: string; icon: keyof typeof Feather.glyphMap }> = [
  { value: 'find_real_places', label: 'Turn videos into real places', icon: 'map-pin' },
  { value: 'organize_map', label: 'Keep all my places on one map', icon: 'map' },
  { value: 'nearby_reminders', label: "Remind me when I'm nearby", icon: 'bell' },
  { value: 'trip_memory', label: 'Remember places for future trips', icon: 'navigation' },
];
const PLATFORM_LABELS: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', other: 'social apps' };

export function OnboardingV2PreAuth() {
  const params = useLocalSearchParams<{ reason?: string }>();
  const { state, loading } = useOnboardingV2();
  const fixtureInFlightRef = useRef(false);
  const mountIdRef = useRef(`onboarding-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const lastRenderedStageRef = useRef<string | null>(null);
  const screenOwnedStage = !!state && [
    'overview', 'platform', 'interest', 'interest_selected', 'personalized_payoff', 'pain_point',
    'desired_value', 'tutorial_loading', 'tutorial_challenge', 'tutorial_ready',
    'tutorial_share_tapped', 'tutorial_more_tapped', 'tutorial_processing', 'tutorial_reveal',
    'tutorial_celebration', 'place_tour', 'fixture_map_payoff', 'phase2_intro',
    'first_magic_moment_complete', 'why_nearr',
    'nearby_value', 'location_education', 'location_background_education',
    'notification_education', 'making_nearr_yours', 'growing_map', 'auth_success',
    'personalized_activation', 'activation_challenge',
    'practice_ready', 'first_independent_external_video_opened',
    'first_independent_share_returned', 'first_independent_save_complete',
  ].includes(state.stage);
  const startupPending = loading || !screenOwnedStage;
  const startupWatchdog = useStartupWatchdog(startupPending);

  useEffect(() => {
    const stage = state?.stage ?? null;
    if (!stage || stage === lastRenderedStageRef.current) return;
    lastRenderedStageRef.current = stage;
    recordOnboardingV2RenderDiagnostic({
      screen: stage,
      mount_id: mountIdRef.current,
      reason: 'durable_stage_changed',
    });
  }, [state?.stage]);

  useEffect(() => {
    if (state?.stage === 'interest_selected') {
      void migrateInterruptedOnboardingV2ToFirstMagic().catch((error) => {
        console.warn('[onboarding-v2] interrupted_migration_failed', error);
      });
    }
  }, [state?.stage]);
  useEffect(() => {
    if (state?.stage !== 'tutorial_loading' || fixtureInFlightRef.current) return;
    fixtureInFlightRef.current = true;
    const fixture = selectOfflineOnboardingFixture(state.preferredPlatform, state.interest);
    void setOnboardingV2TutorialFixture(toOnboardingTutorialFixture(fixture, new Date().toISOString()))
      .catch((error) => {
        console.warn('[onboarding-v2] offline_fixture_persist_failed', error);
      })
      .finally(() => { fixtureInFlightRef.current = false; });
  }, [state?.interest, state?.preferredPlatform, state?.stage]);
  useEffect(() => {
    if (!state || !['tutorial_challenge', 'tutorial_ready'].includes(state.stage)) return;
    if (state.pendingShare || state.tutorialSave || state.tutorialResult) return;
    const expected = selectOfflineOnboardingFixture(state.preferredPlatform, state.interest);
    if (state.tutorialFixture?.id === expected.id) return;
    void repairOnboardingV2PreShareTutorialFixture(
      toOnboardingTutorialFixture(expected, new Date().toISOString()),
    ).catch((error) => console.warn('[onboarding-v2] fixture_mapping_repair_failed', error));
  }, [state]);
  useEffect(() => {
    if (state?.stage !== 'tutorial_processing' || !state.tutorialFixture) return;
    const fixture = offlineFixtureById(state.tutorialFixture.id);
    if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${state.tutorialFixture.id}`);
    const startedAt = state.tutorialLaunchedAt ? Date.parse(state.tutorialLaunchedAt) : Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const remaining = Math.max(0, OFFLINE_ONBOARDING_TIMING_MS.found - elapsed);
    const timer = setTimeout(() => {
      void resolveOnboardingV2TutorialResult(buildOfflineOnboardingResult(fixture)).catch((error) => {
        console.warn('[onboarding-v2] deterministic_result_persist_failed', error);
      });
    }, remaining);
    return () => clearTimeout(timer);
  }, [state?.stage, state?.tutorialFixture?.id, state?.tutorialLaunchedAt]);

  if (!state || startupPending) return <StartupSurface owner={startupWatchdog.timedOut ? 'ERROR_RECOVERY' : 'ONBOARDING'} recovery={startupWatchdog.timedOut} onRetry={startupWatchdog.timedOut ? startupWatchdog.retry : undefined} />;
  if (state.stage === 'overview') return <WelcomeScreen onContinue={() => void recordOnboardingV2GetStarted()} showNewAccountNotice={params.reason === 'new_account'} />;
  if (state.stage === 'platform') return <PlatformScreen state={state} />;
  if (state.stage === 'interest') return <InterestScreen state={state} />;
  if (state.stage === 'personalized_payoff') return <PersonalizedPayoffScreen state={state} />;
  if (state.stage === 'pain_point') return <PainPointScreen />;
  if (state.stage === 'desired_value') return <DesiredValueScreen />;
  if (state.stage === 'tutorial_loading') return <LoadingState label="Preparing your practice post…" />;
  if (state.stage === 'tutorial_challenge') return <ChallengeScreen state={state} />;
  if (['tutorial_ready', 'tutorial_share_tapped', 'tutorial_more_tapped'].includes(state.stage) && state.tutorialFixture) {
    return <ImmersiveGuidedSave
      stage={state.stage as 'tutorial_ready' | 'tutorial_share_tapped' | 'tutorial_more_tapped'}
      fixture={state.tutorialFixture}
      onBack={() => void goBackOnboardingV2()}
      onAdvance={(action) => {
        if (action === 'nearr') void beginOnboardingV2InAppTutorialResolution();
        else if (action === 'share' || action === 'more') void advanceOnboardingV2SharingRehearsal(action);
      }}
    />;
  }
  if (state.stage === 'tutorial_processing') return <ProcessingScreen state={state} />;
  if (['tutorial_reveal', 'tutorial_celebration'].includes(state.stage) && state.tutorialResult) return <MagicMomentScreen state={state} />;
  if (state.stage === 'fixture_map_payoff' && state.tutorialResult) return <FixtureMapPayoffScreen state={state} />;
  if (state.stage === 'phase2_intro' && state.tutorialResult) return <Phase2IntroScreen state={state} />;
  if ([
    'practice_ready',
    'first_independent_external_video_opened',
    'first_independent_share_returned',
  ].includes(state.stage)) return <OnboardingV2RealPractice state={state} />;
  if (state.stage === 'place_tour' && state.tutorialResult) return <OfflinePlaceDetailScreen state={state} />;
  if (state.stage === 'first_magic_moment_complete') return <FirstMagicCompleteScreen state={state} />;
  return <OnboardingV2SecondHalf state={state} />;
}

function WelcomeScreen({ onContinue, showNewAccountNotice }: { onContinue: () => void; showNewAccountNotice: boolean }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const router = useRouter();
  const signIn = async () => {
    await beginExistingAccountSignIn();
    router.push({ pathname: '/(onboarding)/account', params: { intent: 'existing' } });
  };
  return <Phase1Frame footer={<View style={styles.welcomeFooter}><Phase1PrimaryButton title="Get started" onPress={onContinue} /><Pressable onPress={() => void signIn()} accessibilityRole="button" accessibilityLabel="Already have an account? Sign in" style={styles.signInLink}><Text style={styles.signInLinkText}>Already have an account? Sign in</Text></Pressable></View>}>
    <SocialToMapIllustration />
    <Text style={styles.headlineXL}>Your inspiration, out in the world.</Text>
    <Text style={styles.body}>Share something you want to visit. Nearr turns the post into a real place on your map.</Text>
    {showNewAccountNotice ? <View style={styles.newAccountNotice}><Feather name="info" size={16} color={Phase1Colors.orange} /><Text style={styles.newAccountNoticeText}>That account is new to Nearr. Finish this quick setup, then keep using the same sign-in.</Text></View> : null}
    <PlatformStrip />
    <View style={styles.credibilityRow} accessibilityLabel="Private personal map with real saved places"><View style={styles.credibilityItem}><Feather name="shield" size={15} color={Phase1Colors.success} /><Text style={styles.credibilityText}>Your private map</Text></View><View style={styles.credibilityDot} /><View style={styles.credibilityItem}><Feather name="check-circle" size={15} color={Phase1Colors.success} /><Text style={styles.credibilityText}>Real saved places</Text></View></View>
  </Phase1Frame>;
}
function PlatformStrip() {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);
 return <View style={styles.platformStrip} accessibilityLabel="Works with Instagram, TikTok, Facebook, and YouTube">{PLATFORMS.map((item) => <View key={item.value} style={styles.stripItem}><Ionicons name={item.icon} size={19} color={item.tint} /><Text style={styles.stripLabel}>{item.label}</Text></View>)}</View>; }
function PlatformScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.14} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" disabled={!state.preferredPlatform} onPress={() => void completeOnboardingV2Platforms()} />}>
    <Text style={styles.eyebrow}>START WITH YOUR FEED</Text><Text style={styles.headline}>Where do you usually find places?</Text><Text style={styles.body}>Choose the one you use most.</Text>
    <View style={styles.choiceGrid}>{PLATFORMS.map((item) => { const selected = state.preferredPlatform === item.value; return <Pressable key={item.value} onPress={() => { hapticSelection(); void chooseOnboardingV2PrimaryPlatform(item.value); }} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={item.label} style={[styles.platformCard, selected && styles.selectedCard]}><View style={[styles.platformIcon, { backgroundColor: item.tint }]}><Ionicons name={item.icon} size={29} color="#171615" /></View><Text style={styles.choiceTitle}>{item.label}</Text><View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <Feather name="check" size={13} color={Phase1Colors.onOrange} /> : null}</View></Pressable>; })}</View>
  </Phase1Frame>;
}
function InterestScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.22} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" disabled={state.selectedInterests.length === 0} onPress={() => void completeOnboardingV2Interests()} />}>
    <Text style={styles.eyebrow}>MAKE IT YOURS</Text><Text style={styles.headline}>What do you save most?</Text><Text style={styles.body}>Pick everything that sounds like you.</Text>
    <View style={styles.interestGrid}>{INTERESTS.map((item) => { const selected = state.selectedInterests.includes(item.value); return <Pressable key={item.value} onPress={() => { hapticSelection(); void toggleOnboardingV2Interest(item.value); }} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={item.label} style={[styles.interestCard, selected && styles.selectedInterestCard]}><View style={[styles.interestIcon, selected && styles.selectedInterestIcon]}><Feather name={item.icon} size={21} color={selected ? Phase1Colors.onOrange : Phase1Colors.orange} /></View><Text style={[styles.interestLabel, selected && styles.selectedInterestText]}>{item.label}</Text>{selected ? <Feather name="check-circle" size={18} color={Phase1Colors.orange} /> : null}</Pressable>; })}</View>
  </Phase1Frame>;
}
function PersonalizedPayoffScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const platform = PLATFORM_LABELS[state.preferredPlatform ?? 'other'];
  const interest = interestLabel(state.interest);
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.3} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Show me" onPress={() => void continueOnboardingV2FromPersonalizedPayoff()} />} contentStyle={styles.payoffContent}>
    <Text style={styles.payoffKicker}>Perfect <Text accessibilityLabel="celebration">✦</Text></Text>
    <Text style={styles.payoffHeadline}>Nearr can turn {interest.toLowerCase()} you find on {platform} into places on your map.</Text>
    <SocialToMapIllustration platform={state.preferredPlatform} interest={state.interest} />
    <Text style={styles.payoffBody}>One real post. One real place. Ready when you want to go.</Text>
  </Phase1Frame>;
}
function PainPointScreen() {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.6} progressLabel="Onboarding progress"><Text style={styles.eyebrow}>NOW THAT YOU'VE SEEN IT</Text><Text style={styles.headline}>What's most annoying about saving places?</Text><View style={styles.stack}>{PAIN_POINTS.slice(0, 4).map((item) => <Pressable key={item.value} onPress={() => { hapticSelection(); void setOnboardingV2PainPoint(item.value); }} accessibilityRole="button" accessibilityLabel={item.label} style={styles.painCard}><View style={styles.smallIcon}><Feather name={item.icon} size={20} color={Phase1Colors.orange} /></View><Text style={styles.painText}>{item.label}</Text><Feather name="arrow-right" size={18} color={Phase1Colors.textMuted} /></Pressable>)}</View></Phase1Frame>;
}
function DesiredValueScreen() {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.67} progressLabel="Onboarding progress"><Text style={styles.eyebrow}>MAKE IT USEFUL</Text><Text style={styles.headline}>What would make Nearr most useful to you?</Text><View style={styles.stack}>{DESIRED_VALUES.map((item) => <Pressable key={item.value} onPress={() => { hapticSelection(); void setOnboardingV2DesiredValue(item.value); }} accessibilityRole="button" accessibilityLabel={item.label} style={styles.painCard}><View style={styles.smallIcon}><Feather name={item.icon} size={20} color={Phase1Colors.orange} /></View><Text style={styles.painText}>{item.label}</Text><Feather name="arrow-right" size={18} color={Phase1Colors.textMuted} /></Pressable>)}</View></Phase1Frame>;
}

export function ChallengeScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const fixture = state.tutorialFixture!;
  const fixturePlatform = PLATFORM_LABELS[fixture.platform];
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.38} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Practice sharing it" onPress={() => void beginOnboardingV2SharingRehearsal()} />}><Text style={styles.eyebrow}>A POST WORTH SAVING</Text><Text style={styles.headline}>Want to know where this is?</Text><Text style={styles.body}>Practice the same sharing steps you will use in {fixturePlatform}. This lesson stays inside Nearr.</Text><ChallengeSourcePreview fixture={fixture} preferredPlatform={state.preferredPlatform} /><Text style={styles.microcopy}>Nearr will show you the place after you finish the practice.</Text></Phase1Frame>;
}

export function ChallengeSourcePreview({ fixture, preferredPlatform: _preferredPlatform }: {
  fixture: OnboardingTutorialFixture;
  preferredPlatform: OnboardingPlatform | null;
}) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const offlineFixture = offlineFixtureById(fixture.id);
  if (!offlineFixture) throw new Error(`offline_onboarding_fixture_invariant:${fixture.id}`);
  const fixturePlatform = PLATFORM_LABELS[fixture.platform];
  return (
    <View style={styles.videoPreview} testID="onboarding-source-preview">
      <OfflineFixtureVideo assetKey={offlineFixture.assetKey} style={StyleSheet.absoluteFill} accessibilityLabel={`${fixturePlatform} ${offlineFixture.category} practice video`} testID="onboarding-source-preview-video" />
      <View style={styles.previewShade} pointerEvents="none" />
      <View style={styles.previewBadge} pointerEvents="none"><Ionicons name={PLATFORMS.find((item) => item.value === fixture.platform)?.icon ?? 'play'} size={15} color="#FFFFFF" /><Text style={styles.previewBadgeText}>{fixturePlatform.toUpperCase()} POST</Text></View>
      <View style={styles.previewPrompt} pointerEvents="none"><Text style={styles.previewQuestion}>The location isn't shown.</Text><Text style={styles.previewHint}>{offlineFixture.caption}</Text></View>
    </View>
  );
}
export function ProcessingScreen({ state }: { state: OnboardingV2State; failed?: boolean; onRetry?: () => void }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const [step, setStep] = useState(0);
  const reduceMotion = useOnboardingReduceMotion();
  useEffect(() => {
    if (reduceMotion) { setStep(3); return; }
    const scanning = setTimeout(() => setStep(1), OFFLINE_ONBOARDING_TIMING_MS.scanningVideo);
    const clues = setTimeout(() => setStep(2), OFFLINE_ONBOARDING_TIMING_MS.lookingForClues);
    const matching = setTimeout(() => setStep(3), OFFLINE_ONBOARDING_TIMING_MS.matchingPlace);
    return () => { clearTimeout(scanning); clearTimeout(clues); clearTimeout(matching); };
  }, [reduceMotion]);
  const fixture = offlineFixtureById(state.tutorialFixture?.id);
  const practiceSource = onboardingPhase2PracticeForInterest(state.interest);
  if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${state.tutorialFixture?.id ?? 'missing'}`);
  const steps = ['Post received', 'Scanning video', 'Looking for clues', 'Matching the place'];
  return <Phase1Frame progress={0.6} progressLabel="Onboarding progress" contentStyle={styles.processingContent}>
    <Text style={styles.processingEyebrow}>PRACTICE SAVE</Text>
    <Text style={styles.headline}>From your feed to your world.</Text>
    <FieldnotesPracticeScene fixtureId={fixture.id} stage="receipt" />
    <Text style={styles.bodyCentered} accessibilityLiveRegion="polite">{steps[step]}</Text>
    <Text style={styles.microcopy}>A bundled example. Your real posts are checked after sharing.</Text>
  </Phase1Frame>;

}

function MagicMomentScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const fixture = offlineFixtureById(state.tutorialFixture?.id);
  if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${state.tutorialFixture?.id ?? 'missing'}`);
  useEffect(() => { if (state.stage === 'tutorial_reveal') void confirmOnboardingV2FirstMagicMoment(); }, [state.stage]);
  useEffect(() => { if (state.stage === 'tutorial_celebration' && !state.celebrationShownAt) { hapticSuccess(); void recordOnboardingV2CelebrationShown(); } }, [state.celebrationShownAt, state.stage]);
  const continueFlow = async () => {
    let next = state;
    if (next.stage === 'tutorial_reveal') next = await confirmOnboardingV2FirstMagicMoment();
    if (next.stage === 'tutorial_celebration') next = await finishOnboardingV2FirstMagicMoment();
  };
  return (
    <Phase1Frame
      progress={0.68}
      progressLabel="Onboarding progress"
      footer={<Phase1PrimaryButton title="Find it on my map" onPress={() => void continueFlow()} />}
    >
      <Text style={styles.eyebrow}>1 PLACE FOUND</Text>
      <Text style={styles.headline}>The place, not just the post.</Text>
      <FieldnotesPracticeScene fixtureId={fixture.id} stage="place" />
      <Text style={styles.whyStatement}>Social apps save the video. Nearr saves the place.</Text>
      <Text style={styles.whyBody}>The original post stays attached, so you remember why it mattered.</Text>
    </Phase1Frame>
  );
}

function FixtureMapPayoffScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const fixture = offlineFixtureById(state.tutorialFixture?.id);
  const savedPlaceId = state.tutorialSave?.savedPlaceId;
  if (!fixture || !savedPlaceId) throw new Error('offline_fixture_map_payoff_invariant');
  const closeRef = useRef(false);
  const closeCard = () => {
    if (closeRef.current) return;
    closeRef.current = true;
    hapticSuccess();
    void closeOnboardingV2PlaceTour(savedPlaceId);
  };
  return <Phase1Frame progress={0.7} progressLabel="Onboarding progress">
    <Text style={styles.eyebrow}>A PLACE TO REMEMBER</Text>
    <Text style={styles.headline}>Saved to your practice map.</Text>
    <FieldnotesPracticeScene fixtureId={fixture.id} stage="place" onClose={closeCard} />
  </Phase1Frame>;
}

function Phase2IntroScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const fixture = offlineFixtureById(state.tutorialFixture?.id);
  const practiceSource = onboardingPhase2PracticeForInterest(state.interest);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!fixture) throw new Error('offline_phase2_intro_invariant');
  const tryRealVideo = async () => {
    if (starting) return;
    setStarting(true);
    setError(null);
    try {
      const result = await bootstrapAnonymousOnboarding();
      if (result.kind === 'failed') {
        setError('A connection is needed for real sharing. Retry when you’re online or do this later.');
        return;
      }
      const next = await beginOnboardingV2RealPractice();
      const practiceFixture = next.practiceFixture;
      if (!practiceFixture) throw new Error('practice_fixture_missing');
      await openOnboardingV2Starter({
        contentId: practiceFixture.contentId,
        sourceUrl: practiceFixture.canonicalUrl,
      });
      await openOnboardingPracticePost(practiceFixture);
      await markOnboardingV2PracticeWaitingForShare();
    } catch {
      setError('A connection is needed for real sharing. Retry when you’re online or do this later.');
    } finally {
      setStarting(false);
    }
  };
  return (
    <Phase1Frame progress={0.74} progressLabel="Onboarding progress" scroll={false} contentStyle={styles.phase2Content} footer={<View style={styles.phase2Actions}><Phase1PrimaryButton title={starting ? 'Connecting…' : 'Try with a real video'} disabled={starting} onPress={() => void tryRealVideo()} /><Pressable onPress={() => void deferOnboardingV2Practice()} accessibilityRole="button" accessibilityLabel="I'll try this later" style={styles.laterButton}><Text style={styles.laterButtonText}>I’ll try this later</Text></Pressable></View>}>
      <View style={styles.phase2MapBackdrop}><View style={styles.mapRoadWide} /><View style={styles.mapRoadThin} /><View style={styles.smallPayoffPin}><Feather name="map-pin" size={17} color={Phase1Colors.onOrange} /></View></View>
      <View style={styles.phase2Sheet}>
        <Text style={styles.eyebrow}>OPTIONAL REAL-WORLD PRACTICE</Text>
        <Text style={styles.headline}>Ready to save one of your own?</Text>
        <Text style={styles.body}>One tap opens the exact practice post. Use Share, then choose Nearr. A connection is needed for this optional real save.</Text>
        <View style={styles.phase2Proof}><Image source={offlineOnboardingAsset(practiceSource.localPreviewAssetKey)} style={styles.phase2ProofImage} /><View style={styles.flex}><Text style={styles.detailLabel}>YOUR REAL PRACTICE POST</Text><Text style={styles.detailText}>{practiceSource.expectedPlaceName} is a {interestLabel(state.interest).toLowerCase()} example. Nearr will still verify the shared post before saving anything.</Text></View></View>
        {error ? <Text style={styles.phase2Error} accessibilityRole="alert">{error}</Text> : null}
      </View>
    </Phase1Frame>
  );
}

function OfflinePlaceDetailScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const fixture = offlineFixtureById(state.tutorialFixture?.id);
  const savedPlaceId = state.tutorialSave?.savedPlaceId;
  if (!fixture || !savedPlaceId) throw new Error('offline_onboarding_place_detail_invariant');
  useEffect(() => { void recordOnboardingV2PlaceTourOpened(savedPlaceId); }, [savedPlaceId]);
  return <Phase1Frame progress={0.71} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" onPress={() => void closeOnboardingV2PlaceTour(savedPlaceId)} />}>
    <Text style={styles.eyebrow}>YOUR SAVED PLACE</Text><Text style={styles.revealTitle}>{fixture.place.name}</Text><Text style={styles.revealAddress}>{fixture.place.address}</Text>
    <Image source={offlineOnboardingAsset(fixture.assetKey)} style={[styles.heroPhoto, styles.localHeroPhoto]} resizeMode="cover" accessibilityLabel={`${fixture.place.name} bundled place photo`} />
    <View style={styles.detailNote}><Feather name="star" size={18} color={Phase1Colors.orange} /><View style={styles.flex}><Text style={styles.detailLabel}>NEARR NOTE</Text><Text style={styles.detailText}>{fixture.place.aiNote}</Text></View></View>
    <View style={styles.localMapCard}><View style={styles.localMapRoadOne} /><View style={styles.localMapRoadTwo} /><View style={styles.localMapPin}><Feather name="map-pin" size={18} color="#FFFFFF" /></View><View style={styles.localMapCopy}><Text style={styles.detailLabel}>MAP & DIRECTIONS</Text><Text style={styles.detailText}>{fixture.place.directionsLabel}</Text></View></View>
    <Text style={styles.sectionLabel}>NEARBY EXAMPLES</Text><View style={styles.nearbyList}>{fixture.place.nearby.map((name) => <View key={name} style={styles.nearbyRow}><Feather name="map-pin" size={15} color={Phase1Colors.success} /><Text style={styles.nearbyText}>{name}</Text></View>)}</View>
  </Phase1Frame>;
}

function FirstMagicCompleteScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const { data: savedPlaces } = useSavedPlaces();
  const practice = onboardingPhase2PracticeFromFixtureId(state.practiceFixture?.id);
  const practiceSavedPlaceId = state.realPracticeSession?.savedPlaceId
    ?? state.independentSaves[0]?.savedPlaceId
    ?? null;
  const realSave = practiceSavedPlaceId
    ? savedPlaces.find((saved) => saved.id === practiceSavedPlaceId)
    : undefined;
  const sourceThumbnail = realSave?.sources?.find((source) => source.is_primary)?.thumbnail_url
    ?? realSave?.sources?.[0]?.thumbnail_url
    ?? null;
  const placeName = realSave?.place.name ?? practice?.expectedPlaceName ?? 'Your place';
  const fallbackAsset = practice?.localPreviewAssetKey ?? 'mad_yolks';
  return <Phase1Frame progress={0.76} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Set up Nearr" onPress={() => void beginOnboardingV2SecondHalf()} />} contentStyle={styles.centered}>
    <View style={styles.celebrationMark}><NearrSparkleMark size={78} /><View style={styles.checkBadge}><Feather name="check" size={18} color={Phase1Colors.onOrange} /></View></View>
    <Text style={styles.headlineCentered}>{placeName} is saved.</Text>
    <View style={styles.realSaveProof}>
      <Image source={sourceThumbnail ? { uri: sourceThumbnail } : offlineOnboardingAsset(fallbackAsset)} style={styles.realSaveFallback} resizeMode="cover" accessibilityLabel={`${placeName} saved-place photo`} />
    </View>
    <Text style={styles.celebrationCopy}>It’s now on your map. Next, choose whether Nearr can bring saved places back when you’re nearby.</Text>
  </Phase1Frame>;
}
function LoadingState({ label }: { label: string }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);
 return <Phase1Frame progress={0.34} progressLabel="Onboarding progress" contentStyle={styles.centered}><NearrSparkleMark size={76} /><Text style={styles.loadingLabel}>{label}</Text><Text style={styles.bodyCentered}>Matching your choices with a real guided example.</Text></Phase1Frame>; }
function interestLabel(value: OnboardingInterest | null): string { switch (value) { case 'outdoors': case 'beaches': return 'Outdoor spots'; case 'food': return 'Food spots'; case 'cafes': return 'Cafes'; case 'travel': return 'Travel places'; case 'things_to_do': return 'Things to do'; case 'shopping': return 'Shops'; default: return 'Great places'; } }

function createStyles(Phase1Colors: ReturnType<typeof usePhase1Colors>) { return StyleSheet.create({
  flex: { flex: 1 }, centered: { justifyContent: 'center', paddingBottom: 52 }, eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '600', letterSpacing: 1.7, marginBottom: 10 },
  headline: { color: Phase1Colors.text, fontSize: 32, lineHeight: 38, fontWeight: '600', letterSpacing: -1 }, headlineXL: { color: Phase1Colors.text, fontSize: 37, lineHeight: 41, fontWeight: '600', letterSpacing: -1.7 }, headlineCentered: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '600', letterSpacing: -1, textAlign: 'center', marginTop: 24 }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12, textAlign: 'center' },
  welcomeBrand: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 18 }, wordmark: { color: Phase1Colors.text, fontSize: 22, fontWeight: '600', letterSpacing: 3.4 },
  welcomeFooter: { gap: 4 }, signInLink: { minHeight: 44, alignItems: 'center', justifyContent: 'center' }, signInLinkText: { color: Phase1Colors.text, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
  newAccountNotice: { flexDirection: 'row', gap: 9, marginTop: 16, padding: 12, borderRadius: 15, backgroundColor: Phase1Colors.surfaceRaised }, newAccountNoticeText: { flex: 1, color: Phase1Colors.text, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  credibilityRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18 }, credibilityItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, credibilityText: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '600' }, credibilityDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#B6AEA2' },
  logoHero: { width: 88, height: 88, borderRadius: 25, overflow: 'hidden', marginBottom: 28, borderWidth: 1, borderColor: '#33302B' }, logo: { width: '100%', height: '100%' }, logoSmall: { width: 72, height: 72, borderRadius: 20 },
  platformStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 28 }, stripItem: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: 14, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stripLabel: { color: Phase1Colors.text, fontSize: 12, fontWeight: '600' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 28 }, platformCard: { width: '48%', minHeight: 124, padding: 15, borderRadius: 12, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, justifyContent: 'space-between', shadowColor: '#4B3B2D', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 2 }, selectedCard: { borderColor: Phase1Colors.orange, backgroundColor: Phase1Colors.surfaceRaised }, platformIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, choiceTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '600' }, radio: { position: 'absolute', right: 13, top: 13, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#CFC6BA', alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.surface }, radioSelected: { borderColor: Phase1Colors.orange, backgroundColor: Phase1Colors.orange },
  disabledCard: { opacity: 0.42 },
  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 }, interestPill: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedPill: { backgroundColor: Phase1Colors.orange, borderColor: Phase1Colors.orange }, interestLabel: { color: Phase1Colors.text, fontSize: 14, fontWeight: '600' }, selectedPillText: { color: Phase1Colors.onOrange },
  interestGrid: { gap: 9, marginTop: 24 }, interestCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, borderRadius: 12, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedInterestCard: { borderColor: Phase1Colors.orange, backgroundColor: Phase1Colors.surfaceRaised }, interestIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.surfaceRaised }, selectedInterestIcon: { backgroundColor: Phase1Colors.orange }, selectedInterestText: { color: Phase1Colors.text },
  payoffContent: { justifyContent: 'center', paddingBottom: 38 }, payoffKicker: { color: Phase1Colors.orange, fontSize: 18, lineHeight: 24, fontWeight: '600', textAlign: 'center', marginBottom: 12 }, payoffHeadline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 39, fontWeight: '600', letterSpacing: -1.1, textAlign: 'center' }, payoffBody: { color: Phase1Colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 18, paddingHorizontal: 12 },
  sectionLabel: { color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '600', letterSpacing: 1.3, marginTop: 28, marginBottom: 10 }, compactPainWrap: { gap: 8 }, compactPain: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, borderRadius: 16, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedPain: { backgroundColor: Phase1Colors.orange, borderColor: Phase1Colors.orange }, compactPainText: { flex: 1, color: Phase1Colors.text, fontSize: 13, fontWeight: '600' },
  stack: { gap: 10, marginTop: 26 }, painCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, shadowColor: '#4B3B2D', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 }, smallIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.surfaceRaised }, painText: { flex: 1, color: Phase1Colors.text, fontSize: 14, lineHeight: 19, fontWeight: '600' },
  videoPreview: { height: 344, marginTop: 26, borderRadius: 28, overflow: 'hidden', backgroundColor: '#DDE9E4', borderWidth: 5, borderColor: Phase1Colors.surface, shadowColor: '#30251D', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 4 }, previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' }, playButton: { position: 'absolute', left: '50%', top: '45%', marginLeft: -30, marginTop: -30, width: 60, height: 60, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }, previewBadge: { position: 'absolute', zIndex: 4, top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(10,10,10,0.78)' }, previewBadgeText: { color: '#FFFFFF', fontSize: 9, letterSpacing: 1.1, fontWeight: '600' }, previewPrompt: { position: 'absolute', zIndex: 4, left: 17, right: 17, bottom: 17 }, previewQuestion: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '600', textShadowColor: '#000000', textShadowRadius: 8 }, previewHint: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 5, textShadowColor: '#000000', textShadowRadius: 8 }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  neutralPostMark: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#40281A', borderWidth: 1, borderColor: '#6D452E' }, neutralPostLogo: { position: 'absolute', width: 54, height: 54, borderRadius: 15, opacity: 0.45 }, neutralPostText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600', marginTop: 16 },
  steps: { gap: 12, marginTop: 27 }, instruction: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stepNumber: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '600' }, stepIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1C14' }, nearrStepLogo: { width: 42, height: 42, borderRadius: 12 }, instructionTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '600' }, instructionBody: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  statusIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.surfaceRaised, marginBottom: 26 }, reminder: { minHeight: 58, alignItems: 'center', justifyContent: 'center', marginTop: 28, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, reminderText: { color: Phase1Colors.text, fontSize: 17, fontWeight: '600' },
  processingContent: { justifyContent: 'center', paddingBottom: 34 }, processingEyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '600', letterSpacing: 1.7, textAlign: 'center' }, orangeDot: { color: Phase1Colors.orange }, processingSteps: { gap: 8, marginTop: 23 }, processingStep: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: Phase1Colors.surfaceRaised, opacity: 0.65 }, processingStepActive: { backgroundColor: Phase1Colors.surface, opacity: 1 }, processingStepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8C0B5' }, processingStepDotActive: { backgroundColor: Phase1Colors.orange }, processingStepText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 13, fontWeight: '600' }, processingStepTextActive: { color: Phase1Colors.text },
  localScanner: { height: 330, marginTop: 26, borderRadius: 34, overflow: 'hidden', backgroundColor: '#23322F', borderWidth: 6, borderColor: Phase1Colors.surface, shadowColor: '#513B2C', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 7 }, scanLineStatic: { position: 'absolute', left: 20, right: 20, top: '52%', height: 3, borderRadius: 2, backgroundColor: '#FF8252', shadowColor: '#FF5B24', shadowOpacity: 0.95, shadowRadius: 12 }, scannerPin: { position: 'absolute', right: 24, bottom: 24, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange },
  mapPayoffContent: { flex: 1, paddingHorizontal: 0, paddingBottom: 0 }, fixtureMap: { minHeight: 600, overflow: 'hidden', backgroundColor: Phase1Colors.mapLand }, mapRoadWide: { position: 'absolute', width: '150%', height: 35, left: '-24%', top: '31%', backgroundColor: Phase1Colors.surface, transform: [{ rotate: '-19deg' }] }, mapRoadThin: { position: 'absolute', width: 24, height: '120%', left: '24%', top: '-8%', backgroundColor: Phase1Colors.surface, transform: [{ rotate: '27deg' }] }, mapWater: { position: 'absolute', width: '58%', height: '45%', right: '-20%', top: '-7%', borderRadius: 120, backgroundColor: Phase1Colors.mapWater }, focusRing: { position: 'absolute', width: 84, height: 84, borderRadius: 42, left: '50%', top: 74, marginLeft: -42, borderWidth: 2, borderColor: 'rgba(255,91,36,0.5)', backgroundColor: 'rgba(255,91,36,0.12)' }, payoffPin: { position: 'absolute', width: 52, height: 52, borderRadius: 26, left: '50%', top: 90, marginLeft: -26, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange }, smallPayoffPin: { position: 'absolute', width: 36, height: 36, borderRadius: 18, left: '52%', top: '30%', alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange }, mapSavedPill: { position: 'absolute', top: 18, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 18, backgroundColor: Phase1Colors.surface }, mapSavedPillText: { color: Phase1Colors.text, fontSize: 12, fontWeight: '600' }, openPlaceCard: { marginHorizontal: 12, marginTop: 174, marginBottom: 12, padding: 16, borderRadius: 26, backgroundColor: Phase1Colors.surface, shadowColor: '#362B23', shadowOpacity: 0.2, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 }, cardClose: { position: 'absolute', zIndex: 4, right: 12, top: 12, width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.surface }, cardPhoto: { width: '100%', height: 150, borderRadius: 18, marginBottom: 13 }, cardEyebrow: { color: Phase1Colors.success, fontSize: 10, fontWeight: '600', letterSpacing: 1.3 }, cardTitle: { color: Phase1Colors.text, fontSize: 27, fontWeight: '600', marginTop: 4 }, cardAddress: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 }, cardNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 11, padding: 10, borderRadius: 13, backgroundColor: Phase1Colors.surfaceRaised }, cardNoteText: { flex: 1, color: Phase1Colors.text, fontSize: 12, lineHeight: 17, fontWeight: '700' }, cardCloseHint: { color: Phase1Colors.textMuted, fontSize: 11, textAlign: 'center', marginTop: 10 },
  phase2Content: { flex: 1, paddingHorizontal: 0, paddingBottom: 0 }, phase2MapBackdrop: { height: 170, overflow: 'hidden', backgroundColor: Phase1Colors.mapLand }, phase2Sheet: { flex: 1, marginTop: -18, paddingHorizontal: 22, paddingTop: 22, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: Phase1Colors.background }, phase2Actions: { gap: 4 }, laterButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center' }, laterButtonText: { color: Phase1Colors.text, fontSize: 14, fontWeight: '600' }, phase2Proof: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 16, padding: 9, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, phase2ProofImage: { width: 50, height: 50, borderRadius: 12 }, phase2Error: { color: Phase1Colors.danger, fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 12 },
  revealTitle: { color: Phase1Colors.text, fontSize: 38, lineHeight: 41, fontWeight: '600', letterSpacing: -1.3 }, revealAddress: { color: Phase1Colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 }, heroPhoto: { marginTop: 20 }, photoAttribution: { color: Phase1Colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 5, textAlign: 'right' }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, metaChip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 12, backgroundColor: Phase1Colors.surface }, metaText: { color: Phase1Colors.text, fontSize: 11, fontWeight: '600' }, mapWrap: { height: 150, marginTop: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: Phase1Colors.border }, sourceCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 10, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, sourceThumb: { width: 54, height: 54, borderRadius: 12 }, sourceThumbFallback: { width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#462C20' }, sourceEyebrow: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '600', letterSpacing: 1 }, sourceTitle: { color: Phase1Colors.text, fontSize: 13, lineHeight: 17, fontWeight: '600', marginTop: 3 },
  localHeroPhoto: { width: '100%', height: 292, borderRadius: 18 }, localMapRoadOne: { position: 'absolute', width: 220, borderTopWidth: 2, borderColor: '#AFC5B4', top: 30, left: -20, transform: [{ rotate: '-14deg' }] }, localMapRoadTwo: { position: 'absolute', height: 130, borderLeftWidth: 2, borderColor: '#BDCEBF', left: 88, top: -24, transform: [{ rotate: '30deg' }] }, localMapPin: { position: 'absolute', left: '48%', top: '31%', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange }, detailNote: { flexDirection: 'row', gap: 10, marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, detailLabel: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '600', letterSpacing: 1 }, detailText: { color: Phase1Colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700', marginTop: 4 }, localMapCard: { height: 130, marginTop: 14, borderRadius: 20, overflow: 'hidden', backgroundColor: Phase1Colors.mapLand, borderWidth: 1, borderColor: Phase1Colors.border }, localMapCopy: { position: 'absolute', left: 12, right: 12, bottom: 10, padding: 8, borderRadius: 11, backgroundColor: Phase1Colors.surface }, nearbyList: { gap: 7 }, nearbyRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: Phase1Colors.surface }, nearbyText: { flex: 1, color: Phase1Colors.text, fontSize: 12, fontWeight: '600' },
  revealTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, revealCount: { color: Phase1Colors.orange, fontSize: 10, fontWeight: '600', letterSpacing: 1.5 }, revealFound: { color: Phase1Colors.textMuted, fontSize: 16, fontWeight: '600', marginBottom: 4 }, revealCheck: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedBanner: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 12, borderRadius: 17, backgroundColor: Phase1Colors.successSurface }, savedBannerIcon: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedBannerText: { color: Phase1Colors.success, fontSize: 13, fontWeight: '600' }, transformationCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 9, borderRadius: 21, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, transformSource: { width: 78, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: '#2E2B28' }, transformThumb: { width: '100%', height: '100%' }, transformThumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#423B36' }, transformArrow: { width: 30, alignItems: 'center' }, transformMap: { flex: 1, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: Phase1Colors.mapLand }, transformLabel: { position: 'absolute', left: 6, bottom: 6, color: '#FFFFFF', fontSize: 8, fontWeight: '600', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(22,20,18,0.72)' }, whyStatement: { color: Phase1Colors.text, fontSize: 16, lineHeight: 23, fontWeight: '600', marginTop: 18 }, whyBody: { color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  celebrationMark: { width: 126, height: 126, borderRadius: 63, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: Phase1Colors.orange }, celebrationHalo: { position: 'absolute', width: 156, height: 156, borderRadius: 78, borderWidth: 1, borderColor: 'rgba(255,106,26,0.38)' }, checkBadge: { position: 'absolute', right: 1, bottom: 6, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E', borderWidth: 3, borderColor: Phase1Colors.background }, celebrationCopy: { color: Phase1Colors.textMuted, fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 13 }, savedProof: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', marginTop: 28, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, savedProofText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '600' }, loadingLabel: { color: Phase1Colors.text, fontSize: 16, fontWeight: '600', marginTop: 18 },
  realSaveProof: { width: '100%', height: 154, marginTop: 22, overflow: 'hidden', borderRadius: 18, backgroundColor: Phase1Colors.surfaceRaised }, realSaveFallback: { width: '100%', height: '100%' },
}); }
