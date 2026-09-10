import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import MapView, { Marker } from 'react-native-maps';

import { PlaceImage } from '@/components/PlaceImage';
import { StartupSurface } from '@/components/StartupSurface';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from '@/components/onboarding/v2/Phase1Visuals';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingTutorialJobs } from '@/hooks/useOnboardingTutorialJobs';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { useStartupWatchdog } from '@/hooks/useStartupWatchdog';
import { bootstrapAnonymousOnboarding } from '@/lib/anonymousOnboarding';
import { ANONYMOUS_BOOTSTRAP_TIMEOUT_MS } from '@/lib/anonymousOnboardingCore';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { canLoadOnboardingTutorialFixture, isShareJobForTutorialFixture, loadActiveOnboardingTutorialFixture, tutorialResultFromShareJob } from '@/lib/onboardingTutorialFixture';
import { selectTutorialContent } from '@/constants/onboardingStarterContent';
import {
  completeOnboardingV2Interests, completeOnboardingV2Platforms,
  confirmOnboardingV2FirstMagicMoment, continueOnboardingV2ToShareInstructions,
  finishOnboardingV2FirstMagicMoment, goBackOnboardingV2,
  migrateInterruptedOnboardingV2ToFirstMagic,
  observeOnboardingV2TutorialJob, observeWrongOnboardingV2TutorialJob,
  recordOnboardingV2CelebrationShown, recordOnboardingV2GetStarted,
  recordOnboardingV2TutorialLaunch, resolveOnboardingV2TutorialResult,
  retryOnboardingV2TutorialShare, setOnboardingV2PainPoint,
  continueOnboardingV2ToTutorial, setOnboardingV2Interest, setOnboardingV2Platform,
  setOnboardingV2TutorialFixture, setOnboardingV2TutorialFixtureError,
  toggleOnboardingV2Interest, toggleOnboardingV2Platform,
} from '@/lib/onboardingV2';
import type { OnboardingInterest, OnboardingPainPoint, OnboardingPlatform, OnboardingV2State } from '@/lib/onboardingV2Core';

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
const PLATFORM_LABELS: Record<string, string> = { instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', youtube: 'YouTube', other: 'social apps' };

export function OnboardingV2PreAuth() {
  const { state, loading } = useOnboardingV2();
  const { session, loading: authLoading } = useAuth();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [fixtureRetry, setFixtureRetry] = useState(0);
  const [launchError, setLaunchError] = useState(false);
  const firstMagicDev = canLoadOnboardingTutorialFixture(getResolvedEnvironment());
  const bootstrapInFlightRef = useRef(false);
  const fixtureInFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const anonymousSessionReady = !!(state?.cohort === 'new_user_v2' && state.identityLifecycle === 'anonymous_active' && state.anonymousUserId && session?.user.is_anonymous === true && session.user.id === state.anonymousUserId);
  const screenOwnedStage = !!state && (firstMagicDev
    ? ['overview', 'platform', 'interest', 'interest_selected', 'pain_point', 'tutorial_loading', 'tutorial_challenge', 'tutorial_share_instructions', 'tutorial_awaiting_share', 'tutorial_processing', 'tutorial_reveal', 'tutorial_celebration', 'first_magic_moment_complete'].includes(state.stage)
    : ['overview', 'platform', 'interest', 'interest_selected'].includes(state.stage));
  const startupPending = loading || authLoading || bootstrapping || !anonymousSessionReady || !screenOwnedStage;
  const startupWatchdog = useStartupWatchdog(startupPending);
  const watchingJobs = !!state && ['tutorial_awaiting_share', 'tutorial_processing'].includes(state.stage);
  const { jobs, error: jobsError, refresh: refreshJobs } = useOnboardingTutorialJobs(state?.tutorialFixture?.selectedAt ?? state?.tutorialLaunchedAt ?? null, watchingJobs && anonymousSessionReady);

  useEffect(() => () => { mountedRef.current = false; }, []);
  useEffect(() => {
    if (loading || authLoading || bootstrapInFlightRef.current || bootstrapError || anonymousSessionReady || (session && session.user.is_anonymous !== true)) return;
    bootstrapInFlightRef.current = true; setBootstrapping(true);
    const timeout = setTimeout(() => { if (mountedRef.current) { bootstrapInFlightRef.current = false; setBootstrapping(false); setBootstrapError('anonymous_setup_timeout'); } }, ANONYMOUS_BOOTSTRAP_TIMEOUT_MS);
    void bootstrapAnonymousOnboarding().then((result) => { if (mountedRef.current) setBootstrapError(result.kind === 'failed' ? result.reason : null); }).catch(() => { if (mountedRef.current) setBootstrapError('anonymous_setup_failed'); }).finally(() => { clearTimeout(timeout); bootstrapInFlightRef.current = false; if (mountedRef.current) setBootstrapping(false); });
  }, [anonymousSessionReady, authLoading, bootstrapError, loading, session]);
  useEffect(() => {
    if (firstMagicDev && state?.stage === 'interest_selected') void migrateInterruptedOnboardingV2ToFirstMagic();
  }, [firstMagicDev, state?.stage]);
  useEffect(() => {
    if (!firstMagicDev || state?.stage !== 'tutorial_loading' || fixtureInFlightRef.current) return;
    fixtureInFlightRef.current = true;
    void loadActiveOnboardingTutorialFixture().then(setOnboardingV2TutorialFixture).catch((error) => setOnboardingV2TutorialFixtureError(error instanceof Error ? error.message : 'fixture_unavailable')).finally(() => { fixtureInFlightRef.current = false; });
  }, [firstMagicDev, fixtureRetry, state?.revision, state?.stage]);
  useEffect(() => {
    if (!state?.tutorialFixture || jobs.length === 0 || !watchingJobs) return;
    const intended = jobs.find((job) => isShareJobForTutorialFixture(job, state.tutorialFixture!));
    if (!intended) { void observeWrongOnboardingV2TutorialJob(jobs[0].id); return; }
    void (async () => {
      await observeOnboardingV2TutorialJob({ jobId: intended.id, sourceUrl: intended.canonical_url || intended.source_url });
      const result = tutorialResultFromShareJob(intended, state.tutorialFixture!);
      if (result) await resolveOnboardingV2TutorialResult(result);
    })();
  }, [jobs, state, watchingJobs]);

  if (bootstrapError) return <MessageState eyebrow="CONNECTION PAUSED" title="We could not open your private map." body="Check your connection and try again." action="Try again" onAction={() => setBootstrapError(null)} />;
  if (!state || startupPending) return <StartupSurface owner={startupWatchdog.timedOut ? 'ERROR_RECOVERY' : 'ONBOARDING'} recovery={startupWatchdog.timedOut} onRetry={startupWatchdog.timedOut ? startupWatchdog.retry : undefined} />;
  if (!firstMagicDev) return <ProductionV2Compatibility state={state} />;
  if (state.stage === 'overview') return <WelcomeScreen onContinue={() => void recordOnboardingV2GetStarted()} />;
  if (state.stage === 'platform') return <PlatformScreen state={state} />;
  if (state.stage === 'interest') return <InterestScreen state={state} />;
  if (state.stage === 'pain_point') return <PainPointScreen />;
  if (state.stage === 'tutorial_loading') return state.tutorialFixtureError
    ? <MessageState eyebrow="TUTORIAL UNAVAILABLE" title="The real practice post isn't ready." body="Nearr won't substitute an unverified result. Try again when you have a connection, or after the fixture is restored." action="Try again" onAction={() => setFixtureRetry((value) => value + 1)} onBack={() => void goBackOnboardingV2()} />
    : <LoadingState label="Getting a real post ready…" />;
  if (state.stage === 'tutorial_challenge') return <ChallengeScreen state={state} />;
  if (state.stage === 'tutorial_share_instructions') return <ShareInstructionsScreen state={state} launchError={launchError} onLaunch={async () => { setLaunchError(false); const next = await recordOnboardingV2TutorialLaunch(); try { await Linking.openURL(next.tutorialFixture?.launchUrl ?? ''); } catch { setLaunchError(true); } }} />;
  if (state.stage === 'tutorial_awaiting_share') return <AwaitingShareScreen state={state} launchError={launchError} jobsError={jobsError} onOpen={async () => { setLaunchError(false); try { await Linking.openURL(state.tutorialFixture?.launchUrl ?? ''); } catch { setLaunchError(true); } }} onRefresh={() => void refreshJobs()} />;
  if (state.stage === 'tutorial_processing') {
    const intended = state.tutorialJobId ? jobs.find((job) => job.id === state.tutorialJobId) : null;
    const terminalProblem = !!(intended && (['failed', 'needs_help', 'cancelled', 'awaiting_purchase'].includes(intended.status) || (intended.status === 'completed' && !tutorialResultFromShareJob(intended, state.tutorialFixture!))));
    return <ProcessingScreen failed={terminalProblem} onRetry={() => void retryOnboardingV2TutorialShare()} />;
  }
  if (state.stage === 'tutorial_reveal' && state.tutorialResult) return <RevealScreen state={state} />;
  if (state.stage === 'tutorial_celebration') return <CelebrationScreen state={state} />;
  return <CompletionHoldingScreen state={state} />;
}

/** Keeps the already-shipped V2 setup contract outside the Development lane.
 * The new fixture-backed stages are never entered here. */
function ProductionV2Compatibility({ state }: { state: OnboardingV2State }) {
  if (state.stage === 'overview') return <WelcomeScreen onContinue={() => void recordOnboardingV2GetStarted()} />;
  if (state.stage === 'platform') {
    return <Phase1Frame progress={0.18} progressLabel="Choose a source"><Text style={styles.eyebrow}>PICK A SOURCE</Text><Text style={styles.headline}>Where do you find places?</Text><Text style={styles.body}>Choose Instagram for the current guided example.</Text><View style={styles.choiceGrid}>{PLATFORMS.map((item) => <Pressable key={item.value} disabled={item.value !== 'instagram'} onPress={() => void setOnboardingV2Platform(item.value)} accessibilityRole="button" accessibilityState={{ disabled: item.value !== 'instagram' }} style={[styles.platformCard, item.value !== 'instagram' && styles.disabledCard]}><View style={[styles.platformIcon, { backgroundColor: item.tint }]}><Ionicons name={item.icon} size={26} color="#11110F" /></View><Text style={styles.choiceTitle}>{item.label}</Text></Pressable>)}</View></Phase1Frame>;
  }
  if (state.stage === 'interest') {
    const legacyInterests = INTERESTS.filter((item) => ['outdoors', 'food', 'travel', 'anything'].includes(item.value));
    return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.32} progressLabel="Choose a category"><Text style={styles.eyebrow}>MAKE IT YOURS</Text><Text style={styles.headline}>What catches your eye?</Text><View style={styles.interestWrap}>{legacyInterests.map((item) => <Pressable key={item.value} onPress={() => { const tutorial = selectTutorialContent(state.preferredPlatform, item.value); void setOnboardingV2Interest(item.value, tutorial?.id ?? null); }} accessibilityRole="button" style={styles.interestPill}><Feather name={item.icon} size={17} color={Phase1Colors.text} /><Text style={styles.interestLabel}>{item.label}</Text></Pressable>)}</View></Phase1Frame>;
  }
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.45} progressLabel="Tutorial ready" footer={<Phase1PrimaryButton title="Start guided save" onPress={() => void continueOnboardingV2ToTutorial()} />}><Text style={styles.eyebrow}>READY</Text><Text style={styles.headline}>Try a guided save.</Text><Text style={styles.body}>Nearr will walk you through the current in-app tutorial.</Text></Phase1Frame>;
}

