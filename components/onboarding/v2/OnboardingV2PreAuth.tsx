import { useEffect, useRef, useState } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

import { StartupSurface } from '@/components/StartupSurface';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from '@/components/onboarding/v2/Phase1Visuals';
import { NearrSparkleMark, SocialToMapIllustration, useOnboardingReduceMotion } from '@/components/onboarding/v2/OnboardingVisualLanguage';
import { OnboardingV2SecondHalf } from '@/components/onboarding/v2/OnboardingV2SecondHalf';
import { ImmersiveGuidedSave } from '@/components/onboarding/v2/ImmersiveGuidedSave';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { useStartupWatchdog } from '@/hooks/useStartupWatchdog';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import { offlineOnboardingAsset } from '@/onboarding/assets/offlineOnboardingAssets';
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
  beginOnboardingV2SecondHalf,
  finishOnboardingV2FirstMagicMoment, goBackOnboardingV2,
  migrateInterruptedOnboardingV2ToFirstMagic,
  recordOnboardingV2PlaceTourOpened, closeOnboardingV2PlaceTour,
  recordOnboardingV2CelebrationShown, recordOnboardingV2GetStarted,
  resolveOnboardingV2TutorialResult,
  setOnboardingV2DesiredValue, setOnboardingV2PainPoint,
  setOnboardingV2TutorialFixture,
  toggleOnboardingV2Interest,
} from '@/lib/onboardingV2';
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
  const { state, loading } = useOnboardingV2();
  const fixtureInFlightRef = useRef(false);
  const screenOwnedStage = !!state && [
    'overview', 'platform', 'interest', 'interest_selected', 'personalized_payoff', 'pain_point',
    'desired_value', 'tutorial_loading', 'tutorial_challenge', 'tutorial_ready',
    'tutorial_share_tapped', 'tutorial_more_tapped', 'tutorial_processing', 'tutorial_reveal',
    'tutorial_celebration', 'place_tour', 'first_magic_moment_complete', 'why_nearr',
    'nearby_value', 'location_education', 'location_background_education',
    'notification_education', 'making_nearr_yours', 'growing_map', 'auth_success',
    'personalized_activation', 'activation_challenge',
  ].includes(state.stage);
  const startupPending = loading || !screenOwnedStage;
  const startupWatchdog = useStartupWatchdog(startupPending);

  useEffect(() => {
    if (state?.stage === 'interest_selected') void migrateInterruptedOnboardingV2ToFirstMagic();
  }, [state?.stage]);
  useEffect(() => {
    if (state?.stage !== 'tutorial_loading' || fixtureInFlightRef.current) return;
    fixtureInFlightRef.current = true;
    const fixture = selectOfflineOnboardingFixture(state.preferredPlatform, state.interest);
    void setOnboardingV2TutorialFixture(toOnboardingTutorialFixture(fixture, new Date().toISOString()))
      .finally(() => { fixtureInFlightRef.current = false; });
  }, [state?.interest, state?.preferredPlatform, state?.stage]);
  useEffect(() => {
    if (state?.stage !== 'tutorial_processing' || !state.tutorialFixture) return;
    const fixture = offlineFixtureById(state.tutorialFixture.id);
    if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${state.tutorialFixture.id}`);
    const startedAt = state.tutorialLaunchedAt ? Date.parse(state.tutorialLaunchedAt) : Date.now();
    const elapsed = Math.max(0, Date.now() - startedAt);
    const remaining = Math.max(0, OFFLINE_ONBOARDING_TIMING_MS.found - elapsed);
    const timer = setTimeout(() => {
      void resolveOnboardingV2TutorialResult(buildOfflineOnboardingResult(fixture));
    }, remaining);
    return () => clearTimeout(timer);
  }, [state?.stage, state?.tutorialFixture?.id, state?.tutorialLaunchedAt]);

  if (!state || startupPending) return <StartupSurface owner={startupWatchdog.timedOut ? 'ERROR_RECOVERY' : 'ONBOARDING'} recovery={startupWatchdog.timedOut} onRetry={startupWatchdog.timedOut ? startupWatchdog.retry : undefined} />;
  if (state.stage === 'overview') return <WelcomeScreen onContinue={() => void recordOnboardingV2GetStarted()} />;
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
  if (state.stage === 'place_tour' && state.tutorialResult) return <OfflinePlaceDetailScreen state={state} />;
  if (state.stage === 'first_magic_moment_complete') return <FirstMagicCompleteScreen />;
  return <OnboardingV2SecondHalf state={state} />;
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) {
  return <Phase1Frame footer={<Phase1PrimaryButton title="Get started" onPress={onContinue} />}>
    <View style={styles.welcomeBrand}><NearrSparkleMark size={54} /><Text style={styles.wordmark}>NEARR</Text></View>
    <SocialToMapIllustration />
    <Text style={styles.headlineXL}>Find the places hiding in your feed.</Text>
    <Text style={styles.body}>Share something you want to visit. Nearr turns the post into a real place on your map.</Text>
    <PlatformStrip />
    <View style={styles.credibilityRow} accessibilityLabel="Private personal map with real saved places"><View style={styles.credibilityItem}><Feather name="shield" size={15} color={Phase1Colors.success} /><Text style={styles.credibilityText}>Your private map</Text></View><View style={styles.credibilityDot} /><View style={styles.credibilityItem}><Feather name="check-circle" size={15} color={Phase1Colors.success} /><Text style={styles.credibilityText}>Real saved places</Text></View></View>
  </Phase1Frame>;
}
function PlatformStrip() { return <View style={styles.platformStrip} accessibilityLabel="Works with Instagram, TikTok, Facebook, and YouTube">{PLATFORMS.map((item) => <View key={item.value} style={styles.stripItem}><Ionicons name={item.icon} size={19} color={item.tint} /><Text style={styles.stripLabel}>{item.label}</Text></View>)}</View>; }
function PlatformScreen({ state }: { state: OnboardingV2State }) {
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.14} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" disabled={!state.preferredPlatform} onPress={() => void completeOnboardingV2Platforms()} />}>
    <Text style={styles.eyebrow}>START WITH YOUR FEED</Text><Text style={styles.headline}>Where do you usually find places?</Text><Text style={styles.body}>Choose the one you use most.</Text>
    <View style={styles.choiceGrid}>{PLATFORMS.map((item) => { const selected = state.preferredPlatform === item.value; return <Pressable key={item.value} onPress={() => { hapticSelection(); void chooseOnboardingV2PrimaryPlatform(item.value); }} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={item.label} style={[styles.platformCard, selected && styles.selectedCard]}><View style={[styles.platformIcon, { backgroundColor: item.tint }]}><Ionicons name={item.icon} size={29} color="#171615" /></View><Text style={styles.choiceTitle}>{item.label}</Text><View style={[styles.radio, selected && styles.radioSelected]}>{selected ? <Feather name="check" size={13} color="#FFFFFF" /> : null}</View></Pressable>; })}</View>
  </Phase1Frame>;
}
function InterestScreen({ state }: { state: OnboardingV2State }) {
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.22} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" disabled={state.selectedInterests.length === 0} onPress={() => void completeOnboardingV2Interests()} />}>
    <Text style={styles.eyebrow}>MAKE IT YOURS</Text><Text style={styles.headline}>What do you save most?</Text><Text style={styles.body}>Pick everything that sounds like you.</Text>
    <View style={styles.interestGrid}>{INTERESTS.map((item) => { const selected = state.selectedInterests.includes(item.value); return <Pressable key={item.value} onPress={() => { hapticSelection(); void toggleOnboardingV2Interest(item.value); }} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={item.label} style={[styles.interestCard, selected && styles.selectedInterestCard]}><View style={[styles.interestIcon, selected && styles.selectedInterestIcon]}><Feather name={item.icon} size={21} color={selected ? '#FFFFFF' : Phase1Colors.orange} /></View><Text style={[styles.interestLabel, selected && styles.selectedInterestText]}>{item.label}</Text>{selected ? <Feather name="check-circle" size={18} color={Phase1Colors.orange} /> : null}</Pressable>; })}</View>
  </Phase1Frame>;
}
function PersonalizedPayoffScreen({ state }: { state: OnboardingV2State }) {
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
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.6} progressLabel="Onboarding progress"><Text style={styles.eyebrow}>NOW THAT YOU'VE SEEN IT</Text><Text style={styles.headline}>What's most annoying about saving places?</Text><View style={styles.stack}>{PAIN_POINTS.slice(0, 4).map((item) => <Pressable key={item.value} onPress={() => { hapticSelection(); void setOnboardingV2PainPoint(item.value); }} accessibilityRole="button" accessibilityLabel={item.label} style={styles.painCard}><View style={styles.smallIcon}><Feather name={item.icon} size={20} color={Phase1Colors.orange} /></View><Text style={styles.painText}>{item.label}</Text><Feather name="arrow-right" size={18} color={Phase1Colors.textMuted} /></Pressable>)}</View></Phase1Frame>;
}
function DesiredValueScreen() {
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.67} progressLabel="Onboarding progress"><Text style={styles.eyebrow}>MAKE IT USEFUL</Text><Text style={styles.headline}>What would make Nearr most useful to you?</Text><View style={styles.stack}>{DESIRED_VALUES.map((item) => <Pressable key={item.value} onPress={() => { hapticSelection(); void setOnboardingV2DesiredValue(item.value); }} accessibilityRole="button" accessibilityLabel={item.label} style={styles.painCard}><View style={styles.smallIcon}><Feather name={item.icon} size={20} color={Phase1Colors.orange} /></View><Text style={styles.painText}>{item.label}</Text><Feather name="arrow-right" size={18} color={Phase1Colors.textMuted} /></Pressable>)}</View></Phase1Frame>;
}

export function ChallengeScreen({ state }: { state: OnboardingV2State }) {
  const fixture = state.tutorialFixture!;
  const fixturePlatform = PLATFORM_LABELS[fixture.platform];
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.38} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Practice sharing it" onPress={() => void beginOnboardingV2SharingRehearsal()} />}><Text style={styles.eyebrow}>A POST WORTH SAVING</Text><Text style={styles.headline}>Want to know where this is?</Text><Text style={styles.body}>Practice the same sharing steps you will use in {fixturePlatform}. This lesson stays inside Nearr.</Text><ChallengeSourcePreview fixture={fixture} preferredPlatform={state.preferredPlatform} /><Text style={styles.microcopy}>Nearr will show you the place after you finish the practice.</Text></Phase1Frame>;
}

export function ChallengeSourcePreview({ fixture, preferredPlatform: _preferredPlatform }: {
  fixture: OnboardingTutorialFixture;
  preferredPlatform: OnboardingPlatform | null;
}) {
  const offlineFixture = offlineFixtureById(fixture.id);
  if (!offlineFixture) throw new Error(`offline_onboarding_fixture_invariant:${fixture.id}`);
  const fixturePlatform = PLATFORM_LABELS[fixture.platform];
  return (
    <View style={styles.videoPreview} testID="onboarding-source-preview">
      <Image source={offlineOnboardingAsset(offlineFixture.assetKey)} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`${fixturePlatform} ${offlineFixture.category} practice post`} testID="onboarding-source-preview-image" />
      <View style={styles.previewShade} pointerEvents="none" />
      <View style={styles.previewBadge} pointerEvents="none"><Ionicons name={PLATFORMS.find((item) => item.value === fixture.platform)?.icon ?? 'play'} size={15} color="#FFFFFF" /><Text style={styles.previewBadgeText}>{fixturePlatform.toUpperCase()} POST</Text></View>
      <View style={styles.previewPrompt} pointerEvents="none"><Text style={styles.previewQuestion}>The location isn't shown.</Text><Text style={styles.previewHint}>{offlineFixture.caption}</Text></View>
    </View>
  );
}
export function ProcessingScreen({ state }: { state: OnboardingV2State; failed?: boolean; onRetry?: () => void }) {
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
  if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${state.tutorialFixture?.id ?? 'missing'}`);
  const steps = ['Post received', 'Scanning video', 'Looking for clues', 'Matching the place'];
  return <Phase1Frame progress={0.6} progressLabel="Onboarding progress" contentStyle={styles.processingContent}><Text style={styles.processingEyebrow}>NEARR IS ON IT</Text><Text style={styles.headlineCentered}>{steps[step]}<Text style={styles.orangeDot}>.</Text></Text><View style={styles.localScanner}><Image source={offlineOnboardingAsset(fixture.assetKey)} style={StyleSheet.absoluteFill} resizeMode="cover" /><View style={styles.previewShade} /><View style={styles.scanLineStatic} /><View style={styles.scannerPin}><Feather name="map-pin" size={22} color="#FFFFFF" /></View></View><View style={styles.processingSteps}>{steps.map((label, index) => <View key={label} style={[styles.processingStep, index <= step && styles.processingStepActive]}><View style={[styles.processingStepDot, index <= step && styles.processingStepDotActive]} /><Text style={[styles.processingStepText, index <= step && styles.processingStepTextActive]}>{label}</Text>{index < step ? <Feather name="check" size={15} color={Phase1Colors.success} /> : null}</View>)}</View></Phase1Frame>;
}

