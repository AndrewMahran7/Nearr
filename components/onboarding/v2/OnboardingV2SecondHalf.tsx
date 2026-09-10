import { useEffect, useRef, useState } from 'react';
import { Animated, AppState, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { MapFormationIllustration, NearrSparkleMark, useOnboardingReduceMotion } from './OnboardingVisualLanguage';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton } from './Phase1Visuals';
import { syncGeofencesForSavedPlaces } from '@/lib/geofencing';
import { syncProximityWatch } from '@/lib/notifications';
import {
  completeOnboardingV2SecondHalf,
  continueOnboardingV2AfterAuth,
  continueOnboardingV2AfterMakingNearrYours,
  continueOnboardingV2ToLocationEducation,
  continueOnboardingV2ToNearbyValue,
  recordOnboardingV2BackgroundLocationResult,
  recordOnboardingV2ForegroundLocationResult,
  recordOnboardingV2NotificationResult,
  recordOnboardingV2ReminderInitialization,
  showOnboardingV2ActivationChallenge,
} from '@/lib/onboardingV2';
import {
  classifyReminderInitialization,
  desiredValueCopy,
  nearbyExample,
  painPointValueCopy,
  personalizedActivationCopy,
  platformLaunchUrl,
  platformName,
} from '@/lib/onboardingV2SecondHalfCore';
import { getOnboardingLocationPermissionSnapshot, requestOnboardingBackgroundLocation, requestOnboardingForegroundLocation, requestOnboardingNotifications } from '@/lib/onboardingV2SecondHalf';
import { resolveOpenSavedPlaceRoute } from '@/lib/openSavedPlace';
import { registerPushTokenForCurrentUser } from '@/lib/pushTokens';
import type { OnboardingReminderInitializationResult, OnboardingV2State } from '@/lib/onboardingV2Core';

export function OnboardingV2SecondHalf({ state }: { state: OnboardingV2State }) {
  if (state.stage === 'why_nearr') return <ShareEducationScreen state={state} />;
  if (state.stage === 'nearby_value' || state.stage === 'location_education') return <NearbyPermissionScreen state={state} />;
  if (state.stage === 'location_background_education') return <BackgroundLocationScreen state={state} />;
  if (state.stage === 'notification_education') return <NotificationEducationScreen state={state} />;
  if (state.stage === 'making_nearr_yours') return <MakingNearrYoursScreen state={state} />;
  if (state.stage === 'growing_map') return <LegacyGrowingMapAdvance />;
  if (['auth_success', 'personalized_activation', 'activation_challenge'].includes(state.stage)) return <FinalActivationScreen state={state} />;
  return null;
}