function WelcomeScreen({ onContinue }: { onContinue: () => void }) { return <Phase1Frame footer={<Phase1PrimaryButton title="Get started" onPress={onContinue} />} contentStyle={styles.centered}><View style={styles.logoHero}><Image source={require('../../../assets/icon.png')} style={styles.logo} accessibilityLabel="Nearr logo" /></View><Text style={styles.headlineXL}>Find the places hiding in your feed.</Text><Text style={styles.body}>Share a social post. Nearr turns it into a real place on your map.</Text><PlatformStrip /></Phase1Frame>; }
function PlatformStrip() { return <View style={styles.platformStrip} accessibilityLabel="Works with Instagram, TikTok, Facebook, and YouTube">{PLATFORMS.map((item) => <View key={item.value} style={styles.stripItem}><Ionicons name={item.icon} size={20} color={item.tint} /><Text style={styles.stripLabel}>{item.label}</Text></View>)}</View>; }
function PlatformScreen({ state }: { state: OnboardingV2State }) { return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.18} progressLabel="Setup progress" footer={<Phase1PrimaryButton title="Continue" disabled={state.selectedPlatforms.length === 0} onPress={() => void completeOnboardingV2Platforms()} />}><Text style={styles.eyebrow}>YOUR FEED</Text><Text style={styles.headline}>Where do you find places?</Text><Text style={styles.body}>Choose all that fit. Your first choice personalizes the walkthrough.</Text><View style={styles.choiceGrid}>{PLATFORMS.map((item) => { const selected = state.selectedPlatforms.includes(item.value); return <Pressable key={item.value} onPress={() => { hapticSelection(); void toggleOnboardingV2Platform(item.value); }} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={item.label} style={[styles.platformCard, selected && styles.selectedCard]}><View style={[styles.platformIcon, { backgroundColor: item.tint }]}><Ionicons name={item.icon} size={26} color="#11110F" /></View><Text style={styles.choiceTitle}>{item.label}</Text>{selected ? <Feather name="check-circle" size={19} color={Phase1Colors.orange} /> : null}</Pressable>; })}</View></Phase1Frame>; }
function InterestScreen({ state }: { state: OnboardingV2State }) { return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.32} progressLabel="Setup progress" footer={<Phase1PrimaryButton title="Continue" disabled={state.selectedInterests.length === 0} onPress={() => void completeOnboardingV2Interests()} />}><Text style={styles.eyebrow}>WHAT CATCHES YOUR EYE?</Text><Text style={styles.headline}>Build the map you actually want.</Text><Text style={styles.body}>Pick a few. We'll use them to keep the walkthrough relevant.</Text><View style={styles.interestWrap}>{INTERESTS.map((item) => { const selected = state.selectedInterests.includes(item.value); return <Pressable key={item.value} onPress={() => { hapticSelection(); void toggleOnboardingV2Interest(item.value); }} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={item.label} style={[styles.interestPill, selected && styles.selectedPill]}><Feather name={item.icon} size={17} color={selected ? Phase1Colors.onOrange : Phase1Colors.text} /><Text style={[styles.interestLabel, selected && styles.selectedPillText]}>{item.label}</Text></Pressable>; })}</View></Phase1Frame>; }
function PainPointScreen() { return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.45} progressLabel="Setup progress"><Text style={styles.eyebrow}>ONE QUICK THING</Text><Text style={styles.headline}>What usually happens next?</Text><Text style={styles.body}>When you find somewhere you want to go…</Text><View style={styles.stack}>{PAIN_POINTS.map((item) => <Pressable key={item.value} onPress={() => { hapticSelection(); void setOnboardingV2PainPoint(item.value); }} accessibilityRole="button" accessibilityLabel={item.label} style={styles.painCard}><View style={styles.smallIcon}><Feather name={item.icon} size={18} color={Phase1Colors.orange} /></View><Text style={styles.painText}>{item.label}</Text><Feather name="arrow-right" size={18} color={Phase1Colors.textMuted} /></Pressable>)}</View></Phase1Frame>; }

