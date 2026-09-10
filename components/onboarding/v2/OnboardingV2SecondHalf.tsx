import { useEffect, useState } from 'react';
import { Image, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { PlaceImage } from '@/components/PlaceImage';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from './Phase1Visuals';
import { syncGeofencesForSavedPlaces } from '@/lib/geofencing';
import { syncProximityWatch } from '@/lib/notifications';
import {
  beginOnboardingV2SecondHalf,
  completeOnboardingV2SecondHalf,
  continueOnboardingV2AfterAuth,
  continueOnboardingV2ToAccount,
  continueOnboardingV2ToLocationEducation,
  continueOnboardingV2ToNearbyValue,
  recordOnboardingV2BackgroundLocationResult,
  recordOnboardingV2ForegroundLocationResult,
  recordOnboardingV2NotificationResult,
  showOnboardingV2ActivationChallenge,
} from '@/lib/onboardingV2';
import {
  interestExample,
  nearbyExample,
  painPointValueCopy,
  personalizedActivationCopy,
  platformLaunchUrl,
  platformName,
} from '@/lib/onboardingV2SecondHalfCore';
import {
  requestOnboardingBackgroundLocation,
  requestOnboardingForegroundLocation,
  requestOnboardingNotifications,
} from '@/lib/onboardingV2SecondHalf';
import { resolveOpenSavedPlaceRoute } from '@/lib/openSavedPlace';
import { registerPushTokenForCurrentUser } from '@/lib/pushTokens';
import type { OnboardingPermissionResult, OnboardingV2State } from '@/lib/onboardingV2Core';

export function OnboardingV2SecondHalf({ state }: { state: OnboardingV2State }) {
  if (state.stage === 'why_nearr') return <WhyNearrScreen state={state} />;
  if (state.stage === 'nearby_value') return <NearbyValueScreen state={state} />;
  if (state.stage === 'location_education') return <LocationEducationScreen />;
  if (state.stage === 'location_background_education') return <BackgroundLocationEducationScreen />;
  if (state.stage === 'notification_education') return <NotificationEducationScreen state={state} />;
  if (state.stage === 'growing_map') return <GrowingMapScreen state={state} />;
  if (state.stage === 'auth_success') return <AuthSuccessScreen state={state} />;
  if (state.stage === 'personalized_activation') return <PersonalizedActivationScreen state={state} />;
  if (state.stage === 'activation_challenge') return <ActivationChallengeScreen state={state} />;
  return null;
}

function WhyNearrScreen({ state }: { state: OnboardingV2State }) {
  const result = state.tutorialResult!;
  const thumbnail = state.tutorialFixture?.thumbnailUrl ?? null;
  return (
    <Phase1Frame progress={0.7} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="See what happens next" onPress={() => void continueOnboardingV2ToNearbyValue()} />}>
      <Text style={styles.eyebrow}>YOUR FIRST NEARR PLACE</Text>
      <Text style={styles.headline}>The post became somewhere you can go.</Text>
      <Text style={styles.body}>{painPointValueCopy(state.painPoint)}</Text>
      <View style={styles.transformation} accessible accessibilityLabel={`Original ${platformName(state.tutorialFixture?.platform ?? null)} post became ${result.place.name} on your map`}>
        <View style={styles.transformCard}>{thumbnail ? <Image source={{ uri: thumbnail }} style={styles.transformImage} /> : <Ionicons name="play-circle" size={34} color="#FFFFFF" />}<Text style={styles.transformLabel}>ORIGINAL POST</Text></View>
        <View style={styles.arrowCircle}><Feather name="arrow-right" size={20} color={Phase1Colors.orange} /></View>
        <View style={styles.transformCard}><PlaceImage googlePlaceId={result.place.googlePlaceId} sourceUri={result.place.photoUrls[0] ?? result.place.photoUrl} fallbackSourceUri={thumbnail} preferPlacePhoto width="100%" height={132} borderRadius={18} accessibilityLabel={`${result.place.name} place photo`} /><Text style={styles.transformPlace} numberOfLines={1}>{result.place.name}</Text><Text style={styles.transformMeta}>Map • source • directions</Text></View>
      </View>
      <Text style={styles.statement}>Social apps save the video. Nearr saves the place.</Text>
    </Phase1Frame>
  );
}