function ShareEducationScreen({ state }: { state: OnboardingV2State }) {
  const platform = platformName(state.preferredPlatform);
  return <Phase1Frame progress={0.73} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Continue" onPress={() => void continueOnboardingV2ToNearbyValue()} />}>
    <View style={styles.platformHero}><Ionicons name={platformIcon(state.preferredPlatform)} size={35} color="#FFFFFF" /></View>
    <Text style={styles.eyebrow}>YOUR EVERYDAY SHORTCUT</Text>
    <Text style={styles.headline}>From your feed to your map.</Text>
    <Text style={styles.body}>Next time a place catches your eye on {platform}, tap Share and choose Nearr.</Text>
    <View style={styles.sharePath} accessibilityLabel={`In ${platform}, tap Share, use More if needed, then choose Nearr`}>
      <ShareStep icon="share-2" label="Share" /><Feather name="chevron-right" size={18} color={Phase1Colors.textMuted} /><ShareStep icon="more-horizontal" label="More" /><Feather name="chevron-right" size={18} color={Phase1Colors.textMuted} /><View style={styles.shareStep}><Image source={require('../../../assets/icon.png')} style={styles.shareLogo} /><Text style={styles.shareLabel}>Nearr</Text></View>
    </View>
    <View style={styles.valueCard}><Feather name="check-circle" size={20} color={Phase1Colors.success} /><View style={styles.flex}><Text style={styles.valueTitle}>{painPointValueCopy(state.painPoint)}</Text><Text style={styles.valueBody}>{desiredValueCopy(state.desiredValue)}</Text></View></View>
    <Text style={styles.microcopy}>You do not need to leave Nearr now.</Text>
    {Platform.OS === 'ios' ? <Text style={styles.microcopy}>If Nearr is hidden, tap More. You can add it to Favorites from the share sheet later.</Text> : null}
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
      if (request) {
        const attempt = await requestOnboardingForegroundLocation();
        await recordOnboardingV2ForegroundLocationResult(attempt.result, { requested: attempt.requested });
      } else {
        await recordOnboardingV2ForegroundLocationResult('skipped', { requested: false });
      }
    }
    setBusy(false);
  };
  return <Phase1Frame progress={0.8} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Allow while using Nearr" onPress={() => void choose(true)} loading={busy} /><Pressable disabled={busy} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
    <Text style={styles.eyebrow}>USEFUL AT THE RIGHT MOMENT</Text><Text style={styles.headline}>Remember places when you're nearby.</Text>
    <Text style={styles.body}>Location connects your saved map to what is close—like {nearbyExample(state.selectedInterests).toLowerCase()}.</Text>
    <View style={styles.radar} accessible accessibilityLabel={`Nearby example showing ${state.tutorialResult?.place.name ?? 'your saved place'}`}><View style={styles.radarRingLarge} /><View style={styles.radarRingSmall} /><View style={styles.youDot}><Feather name="navigation" size={18} color="#FFFFFF" /></View><View style={styles.savedNearby}><Feather name="map-pin" size={23} color="#FFFFFF" /><Text style={styles.savedNearbyText} numberOfLines={1}>{state.tutorialResult?.place.name}</Text><Text style={styles.savedNearbyMeta}>saved · nearby</Text></View></View>
    <View style={styles.privacyCard}><Feather name="shield" size={19} color={Phase1Colors.success} /><Text style={styles.privacyText}>First, Nearr needs location while the app is open. Background access is explained separately. Your map works if you decline.</Text></View>
  </Phase1Frame>;
}

function BackgroundLocationScreen({ state }: { state: OnboardingV2State }) {
  const [busy, setBusy] = useState(false);
  const settingsOpenedRef = useRef(false);
  const result = state.locationBackgroundResult;
  const needsSettings = result != null && result !== 'granted' && result !== 'skipped';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !settingsOpenedRef.current) return;
      settingsOpenedRef.current = false;
      setBusy(true);
      void getOnboardingLocationPermissionSnapshot()
        .then((snapshot) => recordOnboardingV2BackgroundLocationResult(snapshot.background, {
          requested: false,
          advance: snapshot.background === 'granted',
        }))
        .finally(() => setBusy(false));
    });
    return () => subscription.remove();
  }, []);

  const request = async () => {
    if (busy) return;
    setBusy(true);
    const attempt = await requestOnboardingBackgroundLocation();
    await recordOnboardingV2BackgroundLocationResult(attempt.result, {
      requested: attempt.requested,
      advance: attempt.result === 'granted',
    });
    setBusy(false);
  };
  const openSettings = async () => {
    settingsOpenedRef.current = true;
    await Linking.openSettings().catch(() => { settingsOpenedRef.current = false; });
  };
  const continueWithout = () => void recordOnboardingV2BackgroundLocationResult(
    result ?? 'skipped', { requested: false, advance: true },
  );

  return <Phase1Frame progress={0.84} progressLabel="Onboarding progress" footer={<View style={styles.actions}>
    <Phase1PrimaryButton title={needsSettings ? 'Open Settings' : 'Allow background location'} onPress={() => void (needsSettings ? openSettings() : request())} loading={busy} />
    <Pressable disabled={busy} onPress={continueWithout} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>{needsSettings ? 'Continue without background reminders' : 'Not now'}</Text></Pressable>
  </View>}>
    <View style={styles.heroIcon}><Feather name="map-pin" size={32} color="#FFFFFF" /></View>
    <Text style={styles.eyebrow}>REMEMBER PLACES LATER</Text>
    <Text style={styles.headline}>Get a reminder even when Nearr isn't open.</Text>
    <Text style={styles.body}>Allow background location so Nearr can notice when a saved place is nearby. The next control uses the supported system permission or Settings screen.</Text>
    {Platform.OS === 'ios' ? <PermissionResultNote text="If you chose Allow Once, iOS may not show another prompt now. Nearr will verify the actual background status; you can enable Always in Settings." /> : null}
    {Platform.OS === 'android' ? <PermissionResultNote text="On newer Android versions, the system may take you to Settings to choose Allow all the time." /> : null}
    {needsSettings ? <PermissionResultNote text="Background access is not enabled. Saving and browsing still work; choose Open Settings to recover, or continue without reminders." /> : null}
  </Phase1Frame>;
}