function ChallengeScreen({ state }: { state: OnboardingV2State }) {
  const fixture = state.tutorialFixture!; const chosen = PLATFORM_LABELS[state.preferredPlatform ?? 'other']; const fixturePlatform = PLATFORM_LABELS[fixture.platform];
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.56} progressLabel="Tutorial progress" footer={<Phase1PrimaryButton title="Show me how" onPress={() => void continueOnboardingV2ToShareInstructions()} />}><Text style={styles.eyebrow}>A REAL POST</Text><Text style={styles.headline}>Let's find this place.</Text><Text style={styles.body}>{state.preferredPlatform === fixture.platform ? `We'll use a real ${fixturePlatform} post.` : `You chose ${chosen}. This guided example uses ${fixturePlatform}; the same Share action works from your other apps.`}</Text><View style={styles.videoPreview}>{fixture.thumbnailUrl ? <Image source={{ uri: fixture.thumbnailUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" accessibilityLabel={`Real ${fixturePlatform} tutorial post preview`} /> : <View style={styles.previewFallback}><Ionicons name={PLATFORMS.find((item) => item.value === fixture.platform)?.icon ?? 'play'} size={52} color="#FFFFFF" /></View>}<View style={styles.previewShade} /><View style={styles.playButton}><Feather name="play" size={24} color="#FFFFFF" /></View><View style={styles.previewBadge}><Text style={styles.previewBadgeText}>{fixturePlatform.toUpperCase()} • REAL POST</Text></View><Text style={styles.previewQuestion}>Think you know where this is?</Text></View><Text style={styles.microcopy}>The answer stays hidden until Nearr resolves your share.</Text></Phase1Frame>;
}
function ShareInstructionsScreen({ state, launchError, onLaunch }: { state: OnboardingV2State; launchError: boolean; onLaunch: () => void }) {
  const platform = PLATFORM_LABELS[state.tutorialFixture?.platform ?? 'youtube'];
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.66} progressLabel="Tutorial progress" footer={<Phase1PrimaryButton title={`Open ${platform}`} onPress={onLaunch} />}><Text style={styles.eyebrow}>THE REAL SHARE FLOW</Text><Text style={styles.headline}>Send the post to Nearr.</Text><Text style={styles.body}>{painPointCopy(state.painPoint)}</Text><View style={styles.steps}><InstructionStep number="1" title="Tap Share" detail={`In ${platform}, open the post's Share action.`} icon="share" /><InstructionStep number="2" title="Tap More" detail="Open the iOS system share sheet if Nearr isn't visible yet." icon="more-horizontal" /><InstructionStep number="3" title="Choose Nearr" detail="Nearr will accept the post and start finding the place." icon="map-pin" nearLogo /></View>{launchError ? <InlineError text={`We couldn't open ${platform}. Try again; your setup is saved.`} /> : null}<Text style={styles.microcopy}>Nearr may not be in your Favorites yet. Swipe through the app row or tap More.</Text></Phase1Frame>;
}
function InstructionStep({ number, title, detail, icon, nearLogo }: { number: string; title: string; detail: string; icon: keyof typeof Feather.glyphMap; nearLogo?: boolean }) { return <View style={styles.instruction}><Text style={styles.stepNumber}>{number}</Text>{nearLogo ? <Image source={require('../../../assets/icon.png')} style={styles.nearrStepLogo} /> : <View style={styles.stepIcon}><Feather name={icon} size={19} color={Phase1Colors.orange} /></View>}<View style={styles.flex}><Text style={styles.instructionTitle}>{title}</Text><Text style={styles.instructionBody}>{detail}</Text></View></View>; }
function AwaitingShareScreen({ state, launchError, jobsError, onOpen, onRefresh }: { state: OnboardingV2State; launchError: boolean; jobsError: string | null; onOpen: () => void; onRefresh: () => void }) { return <Phase1Frame progress={0.72} progressLabel="Tutorial progress" footer={<Phase1PrimaryButton title="Open the tutorial post again" onPress={onOpen} />}><View style={styles.statusIcon}><Feather name="share-2" size={34} color={Phase1Colors.orange} /></View><Text style={styles.headline}>Share it to Nearr when you're ready.</Text><Text style={styles.body}>After the share extension accepts it, return here. iOS doesn't automatically reopen Nearr.</Text><View style={styles.reminder}><Text style={styles.reminderText}>Share → More → Nearr</Text></View>{state.wrongShareJobId ? <InlineError text="That was a different post. Nearr can process it normally, but it won't complete this walkthrough. Open the tutorial post and try again." /> : null}{launchError ? <InlineError text="The source did not open. Your progress is safe—try again." /> : null}{jobsError ? <Pressable onPress={onRefresh} accessibilityRole="button"><Text style={styles.retryLink}>Having trouble checking the share? Tap to retry.</Text></Pressable> : null}</Phase1Frame>; }
function ProcessingScreen({ failed, onRetry }: { failed: boolean; onRetry: () => void }) { return failed ? <MessageState eyebrow="SAVE NEEDS A RETRY" title="Nearr couldn't verify the tutorial result." body="We won't turn an uncertain or unrelated result into tutorial success." action="Try the tutorial again" onAction={onRetry} /> : <Phase1Frame progress={0.82} progressLabel="Tutorial progress" contentStyle={styles.centered}><View style={styles.processingRing}><ActivityIndicator size="large" color={Phase1Colors.orange} /></View><Text style={styles.headlineCentered}>Nearr is finding the place.</Text><Text style={styles.bodyCentered}>Your share was received. This screen follows the real save job—even if it takes a little longer.</Text></Phase1Frame>; }

