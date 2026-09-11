import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import MapView, { Marker } from 'react-native-maps';

import { PlaceImage } from '@/components/PlaceImage';
import { StartupSurface } from '@/components/StartupSurface';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from '@/components/onboarding/v2/Phase1Visuals';
import { MagicScanner, NearrSparkleMark, SocialToMapIllustration, useOnboardingReduceMotion } from '@/components/onboarding/v2/OnboardingVisualLanguage';
import { OnboardingV2SecondHalf } from '@/components/onboarding/v2/OnboardingV2SecondHalf';
import { ImmersiveGuidedSave } from '@/components/onboarding/v2/ImmersiveGuidedSave';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingTutorialJobs } from '@/hooks/useOnboardingTutorialJobs';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { useStartupWatchdog } from '@/hooks/useStartupWatchdog';
import { bootstrapAnonymousOnboarding } from '@/lib/anonymousOnboarding';
import { ANONYMOUS_BOOTSTRAP_TIMEOUT_MS } from '@/lib/anonymousOnboardingCore';
import { hapticSelection, hapticSuccess } from '@/lib/haptics';
import { hostShareSubmitter } from '@/lib/hostShareSubmit';
import { getResolvedEnvironment } from '@/lib/appEnvironment';
import { canLoadOnboardingTutorialFixture, isShareJobForTutorialFixture, loadActiveOnboardingTutorialFixture, tutorialResultFromShareJob } from '@/lib/onboardingTutorialFixture';
import { onboardingTutorialPreviewUrl } from '@/lib/onboardingTutorialPreview';
import { onboardingTutorialSourceAsset } from '@/lib/onboardingTutorialSourceAsset';
import { selectTutorialContent } from '@/constants/onboardingStarterContent';
import {
  completeOnboardingV2Interests, completeOnboardingV2Platforms,
  chooseOnboardingV2PrimaryPlatform, continueOnboardingV2FromPersonalizedPayoff,
  beginOnboardingV2InAppTutorialResolution,
  beginOnboardingV2SharingRehearsal,
  advanceOnboardingV2SharingRehearsal,
  confirmOnboardingV2FirstMagicMoment, continueOnboardingV2ToShareInstructions,
  finishOnboardingV2FirstMagicMoment, goBackOnboardingV2,
  migrateInterruptedOnboardingV2ToFirstMagic,
  observeOnboardingV2TutorialJob, observeWrongOnboardingV2TutorialJob,
  recordOnboardingV2CelebrationShown, recordOnboardingV2GetStarted,
  recordOnboardingV2TutorialLaunch, resolveOnboardingV2TutorialResult,
  retryOnboardingV2TutorialShare, setOnboardingV2DesiredValue, setOnboardingV2PainPoint,
  continueOnboardingV2ToTutorial, setOnboardingV2Interest, setOnboardingV2Platform,
  setOnboardingV2TutorialFixture, setOnboardingV2TutorialFixtureError,
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
  const router = useRouter();
  const { state, loading } = useOnboardingV2();
  const { session, loading: authLoading } = useAuth();
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [fixtureRetry, setFixtureRetry] = useState(0);
  const [launchError, setLaunchError] = useState(false);
  const [inAppSubmitError, setInAppSubmitError] = useState(false);
  const firstMagicDev = canLoadOnboardingTutorialFixture(getResolvedEnvironment());
  const bootstrapInFlightRef = useRef(false);
  const fixtureInFlightRef = useRef(false);
  const inAppSubmitRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const anonymousSessionReady = !!(state?.cohort === 'new_user_v2' && state.identityLifecycle === 'anonymous_active' && state.anonymousUserId && session?.user.is_anonymous === true && session.user.id === state.anonymousUserId);
  const permanentSessionReady = !!(state?.cohort === 'new_user_v2' && state.identityLifecycle === 'permanent_account' && state.permanentUserId && session?.user.is_anonymous !== true && session?.user.id === state.permanentUserId);
  const identitySessionReady = anonymousSessionReady || permanentSessionReady;
  const screenOwnedStage = !!state && (firstMagicDev
    ? ['overview', 'platform', 'interest', 'interest_selected', 'personalized_payoff', 'pain_point', 'desired_value', 'tutorial_loading', 'tutorial_challenge', 'tutorial_ready', 'tutorial_share_tapped', 'tutorial_more_tapped', 'tutorial_share_instructions', 'tutorial_awaiting_share', 'tutorial_processing', 'tutorial_reveal', 'tutorial_celebration', 'first_magic_moment_complete', 'why_nearr', 'nearby_value', 'location_education', 'location_background_education', 'notification_education', 'making_nearr_yours', 'growing_map', 'auth_success', 'personalized_activation', 'activation_challenge'].includes(state.stage)
    : ['overview', 'platform', 'interest', 'interest_selected'].includes(state.stage));
  const startupPending = loading || authLoading || bootstrapping || !identitySessionReady || !screenOwnedStage;
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
    void loadActiveOnboardingTutorialFixture(state.preferredPlatform).then(setOnboardingV2TutorialFixture).catch((error) => setOnboardingV2TutorialFixtureError(error instanceof Error ? error.message : 'fixture_unavailable')).finally(() => { fixtureInFlightRef.current = false; });
  }, [firstMagicDev, fixtureRetry, state?.preferredPlatform, state?.revision, state?.stage]);
  useEffect(() => {
    const attempt = state?.pendingShare;
    if (!anonymousSessionReady || state?.stage !== 'tutorial_processing' || state.tutorialJobId ||
        !attempt?.attemptId.startsWith('tutorial-in-app:') || inAppSubmitRef.current === attempt.attemptId) return;
    inAppSubmitRef.current = attempt.attemptId;
    setInAppSubmitError(false);
    void hostShareSubmitter.submit({ url: attempt.sourceUrl, submissionId: attempt.attemptId })
      .then(async (result) => {
        if (!result.ok || !result.jobId || result.requiresPurchase) {
          setInAppSubmitError(true);
          return;
        }
        await observeOnboardingV2TutorialJob({ jobId: result.jobId, sourceUrl: attempt.sourceUrl });
        await refreshJobs();
      })
      .catch(() => setInAppSubmitError(true));
  }, [anonymousSessionReady, refreshJobs, state?.pendingShare, state?.stage, state?.tutorialJobId]);
  useEffect(() => {
    if (!state?.tutorialFixture || jobs.length === 0 || !watchingJobs) return;
    const intended = jobs.find((job) => isShareJobForTutorialFixture(job, state.tutorialFixture!));
    if (!intended) { void observeWrongOnboardingV2TutorialJob(jobs[0].id); return; }
    void (async () => {
      await observeOnboardingV2TutorialJob({ jobId: intended.id, sourceUrl: intended.canonical_url || intended.source_url });
      const result = tutorialResultFromShareJob(intended, state.tutorialFixture!);
      if (result) {
        const startedAt = state.tutorialLaunchedAt ? Date.parse(state.tutorialLaunchedAt) : Date.now();
        const remaining = Math.max(0, 1250 - Math.max(0, Date.now() - startedAt));
        if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
        if (mountedRef.current) await resolveOnboardingV2TutorialResult(result);
      }
    })();
  }, [jobs, state, watchingJobs]);

  if (bootstrapError) return <MessageState eyebrow="CONNECTION PAUSED" title="We could not open your private map." body="Check your connection and try again." action="Try again" onAction={() => setBootstrapError(null)} />;
  if (!state || startupPending) return <StartupSurface owner={startupWatchdog.timedOut ? 'ERROR_RECOVERY' : 'ONBOARDING'} recovery={startupWatchdog.timedOut} onRetry={startupWatchdog.timedOut ? startupWatchdog.retry : undefined} />;
  if (!firstMagicDev) return <ProductionV2Compatibility state={state} />;
  if (state.stage === 'overview') return <WelcomeScreen onContinue={() => void recordOnboardingV2GetStarted()} />;
  if (state.stage === 'platform') return <PlatformScreen state={state} />;
  if (state.stage === 'interest') return <InterestScreen state={state} />;
  if (state.stage === 'personalized_payoff') return <PersonalizedPayoffScreen state={state} />;
  if (state.stage === 'pain_point') return <PainPointScreen />;
  if (state.stage === 'desired_value') return <DesiredValueScreen />;
  if (state.stage === 'tutorial_loading') return state.tutorialFixtureError
    ? <MessageState eyebrow="PRACTICE POST UNAVAILABLE" title="The real practice post isn't ready." body="Nearr won't substitute an uncertain result. Check your connection and try again." action="Try again" onAction={() => setFixtureRetry((value) => value + 1)} onBack={() => void goBackOnboardingV2()} />
    : <LoadingState label="Choosing a great post for you…" />;
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
  if (state.stage === 'tutorial_share_instructions') return <ShareInstructionsScreen state={state} launchError={launchError} onLaunch={async () => { setLaunchError(false); const next = await recordOnboardingV2TutorialLaunch(); try { await Linking.openURL(next.tutorialFixture?.launchUrl ?? ''); } catch { setLaunchError(true); } }} />;
  if (state.stage === 'tutorial_awaiting_share') return <AwaitingShareScreen state={state} launchError={launchError} jobsError={jobsError} onOpen={async () => { setLaunchError(false); try { await Linking.openURL(state.tutorialFixture?.launchUrl ?? ''); } catch { setLaunchError(true); } }} onRefresh={() => void refreshJobs()} />;
  if (state.stage === 'tutorial_processing') {
    const intended = state.tutorialJobId ? jobs.find((job) => job.id === state.tutorialJobId) : null;
    const terminalProblem = !!(intended && (['failed', 'needs_help', 'cancelled', 'awaiting_purchase'].includes(intended.status) || (intended.status === 'completed' && !tutorialResultFromShareJob(intended, state.tutorialFixture!))));
    return <ProcessingScreen state={state} failed={terminalProblem || inAppSubmitError} onRetry={() => { inAppSubmitRef.current = null; setInAppSubmitError(false); void retryOnboardingV2TutorialShare(); }} />;
  }
  if (['tutorial_reveal', 'tutorial_celebration', 'first_magic_moment_complete'].includes(state.stage) && state.tutorialResult) return <MagicMomentScreen state={state} onOpenSavedPlace={() => router.replace('/(tabs)/map')} />;
  return <OnboardingV2SecondHalf state={state} />;
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
  const fixture = state.tutorialFixture!; const fixturePlatform = PLATFORM_LABELS[fixture.platform]; const exactPlatform = state.preferredPlatform === fixture.platform;
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.38} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Practice sharing it" onPress={() => void beginOnboardingV2SharingRehearsal()} />}><Text style={styles.eyebrow}>A POST WORTH SAVING</Text><Text style={styles.headline}>Want to know where this is?</Text><Text style={styles.body}>{exactPlatform ? `Try the same sharing steps you will use in ${fixturePlatform}.` : `This ${fixturePlatform} example teaches the sharing steps. Practice for ${PLATFORM_LABELS[state.preferredPlatform ?? 'other']} is not available yet.`}</Text><ChallengeSourcePreview fixture={fixture} preferredPlatform={state.preferredPlatform} /><Text style={styles.microcopy}>Nearr will show you the place after you finish the practice.</Text></Phase1Frame>;
}