function NearbyValueScreen({ state }: { state: OnboardingV2State }) {
  return (
    <Phase1Frame progress={0.75} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Set up nearby reminders" onPress={() => void continueOnboardingV2ToLocationEducation()} />}>
      <View style={styles.heroIcon}><Feather name="navigation" size={34} color={Phase1Colors.onOrange} /></View>
      <Text style={styles.eyebrow}>USEFUL LATER</Text>
      <Text style={styles.headline}>Remember it when it matters.</Text>
      <Text style={styles.body}>Nearr can surface a saved place when it becomes relevant nearby—even months after you found the post.</Text>
      <View style={styles.exampleCard} accessible accessibilityLabel={`Example reminder: ${nearbyExample(state.selectedInterests)}, eight minutes away`}>
        <View style={styles.exampleBadge}><Text style={styles.exampleBadgeText}>EXAMPLE REMINDER</Text></View>
        <View style={styles.exampleRow}><View style={styles.examplePin}><Feather name="map-pin" size={22} color={Phase1Colors.orange} /></View><View style={styles.flex}><Text style={styles.exampleTitle}>{nearbyExample(state.selectedInterests)}</Text><Text style={styles.exampleMeta}>8 min away • from your future map</Text></View></View>
      </View>
      <Text style={styles.microcopy}>This is an example, not a reminder Nearr has already sent.</Text>
    </Phase1Frame>
  );
}

function LocationEducationScreen() {
  const [busy, setBusy] = useState(false);
  const choose = async (request: boolean) => {
    if (busy) return;
    setBusy(true);
    const result: OnboardingPermissionResult = request ? await requestOnboardingForegroundLocation() : 'skipped';
    await recordOnboardingV2ForegroundLocationResult(result);
    setBusy(false);
  };
  return (
    <PermissionFrame icon="map" eyebrow="LOCATION, WITH CONTEXT" title="Notice saved places nearby." body="First, allow location while using Nearr. This powers your map and lets Nearr check what is relevant while the app is open." primary="Allow while using Nearr" busy={busy} onPrimary={() => void choose(true)} onSkip={() => void choose(false)} />
  );
}

function BackgroundLocationEducationScreen() {
  const [busy, setBusy] = useState(false);
  const choose = async (request: boolean) => {
    if (busy) return;
    setBusy(true);
    const result: OnboardingPermissionResult = request ? await requestOnboardingBackgroundLocation() : 'skipped';
    await recordOnboardingV2BackgroundLocationResult(result);
    setBusy(false);
  };
  return (
    <PermissionFrame icon="clock" eyebrow="WHEN NEARR IS CLOSED" title="Keep nearby reminders useful." body="Allow background location so Nearr can notice saved places nearby when you are not actively using the app. iOS controls when those checks run." primary="Allow background location" busy={busy} onPrimary={() => void choose(true)} onSkip={() => void choose(false)} />
  );
}

function NotificationEducationScreen({ state }: { state: OnboardingV2State }) {
  const [busy, setBusy] = useState(false);
  const locationNote = locationRecoveryCopy(state);
  const choose = async (request: boolean) => {
    if (busy) return;
    setBusy(true);
    const result: OnboardingPermissionResult = request ? await requestOnboardingNotifications() : 'skipped';
    await recordOnboardingV2NotificationResult(result);
    setBusy(false);
  };
  return (
    <Phase1Frame progress={0.83} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Notify me" onPress={() => void choose(true)} loading={busy} /><Pressable disabled={busy} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
      <View style={styles.heroIcon}><Feather name="bell" size={34} color={Phase1Colors.onOrange} /></View>
      <Text style={styles.eyebrow}>A QUIET HEADS-UP</Text>
      <Text style={styles.headline}>Know when a saved place is nearby.</Text>
      <Text style={styles.body}>Notifications let Nearr tell you when a saved place becomes relevant. You stay in control in Settings.</Text>
      {locationNote ? <PermissionResultNote text={locationNote} /> : null}
      <View style={styles.notificationCard} accessible accessibilityLabel={`Example notification: You saved something nearby. ${nearbyExample(state.selectedInterests)} is close to your route.`}>
        <View style={styles.notificationHeader}><Image source={require('../../../assets/icon.png')} style={styles.notificationLogo} /><Text style={styles.notificationApp}>NEARR • EXAMPLE</Text><Text style={styles.notificationTime}>now</Text></View>
        <Text style={styles.notificationTitle}>You saved something nearby</Text>
        <Text style={styles.notificationBody}>{nearbyExample(state.selectedInterests)} is close to your route.</Text>
      </View>
    </Phase1Frame>
  );
}