function MagicMomentScreen({ state }: { state: OnboardingV2State }) {
  const result = state.tutorialResult!;
  const place = result.place;
  const fixture = offlineFixtureById(state.tutorialFixture?.id);
  if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${state.tutorialFixture?.id ?? 'missing'}`);
  const [showTransformation, setShowTransformation] = useState(false);
  const reduceMotion = useOnboardingReduceMotion();
  const scale = useRef(new Animated.Value(0.78)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (state.stage === 'tutorial_reveal') void confirmOnboardingV2FirstMagicMoment(); }, [state.stage]);
  useEffect(() => { if (state.stage === 'tutorial_celebration' && !state.celebrationShownAt) { hapticSuccess(); void recordOnboardingV2CelebrationShown(); } }, [state.celebrationShownAt, state.stage]);
  useEffect(() => { const timer = setTimeout(() => setShowTransformation(true), reduceMotion ? 0 : 360); return () => clearTimeout(timer); }, [reduceMotion]);
  useEffect(() => { if (reduceMotion) { scale.setValue(1); opacity.setValue(1); return; } Animated.parallel([Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7, tension: 70 }), Animated.timing(opacity, { toValue: 1, duration: 360, useNativeDriver: true })]).start(); }, [opacity, reduceMotion, scale]);
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
      <View style={styles.revealTopRow}><Text style={styles.revealCount}>1 PLACE FOUND</Text><Animated.View style={[styles.revealCheck, { opacity, transform: [{ scale }] }]}><Feather name="check" size={22} color="#FFFFFF" /></Animated.View></View>
      <Text style={styles.revealFound}>Found it.</Text>
      <Text style={styles.revealTitle}>{place.name}</Text>
      <Text style={styles.revealAddress}>{place.formattedAddress ?? 'Saved to your Nearr map'}</Text>
      <Image source={offlineOnboardingAsset(fixture.assetKey)} style={[styles.heroPhoto, styles.localHeroPhoto]} resizeMode="cover" accessibilityLabel={`${place.name} bundled onboarding photo`} />
      <Animated.View style={[styles.savedBanner, { opacity }]} accessible accessibilityLabel="Saved to your onboarding map"><View style={styles.savedBannerIcon}><Feather name="check" size={16} color="#FFFFFF" /></View><Text style={styles.savedBannerText}>Saved for this walkthrough</Text></Animated.View>
      {showTransformation ? <Animated.View style={[styles.transformationCard, { opacity }]}>
        <View style={styles.transformSource}><Image source={offlineOnboardingAsset(fixture.assetKey)} style={styles.transformThumb} /><Text style={styles.transformLabel}>POST</Text></View>
        <View style={styles.transformArrow}><Feather name="arrow-right" size={20} color={Phase1Colors.orange} /></View>
        <View style={styles.transformMap} accessibilityLabel={`Offline map preview showing ${place.name}`}><View style={styles.localMapRoadOne} /><View style={styles.localMapRoadTwo} /><View style={styles.localMapPin}><Feather name="map-pin" size={17} color="#FFFFFF" /></View><Text style={styles.transformLabel}>PLACE</Text></View>
      </Animated.View> : null}
      <Text style={styles.whyStatement}>Social apps save the video. Nearr saves the place.</Text>
      <Text style={styles.whyBody}>Its name, map, source, and directions stay together for when you need them.</Text>
    </Phase1Frame>
  );
}

function OfflinePlaceDetailScreen({ state }: { state: OnboardingV2State }) {
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

function FirstMagicCompleteScreen() {
  return <Phase1Frame progress={0.72} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Keep going" onPress={() => void beginOnboardingV2SecondHalf()} />} contentStyle={styles.centered}><View style={styles.celebrationMark}><NearrSparkleMark size={78} /><View style={styles.checkBadge}><Feather name="check" size={18} color="#FFFFFF" /></View></View><Text style={styles.headlineCentered}>That’s the whole loop.</Text><Text style={styles.celebrationCopy}>Share a post, let Nearr find the place, then keep every detail together.</Text></Phase1Frame>;
}
function LoadingState({ label }: { label: string }) { return <Phase1Frame progress={0.34} progressLabel="Onboarding progress" contentStyle={styles.centered}><NearrSparkleMark size={76} /><Text style={styles.loadingLabel}>{label}</Text><Text style={styles.bodyCentered}>Matching your choices with a real guided example.</Text></Phase1Frame>; }
function interestLabel(value: OnboardingInterest | null): string { switch (value) { case 'outdoors': case 'beaches': return 'Outdoor spots'; case 'food': return 'Food spots'; case 'cafes': return 'Cafes'; case 'travel': return 'Travel places'; case 'things_to_do': return 'Things to do'; case 'shopping': return 'Shops'; default: return 'Great places'; } }

const styles = StyleSheet.create({
  flex: { flex: 1 }, centered: { justifyContent: 'center', paddingBottom: 52 }, eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.7, marginBottom: 10 },
  headline: { color: Phase1Colors.text, fontSize: 33, lineHeight: 37, fontWeight: '900', letterSpacing: -1 }, headlineXL: { color: Phase1Colors.text, fontSize: 42, lineHeight: 44, fontWeight: '900', letterSpacing: -1.7 }, headlineCentered: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1, textAlign: 'center', marginTop: 24 }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12, textAlign: 'center' },
  welcomeBrand: { flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 18 }, wordmark: { color: Phase1Colors.text, fontSize: 22, fontWeight: '900', letterSpacing: 3.4 },
  credibilityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, marginTop: 18 }, credibilityItem: { flexDirection: 'row', alignItems: 'center', gap: 5 }, credibilityText: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '800' }, credibilityDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#B6AEA2' },
  logoHero: { width: 88, height: 88, borderRadius: 25, overflow: 'hidden', marginBottom: 28, borderWidth: 1, borderColor: '#33302B' }, logo: { width: '100%', height: '100%' }, logoSmall: { width: 72, height: 72, borderRadius: 20 },
  platformStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 28 }, stripItem: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: 14, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stripLabel: { color: Phase1Colors.text, fontSize: 12, fontWeight: '800' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 28 }, platformCard: { width: '48%', minHeight: 124, padding: 15, borderRadius: 22, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, justifyContent: 'space-between', shadowColor: '#4B3B2D', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 2 }, selectedCard: { borderColor: Phase1Colors.orange, backgroundColor: '#FFF4EE' }, platformIcon: { width: 46, height: 46, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, choiceTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900' }, radio: { position: 'absolute', right: 13, top: 13, width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: '#CFC6BA', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' }, radioSelected: { borderColor: Phase1Colors.orange, backgroundColor: Phase1Colors.orange },
  disabledCard: { opacity: 0.42 },
  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 }, interestPill: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedPill: { backgroundColor: Phase1Colors.orange, borderColor: Phase1Colors.orange }, interestLabel: { color: Phase1Colors.text, fontSize: 14, fontWeight: '800' }, selectedPillText: { color: Phase1Colors.onOrange },
  interestGrid: { gap: 9, marginTop: 24 }, interestCard: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, borderRadius: 19, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedInterestCard: { borderColor: Phase1Colors.orange, backgroundColor: '#FFF4EE' }, interestIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E9' }, selectedInterestIcon: { backgroundColor: Phase1Colors.orange }, selectedInterestText: { color: Phase1Colors.text },
  payoffContent: { justifyContent: 'center', paddingBottom: 38 }, payoffKicker: { color: Phase1Colors.orange, fontSize: 18, lineHeight: 24, fontWeight: '900', textAlign: 'center', marginBottom: 12 }, payoffHeadline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 39, fontWeight: '900', letterSpacing: -1.1, textAlign: 'center' }, payoffBody: { color: Phase1Colors.textMuted, fontSize: 15, lineHeight: 22, textAlign: 'center', marginTop: 18, paddingHorizontal: 12 },
  sectionLabel: { color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '900', letterSpacing: 1.3, marginTop: 28, marginBottom: 10 }, compactPainWrap: { gap: 8 }, compactPain: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 13, borderRadius: 16, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedPain: { backgroundColor: Phase1Colors.orange, borderColor: Phase1Colors.orange }, compactPainText: { flex: 1, color: Phase1Colors.text, fontSize: 13, fontWeight: '800' },
  stack: { gap: 10, marginTop: 26 }, painCard: { minHeight: 70, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, shadowColor: '#4B3B2D', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 1 }, smallIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E9' }, painText: { flex: 1, color: Phase1Colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  videoPreview: { height: 344, marginTop: 26, borderRadius: 28, overflow: 'hidden', backgroundColor: '#DDE9E4', borderWidth: 5, borderColor: '#FFFFFF', shadowColor: '#30251D', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 4 }, previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' }, playButton: { position: 'absolute', left: '50%', top: '45%', marginLeft: -30, marginTop: -30, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }, previewBadge: { position: 'absolute', zIndex: 4, top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(10,10,10,0.78)' }, previewBadgeText: { color: '#FFFFFF', fontSize: 9, letterSpacing: 1.1, fontWeight: '900' }, previewPrompt: { position: 'absolute', zIndex: 4, left: 17, right: 17, bottom: 17 }, previewQuestion: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '900', textShadowColor: '#000000', textShadowRadius: 8 }, previewHint: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 5, textShadowColor: '#000000', textShadowRadius: 8 }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  neutralPostMark: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#40281A', borderWidth: 1, borderColor: '#6D452E' }, neutralPostLogo: { position: 'absolute', width: 54, height: 54, borderRadius: 15, opacity: 0.45 }, neutralPostText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', marginTop: 16 },
  steps: { gap: 12, marginTop: 27 }, instruction: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stepNumber: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '900' }, stepIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1C14' }, nearrStepLogo: { width: 42, height: 42, borderRadius: 12 }, instructionTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900' }, instructionBody: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  statusIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E8', marginBottom: 26 }, reminder: { minHeight: 58, alignItems: 'center', justifyContent: 'center', marginTop: 28, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, reminderText: { color: Phase1Colors.text, fontSize: 17, fontWeight: '900' },
  processingContent: { justifyContent: 'center', paddingBottom: 34 }, processingEyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.7, textAlign: 'center' }, orangeDot: { color: Phase1Colors.orange }, processingSteps: { gap: 8, marginTop: 23 }, processingStep: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#F0EBE3', opacity: 0.65 }, processingStepActive: { backgroundColor: '#FFFFFF', opacity: 1 }, processingStepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8C0B5' }, processingStepDotActive: { backgroundColor: Phase1Colors.orange }, processingStepText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 13, fontWeight: '800' }, processingStepTextActive: { color: Phase1Colors.text },
  localScanner: { height: 330, marginTop: 26, borderRadius: 34, overflow: 'hidden', backgroundColor: '#23322F', borderWidth: 6, borderColor: '#FFFFFF', shadowColor: '#513B2C', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 7 }, scanLineStatic: { position: 'absolute', left: 20, right: 20, top: '52%', height: 3, borderRadius: 2, backgroundColor: '#FF8252', shadowColor: '#FF5B24', shadowOpacity: 0.95, shadowRadius: 12 }, scannerPin: { position: 'absolute', right: 24, bottom: 24, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange },
  revealTitle: { color: Phase1Colors.text, fontSize: 38, lineHeight: 41, fontWeight: '900', letterSpacing: -1.3 }, revealAddress: { color: Phase1Colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 }, heroPhoto: { marginTop: 20 }, photoAttribution: { color: Phase1Colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 5, textAlign: 'right' }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, metaChip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 12, backgroundColor: Phase1Colors.surface }, metaText: { color: Phase1Colors.text, fontSize: 11, fontWeight: '800' }, mapWrap: { height: 150, marginTop: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: Phase1Colors.border }, sourceCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 10, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, sourceThumb: { width: 54, height: 54, borderRadius: 12 }, sourceThumbFallback: { width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#462C20' }, sourceEyebrow: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, sourceTitle: { color: Phase1Colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 3 },
  localHeroPhoto: { width: '100%', height: 292, borderRadius: 30 }, localMapRoadOne: { position: 'absolute', width: 220, borderTopWidth: 2, borderColor: '#AFC5B4', top: 30, left: -20, transform: [{ rotate: '-14deg' }] }, localMapRoadTwo: { position: 'absolute', height: 130, borderLeftWidth: 2, borderColor: '#BDCEBF', left: 88, top: -24, transform: [{ rotate: '30deg' }] }, localMapPin: { position: 'absolute', left: '48%', top: '31%', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange }, detailNote: { flexDirection: 'row', gap: 10, marginTop: 14, padding: 14, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, detailLabel: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, detailText: { color: Phase1Colors.text, fontSize: 13, lineHeight: 19, fontWeight: '700', marginTop: 4 }, localMapCard: { height: 130, marginTop: 14, borderRadius: 20, overflow: 'hidden', backgroundColor: '#DDE9E0', borderWidth: 1, borderColor: Phase1Colors.border }, localMapCopy: { position: 'absolute', left: 12, right: 12, bottom: 10, padding: 8, borderRadius: 11, backgroundColor: 'rgba(255,255,255,0.9)' }, nearbyList: { gap: 7 }, nearbyRow: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderRadius: 12, backgroundColor: Phase1Colors.surface }, nearbyText: { flex: 1, color: Phase1Colors.text, fontSize: 12, fontWeight: '800' },
  revealTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, revealCount: { color: Phase1Colors.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }, revealFound: { color: Phase1Colors.textMuted, fontSize: 16, fontWeight: '800', marginBottom: 4 }, revealCheck: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedBanner: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 12, borderRadius: 17, backgroundColor: '#E8F6EF' }, savedBannerIcon: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedBannerText: { color: '#1D7150', fontSize: 13, fontWeight: '900' }, transformationCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 9, borderRadius: 21, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, transformSource: { width: 78, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: '#2E2B28' }, transformThumb: { width: '100%', height: '100%' }, transformThumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#423B36' }, transformArrow: { width: 30, alignItems: 'center' }, transformMap: { flex: 1, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: '#D9E5DD' }, transformLabel: { position: 'absolute', left: 6, bottom: 6, color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(22,20,18,0.72)' }, whyStatement: { color: Phase1Colors.text, fontSize: 16, lineHeight: 23, fontWeight: '900', marginTop: 18 }, whyBody: { color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  celebrationMark: { width: 126, height: 126, borderRadius: 63, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: Phase1Colors.orange }, celebrationHalo: { position: 'absolute', width: 156, height: 156, borderRadius: 78, borderWidth: 1, borderColor: 'rgba(255,106,26,0.38)' }, checkBadge: { position: 'absolute', right: 1, bottom: 6, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E', borderWidth: 3, borderColor: Phase1Colors.background }, celebrationCopy: { color: Phase1Colors.textMuted, fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 13 }, savedProof: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', marginTop: 28, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, savedProofText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900' }, loadingLabel: { color: Phase1Colors.text, fontSize: 16, fontWeight: '800', marginTop: 18 },
});