function NotificationEducationScreen({ state }: { state: OnboardingV2State }) {
  const [busy, setBusy] = useState(false);
  const choose = async (request: boolean) => { if (busy) return; setBusy(true); if (request) { const attempt = await requestOnboardingNotifications(); await recordOnboardingV2NotificationResult(attempt.result, { requested: attempt.requested }); } else { await recordOnboardingV2NotificationResult('skipped', { requested: false }); } setBusy(false); };
  return <Phase1Frame progress={0.87} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Notify me" onPress={() => void choose(true)} loading={busy} /><Pressable disabled={busy} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
    <View style={styles.heroIcon}><Feather name="bell" size={32} color="#FFFFFF" /></View><Text style={styles.eyebrow}>A QUIET HEADS-UP</Text><Text style={styles.headline}>Know when a saved place is nearby.</Text><Text style={styles.body}>Nearr can remind you at a useful moment. You stay in control in Settings.</Text>
    {state.locationForegroundResult !== 'granted' ? <PermissionResultNote text="Location is off, so nearby alerts will wait. Your map still works." /> : state.locationBackgroundResult !== 'granted' ? <PermissionResultNote text="Only in-app location is enabled. Notifications alone cannot enable background nearby reminders." /> : null}
    <View style={styles.notificationCard} accessible accessibilityLabel={`Example Nearr notification for ${nearbyExample(state.selectedInterests)}`}><View style={styles.notificationHeader}><Image source={require('../../../assets/icon.png')} style={styles.notificationLogo} /><Text style={styles.notificationApp}>NEARR · EXAMPLE</Text><Text style={styles.notificationTime}>now</Text></View><Text style={styles.notificationTitle}>A saved place is nearby</Text><Text style={styles.notificationBody}>{nearbyExample(state.selectedInterests)} is close to your route.</Text></View>
  </Phase1Frame>;
}