function GrowingMapScreen({ state }: { state: OnboardingV2State }) {
  const place = state.tutorialResult!.place;
  const notificationMissing = state.notificationPermissionResult !== 'granted' && state.notificationPermissionResult !== 'provisional';
  return (
    <Phase1Frame progress={0.88} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Keep my map" onPress={() => void continueOnboardingV2ToAccount()} />}>
      <Text style={styles.eyebrow}>YOUR MAP STARTS HERE</Text>
      <Text style={styles.headline}>One place becomes a map made for you.</Text>
      <Text style={styles.body}>Keep sharing {interestExample(state.selectedInterests)}. Each real save gives you another place you can actually use.</Text>
      {notificationMissing ? <PermissionResultNote text="Notifications were not enabled. Your map still works, and you can change access later in Settings." /> : null}
      <View style={styles.mapConcept} accessible accessibilityLabel={`${place.name} is your one real saved place. Other pins illustrate future saves and are not saved places.`}>
        <View style={styles.mapLineOne} /><View style={styles.mapLineTwo} />
        <ConceptPin style={styles.realPin} label={place.name} real />
        <ConceptPin style={styles.futurePinOne} label="Future save" />
        <ConceptPin style={styles.futurePinTwo} label="Future save" />
      </View>
      <View style={styles.legend}><View style={styles.legendDotReal} /><Text style={styles.legendText}>Your real saved place</Text><View style={styles.legendDotFuture} /><Text style={styles.legendText}>Future examples—not saved</Text></View>
    </Phase1Frame>
  );
}

function AuthSuccessScreen({ state }: { state: OnboardingV2State }) {
  useEffect(() => {
    void Promise.allSettled([
      registerPushTokenForCurrentUser(),
      syncProximityWatch(),
      syncGeofencesForSavedPlaces(),
    ]);
  }, []);
  return (
    <Phase1Frame progress={0.94} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Choose what to do next" onPress={() => void continueOnboardingV2AfterAuth()} />} contentStyle={styles.centered}>
      <View style={styles.successMark}><Feather name="check" size={40} color="#FFFFFF" /></View>
      <Text style={styles.headlineCentered}>Your map is yours.</Text>
      <Text style={styles.bodyCentered}>{state.tutorialResult?.place.name} stayed on your map while your account was connected.</Text>
      <View style={styles.savedProof}><Feather name="map-pin" size={19} color={Phase1Colors.orange} /><Text style={styles.savedProofText}>First place preserved</Text></View>
    </Phase1Frame>
  );
}

function PersonalizedActivationScreen({ state }: { state: OnboardingV2State }) {
  return (
    <Phase1Frame progress={0.97} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Build my map" onPress={() => void showOnboardingV2ActivationChallenge()} />}>
      <View style={styles.platformHero}><Ionicons name={platformIcon(state.preferredPlatform)} size={38} color="#FFFFFF" /></View>
      <Text style={styles.eyebrow}>YOUR NEXT FIND</Text>
      <Text style={styles.headline}>{personalizedActivationCopy({ platform: state.preferredPlatform, interest: state.interest })}</Text>
      <Text style={styles.body}>From {platformName(state.preferredPlatform)}, use the same Share → More → Nearr action you just learned. {painPointValueCopy(state.painPoint)}</Text>
      <View style={styles.loopRow}><LoopStep icon="play" label="Find" /><Feather name="chevron-right" size={18} color={Phase1Colors.textMuted} /><LoopStep icon="share-2" label="Share" /><Feather name="chevron-right" size={18} color={Phase1Colors.textMuted} /><LoopStep icon="map-pin" label="Use later" /></View>
    </Phase1Frame>
  );
}

function ActivationChallengeScreen({ state }: { state: OnboardingV2State }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const finish = async (choice: 'find_another' | 'explore_map') => {
    if (busy) return;
    setBusy(true);
    const next = await completeOnboardingV2SecondHalf(choice);
    const mapRoute = resolveOpenSavedPlaceRoute({ savedPlaceId: next.tutorialSave?.savedPlaceId, googlePlaceId: next.tutorialResult?.place.googlePlaceId, source: 'onboarding_tutorial' });
    router.replace(mapRoute);
    if (choice === 'find_another') {
      const url = platformLaunchUrl(next.preferredPlatform);
      if (url) void Linking.openURL(url).catch(() => undefined);
    }
  };
  return (
    <Phase1Frame progress={1} progressLabel="Onboarding complete">
      <View style={styles.progressOrb}><Text style={styles.progressNumber}>1</Text><Text style={styles.progressDivider}>/ 3</Text></View>
      <Text style={styles.eyebrow}>OPTIONAL CHALLENGE</Text>
      <Text style={styles.headline}>Your map has its first place.</Text>
      <Text style={styles.body}>Add two more when you feel like it. This is a suggestion—not a gate, streak, or reward system.</Text>
      <View style={styles.challengeProgress}><View style={styles.challengeProgressFill} /></View>
      <View style={styles.challengeActions}><Phase1PrimaryButton title={`Find another on ${platformName(state.preferredPlatform)}`} onPress={() => void finish('find_another')} loading={busy} /><Pressable disabled={busy} onPress={() => void finish('explore_map')} accessibilityRole="button" style={styles.exploreButton}><Text style={styles.exploreText}>Explore my map</Text></Pressable></View>
    </Phase1Frame>
  );
}