const SOURCE_PREVIEW_TIMEOUT_MS = 12_000;

export function ChallengeSourcePreview({ fixture, preferredPlatform }: {
  fixture: OnboardingTutorialFixture;
  preferredPlatform: OnboardingPlatform | null;
}) {
  const fixturePlatform = PLATFORM_LABELS[fixture.platform];
  const exactPlatform = preferredPlatform === fixture.platform;
  const previewUrl = exactPlatform
    ? onboardingTutorialPreviewUrl(fixture.platform, fixture.contentId, fixture.thumbnailUrl)
    : null;
  const exactSourceAsset = exactPlatform ? onboardingTutorialSourceAsset(fixture.contentId) : null;
  const [attempt, setAttempt] = useState(0);
  const [previewState, setPreviewState] = useState<'loading' | 'loaded' | 'failed' | 'unavailable'>(
    previewUrl ? 'loading' : 'unavailable',
  );

  useEffect(() => {
    setAttempt(0);
    setPreviewState(previewUrl ? 'loading' : 'unavailable');
  }, [previewUrl]);
  useEffect(() => {
    if (previewState !== 'loading') return;
    const timeout = setTimeout(() => setPreviewState('failed'), SOURCE_PREVIEW_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [attempt, previewState]);

  const retryPreview = () => {
    setAttempt((value) => value + 1);
    setPreviewState(previewUrl ? 'loading' : 'unavailable');
  };
  const retrySuffix = attempt > 0 ? `${previewUrl?.includes('?') ? '&' : '?'}nearr_preview_retry=${attempt}` : '';
  const imageUrl = previewUrl ? `${previewUrl}${retrySuffix}` : null;

  return (
    <View style={styles.videoPreview} testID="onboarding-source-preview">
      {!exactPlatform ? (
        <View style={styles.previewFallback} testID="onboarding-source-preview-fallback">
          <NearrSparkleMark size={72} />
          <Text style={styles.neutralPostText}>A real place, hidden in a post</Text>
        </View>
      ) : exactSourceAsset || imageUrl ? (
        <Image
          key={imageUrl ?? fixture.contentId}
          source={exactSourceAsset ?? { uri: imageUrl! }}
          style={StyleSheet.absoluteFill}
          resizeMode="cover"
          accessibilityLabel={`Real ${fixturePlatform} tutorial post preview`}
          testID="onboarding-source-preview-image"
          onLoad={() => setPreviewState('loaded')}
          onError={() => setPreviewState('failed')}
        />
      ) : (
        <View style={styles.previewUnavailable} testID="onboarding-source-preview-unavailable">
          <Feather name="image" size={34} color={Phase1Colors.textMuted} />
          <Text style={styles.previewUnavailableTitle}>Source preview unavailable</Text>
          <Text style={styles.previewUnavailableBody}>You can still ask Nearr to find the place.</Text>
        </View>
      )}
      {exactPlatform && previewState === 'loading' ? (
        <View style={styles.previewStatus} testID="onboarding-source-preview-loading">
          <ActivityIndicator color="#FFFFFF" />
          <Text style={styles.previewStatusText}>Loading the real source preview…</Text>
        </View>
      ) : null}
      {exactPlatform && previewState === 'failed' ? (
        <View style={styles.previewStatus} testID="onboarding-source-preview-failed">
          <Feather name="image" size={28} color="#FFFFFF" />
          <Text style={styles.previewStatusTitle}>We couldn't load this source preview.</Text>
          <Pressable onPress={retryPreview} accessibilityRole="button" accessibilityLabel="Retry source preview" style={styles.previewRetry}>
            <Text style={styles.previewRetryText}>Try preview again</Text>
          </Pressable>
        </View>
      ) : null}
      {!exactPlatform || previewState === 'loaded' ? <>
        <View style={styles.previewShade} pointerEvents="none" />
        <View style={styles.previewBadge} pointerEvents="none"><Ionicons name={exactPlatform ? PLATFORMS.find((item) => item.value === fixture.platform)?.icon ?? 'play' : 'sparkles-outline'} size={15} color="#FFFFFF" /><Text style={styles.previewBadgeText}>{exactPlatform ? `${fixturePlatform.toUpperCase()} POST` : 'NEARR GUIDED EXAMPLE'}</Text></View>
        <View style={styles.previewPrompt} pointerEvents="none"><Text style={styles.previewQuestion}>The location isn't shown.</Text><Text style={styles.previewHint}>Nearr can turn it into a place.</Text></View>
      </> : null}
    </View>
  );
}
function ShareInstructionsScreen({ state, launchError, onLaunch }: { state: OnboardingV2State; launchError: boolean; onLaunch: () => void }) {
  const platform = PLATFORM_LABELS[state.tutorialFixture?.platform ?? 'youtube'];
  return <Phase1Frame onBack={() => void goBackOnboardingV2()} progress={0.66} progressLabel="Tutorial progress" footer={<Phase1PrimaryButton title={`Open ${platform}`} onPress={onLaunch} />}><Text style={styles.eyebrow}>SHARE FROM THE SOURCE</Text><Text style={styles.headline}>Send the post to Nearr.</Text><Text style={styles.body}>{painPointCopy(state.painPoint)}</Text><View style={styles.steps}><InstructionStep number="1" title="Tap Share" detail={`In ${platform}, open the post's Share action.`} icon="share" /><InstructionStep number="2" title="Tap More" detail="Open the iOS system share sheet if Nearr isn't visible yet." icon="more-horizontal" /><InstructionStep number="3" title="Choose Nearr" detail="Nearr will accept the post and start finding the place." icon="map-pin" nearLogo /></View>{launchError ? <InlineError text={`We couldn't open ${platform}. Try again; your setup is saved.`} /> : null}<Text style={styles.microcopy}>Swipe through the app row or tap More if Nearr is not visible.</Text></Phase1Frame>;
}
function InstructionStep({ number, title, detail, icon, nearLogo }: { number: string; title: string; detail: string; icon: keyof typeof Feather.glyphMap; nearLogo?: boolean }) { return <View style={styles.instruction}><Text style={styles.stepNumber}>{number}</Text>{nearLogo ? <Image source={require('../../../assets/icon.png')} style={styles.nearrStepLogo} /> : <View style={styles.stepIcon}><Feather name={icon} size={19} color={Phase1Colors.orange} /></View>}<View style={styles.flex}><Text style={styles.instructionTitle}>{title}</Text><Text style={styles.instructionBody}>{detail}</Text></View></View>; }
function AwaitingShareScreen({ state, launchError, jobsError, onOpen, onRefresh }: { state: OnboardingV2State; launchError: boolean; jobsError: string | null; onOpen: () => void; onRefresh: () => void }) { return <Phase1Frame progress={0.72} progressLabel="Tutorial progress" footer={<Phase1PrimaryButton title="Open the tutorial post again" onPress={onOpen} />}><View style={styles.statusIcon}><Feather name="share-2" size={34} color={Phase1Colors.orange} /></View><Text style={styles.headline}>Share it to Nearr when you're ready.</Text><Text style={styles.body}>After the share extension accepts it, return here. iOS doesn't automatically reopen Nearr.</Text><View style={styles.reminder}><Text style={styles.reminderText}>Share → More → Nearr</Text></View>{state.wrongShareJobId ? <InlineError text="That was a different post. Nearr can process it normally, but it won't complete this walkthrough. Open the tutorial post and try again." /> : null}{launchError ? <InlineError text="The source did not open. Your progress is safe—try again." /> : null}{jobsError ? <Pressable onPress={onRefresh} accessibilityRole="button"><Text style={styles.retryLink}>Having trouble checking the share? Tap to retry.</Text></Pressable> : null}</Phase1Frame>; }
export function ProcessingScreen({ state, failed, onRetry }: { state: OnboardingV2State; failed: boolean; onRetry: () => void }) {
  const [step, setStep] = useState(0);
  const reduceMotion = useOnboardingReduceMotion();
  useEffect(() => {
    if (reduceMotion) { setStep(2); return; }
    const first = setTimeout(() => setStep(1), 420);
    const second = setTimeout(() => setStep(2), 840);
    return () => { clearTimeout(first); clearTimeout(second); };
  }, [reduceMotion]);
  if (failed) return <MessageState eyebrow="SAVE NEEDS A RETRY" title="That place needs another look." body="Your progress is safe. Nearr won't save an uncertain result." action="Try again" onAction={onRetry} />;
  const steps = ['Looking at the post', 'Finding visual clues', 'Matching places'];
  return <Phase1Frame progress={0.6} progressLabel="Onboarding progress" contentStyle={styles.processingContent}><Text style={styles.processingEyebrow}>NEARR IS ON IT</Text><Text style={styles.headlineCentered}>{steps[step]}<Text style={styles.orangeDot}>.</Text></Text><MagicScanner thumbnailUrl={state.tutorialFixture?.thumbnailUrl ?? null} platform={state.preferredPlatform} /><View style={styles.processingSteps}>{steps.map((label, index) => <View key={label} style={[styles.processingStep, index <= step && styles.processingStepActive]}><View style={[styles.processingStepDot, index <= step && styles.processingStepDotActive]} /><Text style={[styles.processingStepText, index <= step && styles.processingStepTextActive]}>{label}</Text>{index < step ? <Feather name="check" size={15} color={Phase1Colors.success} /> : null}</View>)}</View></Phase1Frame>;
}

function MagicMomentScreen({ state, onOpenSavedPlace }: { state: OnboardingV2State; onOpenSavedPlace: () => void }) {
  const result = state.tutorialResult!;
  const place = result.place;
  const sourceThumb = state.tutorialFixture?.thumbnailUrl ?? null;
  const exactSourceFrame = state.tutorialFixture ? onboardingTutorialSourceAsset(state.tutorialFixture.contentId) : null;
  const [showPlacesAttribution, setShowPlacesAttribution] = useState(false);
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
    if (next.stage === 'place_tour') onOpenSavedPlace();
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
      <PlaceImage
        googlePlaceId={place.googlePlaceId}
        sourceUri={place.photoUrls[0] ?? place.photoUrl}
        fallbackSourceUri={sourceThumb}
        preferPlacePhoto
        width="100%"
        height={292}
        borderRadius={30}
        accessibilityLabel={`${place.name} place photo`}
        style={styles.heroPhoto}
        onResolvedKind={(kind) => setShowPlacesAttribution(kind === 'places')}
      />
      {showPlacesAttribution ? <Text style={styles.photoAttribution}>Place imagery via Google</Text> : null}
      <Animated.View style={[styles.savedBanner, { opacity }]} accessible accessibilityLabel="Saved to your map"><View style={styles.savedBannerIcon}><Feather name="check" size={16} color="#FFFFFF" /></View><Text style={styles.savedBannerText}>Saved to your map</Text></Animated.View>
      {showTransformation ? <Animated.View style={[styles.transformationCard, { opacity }]}>
        <Pressable onPress={() => void Linking.openURL(result.sourceUrl)} accessibilityRole="link" accessibilityLabel="Open the original tutorial post" style={styles.transformSource}>{exactSourceFrame || sourceThumb ? <Image source={exactSourceFrame ?? { uri: sourceThumb! }} style={styles.transformThumb} /> : <View style={styles.transformThumbFallback}><Feather name="play" size={18} color="#FFFFFF" /></View>}<Text style={styles.transformLabel}>POST</Text></Pressable>
        <View style={styles.transformArrow}><Feather name="arrow-right" size={20} color={Phase1Colors.orange} /></View>
        <View style={styles.transformMap}><MapView style={StyleSheet.absoluteFill} pointerEvents="none" initialRegion={{ latitude: place.latitude, longitude: place.longitude, latitudeDelta: 0.12, longitudeDelta: 0.12 }} accessibilityLabel={`Map showing ${place.name}`}><Marker coordinate={{ latitude: place.latitude, longitude: place.longitude }} title={place.name} pinColor={Phase1Colors.orange} /></MapView><Text style={styles.transformLabel}>PLACE</Text></View>
      </Animated.View> : null}
      <Text style={styles.whyStatement}>Social apps save the video. Nearr saves the place.</Text>
      <Text style={styles.whyBody}>Its name, map, source, and directions stay together for when you need them.</Text>
    </Phase1Frame>
  );
}
function LoadingState({ label }: { label: string }) { return <Phase1Frame progress={0.34} progressLabel="Onboarding progress" contentStyle={styles.centered}><NearrSparkleMark size={76} /><Text style={styles.loadingLabel}>{label}</Text><Text style={styles.bodyCentered}>Matching your choices with a real guided example.</Text></Phase1Frame>; }
function MessageState({ eyebrow, title, body, action, onAction, onBack }: { eyebrow: string; title: string; body: string; action: string; onAction: () => void; onBack?: () => void }) { return <Phase1Frame onBack={onBack} footer={<Phase1PrimaryButton title={action} onPress={onAction} />} contentStyle={styles.centered}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.headlineCentered}>{title}</Text><Text style={styles.bodyCentered}>{body}</Text></Phase1Frame>; }
function InlineError({ text }: { text: string }) { return <View style={styles.errorBox} accessibilityLiveRegion="polite"><Feather name="alert-circle" size={18} color="#FFB36B" /><Text style={styles.errorText}>{text}</Text></View>; }
function painPointCopy(value: OnboardingPainPoint | null): string { switch (value) { case 'cannot_find_place': return "Instead of hunting through comments, share the post and Nearr will find the place."; case 'saved_posts_mess': return 'Turn one more lost bookmark into a place you can actually use.'; case 'screenshot': return 'Skip the screenshot this time—send the post straight to your map.'; case 'send_to_friends': return "Send this one to Nearr too, so the destination doesn't get lost in a chat."; default: return "This time, the post won't disappear into a saved folder."; } }
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
  videoPreview: { height: 344, marginTop: 26, borderRadius: 28, overflow: 'hidden', backgroundColor: '#DDE9E4', borderWidth: 5, borderColor: '#FFFFFF', shadowColor: '#30251D', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 4 }, previewFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#DDE9E4' }, previewUnavailable: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, backgroundColor: '#E8E2D8' }, previewUnavailableTitle: { color: Phase1Colors.text, fontSize: 16, fontWeight: '900', marginTop: 10 }, previewUnavailableBody: { color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 5 }, previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' }, previewStatus: { ...StyleSheet.absoluteFillObject, zIndex: 3, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 28, backgroundColor: 'rgba(19,24,23,0.88)' }, previewStatusText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' }, previewStatusTitle: { color: '#FFFFFF', fontSize: 15, lineHeight: 20, fontWeight: '900', textAlign: 'center' }, previewRetry: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 20, backgroundColor: '#FFFFFF' }, previewRetryText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900' }, playButton: { position: 'absolute', left: '50%', top: '45%', marginLeft: -30, marginTop: -30, width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.68)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)' }, previewBadge: { position: 'absolute', zIndex: 4, top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(10,10,10,0.78)' }, previewBadgeText: { color: '#FFFFFF', fontSize: 9, letterSpacing: 1.1, fontWeight: '900' }, previewPrompt: { position: 'absolute', zIndex: 4, left: 17, right: 17, bottom: 17 }, previewQuestion: { color: '#FFFFFF', fontSize: 22, lineHeight: 26, fontWeight: '900', textShadowColor: '#000000', textShadowRadius: 8 }, previewHint: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: 5, textShadowColor: '#000000', textShadowRadius: 8 }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  neutralPostMark: { width: 88, height: 88, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: '#40281A', borderWidth: 1, borderColor: '#6D452E' }, neutralPostLogo: { position: 'absolute', width: 54, height: 54, borderRadius: 15, opacity: 0.45 }, neutralPostText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900', marginTop: 16 },
  steps: { gap: 12, marginTop: 27 }, instruction: { minHeight: 84, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 13, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, stepNumber: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '900' }, stepIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1C14' }, nearrStepLogo: { width: 42, height: 42, borderRadius: 12 }, instructionTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900' }, instructionBody: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 3 },
  statusIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E8', marginBottom: 26 }, reminder: { minHeight: 58, alignItems: 'center', justifyContent: 'center', marginTop: 28, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, reminderText: { color: Phase1Colors.text, fontSize: 17, fontWeight: '900' }, errorBox: { flexDirection: 'row', gap: 10, marginTop: 20, padding: 14, borderRadius: 16, backgroundColor: '#FFF2E7', borderWidth: 1, borderColor: '#E7B78E' }, errorText: { flex: 1, color: '#7B3F17', fontSize: 13, lineHeight: 19 }, retryLink: { color: Phase1Colors.orange, fontSize: 13, fontWeight: '800', marginTop: 18, textDecorationLine: 'underline' }, processingRing: { width: 92, height: 92, borderRadius: 46, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border },
  processingContent: { justifyContent: 'center', paddingBottom: 34 }, processingEyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.7, textAlign: 'center' }, orangeDot: { color: Phase1Colors.orange }, processingSteps: { gap: 8, marginTop: 23 }, processingStep: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#F0EBE3', opacity: 0.65 }, processingStepActive: { backgroundColor: '#FFFFFF', opacity: 1 }, processingStepDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#C8C0B5' }, processingStepDotActive: { backgroundColor: Phase1Colors.orange }, processingStepText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 13, fontWeight: '800' }, processingStepTextActive: { color: Phase1Colors.text },
  revealTitle: { color: Phase1Colors.text, fontSize: 38, lineHeight: 41, fontWeight: '900', letterSpacing: -1.3 }, revealAddress: { color: Phase1Colors.textMuted, fontSize: 15, lineHeight: 21, marginTop: 8 }, heroPhoto: { marginTop: 20 }, photoAttribution: { color: Phase1Colors.textMuted, fontSize: 10, lineHeight: 14, marginTop: 5, textAlign: 'right' }, metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }, metaChip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 12, backgroundColor: Phase1Colors.surface }, metaText: { color: Phase1Colors.text, fontSize: 11, fontWeight: '800' }, mapWrap: { height: 150, marginTop: 14, borderRadius: 20, overflow: 'hidden', borderWidth: 1, borderColor: Phase1Colors.border }, sourceCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 14, padding: 10, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, sourceThumb: { width: 54, height: 54, borderRadius: 12 }, sourceThumbFallback: { width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#462C20' }, sourceEyebrow: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, sourceTitle: { color: Phase1Colors.text, fontSize: 13, lineHeight: 17, fontWeight: '800', marginTop: 3 },
  revealTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }, revealCount: { color: Phase1Colors.orange, fontSize: 10, fontWeight: '900', letterSpacing: 1.5 }, revealFound: { color: Phase1Colors.textMuted, fontSize: 16, fontWeight: '800', marginBottom: 4 }, revealCheck: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedBanner: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, marginTop: 12, borderRadius: 17, backgroundColor: '#E8F6EF' }, savedBannerIcon: { width: 27, height: 27, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedBannerText: { color: '#1D7150', fontSize: 13, fontWeight: '900' }, transformationCard: { minHeight: 88, flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, padding: 9, borderRadius: 21, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, transformSource: { width: 78, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: '#2E2B28' }, transformThumb: { width: '100%', height: '100%' }, transformThumbFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#423B36' }, transformArrow: { width: 30, alignItems: 'center' }, transformMap: { flex: 1, height: 68, borderRadius: 14, overflow: 'hidden', backgroundColor: '#D9E5DD' }, transformLabel: { position: 'absolute', left: 6, bottom: 6, color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6, overflow: 'hidden', backgroundColor: 'rgba(22,20,18,0.72)' }, whyStatement: { color: Phase1Colors.text, fontSize: 16, lineHeight: 23, fontWeight: '900', marginTop: 18 }, whyBody: { color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 5 },
  celebrationMark: { width: 126, height: 126, borderRadius: 63, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: Phase1Colors.orange }, celebrationHalo: { position: 'absolute', width: 156, height: 156, borderRadius: 78, borderWidth: 1, borderColor: 'rgba(255,106,26,0.38)' }, checkBadge: { position: 'absolute', right: 1, bottom: 6, width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E', borderWidth: 3, borderColor: Phase1Colors.background }, celebrationCopy: { color: Phase1Colors.textMuted, fontSize: 17, lineHeight: 24, textAlign: 'center', marginTop: 13 }, savedProof: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 10, alignSelf: 'center', marginTop: 28, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, savedProofText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900' }, loadingLabel: { color: Phase1Colors.text, fontSize: 16, fontWeight: '800', marginTop: 18 },
});
