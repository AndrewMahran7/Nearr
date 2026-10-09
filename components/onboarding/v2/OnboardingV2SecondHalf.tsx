import { useMemo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { MapFormationIllustration, NearrSparkleMark } from './OnboardingVisualLanguage';
import { Phase1Colors, Phase1Frame, Phase1PrimaryButton, usePhase1Colors } from './Phase1Visuals';
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
  recordOnboardingV2MapHandoff,
  showOnboardingV2ActivationChallenge,
} from '@/lib/onboardingV2';
import {
  desiredValueCopy,
  nearbyExample,
  painPointValueCopy,
  personalizedActivationCopy,
} from '@/lib/onboardingV2SecondHalfCore';
import { getOnboardingLocationPermissionSnapshot, requestOnboardingBackgroundLocation, requestOnboardingForegroundLocation, requestOnboardingNotifications } from '@/lib/onboardingV2SecondHalf';
import { onboardingV2SavedPlaceProgress, type OnboardingReminderInitializationResult, type OnboardingV2State } from '@/lib/onboardingV2Core';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { onboardingPhase2PracticeFromFixtureId } from '@/lib/onboardingPhase2Practice';
import { offlineOnboardingAsset } from '@/onboarding/assets/offlineOnboardingAssets';

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
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return <Phase1Frame progress={0.73} progressLabel="Onboarding progress" footer={<Phase1PrimaryButton title="Set up nearby reminders" onPress={() => void continueOnboardingV2ToNearbyValue()} />}>
    <View style={styles.platformHero}><Feather name="map" size={35} color="#FFFFFF" /></View>
    <Text style={styles.eyebrow}>YOUR SAVES HAVE A HOME</Text>
    <Text style={styles.headline}>Bring a saved place back when it matters.</Text>
    <Text style={styles.body}>Your map keeps the place, its original post, and directions together. Nearby reminders are optional and require separate permission.</Text>
    <View style={styles.valueCard}><Feather name="check-circle" size={20} color={Phase1Colors.success} /><View style={styles.flex}><Text style={styles.valueTitle}>{painPointValueCopy(state.painPoint)}</Text><Text style={styles.valueBody}>{desiredValueCopy(state.desiredValue)}</Text></View></View>
  </Phase1Frame>;
}

function NearbyPermissionScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const [requestingOsPermission, setRequestingOsPermission] = useState(false);
  const operationRef = useRef(false);
  const choose = async (request: boolean) => {
    if (operationRef.current) return;
    operationRef.current = true;
    try {
      let next = state;
      if (next.stage === 'nearby_value') next = await continueOnboardingV2ToLocationEducation();
      if (next.stage === 'location_education') {
        if (request) {
          setRequestingOsPermission(true);
          const attempt = await requestOnboardingForegroundLocation();
          setRequestingOsPermission(false);
          await recordOnboardingV2ForegroundLocationResult(attempt.result, { requested: attempt.requested });
        } else {
          await recordOnboardingV2ForegroundLocationResult('skipped', { requested: false });
        }
      }
    } finally {
      setRequestingOsPermission(false);
      operationRef.current = false;
    }
  };
  return <Phase1Frame progress={0.8} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Allow while using Nearr" onPress={() => void choose(true)} loading={requestingOsPermission} /><Pressable disabled={requestingOsPermission} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
    <Text style={styles.eyebrow}>USEFUL AT THE RIGHT MOMENT</Text><Text style={styles.headline}>Remember places when you're nearby.</Text>
    <Text style={styles.body}>Location can connect your saved map to what is close—for example, {nearbyExample(state.selectedInterests).toLowerCase()}.</Text>
    <View style={styles.radar} accessible accessibilityLabel={`Illustrative nearby-reminder example using ${state.tutorialResult?.place.name ?? 'a saved place'}; not a live distance`}><View style={styles.exampleBadge}><Text style={styles.exampleBadgeText}>EXAMPLE · NOT LIVE DISTANCE</Text></View><View style={styles.radarRingLarge} /><View style={styles.radarRingSmall} /><View style={styles.youDot}><Feather name="navigation" size={18} color="#FFFFFF" /></View><View style={styles.savedNearby}><Feather name="map-pin" size={23} color="#FFFFFF" /><Text style={styles.savedNearbyText} numberOfLines={1}>{state.tutorialResult?.place.name}</Text><Text style={styles.savedNearbyMeta}>saved place example</Text></View></View>
    <View style={styles.privacyCard}><Feather name="shield" size={19} color={Phase1Colors.success} /><Text style={styles.privacyText}>First, Nearr needs location while the app is open. Background access is explained separately. Your map works if you decline.</Text></View>
  </Phase1Frame>;
}

function BackgroundLocationScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const [busy, setBusy] = useState(false);
  const operationRef = useRef(false);
  const settingsOpenedRef = useRef(false);
  const result = state.locationBackgroundResult;
  const needsSettings = result != null && result !== 'granted' && result !== 'skipped';

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || !settingsOpenedRef.current) return;
      settingsOpenedRef.current = false;
      setBusy(true);
      void getOnboardingLocationPermissionSnapshot()
        .then((snapshot) => {
          setBusy(false);
          return recordOnboardingV2BackgroundLocationResult(snapshot.background, {
            requested: false,
            advance: snapshot.background === 'granted',
          });
        })
        .finally(() => setBusy(false));
    });
    return () => subscription.remove();
  }, []);

  const request = async () => {
    if (operationRef.current) return;
    operationRef.current = true;
    try {
      setBusy(true);
      const attempt = await requestOnboardingBackgroundLocation();
      setBusy(false);
      await recordOnboardingV2BackgroundLocationResult(attempt.result, {
        requested: attempt.requested,
        advance: attempt.result === 'granted',
      });
    } finally {
      setBusy(false);
      operationRef.current = false;
    }
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
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const [requestingOsPermission, setRequestingOsPermission] = useState(false);
  const operationRef = useRef(false);
  const choose = async (request: boolean) => {
    if (operationRef.current) return;
    operationRef.current = true;
    try {
      if (request) {
        setRequestingOsPermission(true);
        const attempt = await requestOnboardingNotifications();
        setRequestingOsPermission(false);
        await recordOnboardingV2NotificationResult(attempt.result, { requested: attempt.requested });
      } else {
        await recordOnboardingV2NotificationResult('skipped', { requested: false });
      }
    } finally {
      setRequestingOsPermission(false);
      operationRef.current = false;
    }
  };
  return <Phase1Frame progress={0.87} progressLabel="Onboarding progress" footer={<View style={styles.actions}><Phase1PrimaryButton title="Notify me" onPress={() => void choose(true)} loading={requestingOsPermission} /><Pressable disabled={requestingOsPermission} onPress={() => void choose(false)} accessibilityRole="button" style={styles.skipButton}><Text style={styles.skipText}>Not now</Text></Pressable></View>}>
    <View style={styles.heroIcon}><Feather name="bell" size={32} color="#FFFFFF" /></View><Text style={styles.eyebrow}>A QUIET HEADS-UP</Text><Text style={styles.headline}>Know when a saved place is nearby.</Text><Text style={styles.body}>Nearr can remind you at a useful moment. You stay in control in Settings.</Text>
    {state.locationForegroundResult !== 'granted' ? <PermissionResultNote text="Location is off, so nearby alerts will wait. Your map still works." /> : state.locationBackgroundResult !== 'granted' ? <PermissionResultNote text="Only in-app location is enabled. Notifications alone cannot enable background nearby reminders." /> : null}
    <View style={styles.notificationCard} accessible accessibilityLabel={`Example Nearr notification for ${nearbyExample(state.selectedInterests)}`}><View style={styles.notificationHeader}><Image source={require('../../../assets/icon.png')} style={styles.notificationLogo} /><Text style={styles.notificationApp}>NEARR · EXAMPLE</Text><Text style={styles.notificationTime}>now</Text></View><Text style={styles.notificationTitle}>A saved place is nearby</Text><Text style={styles.notificationBody}>{nearbyExample(state.selectedInterests)} is close to your route.</Text></View>
  </Phase1Frame>;
}

function MakingNearrYoursScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const initialize = async () => {
      const permissionsReady = state.locationBackgroundResult === 'granted' &&
        (state.notificationPermissionResult === 'granted' || state.notificationPermissionResult === 'provisional');
      await recordOnboardingV2ReminderInitialization(permissionsReady ? 'pending' : 'not_eligible');
      // This handoff refers only to the bundled onboarding card. Real saved
      // places and reminder services start after authentication.
      await recordOnboardingV2MapHandoff('ready');
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
    <View style={styles.checklist} accessibilityLiveRegion="polite"><SetupRow ready label="Practice place ready" /><SetupRow ready={!!state.sharingRehearsalCompletedAt} label={state.sharingRehearsalCompletedAt ? 'Sharing practice completed' : 'Sharing practice not completed'} neutral={!state.sharingRehearsalCompletedAt} /><SetupRow ready={state.mapHandoffResult === 'ready'} label={mapHandoffLabel(state.mapHandoffResult)} neutral={state.mapHandoffResult !== 'ready'} /><SetupRow ready={foregroundReady} label={foregroundReady ? 'Location while using Nearr allowed' : 'In-app location not allowed'} neutral={!foregroundReady} /><SetupRow ready={backgroundReady} label={backgroundReady ? 'Background location allowed' : 'Background location not allowed'} neutral={!backgroundReady} /><SetupRow ready={notificationsReady} label={notificationsReady ? 'Notifications allowed' : 'Notifications not allowed'} neutral={!notificationsReady} /><SetupRow ready={state.reminderInitializationResult === 'ready'} label={reminderInitializationLabel(state.reminderInitializationResult)} neutral={state.reminderInitializationResult !== 'ready'} /></View>
  </Phase1Frame>;
}

function LegacyGrowingMapAdvance() {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);
 useEffect(() => { void continueOnboardingV2AfterMakingNearrYours(); }, []); return <Phase1Frame contentStyle={styles.centered}><Text style={styles.bodyCentered}>Opening your map…</Text></Phase1Frame>; }

function FinalActivationScreen({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const [busy, setBusy] = useState(false);
  const { data: savedPlaces } = useSavedPlaces();
  useEffect(() => { if (state.stage !== 'auth_success') return; void continueOnboardingV2AfterAuth(); }, [state.stage]);
  useEffect(() => { if (state.stage === 'personalized_activation') void showOnboardingV2ActivationChallenge(); }, [state.stage]);
  const finish = async () => {
    if (busy) return; setBusy(true); let next = state;
    if (next.stage === 'auth_success') next = await continueOnboardingV2AfterAuth();
    if (next.stage === 'personalized_activation') next = await showOnboardingV2ActivationChallenge();
    if (next.stage !== 'activation_challenge') { setBusy(false); return; }
    await completeOnboardingV2SecondHalf('explore_map');
    // AuthGate owns the resulting onboarding_complete -> map replace edge.
  };
  const practice = onboardingPhase2PracticeFromFixtureId(state.practiceFixture?.id);
  const realSavedPlaceId = state.realPracticeSession?.savedPlaceId ?? state.independentSaves[0]?.savedPlaceId ?? null;
  const realSave = realSavedPlaceId ? savedPlaces.find((saved) => saved.id === realSavedPlaceId) : undefined;
  const realThumbnail = realSave?.sources?.find((source) => source.is_primary)?.thumbnail_url
    ?? realSave?.sources?.[0]?.thumbnail_url
    ?? null;
  const realPlaceName = realSave?.place.name ?? state.realPracticeSession?.expectedPlaceName ?? practice?.expectedPlaceName ?? null;
  const realPracticeCompleted = state.realPracticeSession?.completionReason === 'resolved' && !!realSavedPlaceId;
  const tutorialPlace = state.tutorialResult?.place;
  const savedCount = onboardingV2SavedPlaceProgress(state).count;
  return <View style={styles.flex}><Phase1Frame progress={1} progressLabel="Onboarding complete">
    <View style={styles.finalHeader}><View style={styles.successMark}><Feather name="check" size={24} color="#FFFFFF" /></View><View style={styles.progressPill}><Text style={styles.progressText}>{savedCount} {savedCount === 1 ? 'place' : 'places'} saved</Text></View></View>
    <Text style={styles.eyebrow}>{realPracticeCompleted ? 'YOU JUST DID IT FOR REAL' : state.mapHandoffResult === 'ready' ? 'READY TO EXPLORE' : 'OPENING YOUR MAP'}</Text><Text style={styles.headline}>{realPracticeCompleted ? `${realPlaceName} is on your map.` : state.mapHandoffResult === 'ready' ? 'Your map is ready to use.' : 'Your map is getting ready.'}</Text><Text style={styles.body}>{realPracticeCompleted ? 'Your real shared post became a saved place, with its source and directions kept together.' : `${tutorialPlace?.name ?? 'Your tutorial place'} was a private practice example. Your next real share will use Nearr's live recognition.`}</Text>
    {realPracticeCompleted ? <Image source={realThumbnail ? { uri: realThumbnail } : offlineOnboardingAsset(practice?.localPreviewAssetKey ?? 'mad_yolks')} style={styles.realResultHero} resizeMode="cover" accessibilityLabel={`${realPlaceName} saved-place image`} /> : <MapFormationIllustration placeName={tutorialPlace?.name ?? 'Your first place'} platform={state.preferredPlatform} interest={state.interest} />}
    <Text style={styles.personalCopy}>{personalizedActivationCopy({ platform: state.preferredPlatform, interest: state.interest })}</Text>
    <View style={styles.finalActions}><Phase1PrimaryButton title="Explore my map" onPress={() => void finish()} loading={busy} /></View>
    <View style={styles.backupNote}><Feather name="shield" size={14} color={Phase1Colors.success} /><Text style={styles.backupText}>Your map is backed up to your account.</Text></View>
  </Phase1Frame></View>;
}

function SetupRow({ label, ready, neutral }: { label: string; ready: boolean; neutral?: boolean }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);
 return <View style={styles.setupRow}><View style={[styles.setupIcon, neutral && styles.setupIconNeutral]}><Feather name={ready ? 'check' : 'minus'} size={15} color={neutral ? Phase1Colors.textMuted : '#FFFFFF'} /></View><Text style={[styles.setupLabel, neutral && styles.setupLabelNeutral]}>{label}</Text></View>; }