function MakingNearrYoursScreen({ state }: { state: OnboardingV2State }) {
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const initialize = async () => {
      const [proximity, geofence, push] = await Promise.allSettled([
        syncProximityWatch(),
        syncGeofencesForSavedPlaces(),
        state.notificationPermissionResult === 'granted' || state.notificationPermissionResult === 'provisional'
          ? registerPushTokenForCurrentUser()
          : Promise.resolve('not_requested' as const),
      ]);
      const result = classifyReminderInitialization({
        backgroundLocation: state.locationBackgroundResult,
        notifications: state.notificationPermissionResult,
        proximity: proximity.status === 'fulfilled' ? proximity.value : 'rejected',
        geofence: geofence.status === 'fulfilled' ? geofence.value.state : 'rejected',
        push: push.status === 'fulfilled' && push.value === 'not_requested' ? 'not_requested' : push.status,
      });
      await recordOnboardingV2ReminderInitialization(result);
      await continueOnboardingV2AfterMakingNearrYours();
    };
    void initialize();
  }, [state.locationBackgroundResult, state.notificationPermissionResult]);
  const foregroundReady = state.locationForegroundResult === 'granted';
  const backgroundReady = state.locationBackgroundResult === 'granted';
  const notificationsReady = state.notificationPermissionResult === 'granted' || state.notificationPermissionResult === 'provisional';
  return <Phase1Frame progress={0.93} progressLabel="Onboarding progress" contentStyle={styles.makingContent}>
    <Text style={styles.eyebrowCentered}>MAKING NEARR YOURS</Text><Text style={styles.headlineCentered}>Building your map around what matters to you.</Text>
    <MapFormationIllustration placeName={state.tutorialResult?.place.name ?? 'Your first place'} platform={state.preferredPlatform} interest={state.interest} />
    <View style={styles.checklist} accessibilityLiveRegion="polite"><SetupRow ready label="Demo place saved" /><SetupRow ready={!!state.sharingRehearsalCompletedAt} label={state.sharingRehearsalCompletedAt ? 'Sharing practice completed' : 'Sharing practice not completed'} neutral={!state.sharingRehearsalCompletedAt} /><SetupRow ready={!!state.practiceCompletedAt} label={state.practiceCompletedAt ? 'External practice place saved' : 'External practice saved for later'} neutral={!state.practiceCompletedAt} /><SetupRow ready={foregroundReady} label={foregroundReady ? 'Location while using Nearr allowed' : 'In-app location not allowed'} neutral={!foregroundReady} /><SetupRow ready={backgroundReady} label={backgroundReady ? 'Background location allowed' : 'Background location not allowed'} neutral={!backgroundReady} /><SetupRow ready={notificationsReady} label={notificationsReady ? 'Notifications allowed' : 'Notifications not allowed'} neutral={!notificationsReady} /><SetupRow ready={state.reminderInitializationResult === 'ready'} label={reminderInitializationLabel(state.reminderInitializationResult)} neutral={state.reminderInitializationResult !== 'ready'} /></View>
  </Phase1Frame>;
}

function LegacyGrowingMapAdvance() { useEffect(() => { void continueOnboardingV2AfterMakingNearrYours(); }, []); return <Phase1Frame contentStyle={styles.centered}><Text style={styles.bodyCentered}>Opening your map…</Text></Phase1Frame>; }