function RevealScreen({ state }: { state: OnboardingV2State }) {
  const result = state.tutorialResult!;
  const place = result.place;
  const sourceThumb = state.tutorialFixture?.thumbnailUrl ?? null;
  const [showPlacesAttribution, setShowPlacesAttribution] = useState(false);
  return (
    <Phase1Frame
      progress={0.92}
      progressLabel="Tutorial progress"
      footer={<Phase1PrimaryButton title="Add to my map" onPress={() => void confirmOnboardingV2FirstMagicMoment()} />}
    >
      <Text style={styles.eyebrow}>FOUND</Text>
      <Text style={styles.revealTitle}>{place.name}</Text>
      <Text style={styles.revealAddress}>{place.formattedAddress ?? 'Saved to your Nearr map'}</Text>
      <PlaceImage
        googlePlaceId={place.googlePlaceId}
        sourceUri={place.photoUrls[0] ?? place.photoUrl}
        fallbackSourceUri={sourceThumb}
        preferPlacePhoto
        width="100%"
        height={238}
        borderRadius={24}
        accessibilityLabel={`${place.name} place photo`}
        style={styles.heroPhoto}
        onResolvedKind={(kind) => setShowPlacesAttribution(kind === 'places')}
      />
      {showPlacesAttribution ? <Text style={styles.photoAttribution}>Place imagery via Google</Text> : null}
      <View style={styles.metaRow}>
        {place.typeLabel || place.primaryType ? <View style={styles.metaChip}><Feather name="map-pin" size={14} color={Phase1Colors.orange} /><Text style={styles.metaText}>{place.typeLabel ?? place.primaryType}</Text></View> : null}
        <View style={styles.metaChip}><Feather name="check" size={14} color={Phase1Colors.success} /><Text style={styles.metaText}>Resolved from your post</Text></View>
      </View>
      <View style={styles.mapWrap}>
        <MapView style={StyleSheet.absoluteFill} pointerEvents="none" initialRegion={{ latitude: place.latitude, longitude: place.longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 }} accessibilityLabel={`Map showing ${place.name}`}>
          <Marker coordinate={{ latitude: place.latitude, longitude: place.longitude }} title={place.name} pinColor={Phase1Colors.orange} />
        </MapView>
      </View>
      <Pressable onPress={() => void Linking.openURL(result.sourceUrl)} accessibilityRole="link" accessibilityLabel="Open the original tutorial post" style={styles.sourceCard}>
        {sourceThumb ? <Image source={{ uri: sourceThumb }} style={styles.sourceThumb} /> : <View style={styles.sourceThumbFallback}><Feather name="play" size={18} color="#FFFFFF" /></View>}
        <View style={styles.flex}><Text style={styles.sourceEyebrow}>SOURCE POST</Text><Text style={styles.sourceTitle}>See the post that became this place</Text></View>
        <Feather name="external-link" size={18} color={Phase1Colors.textMuted} />
      </Pressable>
      <Text style={styles.microcopy}>The share already created this saved place through Nearr's normal save pipeline. This confirms it as yours—no duplicate is created.</Text>
    </Phase1Frame>
  );
}
function CelebrationScreen({ state }: { state: OnboardingV2State }) {
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null); const scale = useRef(new Animated.Value(0.72)).current; const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => { void AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion); }, []);
  useEffect(() => { if (!state.celebrationShownAt) { hapticSuccess(); void recordOnboardingV2CelebrationShown(); } }, [state.celebrationShownAt]);
  useEffect(() => { if (reduceMotion === null) return; if (reduceMotion) { scale.setValue(1); opacity.setValue(1); return; } Animated.parallel([Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 7, tension: 70 }), Animated.timing(opacity, { toValue: 1, duration: 320, useNativeDriver: true })]).start(); }, [opacity, reduceMotion, scale]);
  return <Phase1Frame footer={<Phase1PrimaryButton title="Continue" onPress={() => void finishOnboardingV2FirstMagicMoment()} />} contentStyle={styles.centered}><Animated.View style={[styles.celebrationMark, { opacity, transform: [{ scale }] }]}><View style={styles.celebrationHalo} /><Feather name="map-pin" size={48} color={Phase1Colors.onOrange} /><View style={styles.checkBadge}><Feather name="check" size={17} color="#FFFFFF" /></View></Animated.View><Text style={styles.headlineCentered}>That post is now a place on your map.</Text><Text style={styles.celebrationCopy}>Social apps save the video. Nearr saves the place.</Text><View style={styles.savedProof}><Feather name="check-circle" size={20} color={Phase1Colors.success} /><Text style={styles.savedProofText}>{state.tutorialResult?.place.name} is saved</Text></View></Phase1Frame>;
}
function CompletionHoldingScreen({ state }: { state: OnboardingV2State }) { return <Phase1Frame contentStyle={styles.centered}><Image source={require('../../../assets/icon.png')} style={styles.logoSmall} /><Text style={styles.headlineCentered}>Your first Nearr place is ready.</Text><Text style={styles.bodyCentered}>{state.tutorialResult?.place.name} is on your real map. The next onboarding chapter will pick up here with permissions and activation—nothing else is requested yet.</Text><View style={styles.savedProof}><Feather name="check-circle" size={20} color={Phase1Colors.success} /><Text style={styles.savedProofText}>First magic moment complete</Text></View></Phase1Frame>; }
function LoadingState({ label }: { label: string }) { return <Phase1Frame contentStyle={styles.centered}><ActivityIndicator size="large" color={Phase1Colors.orange} /><Text style={styles.loadingLabel}>{label}</Text></Phase1Frame>; }
function MessageState({ eyebrow, title, body, action, onAction, onBack }: { eyebrow: string; title: string; body: string; action: string; onAction: () => void; onBack?: () => void }) { return <Phase1Frame onBack={onBack} footer={<Phase1PrimaryButton title={action} onPress={onAction} />} contentStyle={styles.centered}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.headlineCentered}>{title}</Text><Text style={styles.bodyCentered}>{body}</Text></Phase1Frame>; }
function InlineError({ text }: { text: string }) { return <View style={styles.errorBox} accessibilityLiveRegion="polite"><Feather name="alert-circle" size={18} color="#FFB36B" /><Text style={styles.errorText}>{text}</Text></View>; }
function painPointCopy(value: OnboardingPainPoint | null): string { switch (value) { case 'cannot_find_place': return "Instead of hunting through comments, share the post and Nearr will find the place."; case 'saved_posts_mess': return 'Turn one more lost bookmark into a place you can actually use.'; case 'screenshot': return 'Skip the screenshot this time—send the post straight to your map.'; case 'send_to_friends': return "Send this one to Nearr too, so the destination doesn't get lost in a chat."; default: return "This time, the post won't disappear into a saved folder."; } }