function PermissionResultNote({ text }: { text: string }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);
 return <View style={styles.permissionResult}><Feather name="info" size={17} color={Phase1Colors.orange} /><Text style={styles.permissionResultText}>{text}</Text></View>; }
function reminderInitializationLabel(result: OnboardingReminderInitializationResult | null): string {
  if (result === 'ready') return 'Background reminder service ready';
  if (result === 'partial') return 'Reminder service partially ready';
  if (result === 'failed') return 'Reminder setup needs another try';
  if (result === 'not_eligible') return 'Reminder setup waiting for permissions';
  return 'Reminder setup pending';
}
function mapHandoffLabel(result: OnboardingV2State['mapHandoffResult']): string {
  if (result === 'ready') return 'Saved cards ready for the map';
  if (result === 'missing') return 'Saved card needs a refresh';
  if (result === 'offline') return 'Saved card available when back online';
  if (result === 'failed') return 'Saved card check needs another try';
  return 'Saved cards loading';
}

function createStyles(Phase1Colors: ReturnType<typeof usePhase1Colors>) { return StyleSheet.create({
  flex: { flex: 1 }, centered: { justifyContent: 'center', paddingBottom: 48 }, makingContent: { justifyContent: 'center', paddingBottom: 32 },
  eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '600', letterSpacing: 1.6, marginBottom: 10 }, eyebrowCentered: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '600', letterSpacing: 1.6, marginBottom: 10, textAlign: 'center' }, headline: { color: Phase1Colors.text, fontSize: 34, lineHeight: 38, fontWeight: '600', letterSpacing: -1.1 }, headlineCentered: { color: Phase1Colors.text, fontSize: 31, lineHeight: 36, fontWeight: '600', letterSpacing: -1, textAlign: 'center' }, body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 }, bodyCentered: { color: Phase1Colors.textMuted, fontSize: 16, textAlign: 'center' }, microcopy: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 12 },
  platformHero: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, marginBottom: 24, shadowColor: '#61311E', shadowOpacity: 0.2, shadowRadius: 14, shadowOffset: { width: 0, height: 7 }, elevation: 3 }, sharePath: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 28 }, shareStep: { width: 76, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 19, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, shareIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.surfaceRaised }, shareLogo: { width: 38, height: 38, borderRadius: 12 }, shareLabel: { color: Phase1Colors.text, fontSize: 11, fontWeight: '600' },
  valueCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 11, marginTop: 24, padding: 15, borderRadius: 18, backgroundColor: Phase1Colors.successSurface, borderWidth: 1, borderColor: Phase1Colors.border }, valueTitle: { color: Phase1Colors.textMuted, fontSize: 14, lineHeight: 19, fontWeight: '600' }, valueBody: { color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 4 },
  actions: { gap: 7 }, skipButton: { minHeight: 46, alignItems: 'center', justifyContent: 'center' }, skipText: { color: Phase1Colors.textMuted, fontSize: 14, fontWeight: '600' }, radar: { height: 276, marginTop: 26, borderRadius: 29, overflow: 'hidden', backgroundColor: Phase1Colors.mapLand, borderWidth: 5, borderColor: Phase1Colors.surface, shadowColor: '#30473C', shadowOpacity: 0.12, shadowRadius: 15, shadowOffset: { width: 0, height: 7 }, elevation: 3 }, radarRingLarge: { position: 'absolute', width: 250, height: 250, borderRadius: 125, left: -52, top: 54, borderWidth: 1, borderColor: 'rgba(44,155,105,0.25)' }, radarRingSmall: { position: 'absolute', width: 145, height: 145, borderRadius: 73, left: 1, top: 106, borderWidth: 1, borderColor: 'rgba(44,155,105,0.42)' }, youDot: { position: 'absolute', left: 57, top: 160, width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, savedNearby: { position: 'absolute', right: 18, top: 54, maxWidth: 180, padding: 13, borderRadius: 18, backgroundColor: Phase1Colors.orange }, savedNearbyText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600', marginTop: 5 }, savedNearbyMeta: { color: '#FFF1EA', fontSize: 10, fontWeight: '600', marginTop: 3 }, privacyCard: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', marginTop: 14, padding: 14, borderRadius: 17, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border }, privacyText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18 },
  exampleBadge: { position: 'absolute', left: 12, top: 12, zIndex: 2, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.9)' }, exampleBadgeText: { color: Phase1Colors.textMuted, fontSize: 9, fontWeight: '600', letterSpacing: 0.7 },
  heroIcon: { width: 70, height: 70, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange, marginBottom: 26 }, permissionResult: { flexDirection: 'row', gap: 9, marginTop: 17, padding: 12, borderRadius: 15, backgroundColor: Phase1Colors.surfaceRaised }, permissionResultText: { flex: 1, color: Phase1Colors.textMuted, fontSize: 12, lineHeight: 18 }, notificationCard: { marginTop: 28, padding: 16, borderRadius: 23, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border, shadowColor: '#41352D', shadowOpacity: 0.12, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 3 }, notificationHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 }, notificationLogo: { width: 27, height: 27, borderRadius: 8 }, notificationApp: { flex: 1, color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '600' }, notificationTime: { color: Phase1Colors.textMuted, fontSize: 10 }, notificationTitle: { color: Phase1Colors.text, fontSize: 15, fontWeight: '600', marginTop: 13 }, notificationBody: { color: Phase1Colors.textMuted, fontSize: 13, lineHeight: 19, marginTop: 4 },
  checklist: { gap: 8, marginTop: 18 }, setupRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, borderRadius: 14, backgroundColor: Phase1Colors.surface }, setupIcon: { width: 25, height: 25, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, setupIconNeutral: { backgroundColor: Phase1Colors.surfaceRaised }, setupLabel: { flex: 1, color: Phase1Colors.text, fontSize: 13, fontWeight: '600' }, setupLabelNeutral: { color: Phase1Colors.textMuted },
  finalHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 }, successMark: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.success }, progressPill: { paddingHorizontal: 11, paddingVertical: 7, borderRadius: 12, backgroundColor: Phase1Colors.surface }, progressText: { color: Phase1Colors.textMuted, fontSize: 10, fontWeight: '600' }, personalCopy: { color: Phase1Colors.text, fontSize: 14, lineHeight: 20, fontWeight: '600', marginTop: 17 }, finalActions: { gap: 9, marginTop: 22 }, secondaryAction: { minHeight: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 18, borderWidth: 1, borderColor: Phase1Colors.border, backgroundColor: Phase1Colors.surface }, secondaryText: { color: Phase1Colors.text, fontSize: 14, fontWeight: '600' }, backupNote: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, marginTop: 14, paddingBottom: 14 }, backupText: { color: Phase1Colors.textMuted, fontSize: 11, fontWeight: '700' }, mapTransition: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#171615' },
  realResultHero: { width: '100%', height: 210, marginTop: 22, borderRadius: 24, backgroundColor: Phase1Colors.surface },
}); }