function FinalActivationScreen({ state }: { state: OnboardingV2State }) {
  const router = useRouter(); const [busy, setBusy] = useState(false); const reduceMotion = useOnboardingReduceMotion(); const transition = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (state.stage !== 'auth_success') return; void Promise.allSettled([registerPushTokenForCurrentUser(), syncProximityWatch(), syncGeofencesForSavedPlaces()]); void continueOnboardingV2AfterAuth(); }, [state.stage]);
  useEffect(() => { if (state.stage === 'personalized_activation') void showOnboardingV2ActivationChallenge(); }, [state.stage]);
  const finish = async (choice: 'find_another' | 'explore_map') => {
    if (busy) return; setBusy(true); let next = state;
    if (next.stage === 'auth_success') next = await continueOnboardingV2AfterAuth();
    if (next.stage === 'personalized_activation') next = await showOnboardingV2ActivationChallenge();
    if (next.stage !== 'activation_challenge') { setBusy(false); return; }
    next = await completeOnboardingV2SecondHalf(choice);
    const openMap = () => { router.replace(resolveOpenSavedPlaceRoute({ savedPlaceId: next.tutorialSave?.savedPlaceId, googlePlaceId: next.tutorialResult?.place.googlePlaceId, source: 'onboarding_tutorial' })); if (choice === 'find_another') { const url = platformLaunchUrl(next.preferredPlatform); if (url) void Linking.openURL(url).catch(() => undefined); } };
    if (reduceMotion) openMap(); else Animated.timing(transition, { toValue: 1, duration: 260, useNativeDriver: true }).start(openMap);
  };
  const place = state.tutorialResult?.place;
  return <View style={styles.flex}><Phase1Frame progress={1} progressLabel="Onboarding complete">
    <View style={styles.finalHeader}><View style={styles.successMark}><Feather name="check" size={24} color="#FFFFFF" /></View><View style={styles.progressPill}><Text style={styles.progressText}>1 place saved</Text></View></View>
    <Text style={styles.eyebrow}>YOUR MAP IS READY</Text><Text style={styles.headline}>A real place. A map that can grow with you.</Text><Text style={styles.body}>{place?.name} is already waiting on your private map. No account setup is needed to explore it.</Text>
    <MapFormationIllustration placeName={place?.name ?? 'Your first place'} platform={state.preferredPlatform} interest={state.interest} />
    <Text style={styles.personalCopy}>{personalizedActivationCopy({ platform: state.preferredPlatform, interest: state.interest })}</Text>
    <View style={styles.finalActions}><Phase1PrimaryButton title="Explore my map" onPress={() => void finish('explore_map')} loading={busy} /><Pressable disabled={busy} onPress={() => void finish('find_another')} accessibilityRole="button" style={styles.secondaryAction}><Text style={styles.secondaryText}>Find another on {platformName(state.preferredPlatform)}</Text></Pressable></View>
    <View style={styles.backupNote}><Feather name="shield" size={14} color={Phase1Colors.success} /><Text style={styles.backupText}>Back up your map from Settings whenever you're ready.</Text></View>
  </Phase1Frame><Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.mapTransition, { opacity: transition }]}><NearrSparkleMark size={68} /></Animated.View></View>;
}

function ShareStep({ icon, label }: { icon: keyof typeof Feather.glyphMap; label: string }) { return <View style={styles.shareStep}><View style={styles.shareIcon}><Feather name={icon} size={20} color={Phase1Colors.orange} /></View><Text style={styles.shareLabel}>{label}</Text></View>; }
function SetupRow({ label, ready, neutral }: { label: string; ready: boolean; neutral?: boolean }) { return <View style={styles.setupRow}><View style={[styles.setupIcon, neutral && styles.setupIconNeutral]}><Feather name={ready ? 'check' : 'minus'} size={15} color={neutral ? Phase1Colors.textMuted : '#FFFFFF'} /></View><Text style={[styles.setupLabel, neutral && styles.setupLabelNeutral]}>{label}</Text></View>; }
function PermissionResultNote({ text }: { text: string }) { return <View style={styles.permissionResult}><Feather name="info" size={17} color={Phase1Colors.orange} /><Text style={styles.permissionResultText}>{text}</Text></View>; }
function reminderInitializationLabel(result: OnboardingReminderInitializationResult | null): string {
  if (result === 'ready') return 'Background reminder service ready';
  if (result === 'partial') return 'Reminder service partially ready';
  if (result === 'failed') return 'Reminder setup needs another try';
  if (result === 'not_eligible') return 'Reminder setup waiting for permissions';
  return 'Reminder setup pending';
}
function platformIcon(platform: OnboardingV2State['preferredPlatform']): keyof typeof Ionicons.glyphMap { return platform === 'instagram' ? 'logo-instagram' : platform === 'tiktok' ? 'logo-tiktok' : platform === 'facebook' ? 'logo-facebook' : platform === 'youtube' ? 'logo-youtube' : 'compass'; }