const styles = StyleSheet.create({
  flex: { flex: 1 }, centered: { justifyContent: 'center', paddingBottom: 52 }, eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.7, marginBottom: 10 },
  headline: { color: Phase1Colors.text, fontSize: 33, lineHeight: 37, fontWeight: '900', letterSpacing: -1 }, headlineXL: { color: Phase1Colors.text, fontSize: 42, lineHeight: 44, fontWeight: '900', letterSpacing: -1.7 }, headlineCentered: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1, textAlign: 'center', marginTop: 24 }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12, textAlign: 'center' },
  logoHero: { width: 88, height: 88, borderRadius: 25, overflow: 'hidden', marginBottom: 28, borderWidth: 1, borderColor: '#33302B' }, logo: { width: '100%', height: '100%' }, logoSmall: { width: 72, height: 72, borderRadius: 20 },
  platformStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: 9, marginTop: 28 }, stripItem: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 11, borderRadius: 14, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stripLabel: { color: Phase1Colors.text, fontSize: 12, fontWeight: '800' },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 11, marginTop: 28 }, platformCard: { width: '48%', minHeight: 116, padding: 14, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, justifyContent: 'space-between' }, selectedCard: { borderColor: Phase1Colors.orange, backgroundColor: '#251A13' }, platformIcon: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, choiceTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900' },
  disabledCard: { opacity: 0.42 },
  interestWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 28 }, interestPill: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 15, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, selectedPill: { backgroundColor: Phase1Colors.orange, borderColor: Phase1Colors.orange }, interestLabel: { color: Phase1Colors.text, fontSize: 14, fontWeight: '800' }, selectedPillText: { color: Phase1Colors.onOrange },
  stack: { gap: 10, marginTop: 26 }, painCard: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, borderRadius: 19, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, smallIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2A1B13' }, painText: { flex: 1, color: Phase1Colors.text, fontSize: 14, lineHeight: 19, fontWeight: '800' },
  videoPreview: { height: 330, marginTop: 26, borderRadius: 26, overflow: 'hidden', backgroundColor: '#22332F', borderWidth: 1, borderColor: '#3A3630' }, previewFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' }, previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' }, playButton: { position: 'absolute', left: '50%', top: '45%', marginLeft: -30, marginTop: -30, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }, previewBadge: { position: 'absolute', top: 14, left: 14, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(10,10,10,0.78)' }, previewBadgeText: { color: '#FFFFFF', fontSize: 9, letterSpacing: 1.1, fontWeight: '900' }, previewQuestion: { position: 'absolute', left: 17, right: 17, bottom: 18, color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '900', textShadowColor: '#000000', textShadowRadius: 8 }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  steps: { gap: 12, marginTop: 27 }, instruction: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stepNumber: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '900' }, stepIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1C14' }, nearrStepLogo: { width: 42, height: 42, borderRadius: 12 }, instructionTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900' }, instructionBody: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  statusIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#291B13', marginBottom: 26 }, reminder: { minHeight: 58, alignItems: 'center', justifyContent: 'center', marginTop: 28, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, reminderText: { color: Phase1Colors.text, fontSize: 17, fontWeight: '900' }, errorBox: { flexDirection: 'row', gap: 10, marginTop: 20, padding: 14, borderRadius: 16, backgroundColor: '#302018', borderWidth: 1, borderColor: '#6A3E25' }, errorText: { flex: 1, color: '#FFD1A8', fontSize: 13, lineHeight: 19 }, retryLink: { color: Phase1Colors.orange, fontSize: 13, fontWeight: '800', marginTop: 18, textDecorationLine: 'underline' }, processingRing: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border },
  revealTitle: { color: Phase1Colors.text, fontSize: 38, lineHeight: 41, fontWeight: '900', letterSpacing: -1.3 }, revealAddress: { color: Phase1Colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 }, heroPhoto: { marginTop: 20 }, photoAttribution: { color: Phase1Colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 5, textAlign: 'right' }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, metaChip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 12, backgroundColor: Phase1Colors.surface }, metaText: { color: Phase1Colors.text, fontSize: 11, fontWeight: '800' }, mapWrap: { height: 150, marginTop: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: Phase1Colors.border }, sourceCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 10, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, sourceThumb: { width: 54, height: 54, borderRadius: 12 }, sourceThumbFallback: { width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#462C20' }, sourceEyebrow: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, sourceTitle: { color: Phase1Colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 3 },
  celebrationMark: { width: 126, height: 126, borderRadius: 63, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: Phase1Colors.orange }, celebrationHalo: { position: 'absolute', width: 156, height: 156, borderRadius: 78, borderWidth: 1, borderColor: 'rgba(255,106,26,0.38)' }, checkBadge: { position: 'absolute', right: 1, bottom: 6, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E', borderWidth: 3, borderColor: Phase1Colors.background }, celebrationCopy: { color: Phase1Colors.textMuted, fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 13 }, savedProof: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', marginTop: 28, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, savedProofText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900' }, loadingLabel: { color: Phase1Colors.text, fontSize: 16, fontWeight: '800', marginTop: 18 },
});
