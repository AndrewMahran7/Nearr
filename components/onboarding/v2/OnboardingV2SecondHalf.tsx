import { useEffect, useState } from 'react';
import { Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from './Phase1Visuals';
import { syncGeofencesForSavedPlaces } from '@/lib/geofencing';
import { syncProximityWatch } from '@/lib/notifications';
import {
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
import { interestExample, nearbyExample, painPointValueCopy, personalizedActivationCopy, platformLaunchUrl, platformName } from '@/lib/onboardingV2SecondHalfCore';
import { requestOnboardingForegroundLocation, requestOnboardingNotifications } from '@/lib/onboardingV2SecondHalf';
import { resolveOpenSavedPlaceRoute } from '@/lib/openSavedPlace';
import { registerPushTokenForCurrentUser } from '@/lib/pushTokens';
import type { OnboardingPermissionResult, OnboardingV2State } from '@/lib/onboardingV2Core';

export function OnboardingV2SecondHalf({ state }: { state: OnboardingV2State }) {
  if (state.stage === 'why_nearr') return <ShareEducationScreen state={state} />;
  if (state.stage === 'nearby_value' || state.stage === 'location_education') return <NearbyPermissionScreen state={state} />;
  if (state.stage === 'location_background_education') return <LegacyBackgroundSkip />;
  if (state.stage === 'notification_education') return <NotificationEducationScreen state={state} />;
  if (state.stage === 'growing_map') return <LegacyGrowingMapAdvance />;
  if (['auth_success', 'personalized_activation', 'activation_challenge'].includes(state.stage)) return <FinalActivationScreen state={state} />;
  return null;
}

function ShareEducationScreen({ state }: { state: OnboardingV2State }) {
  const platform = platformName(state.preferredPlatform);
  return <Phase1Frame progress={0.76} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" onPress={() => void continueOnboardingV2ToNearbyValue()} />}>
    <View style={styles.platformHero}><Ionicons name={platformIcon(state.preferredPlatform)} size={36} color="#FFFFFF" /></View>
    <Text style={styles.eyebrow}>NEXT TIME, FROM {platform.toUpperCase()}</Text>
    <Text style={styles.headline}>Share a post straight to Nearr.</Text>
    <Text style={styles.body}>The first save happened here so you could see the result. Next time, tap Share in {platform}, then choose Nearr. If its icon is not visible, tap More.</Text>
    <View style={styles.sharePath} accessibilityLabel={`In ${platform}, tap Share, use More if needed, then choose Nearr`}>
      <ShareStep icon="share-2" label="Share" /><Feather name="chevron-right" size={18} color={Phase1Colors.textMuted} /><ShareStep icon="more-horizontal" label="More if needed" /><Feather name="chevron-right" size={18} color={Phase1Colors.textMuted} /><View style={styles.shareStep}><Image source={require('../../../assets/icon.png')} style={styles.shareLogo} /><Text style={styles.shareLabel}>Nearr</Text></View>
    </View>
    <Text style={styles.statement}>{painPointValueCopy(state.painPoint)}</Text>
    <Text style={styles.microcopy}>This lesson is optional practice—you do not need to leave Nearr now.</Text>
    {Platform.OS === 'ios' ? <Text style={styles.microcopy}>For faster sharing later, More → Edit lets you add Nearr to Favorites. Nearr is not added automatically.</Text> : null}
  </Phase1Frame>;
}

function NearbyPermissionScreen({ state }: { state: OnboardingV2State }) {
  const [busy, setBusy] = useState(false);
  const choose = async (request: boolean) => {
    if (busy) return;
    setBusy(true);
    let next = state;
    if (next.stage === 'nearby_value') next = await continueOnboardingV2ToLocationEducation();
    if (next.stage === 'location_education') {
      const result: OnboardingPermissionResult = request ? await requestOnboardingForegroundLocation() : 'skipped';
      await recordOnboardingV2ForegroundLocationResult(result);
    }
    setBusy(false);
  };
  return <Phase1Frame progress={0.82} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Allow while using Nearr" onPress={() => void choose(true)} loading={busy} /><Pressable disabled={busy} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
    <Text style={styles.eyebrow}>USEFUL WHEN YOU'RE NEARBY</Text><Text style={styles.headline}>Remember the place at the right moment.</Text>
    <Text style={styles.body}>While Nearr is open, location can connect your saved map to what is close—like {nearbyExample(state.selectedInterests).toLowerCase()}.</Text>
    <View style={styles.radar} accessible accessibilityLabel={`Nearby example showing ${state.tutorialResult?.place.name ?? 'your saved place'} and an example place eight minutes away`}><View style={styles.radarRingLarge} /><View style={styles.radarRingSmall} /><View style={styles.youDot}><Feather name="navigation" size={18} color="#FFFFFF" /></View><View style={styles.savedNearby}><Feather name="map-pin" size={23} color={Phase1Colors.onOrange} /><Text style={styles.savedNearbyText} numberOfLines={1}>{state.tutorialResult?.place.name}</Text><Text style={styles.savedNearbyMeta}>saved • nearby</Text></View></View>
    <View style={styles.privacyCard}><Feather name="shield" size={19} color={Phase1Colors.orange} /><Text style={styles.privacyText}>Foreground access only during onboarding. Background access remains available later in Settings.</Text></View>
  </Phase1Frame>;
}

function LegacyBackgroundSkip() { useEffect(() => { void recordOnboardingV2BackgroundLocationResult('skipped'); }, []); return <Phase1Frame contentStyle={styles.centered}><Text style={styles.bodyCentered}>Finishing location setup…</Text></Phase1Frame>; }

function NotificationEducationScreen({ state }: { state: OnboardingV2State }) {
  const [busy, setBusy] = useState(false);
  const choose = async (request: boolean) => { if (busy) return; setBusy(true); const result: OnboardingPermissionResult = request ? await requestOnboardingNotifications() : 'skipped'; await recordOnboardingV2NotificationResult(result); setBusy(false); };
  return <Phase1Frame progress={0.87} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Notify me" onPress={() => void choose(true)} loading={busy} /><Pressable disabled={busy} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
    <View style={styles.heroIcon}><Feather name="bell" size={32} color={Phase1Colors.onOrange} /></View><Text style={styles.eyebrow}>A QUIET HEADS-UP</Text><Text style={styles.headline}>Know when a saved place is nearby.</Text><Text style={styles.body}>Notifications make nearby discoveries useful later. You stay in control in Settings.</Text>
    {state.locationForegroundResult !== 'granted' ? <PermissionResultNote text="Location was not enabled. Your map still works, and you can change access later." /> : null}
    <View style={styles.notificationCard} accessible accessibilityLabel={`Example Nearr notification for ${nearbyExample(state.selectedInterests)}`}><View style={styles.notificationHeader}><Image source={require('../../../assets/icon.png')} style={styles.notificationLogo} /><Text style={styles.notificationApp}>NEARR • EXAMPLE</Text><Text style={styles.notificationTime}>now</Text></View><Text style={styles.notificationTitle}>You saved something nearby</Text><Text style={styles.notificationBody}>{nearbyExample(state.selectedInterests)} is close to your route.</Text></View>
  </Phase1Frame>;
}

function LegacyGrowingMapAdvance() { useEffect(() => { void continueOnboardingV2ToAccount(); }, []); return <Phase1Frame contentStyle={styles.centered}><Text style={styles.bodyCentered}>Protecting your map…</Text></Phase1Frame>; }

function FinalActivationScreen({ state }: { state: OnboardingV2State }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  useEffect(() => { if (state.stage !== 'auth_success') return; void Promise.allSettled([registerPushTokenForCurrentUser(), syncProximityWatch(), syncGeofencesForSavedPlaces()]); void continueOnboardingV2AfterAuth(); }, [state.stage]);
  useEffect(() => { if (state.stage === 'personalized_activation') void showOnboardingV2ActivationChallenge(); }, [state.stage]);
  const finish = async (choice: 'find_another' | 'explore_map') => {
    if (busy) return; setBusy(true); let next = state;
    if (next.stage === 'auth_success') next = await continueOnboardingV2AfterAuth();
    if (next.stage === 'personalized_activation') next = await showOnboardingV2ActivationChallenge();
    if (next.stage !== 'activation_challenge') { setBusy(false); return; }
    next = await completeOnboardingV2SecondHalf(choice);
    router.replace(resolveOpenSavedPlaceRoute({ savedPlaceId: next.tutorialSave?.savedPlaceId, googlePlaceId: next.tutorialResult?.place.googlePlaceId, source: 'onboarding_tutorial' }));
    if (choice === 'find_another') { const url = platformLaunchUrl(next.preferredPlatform); if (url) void Linking.openURL(url).catch(() => undefined); }
  };
  const place = state.tutorialResult?.place;
  return <Phase1Frame progress={1} progressLabel="Onboarding complete">
    <View style={styles.finalHeader}><View style={styles.successMark}><Feather name="check" size={24} color="#FFFFFF" /></View><View style={styles.progressPill}><Text style={styles.progressText}>1 / 3 places</Text></View></View>
    <Text style={styles.eyebrow}>YOUR MAP IS YOURS</Text><Text style={styles.headline}>One place is the start of a map made for you.</Text><Text style={styles.body}>{place?.name} stayed with you while your account was connected. Keep sharing {interestExample(state.selectedInterests)} whenever inspiration hits.</Text>
    <View style={styles.mapConcept} accessible accessibilityLabel={`${place?.name} is your real saved place. Two dim pins are future examples.`}><View style={styles.mapLineOne} /><View style={styles.mapLineTwo} /><ConceptPin style={styles.realPin} label={place?.name ?? 'First place'} real /><ConceptPin style={styles.futurePinOne} label="future" /><ConceptPin style={styles.futurePinTwo} label="future" /></View>
    <Text style={styles.personalCopy}>{personalizedActivationCopy({ platform: state.preferredPlatform, interest: state.interest })}</Text>
    <View style={styles.finalActions}><Phase1PrimaryButton title="Explore my map" onPress={() => void finish('explore_map')} loading={busy} /><Pressable disabled={busy} onPress={() => void finish('find_another')} accessibilityRole="button" style={styles.secondaryAction}><Text style={styles.secondaryText}>Find another on {platformName(state.preferredPlatform)}</Text></Pressable></View>
  </Phase1Frame>;
}

function ShareStep({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) { return <View style={styles.shareStep}><View style={styles.shareIcon}><Feather name={icon} size={20} color={Phase1Colors.orange} /></View><Text style={styles.shareLabel}>{label}</Text></View>; }
function PermissionResultNote({ text }: { text: string }) { return <View style={styles.permissionResult}><Feather name="info" size={17} color={Phase1Colors.orange} /><Text style={styles.permissionResultText}>{text}</Text></View>; }
function ConceptPin({ style, label, real }: { style: object; label: string; real?: boolean }) { return <View style={[styles.conceptPin, style, !real && styles.futureConceptPin]}><Feather name="map-pin" size={real ? 25 : 18} color={real ? Phase1Colors.onOrange : Phase1Colors.textMuted} /><Text style={[styles.conceptLabel, !real && styles.futureConceptLabel]} numberOfLines={1}>{label}</Text></View>; }
function platformIcon(platform: OnboardingV2State['preferredPlatform']): keyof typeof Ionicons.glyphMap { return platform === 'instagram' ? 'logo-instagram' : platform === 'tiktok' ? 'logo-tiktok' : platform === 'facebook' ? 'logo-facebook' : platform === 'youtube' ? 'logo-youtube' : 'compass'; }

const styles = StyleSheet.create({
  centered: { justifyContent: 'center', paddingBottom: 48 }, eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 10 }, headline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1.1 }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, textAlign: 'center' }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 14 }, statement: { color: Phase1Colors.text, fontSize: 16, lineHeight: 23, fontWeight: '900', marginTop: 26 },
  platformHero: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#292824', borderWidth: 1, borderColor: Phase1Colors.border, marginBottom: 25 }, sharePath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 }, shareStep: { width: 78, minHeight: 82, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, shareIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B1C14' }, shareLogo: { width: 36, height: 36, borderRadius: 11 }, shareLabel: { color: Phase1Colors.text, fontSize: 11, fontWeight: '900' },
  actions: { gap: 7 }, skipButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center' }, skipText: { color: Phase1Colors.textMuted, fontSize: 14, fontWeight: '800' }, radar: { height: 280, marginTop: 28, borderRadius: 28, overflow: 'hidden', backgroundColor: '#172723', borderWidth: 1, borderColor: '#345148' }, radarRingLarge: { position: 'absolute', width: 250, height: 250, borderRadius: 125, left: -52, top: 54, borderWidth: 1, borderColor: 'rgba(84,190,157,0.28)' }, radarRingSmall: { position: 'absolute', width: 145, height: 145, borderRadius: 73, left: 1, top: 106, borderWidth: 1, borderColor: 'rgba(84,190,157,0.42)' }, youDot: { position: 'absolute', left: 57, top: 160, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: '#37A77E' }, savedNearby: { position: 'absolute', right: 18, top: 54, maxWidth: 180, padding: 13, borderRadius: 18, backgroundColor: Phase1Colors.orange }, savedNearbyText: { color: Phase1Colors.onOrange, fontSize: 13, fontWeight: '900', marginTop: 5 }, savedNearbyMeta: { color: '#4D2A12', fontSize: 10, fontWeight: '800', marginTop: 3 }, privacyCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14, padding: 14, borderRadius: 17, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, privacyText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18 },
  heroIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, marginBottom: 26 }, permissionResult: { flexDirection: 'row', gap: 9, marginTop: 17, padding: 12, borderRadius: 15, backgroundColor: '#2B211A' }, permissionResultText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18 }, notificationCard: { marginTop: 28, padding: 16, borderRadius: 23, backgroundColor: '#292824', borderWidth: 1, borderColor: '#44413B' }, notificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, notificationLogo: { width: 25, height: 25, borderRadius: 7 }, notificationApp: { flex: 1, color: '#D8D4CE', fontSize: 10, fontWeight: '900' }, notificationTime: { color: '#A39D94', fontSize: 10 }, notificationTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '900', marginTop: 13 }, notificationBody: { color: '#D8D4CE', fontSize: 13, lineHeight: 19, marginTop: 4 },
  finalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }, successMark: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E' }, progressPill: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, backgroundColor: Phase1Colors.surface }, progressText: { color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '800' }, mapConcept: { height: 230, marginTop: 24, borderRadius: 24, overflow: 'hidden', backgroundColor: '#182320', borderWidth: 1, borderColor: '#35433F' }, mapLineOne: { position: 'absolute', width: 430, height: 80, left: -45, top: 90, borderTopWidth: 2, borderColor: '#334640', transform: [{ rotate: '-16deg' }] }, mapLineTwo: { position: 'absolute', width: 350, height: 100, left: 5, top: 36, borderTopWidth: 1, borderColor: '#3E514B', transform: [{ rotate: '48deg' }] }, conceptPin: { position: 'absolute', maxWidth: 170, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, minHeight: 44, borderRadius: 15, backgroundColor: Phase1Colors.orange }, futureConceptPin: { backgroundColor: 'rgba(40,45,42,0.9)', borderWidth: 1, borderStyle: 'dashed', borderColor: '#6A716D' }, realPin: { left: 24, top: 132 }, futurePinOne: { right: 22, top: 39 }, futurePinTwo: { right: 48, bottom: 20 }, conceptLabel: { flexShrink: 1, color: Phase1Colors.onOrange, fontSize: 11, fontWeight: '900' }, futureConceptLabel: { color: Phase1Colors.textMuted }, personalCopy: { color: Phase1Colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', marginTop: 17 }, finalActions: { gap: 9, marginTop: 24, paddingBottom: 12 }, secondaryAction: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: Phase1Colors.border }, secondaryText: { color: Phase1Colors.text, fontSize: 14, fontWeight: '900' },
});