function PermissionFrame({ icon, eyebrow, title, body, primary, busy, onPrimary, onSkip }: { icon: keyof typeof Feather.glyphMap; eyebrow: string; title: string; body: string; primary: string; busy: boolean; onPrimary: () => void; onSkip: () => void }) {
  return <Phase1Frame progress={0.79} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title={primary} onPress={onPrimary} loading={busy} /><Pressable disabled={busy} onPress={onSkip} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}><View style={styles.heroIcon}><Feather name={icon} size={34} color={Phase1Colors.onOrange} /></View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.headline}>{title}</Text><Text style={styles.body}>{body}</Text><View style={styles.privacyCard}><Feather name="shield" size={20} color={Phase1Colors.orange} /><View style={styles.flex}><Text style={styles.privacyTitle}>Your choice</Text><Text style={styles.privacyBody}>Skipping will not block onboarding. You can change this later in Settings.</Text></View></View></Phase1Frame>;
}
function PermissionResultNote({ text }: { text: string }) { return <View style={styles.permissionResult} accessible accessibilityLabel={text}><Feather name="info" size={18} color={Phase1Colors.orange} /><Text style={styles.permissionResultText}>{text}</Text></View>; }
function locationRecoveryCopy(state: OnboardingV2State): string | null {
  if (state.locationForegroundResult !== 'granted') return 'Location was not enabled. You can keep going and change access later in Settings.';
  if (state.locationBackgroundResult !== 'granted') return 'Background location was not enabled. Nearr can still use location while the app is open; you can change this later in Settings.';
  return null;
}
function ConceptPin({ style, label, real }: { style: object; label: string; real?: boolean }) { return <View style={[styles.conceptPin, style, !real && styles.futureConceptPin]}><Feather name="map-pin" size={real ? 27 : 21} color={real ? Phase1Colors.onOrange : Phase1Colors.textMuted} /><Text style={[styles.conceptLabel, !real && styles.futureConceptLabel]} numberOfLines={1}>{label}</Text></View>; }
function LoopStep({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) { return <View style={styles.loopStep}><Feather name={icon} size={20} color={Phase1Colors.orange} /><Text style={styles.loopLabel}>{label}</Text></View>; }
function platformIcon(platform: OnboardingV2State['preferredPlatform']): keyof typeof Ionicons.glyphMap { return platform === 'instagram' ? 'logo-instagram' : platform === 'tiktok' ? 'logo-tiktok' : platform === 'facebook' ? 'logo-facebook' : platform === 'youtube' ? 'logo-youtube' : 'compass'; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, centered: { justifyContent: 'center', paddingBottom: 48 }, eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 10 }, headline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1.1 }, headlineCentered: { color: Phase1Colors.text, fontSize: 35, lineHeight: 39, fontWeight: '900', letterSpacing: -1.1, textAlign: 'center', marginTop: 24 }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12, textAlign: 'center' }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  transformation: { flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 28 }, transformCard: { flex: 1, minHeight: 178, padding: 9, borderRadius: 21, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, justifyContent: 'center' }, transformImage: { width: '100%', height: 132, borderRadius: 16 }, transformLabel: { color: Phase1Colors.textMuted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 9 }, transformPlace: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900', marginTop: 9 }, transformMeta: { color: Phase1Colors.textMuted, fontSize: 10, marginTop: 3 }, arrowCircle: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1D14' }, statement: { color: Phase1Colors.text, fontSize: 17, lineHeight: 23, fontWeight: '900', marginTop: 24 },
  heroIcon: { width: 72, height: 72, borderRadius: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, marginBottom: 28 }, exampleCard: { marginTop: 30, padding: 17, borderRadius: 22, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, exampleBadge: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 5, borderRadius: 8, backgroundColor: '#332318' }, exampleBadgeText: { color: Phase1Colors.orange, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, exampleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 }, examplePin: { width: 48, height: 48, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1C14' }, exampleTitle: { color: Phase1Colors.text, fontSize: 16, fontWeight: '900' }, exampleMeta: { color: Phase1Colors.textMuted, fontSize: 12, marginTop: 4 },
  actions: { gap: 8 }, skipButton: { minHeight: 48, alignItems: 'center', justifyContent: 'center' }, skipText: { color: Phase1Colors.textMuted, fontSize: 15, fontWeight: '800' }, privacyCard: { flexDirection: 'row', gap: 12, marginTop: 30, padding: 16, borderRadius: 20, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, privacyTitle: { color: Phase1Colors.text, fontSize: 14, fontWeight: '900' }, privacyBody: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 4 },
  permissionResult: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 18, padding: 13, borderRadius: 16, backgroundColor: '#2B211A', borderWidth: 1, borderColor: '#5B3A25' }, permissionResultText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18 },
  notificationCard: { marginTop: 30, padding: 16, borderRadius: 23, backgroundColor: '#292824', borderWidth: 1, borderColor: '#44413B' }, notificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, notificationLogo: { width: 25, height: 25, borderRadius: 7 }, notificationApp: { flex: 1, color: '#D8D4CE', fontSize: 10, fontWeight: '900', letterSpacing: 0.7 }, notificationTime: { color: '#A39D94', fontSize: 10 }, notificationTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', marginTop: 13 }, notificationBody: { color: '#D8D4CE', fontSize: 13, lineHeight: 19, marginTop: 4 },
  mapConcept: { height: 300, marginTop: 28, borderRadius: 26, overflow: 'hidden', backgroundColor: '#182320', borderWidth: 1, borderColor: '#35433F' }, mapLineOne: { position: 'absolute', width: 430, height: 80, left: -45, top: 100, borderTopWidth: 2, borderColor: '#334640', transform: [{ rotate: '-16deg' }] }, mapLineTwo: { position: 'absolute', width: 350, height: 100, left: 5, top: 40, borderTopWidth: 1, borderColor: '#3E514B', transform: [{ rotate: '48deg' }] }, conceptPin: { position: 'absolute', maxWidth: 145, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, minHeight: 48, borderRadius: 16, backgroundColor: Phase1Colors.orange }, futureConceptPin: { backgroundColor: 'rgba(40,45,42,0.9)', borderWidth: 1, borderStyle: 'dashed', borderColor: '#6A716D' }, realPin: { left: 30, top: 168 }, futurePinOne: { right: 22, top: 52 }, futurePinTwo: { right: 52, bottom: 28 }, conceptLabel: { flexShrink: 1, color: Phase1Colors.onOrange, fontSize: 11, fontWeight: '900' }, futureConceptLabel: { color: Phase1Colors.textMuted }, legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 7, marginTop: 13 }, legendDotReal: { width: 9, height: 9, borderRadius: 5, backgroundColor: Phase1Colors.orange }, legendDotFuture: { width: 9, height: 9, borderRadius: 5, borderWidth: 1, borderColor: Phase1Colors.textMuted, marginLeft: 7 }, legendText: { color: Phase1Colors.textMuted, fontSize: 10 },
  successMark: { width: 100, height: 100, borderRadius: 50, alignItems: 'center', justifyContent: 'center', alignSelf: 'center', backgroundColor: '#2FA76E' }, savedProof: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, alignSelf: 'center', marginTop: 27, paddingHorizontal: 16, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, savedProofText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900' },
  platformHero: { width: 76, height: 76, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: '#272622', borderWidth: 1, borderColor: Phase1Colors.border, marginBottom: 28 }, loopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 32 }, loopStep: { width: 80, minHeight: 76, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, loopLabel: { color: Phase1Colors.text, fontSize: 11, fontWeight: '900' },
  progressOrb: { width: 118, height: 118, borderRadius: 59, flexDirection: 'row', alignItems: 'baseline', justifyContent: 'center', alignSelf: 'center', paddingTop: 32, marginBottom: 30, backgroundColor: '#2A1B13', borderWidth: 1, borderColor: '#6C3A1C' }, progressNumber: { color: Phase1Colors.orange, fontSize: 45, fontWeight: '900' }, progressDivider: { color: Phase1Colors.textMuted, fontSize: 20, fontWeight: '800' }, challengeProgress: { height: 8, marginTop: 28, borderRadius: 4, overflow: 'hidden', backgroundColor: Phase1Colors.surface }, challengeProgressFill: { width: '33.333%', height: '100%', backgroundColor: Phase1Colors.orange }, challengeActions: { gap: 10, marginTop: 34 }, exploreButton: { minHeight: 54, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: Phase1Colors.border }, exploreText: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900' },
});