const styles = StyleSheet.create({
  flex: { flex: 1 }, centered: { justifyContent: 'center', paddingBottom: 48 }, makingContent: { justifyContent: 'center', paddingBottom: 32 },
  eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 10 }, eyebrowCentered: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '900', letterSpacing: 1.6, marginBottom: 10, textAlign: 'center' }, headline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1.1 }, headlineCentered: { color: Phase1Colors.text, fontSize: 31, lineHeight: 36, fontWeight: '900', letterSpacing: -1, textAlign: 'center' }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, textAlign: 'center' }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  platformHero: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, marginBottom: 24, shadowColor: '#61311E', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 3 }, sharePath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 }, shareStep: { width: 76, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 19, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, shareIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0E9' }, shareLogo: { width: 38, height: 38, borderRadius: 12 }, shareLabel: { color: Phase1Colors.text, fontSize: 11, fontWeight: '900' },
  valueCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 24, padding: 15, borderRadius: 18, backgroundColor: '#EAF6EF', borderWidth: 1, borderColor: '#CEE9DA' }, valueTitle: { color: '#1E644A', fontSize: 14, lineHeight: 19, fontWeight: '900' }, valueBody: { color: '#4D6F60', fontSize: 12, lineHeight: 17, marginTop: 4 },
  actions: { gap: 7 }, skipButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center' }, skipText: { color: Phase1Colors.textMuted, fontSize: 14, fontWeight: '800' }, radar: { height: 276, marginTop: 26, borderRadius: 29, overflow: 'hidden', backgroundColor: '#DCEAE3', borderWidth: 5, borderColor: '#FFFFFF', shadowColor: '#30473C', shadowOpacity: 0.12, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 3 }, radarRingLarge: { position: 'absolute', width: 250, height: 250, borderRadius: 125, left: -52, top: 54, borderWidth: 1, borderColor: 'rgba(44,155,105,0.25)' }, radarRingSmall: { position: 'absolute', width: 145, height: 145, borderRadius: 73, left: 1, top: 106, borderWidth: 1, borderColor: 'rgba(44,155,105,0.42)' }, youDot: { position: 'absolute', left: 57, top: 160, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedNearby: { position: 'absolute', right: 18, top: 54, maxWidth: 180, padding: 13, borderRadius: 18, backgroundColor: Phase1Colors.orange }, savedNearbyText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', marginTop: 5 }, savedNearbyMeta: { color: '#FFF1EA', fontSize: 10, fontWeight: '800', marginTop: 3 }, privacyCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14, padding: 14, borderRadius: 17, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, privacyText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18 },
  heroIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, marginBottom: 26 }, permissionResult: { flexDirection: 'row', gap: 9, marginTop: 17, padding: 12, borderRadius: 15, backgroundColor: '#FFF1E8' }, permissionResultText: { flex: 1, color: '#75503B', fontSize: 12, lineHeight: 18 }, notificationCard: { marginTop: 28, padding: 16, borderRadius: 23, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: Phase1Colors.border, shadowColor: '#41352D', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 3 }, notificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, notificationLogo: { width: 27, height: 27, borderRadius: 8 }, notificationApp: { flex: 1, color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '900' }, notificationTime: { color: '#989187', fontSize: 10 }, notificationTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '900', marginTop: 13 }, notificationBody: { color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  checklist: { gap: 8, marginTop: 18 }, setupRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, borderRadius: 14, backgroundColor: '#FFFFFF' }, setupIcon: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, setupIconNeutral: { backgroundColor: '#EAE5DD' }, setupLabel: { flex: 1, color: Phase1Colors.text, fontSize: 13, fontWeight: '800' }, setupLabelNeutral: { color: Phase1Colors.textMuted },
  finalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }, successMark: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, progressPill: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, backgroundColor: Phase1Colors.surface }, progressText: { color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '800' }, personalCopy: { color: Phase1Colors.text, fontSize: 14, lineHeight: 20, fontWeight: '800', marginTop: 17 }, finalActions: { gap: 9, marginTop: 22 }, secondaryAction: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: Phase1Colors.border, backgroundColor: '#FFFFFF' }, secondaryText: { color: Phase1Colors.text, fontSize: 14, fontWeight: '900' }, backupNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14, paddingBottom: 14 }, backupText: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '700' }, mapTransition: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#171615' },
});
