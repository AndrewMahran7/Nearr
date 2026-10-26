import { i18n, t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
/**
 * Settings screen.
 *
 * Reads / writes the current user's `profiles` row. All edits are local
 * until "Save changes" — that keeps validation predictable and avoids
 * round-trips on every keystroke / toggle.
 *
 * Fields:
 *   - global notifications enabled
 *   - nearby notifications enabled (only meaningful when global is on)
 *   - quiet hours enabled
 *   - quiet hours start / end (HH:MM, only when quiet hours enabled)
 *
 * Validation runs before save:
 *   - if quiet hours are enabled, both start and end must be valid HH:MM
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';

import { Button, Card, DemoModeBanner, DevModeBanner, HowNearrWorksModal, IconButton, Input, Screen, SetupChecklist } from '@/components';
import { LanguageSelector } from '@/components/localization/LanguageSelector';
import { Radius, Spacing } from '@/constants';

import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { disableDevAuth } from '@/lib/devAuth';
import { isDemoMode } from '@/lib/demoMode';
import { setOnboardingPreview } from '@/lib/onboarding';
import { requestOnboardingV2MapBackup } from '@/lib/onboardingV2';
import {
  isOnboardingV2DevelopmentResetAvailable,
  resetOnboardingV2OnlyForDevelopment,
  resetOnboardingV2WithFreshAnonymousUserForDevelopment,
} from '@/lib/onboardingV2DevReset';
import * as Clipboard from 'expo-clipboard';
import { getRecentDiagnostics, formatDiagnosticForCopy, getUpdateInfo } from '@/lib/deviceDiagnostics';
import { areDeveloperToolsVisible, describeEnvironment } from '@/lib/appEnvironment';
import { getGooglePlacesRuntimeDiagnostic } from '@/lib/googlePlacesConfig';
import { sharedAuth } from '@/lib/sharedAuth';
import { decodeJwtClaims } from '@/lib/sharedAuthSession';
import { LEGAL_ACCEPTANCE_REQUIRED, LEGAL_VERSION } from '@/constants';
import { getProfile, getLegalAcceptanceStatus, updateProfile } from '@/services/profileService';
import { signOut } from '@/services/auth';
import { clearOfflineUserData } from '@/lib/offlineIdentity';
import {
  cleanupAfterAccountDeletion,
  deleteAccount,
} from '@/services/accountService';
import {
  DELETE_ACCOUNT_FAILURE_MESSAGE,
  DELETE_ACCOUNT_FINAL_CONFIRM,
  DELETE_ACCOUNT_FIRST_CONFIRM,
} from '@/lib/accountDeletionCore';
import { resetAllDemoData, simulateDemoNearbyNotification } from '@/services/demo';
import {
  ensureNotificationPermission,
  sendTestNotification,
  startProximityWatch,
  stopProximityWatch,
} from '@/services/notifications';
import {
  stopNearrGeofencing,
  syncGeofencesForSavedPlaces,
} from '@/lib/geofencing';
import { useTheme } from '@/lib/theme';
import { recordOnboardingV2RouteDiagnostic } from '@/lib/onboardingV2RouteDiagnostics';

// TODO(app-store): set to Nearr's numeric App Store app ID once the app is
// live (e.g. '1234567890'). Until then "Leave a review" shows a friendly
// "coming soon" alert instead of opening a broken/fake listing. Do NOT
// hardcode a placeholder ID.
const APP_STORE_APP_ID: string | null = null;

/** Deep link that opens the write-review sheet for a live App Store app. */
function appStoreReviewUrl(appId: string): string {
  return `itms-apps://itunes.apple.com/app/id${appId}?action=write-review`;
}
import type { Profile } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** Normalize either "HH:MM" or "HH:MM:SS" coming back from Postgres `time`. */
function trimSeconds(t: string | null): string {
  if (!t) return '';
  // Drop trailing :SS if present.
  const m = t.match(/^(\d{2}:\d{2})(:\d{2})?$/);
  return m ? m[1] : t;
}

function isValidHhmm(s: string): boolean {
  return HHMM.test(s.trim());
}

// ---------------------------------------------------------------------------

export default function SettingsScreen() {
  useLocale();
  useEffect(() => {
    recordOnboardingV2RouteDiagnostic('screen_mounted', {
      route: '/(tabs)/settings',
      result: 'settings',
    });
  }, []);
  const router = useRouter();
  const { user, isDevSession, isLocalUiSession } = useAuth();
  const { colors, typography, themePreference, setThemePreference } = useTheme();
  const { fontScale } = useWindowDimensions();
  const styles = useMemo(() => createStyles(colors, typography, fontScale), [colors, typography, fontScale, i18n.language]);

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // editable state
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [nearbyOn, setNearbyOn] = useState(true);
  const [quietOn, setQuietOn] = useState(false);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [howNearrWorksVisible, setHowNearrWorksVisible] = useState(false);
  const [legalAcceptedVersion, setLegalAcceptedVersion] = useState<string | null>(null);
  const [legalAcceptedAt, setLegalAcceptedAt] = useState<string | null>(null);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [openingMapBackup, setOpeningMapBackup] = useState(false);
  const [resettingOnboarding, setResettingOnboarding] = useState(false);
  const onboardingResetAvailable = isOnboardingV2DevelopmentResetAvailable();
  const [placesDiagnosticText, setPlacesDiagnosticText] = useState(
    'Places REST key diagnostic: loading',
  );

  useEffect(() => {
    if (!areDeveloperToolsVisible()) return;
    let active = true;
    void getGooglePlacesRuntimeDiagnostic()
      .then((diagnostic) => {
        if (!active) return;
        setPlacesDiagnosticText(
          [
            `Places REST key source: ${diagnostic.source}`,
            `Places REST key selected from: ${diagnostic.location}`,
            `Places REST key present: ${diagnostic.present ? 'yes' : 'no'}`,
            `Places REST key fingerprint: ${diagnostic.fingerprint ?? 'unavailable'}`,
            `Google Places endpoint family: ${diagnostic.endpointFamily}`,
            `Places app environment: ${diagnostic.appEnvironment || 'undeclared'}`,
            `Places backend environment: ${diagnostic.backendEnvironment || 'undeclared'}`,
            diagnostic.configurationError
              ? `Places config error: ${diagnostic.configurationError}`
              : '',
          ]
            .filter(Boolean)
            .join('\n'),
        );
      })
      .catch(() => {
        if (active) setPlacesDiagnosticText('Places REST key diagnostic: unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  const hasUnsavedChanges = useMemo(() => {
    if (!profile) return false;

    return (
      notificationsOn !== profile.notifications_enabled ||
      nearbyOn !== profile.nearby_notifications_enabled ||
      quietOn !== profile.quiet_hours_enabled ||
      quietStart !== trimSeconds(profile.quiet_hours_start) ||
      quietEnd !== trimSeconds(profile.quiet_hours_end)
    );
  }, [
    nearbyOn,
    notificationsOn,
    profile,
    quietEnd,
    quietOn,
    quietStart,
  , i18n.language]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const p = await getProfile();
      if (!p) {
        // In dev-session mode there is no real Supabase auth, so getProfile
        // returns null. Don't surface that as an error — the DevModeBanner
        // already explains why.
        if (!isDevSession) {
          setLoadError(t("Could not load your profile. Try again."));
        }
        return;
      }
      setProfile(p);
      setNotificationsOn(p.notifications_enabled);
      setNearbyOn(p.nearby_notifications_enabled);
      setQuietOn(p.quiet_hours_enabled);
      setQuietStart(trimSeconds(p.quiet_hours_start));
      setQuietEnd(trimSeconds(p.quiet_hours_end));
      setLegalAcceptedVersion(p.legal_version ?? null);
      setLegalAcceptedAt(p.privacy_accepted_at ?? p.terms_accepted_at ?? null);

      if (p.id) {
        const legalStatus = await getLegalAcceptanceStatus(p.id);
        setLegalAcceptedVersion(legalStatus?.acceptedVersion ?? p.legal_version ?? null);
        setLegalAcceptedAt(legalStatus?.privacyAcceptedAt ?? legalStatus?.termsAcceptedAt ?? null);
      }
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load profile.');
    } finally {
      setLoading(false);
    }
  }, [isDevSession]);

  useEffect(() => {
    void load();
  }, [load]);

  // ---------------------------------------------------------------------
  // Save
  // ---------------------------------------------------------------------
  async function syncRuntimePreferences(nextProfile: Profile) {
    try {
      const wantsWatch =
        nextProfile.notifications_enabled && nextProfile.nearby_notifications_enabled;

      if (wantsWatch) {
        const ok = await ensureNotificationPermission();
        if (!ok) {
          Alert.alert(
            t("Notifications blocked"),
            t("Settings were saved, but enable notifications in system settings to receive nearby alerts."),
          );
          return;
        }

        await startProximityWatch();
        void syncGeofencesForSavedPlaces();
        return;
      }

      await stopProximityWatch();
      await stopNearrGeofencing();
    } catch (error) {
      console.warn('[settings] runtime sync failed', error);
    }
  }

  async function handleSave() {
    // --- validate quiet hours (only when enabled) ---
    let normalizedStart: string | null = null;
    let normalizedEnd: string | null = null;
    if (quietOn) {
      const s = quietStart.trim();
      const e = quietEnd.trim();
      if (!isValidHhmm(s) || !isValidHhmm(e)) {
        Alert.alert(
          t("Invalid quiet hours"),
          t("Use 24-hour HH:MM format, e.g. 22:00 and 07:30."),
        );
        return;
      }
      if (s === e) {
        Alert.alert(
          t("Invalid quiet hours"),
          t("Start and end times must be different."),
        );
        return;
      }
      normalizedStart = s;
      normalizedEnd = e;
    }

    setSaving(true);
    console.log('[settings] save started');
    try {
      const runtimeSettingsChanged =
        !profile ||
        profile.notifications_enabled !== notificationsOn ||
        profile.nearby_notifications_enabled !== nearbyOn;

      const updated = await updateProfile({
        notifications_enabled: notificationsOn,
        nearby_notifications_enabled: nearbyOn,
        quiet_hours_enabled: quietOn,
        quiet_hours_start: normalizedStart,
        quiet_hours_end: normalizedEnd,
      });

      setProfile(updated);

      setNotificationsOn(updated.notifications_enabled);
      setNearbyOn(updated.nearby_notifications_enabled);
      setQuietOn(updated.quiet_hours_enabled);
      setQuietStart(trimSeconds(updated.quiet_hours_start));
      setQuietEnd(trimSeconds(updated.quiet_hours_end));

      if (runtimeSettingsChanged) {
        void syncRuntimePreferences(updated);
      }

      console.log('[settings] save success');
      Alert.alert(t("Saved"), t("Your settings have been updated."));
    } catch (e: any) {
      console.warn('[settings] save failed', e);
      Alert.alert(t("Save failed"), e?.message ?? 'Unknown error.');
    } finally {
      console.log('[settings] save finished');
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------
  // Sign out
  // ---------------------------------------------------------------------
  function handleSignOut() {
    // Never let Sign out race an in-flight account deletion.
    if (deletingAccount) return;
    Alert.alert(t("Sign out?"), t("You can sign back in any time with a magic link."), [
      { text: t("Cancel"), style: 'cancel' },
      {
        text: t("Sign out"),
        style: 'destructive',
        onPress: async () => {
          try {
            console.log('[signOut] step 1: clearing legacy Local UI Mode flag');
            await disableDevAuth();
            console.log('[signOut] step 2: supabase.auth.signOut()');
            // Tear down OS-level geofences before clearing the session
            // so the OS isn't left tracking regions for a signed-out user.
            try {
              await stopNearrGeofencing();
            } catch {
              /* non-fatal */
            }
            // Explicit sign-out must also remove the offline copies of this
            // account's data — the saved-places cache, the reminder snapshot,
            // and the identity pointer that would unlock either of them.
            // Without this the next launch could show a signed-out device the
            // previous user's private saved places.
            try {
              await clearOfflineUserData(user?.id ?? null);
              console.log('[signOut] step 2b: local offline data cleared');
            } catch {
              /* non-fatal */
            }
            const { error } = await signOut();
            if (error) {
              console.warn('[signOut] supabase signOut returned error', error);
            } else {
              console.log('[signOut] step 3: supabase signOut OK');
            }
            console.log('[signOut] step 4: routing to /(onboarding)/account');
            router.replace('/(onboarding)/account');
          } catch (e: any) {
            console.warn('[signOut] failed', e);
            Alert.alert(t("Sign out failed"), e?.message ?? 'Unknown error.');
          }
        },
      },
    ]);
  }

  async function handleExitDevMode() {
    await disableDevAuth();
    router.replace('/(onboarding)/account');
  }

  async function handleBackUpMap() {
    if (openingMapBackup) return;
    setOpeningMapBackup(true);
    try {
      await requestOnboardingV2MapBackup();
      // The durable account_required edge is owned by AuthGate. Dispatching a
      // second PUSH here remounted the account screen and emitted the 14:10 QA
      // trace's duplicate onboarding_email_started event.
    } catch (error) {
      console.warn('[settings] map backup entry failed', error);
      Alert.alert(t("Could not open map backup"), t("Your map is still safe on this device. Try again."));
      setOpeningMapBackup(false);
    }
  }

  // ---------------------------------------------------------------------
  // Delete account (Apple App Review Guideline 5.1.1(v))
  //
  // Two deliberate confirmations, then a single server-side hard delete.
  // The button appears in ALL builds (no dev/reviewer gating). Local
  // cleanup + navigation to the pre-auth flow happen ONLY after the
  // server confirms deletion; on failure the user stays signed in.
  // ---------------------------------------------------------------------
  function handleDeleteAccount() {
    if (deletingAccount) return;
    Alert.alert(
      DELETE_ACCOUNT_FIRST_CONFIRM.title,
      DELETE_ACCOUNT_FIRST_CONFIRM.body,
      [
        { text: DELETE_ACCOUNT_FIRST_CONFIRM.cancelLabel, style: 'cancel' },
        {
          text: DELETE_ACCOUNT_FIRST_CONFIRM.continueLabel,
          style: 'destructive',
          onPress: promptFinalDeleteAccount,
        },
      ],
      { cancelable: true },
    );
  }

  function promptFinalDeleteAccount() {
    if (deletingAccount) return;
    Alert.alert(
      DELETE_ACCOUNT_FINAL_CONFIRM.title,
      DELETE_ACCOUNT_FINAL_CONFIRM.body,
      [
        { text: DELETE_ACCOUNT_FINAL_CONFIRM.cancelLabel, style: 'cancel' },
        {
          text: DELETE_ACCOUNT_FINAL_CONFIRM.confirmLabel,
          style: 'destructive',
          onPress: () => void runAccountDeletion(),
        },
      ],
      { cancelable: true },
    );
  }

  async function runAccountDeletion() {
    if (deletingAccount) return;
    setDeletingAccount(true);
    console.log('[account] deletion requested');
    const deletedUserId = user?.id ?? null;
    try {
      const result = await deleteAccount();
      if (!result.ok) {
        // Keep the user signed in; do NOT clear local data. Restore the
        // button and let them retry.
        console.warn('[account] deletion failed', result.reason);
        setDeletingAccount(false);
        Alert.alert(t("Delete failed"), result.message);
        return;
      }
      // Server confirmed the hard delete. Tear down local state, then send
      // the (now signed-out) user back to the pre-auth entry point.
      console.log('[account] deletion confirmed, cleaning up');
      await cleanupAfterAccountDeletion(deletedUserId);
      router.replace('/(onboarding)');
    } catch (e: any) {
      console.warn('[account] deletion threw', e?.message ?? e);
      setDeletingAccount(false);
      Alert.alert(t("Delete failed"), DELETE_ACCOUNT_FAILURE_MESSAGE);
    }
  }

  // ---------------------------------------------------------------------
  // Demo mode actions
  // ---------------------------------------------------------------------
  const demo = isDemoMode();

  function handleSimulateNearby() {
    console.log('[settings] simulating nearby notification');
    void simulateDemoNearbyNotification();
  }

  function handleResetDemoData() {
    Alert.alert(
      t("Reset demo data?"),
      t("This restores the seeded demo profile and saved places. Your real account is not affected."),
      [
        { text: t("Cancel"), style: 'cancel' },
        {
          text: t("Reset"),
          style: 'destructive',
          onPress: async () => {
            try {
              await resetAllDemoData();
              await load();
              Alert.alert(t("Demo data reset"), t("Seed data has been restored."));
            } catch (e: any) {
              Alert.alert(t("Reset failed"), e?.message ?? 'Unknown error.');
            }
          },
        },
      ],
    );
  }

  function openHowNearrWorks() {
    setHowNearrWorksVisible(true);
    void trackEvent('how_nearr_works_shown', { entry_point: 'settings' });
  }

  function closeHowNearrWorks(action: 'completed' | 'skipped') {
    setHowNearrWorksVisible(false);
    void trackEvent(
      action === 'completed'
        ? 'how_nearr_works_completed'
        : 'how_nearr_works_skipped',
      { entry_point: 'settings' },
    );
  }

  async function handleSendTestNotification() {
    if (!isOnboardingV2DevelopmentResetAvailable()) return;
    const ok = await ensureNotificationPermission();
    if (!ok) {
      Alert.alert(
        t("Notifications blocked"),
        t("Enable notifications first to test local alerts."),
      );
      return;
    }
    await sendTestNotification();
  }

  // Dev/QA only: open the pre-auth onboarding intro as a preview. Sets the
  // in-memory preview flag so AuthGate keeps a signed-in session on the
  // onboarding route instead of redirecting to the map. Does NOT reset any
  // production onboarding state.
  // Which app / which update / which backend, rendered on the device itself.
  // Every field here is non-secret: hosts and identifiers only, never a key.
  const buildInfoText = useMemo(() => {
    const update = getUpdateInfo();
    const cfg = Constants.expoConfig;
    const buildNumber =
      Platform.OS === 'ios'
        ? cfg?.ios?.buildNumber
        : cfg?.android?.versionCode != null
        ? String(cfg.android.versionCode)
        : null;
    return [
      describeEnvironment(),
      `app=${cfg?.name ?? '?'} version=${cfg?.version ?? '?'} build=${buildNumber ?? '?'}`,
      `runtime=${update.runtimeVersion ?? '?'} channel=${update.channel ?? '?'}`,
      `update=${update.updateId ?? 'embedded (no OTA applied)'}`,
      update.embedded == null ? '' : `embedded=${update.embedded}`,
      update.emergencyLaunch ? 'emergencyLaunch=true' : '',
      placesDiagnosticText,
    ]
      .filter(Boolean)
      .join('\n');
  }, [placesDiagnosticText, i18n.language]);

  async function handleCopyBuildInfo() {
    try {
      await Clipboard.setStringAsync(buildInfoText);
      Alert.alert(t("Build info copied"), t("Paste it into the task or bug report."));
    } catch (err) {
      Alert.alert(t("Could not copy"), (err as Error)?.message ?? 'Please try again.');
    }
  }

  async function handleCopyDiagnostic() {
    try {
      const recent = await getRecentDiagnostics();
      // Non-secret App Group round-trip using ONLY existing native functions:
      // the host writes the `initialized` marker and reads it back through
      // getStatus(). A true host<->extension shared container yields
      // nativeModuleAvailable=true, appGroupAccessible=true and
      // hostRoundTripSucceeded=true. If the module is not linked (the
      // "finish setup" root cause) nativeModuleAvailable is false and every
      // field below is the safe default. NEVER exposes the token.
      const nativeModuleAvailable = sharedAuth.isAvailable();
      const appGroupIdentifier = sharedAuth.getAppGroup();
      const wroteMarker = sharedAuth.setInitialized();
      const status = sharedAuth.getStatus();
      const sharedTokenClaims = decodeJwtClaims(sharedAuth.getToken());
      const sharedTokenUserMatchesHost =
        !!user?.id && !!sharedTokenClaims?.sub && sharedTokenClaims.sub === user.id;
      const shareTrace = sharedAuth.getShareTrace();
      const hostRoundTripSucceeded =
        !!status && status.appGroupAccessible === true && wroteMarker && status.initialized === true;
      const parts: string[] = [];
      parts.push(
        'Shared-auth: nativeModuleAvailable=' + nativeModuleAvailable +
          ' appGroupIdentifier=' + (appGroupIdentifier ?? 'null') +
          ' hostRoundTripSucceeded=' + hostRoundTripSucceeded,
      );
      parts.push(
        status
          ? 'Shared-auth: appGroupAccessible=' + status.appGroupAccessible +
              ' initialized=' + status.initialized +
              ' tokenPresent=' + status.tokenPresent +
              ' tokenStructurallyValid=' + status.tokenStructurallyValid +
              ' tokenUserMatchesHost=' + sharedTokenUserMatchesHost +
              ' tokenExpiresAt=' +
              (status.tokenExpiresAt ? new Date(status.tokenExpiresAt).toISOString() : 'null') +
              ' lastSyncAt=' +
              (status.lastSyncAt ? new Date(status.lastSyncAt).toISOString() : 'null') +
              ' writerTarget=' + (status.writerTarget ?? 'null') +
              ' errorCode=' + (status.errorCode ?? 'none') +
              ' statusReadAt=' + new Date().toISOString() +
              ' statusReader=host_settings'
          : 'Shared-auth: native module unavailable (non-iOS or not linked)',
      );
      const latestInvocationId = shareTrace.at(-1)?.invocationId ?? null;
      const latestInvocation = latestInvocationId
        ? shareTrace.filter((event) => event.invocationId === latestInvocationId)
        : [];
      parts.push(
        latestInvocation.length === 0
          ? 'Share trace: no development invocation recorded.'
          : [
              `Share trace: invocationId=${latestInvocationId}`,
              ...latestInvocation.map((event) => {
                const time = Number.isFinite(event.timestamp)
                  ? new Date(event.timestamp).toISOString()
                  : 'unknown-time';
                return `${time} ${event.process} ${event.event}${
                  event.detail ? ` detail=${event.detail}` : ''
                }`;
              }),
            ].join('\n'),
      );
      parts.push(
        recent.length === 0
          ? 'No recent diagnostics recorded.'
          : formatDiagnosticForCopy(recent[0]),
      );
      await Clipboard.setStringAsync(parts.join('\n\n'));
      Alert.alert(
        t("Diagnostic copied"),
        t("Paste it into a bug report. No tokens or private URLs are included."),
      );
    } catch (err) {
      Alert.alert(t("Could not copy"), (err as Error)?.message ?? 'Please try again.');
    }
  }

  function handleTestOnboarding() {
    if (!isOnboardingV2DevelopmentResetAvailable()) return;
    setOnboardingPreview(true);
    router.push('/(onboarding)?preview=1');
  }

  function handleResetOnboardingOnly() {
    if (resettingOnboarding) return;
    Alert.alert(
      t("Reset onboarding?"),
      t("Clear onboarding progress and server checkpoints while keeping this anonymous identity, its saves, and its jobs?"),
      [
        { text: t("Cancel"), style: 'cancel' },
        {
          text: t("Reset onboarding"),
          style: 'destructive',
          onPress: () => void runOnboardingReset('onboarding_only'),
        },
      ],
      { cancelable: true },
    );
  }

  function handleFreshAnonymousReset() {
    if (resettingOnboarding) return;
    Alert.alert(
      t("Create a fresh QA user?"),
      t("Sign out only this device and create a brand-new anonymous identity? Existing account data, saves, and jobs stay untouched."),
      [
        { text: t("Cancel"), style: 'cancel' },
        {
          text: t("Fresh anonymous user"),
          style: 'destructive',
          onPress: () => void runOnboardingReset('fresh_anonymous'),
        },
      ],
      { cancelable: true },
    );
  }

  async function runOnboardingReset(mode: 'onboarding_only' | 'fresh_anonymous') {
    if (resettingOnboarding) return;
    setResettingOnboarding(true);
    const result = mode === 'onboarding_only'
      ? await resetOnboardingV2OnlyForDevelopment()
      : await resetOnboardingV2WithFreshAnonymousUserForDevelopment();
    if (!result.ok) {
      setResettingOnboarding(false);
      Alert.alert(
        t("Reset blocked"),
        result.code === 'ONBOARDING_DEV_RESET_BLOCKED_NON_DEV'
          ? 'Onboarding reset is available only in the development app connected to Nearr-Dev.'
          : result.code === 'ONBOARDING_DEV_RESET_REQUIRES_ANONYMOUS'
            ? 'Reset onboarding only requires an anonymous QA user. Use Fresh anonymous QA user to leave this account without deleting it.'
          : 'Onboarding could not be reset. Try again.',
      );
      return;
    }
    router.replace('/(onboarding)');
    Alert.alert(
      mode === 'onboarding_only' ? 'Onboarding reset' : 'Fresh anonymous QA user ready',
      mode === 'onboarding_only'
        ? 'Progress is cleared; the current anonymous identity and its saves are preserved.'
        : `Identity ${result.anonymousUserId.slice(0, 8)}… is ready. Start again from Welcome.`,
    );
  }

  // Open the App Store review flow. Public App Store rating — distinct from
  // the private in-app "Send feedback" flow. Until Nearr is live (no App Store
  // ID yet) this shows a friendly "coming soon" alert; never crashes.
  async function handleLeaveReview() {
    if (!APP_STORE_APP_ID) {
      Alert.alert(
        t("Coming soon"),
        t("Reviews will be available after Nearr is live on the App Store."),
      );
      return;
    }
    const deepLink = appStoreReviewUrl(APP_STORE_APP_ID);
    const webUrl = `https://apps.apple.com/app/id${APP_STORE_APP_ID}?action=write-review`;
    try {
      const canOpen = await Linking.canOpenURL(deepLink);
      await Linking.openURL(canOpen ? deepLink : webUrl);
    } catch {
      Alert.alert(
        t("Could not open the App Store"),
        t("Please try again from the App Store app."),
      );
    }
  }

  function formatAcceptedAt(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString();
  }

  // ---------------------------------------------------------------------
  // Local-UI session with no profile: show banner + Exit Dev Mode and skip
  // the form entirely (the form requires a real profile to load).
  if (!loading && isLocalUiSession && !profile) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <DevModeBanner visible />
          <Text style={[typography.body, styles.muted]}>
            {t("Settings are disabled in Local UI Mode because there is no Supabase profile to read or write. Exit Local UI Mode and sign in with a magic link to manage notification preferences.")}</Text>
          <View style={{ height: Spacing.xl }} />
          <Button
            title={t("Exit Local UI Mode")}
            variant="secondary"
            onPress={handleExitDevMode}
          />
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.pageHeader}>
          <View style={{ flex: 1, gap: 8 }}>
            <Text style={typography.eyebrow}>{t("MAKE IT YOURS")}</Text>
            <Text style={typography.largeTitle}>{t("Settings")}</Text>
          </View>
          <IconButton icon="x" label={t("Close settings")} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)/map')} />
        </View>
        <DevModeBanner visible={isLocalUiSession} />
        <DemoModeBanner />
        <Text style={styles.sectionLabel}>{t("Appearance")}</Text>
        <Card style={styles.section}>
          <Text style={[typography.caption, styles.muted]}>
            {t("Choose how Nearr looks on this device.")}</Text>
          <View style={styles.themeOptionsRow}>
            <ThemeOption
              label={t("System")}
              active={themePreference === 'system'}
              onPress={() => setThemePreference('system')}
              colors={colors}
              typography={typography}
              styles={styles}
            />
            <ThemeOption
              label={t("Light")}
              active={themePreference === 'light'}
              onPress={() => setThemePreference('light')}
              colors={colors}
              typography={typography}
              styles={styles}
            />
            <ThemeOption
              label={t("Dark")}
              active={themePreference === 'dark'}
              onPress={() => setThemePreference('dark')}
              colors={colors}
              typography={typography}
              styles={styles}
            />
          </View>
        </Card>

        <Card style={styles.section}>
          <LanguageSelector />
        </Card>

        {loading ? (
          <Card style={styles.section}>
            <View style={styles.unitRow}><ActivityIndicator /><Text style={[typography.caption, styles.muted]}>{t("Loading account preferences…")}</Text></View>
          </Card>
        ) : loadError && !profile ? (
          <Card style={styles.section}>
            <Text style={typography.bodyStrong}>{t("Couldn’t load account preferences")}</Text>
            <Text style={[typography.caption, styles.muted]}>{loadError}</Text>
            <Button title={t("Try again")} variant="secondary" onPress={load} />
          </Card>
        ) : null}

        {/* --- Notifications ------------------------------------------- */}
        <Text style={styles.sectionLabel}>{t("Nearby alerts")}</Text>
        <Card style={styles.section}>
          <ToggleRow
            label={t("Allow notifications")}
            sub={t("Let Nearr send reminders and updates.")}
            value={notificationsOn}
            onValueChange={setNotificationsOn}
            disabled={loading || !profile}
          />
          <View style={styles.divider} />
          <ToggleRow
            label={t("Nearby alerts")}
            sub={t("Remind me when I'm near a place I saved.")}
            value={nearbyOn}
            onValueChange={setNearbyOn}
            disabled={loading || !profile || !notificationsOn}
          />
          <View style={styles.divider} />
          <Pressable
            style={styles.helpRow}
            onPress={() => void Linking.openSettings().catch(() => undefined)}
            accessibilityRole="button"
            accessibilityLabel={t("Open system permission settings")}
          >
            <View style={styles.helpCopy}>
              <Text style={typography.bodyStrong}>{t("System permissions")}</Text>
              <Text style={[typography.caption, styles.muted, styles.helpBody]}>
                {t("Change location or notification access for Nearr.")}</Text>
            </View>
            <Text style={[typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
        </Card>

        {/* --- Quiet hours --------------------------------------------- */}
        <Text style={styles.sectionLabel}>{t("Quiet hours")}</Text>
        <Card style={styles.section}>
          <ToggleRow
            label={t("Enable quiet hours")}
            sub={t("Pause reminders during a daily window.")}
            value={quietOn}
            onValueChange={setQuietOn}
            disabled={loading || !profile}
          />
          {quietOn ? (
            <View style={styles.quietGrid}>
              <View style={styles.quietField}>
                <Text style={[typography.caption, styles.muted]}>{t("Start (24h)")}</Text>
                <Input
                  value={quietStart}
                  onChangeText={setQuietStart}
                  placeholder="22:00"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={5}
                />
              </View>
              <View style={{ width: Spacing.md }} />
              <View style={styles.quietField}>
                <Text style={[typography.caption, styles.muted]}>{t("End (24h)")}</Text>
                <Input
                  value={quietEnd}
                  onChangeText={setQuietEnd}
                  placeholder="07:00"
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={5}
                />
              </View>
            </View>
          ) : null}
        </Card>

        {/* --- Save ---------------------------------------------------- */}
        {hasUnsavedChanges ? (
          <>
            <View style={{ height: Spacing.lg }} />
            <Button title={t("Save changes")} onPress={handleSave} loading={saving} disabled={loading || !profile} />
          </>
        ) : null}

        {/* --- Help ---------------------------------------------------- */}
        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>{t("Help")}</Text>
        <Card style={styles.section}>
          <Pressable style={styles.helpRow} onPress={openHowNearrWorks}>
            <View style={styles.helpCopy}>
              <Text style={typography.bodyStrong}>{t("How Nearr works")}</Text>
              <Text style={[typography.caption, styles.muted, styles.helpBody]}>
                {t("See the save to reminder to go loop again.")}</Text>
            </View>
            <Text style={[typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable
            style={styles.helpRow}
            onPress={() =>
              router.push({ pathname: '/feedback', params: { from: '/(tabs)/settings' } })
            }
          >
            <View style={styles.helpCopy}>
              <Text style={typography.bodyStrong}>{t("Send feedback")}</Text>
              <Text style={[typography.caption, styles.muted, styles.helpBody]}>
                {t("Tell me what's confusing, broken, or missing.")}</Text>
            </View>
            <Text style={[typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.helpRow} onPress={() => void handleLeaveReview()}>
            <View style={styles.helpCopy}>
              <Text style={typography.bodyStrong}>{t("Leave a review")}</Text>
              <Text style={[typography.caption, styles.muted, styles.helpBody]}>
                {t("Enjoying Nearr? A quick review helps a lot.")}</Text>
            </View>
            <Text style={[typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
        </Card>

        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>{t("Legal")}</Text>
        <Card style={styles.section}>
          <Pressable style={styles.helpRow} onPress={() => router.push('/legal/terms')}>
            <View style={styles.helpCopy}>
              <Text style={typography.bodyStrong}>{t("Terms of Service")}</Text>
              <Text style={[typography.caption, styles.muted, styles.helpBody]}>
                {t("Read the current Terms and effective date.")}</Text>
            </View>
            <Text style={[typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.helpRow} onPress={() => router.push('/legal/privacy')}>
            <View style={styles.helpCopy}>
              <Text style={typography.bodyStrong}>{t("Privacy Policy")}</Text>
              <Text style={[typography.caption, styles.muted, styles.helpBody]}>
                {t("How Nearr handles accounts, saved places, and nearby-reminder data.")}</Text>
            </View>
            <Text style={[typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
          <View style={{ height: Spacing.xs }} />
          {__DEV__ ? (
            <>
              <Text style={[typography.caption, styles.muted]}>
                {t("Legal acceptance required now: ")}{LEGAL_ACCEPTANCE_REQUIRED ? t("Yes") : t("No")}
              </Text>
              <Text style={[typography.caption, styles.muted]}>
                {t("Legacy acceptance record version: ")}{LEGAL_VERSION}
              </Text>
              {legalAcceptedVersion ? (
                <Text style={[typography.caption, styles.muted]}>
                  {t("Accepted version: ")}{legalAcceptedVersion}
                  {formatAcceptedAt(legalAcceptedAt) ? ` on ${formatAcceptedAt(legalAcceptedAt)}` : ''}
                </Text>
              ) : null}
            </>
          ) : null}
        </Card>

        {/* --- Setup -------------------------------------------------- */}
        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>{t("Setup Nearr")}</Text>
        <SetupChecklist />

        {/* --- Build info (non-production builds only) ----------------- */}
        {/*
          Answers "which app, which update, which backend am I looking at?" on
          the device itself. After the 2026-08-18 bad OTA there was no way to
          tell a stale install from a live one without a laptop.

          Gated on areDeveloperToolsVisible(), NOT __DEV__: an update published
          to the development channel is a production-mode bundle, so __DEV__ is
          false exactly when this card matters. It requires an explicit
          development/preview declaration, so it can never appear in the App
          Store build.
        */}
        {areDeveloperToolsVisible() ? (
          <>
            <View style={{ height: Spacing.xxl }} />
            <Text style={styles.sectionLabel}>{t("Build info")}</Text>
            <Card style={styles.section}>
              <Text style={[typography.caption, styles.muted]}>{buildInfoText}</Text>
              <View style={{ height: Spacing.sm }} />
              <Button
                title={t("Copy build info")}
                variant="ghost"
                onPress={() => void handleCopyBuildInfo()}
              />
            </Card>
          </>
        ) : null}

        {/* --- Development onboarding QA (hard-gated in the operation too) */}
        {onboardingResetAvailable ? (
          <>
            <View style={{ height: Spacing.xxl }} />
            <Text style={styles.sectionLabel}>{t("Development QA")}</Text>
            <Card style={styles.section}>
              <Text style={[typography.caption, styles.muted]}>
                {t("Reset progress in place, or rotate to a truly fresh anonymous identity. Both operations are hard-gated to Nearr-Dev.")}</Text>
              <Button
                title={t("Reset onboarding only")}
                variant="secondary"
                loading={resettingOnboarding}
                onPress={handleResetOnboardingOnly}
              />
              <View style={{ height: Spacing.sm }} />
              <Button
                title={t("Fresh anonymous QA user")}
                variant="secondary"
                loading={resettingOnboarding}
                onPress={handleFreshAnonymousReset}
              />
              <View style={{ height: Spacing.sm }} />
              <Button
                title={t("Open standalone QA reset")}
                variant="ghost"
                disabled={resettingOnboarding}
                onPress={() => router.push('/dev-qa')}
              />
            </Card>
          </>
        ) : null}

        {/* Same verified Development boundary as the actions and QA route. */}
        {onboardingResetAvailable ? (
          <>
            <View style={{ height: Spacing.xxl }} />
            <Text style={styles.sectionLabel}>{t("Testing")}</Text>
            <Card style={styles.section}>
              <Text style={[typography.caption, styles.muted]}>
                {t("Development app only. Tools for checking this build.")}</Text>
              <Button
                title={t("Send test notification")}
                variant="secondary"
                onPress={() => void handleSendTestNotification()}
              />
              <View style={{ height: Spacing.sm }} />
              <Button
                title={t("Preview onboarding")}
                variant="ghost"
                onPress={handleTestOnboarding}
              />
              <Text style={[typography.caption, styles.muted]}>
                {t("Opens the pre-auth onboarding intro flow.")}</Text>
              <View style={{ height: Spacing.sm }} />
              <Button
                title={t("Copy diagnostic")}
                variant="ghost"
                onPress={() => void handleCopyDiagnostic()}
              />
              <Text style={[typography.caption, styles.muted]}>
                {t("Copies the last sanitized crash + App Group auth status (no tokens/URLs).")}</Text>
            </Card>
          </>
        ) : null}

        {/* --- Account ------------------------------------------------- */}
        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>{t("Account")}</Text>
        <Card style={styles.section}>
          {user?.is_anonymous === true ? (
            <>
              <Text style={typography.bodyStrong}>{t("Back up your map")}</Text>
              <Text style={[typography.caption, styles.muted]}>
                {t("Add a sign-in to recover your saved places and use them on another device. You can keep using Nearr without one.")}</Text>
              <View style={{ height: Spacing.md }} />
              <Button
                title={openingMapBackup ? t("Opening…") : t("Back up my map")}
                variant="secondary"
                onPress={() => void handleBackUpMap()}
                disabled={openingMapBackup}
              />
              <View style={styles.divider} />
            </>
          ) : null}
          {profile?.email ? (
            <Text style={[typography.body, styles.muted]}>
              {t("Signed in as ")}{profile.email}
            </Text>
          ) : null}
          <View style={{ height: Spacing.md }} />
          {user?.is_anonymous !== true ? <Button
            title={t("Sign out")}
            variant="secondary"
            onPress={handleSignOut}
            disabled={deletingAccount}
          /> : null}
          <View style={styles.divider} />
          <Pressable
            style={styles.deleteRow}
            onPress={handleDeleteAccount}
            disabled={deletingAccount}
            accessibilityRole="button"
            accessibilityLabel={t("Delete account")}
            accessibilityState={{ disabled: deletingAccount, busy: deletingAccount }}
          >
            <View style={styles.helpCopy}>
              <Text style={[typography.bodyStrong, styles.deleteTitle]}>
                {t("Delete account")}</Text>
              <Text style={[typography.caption, styles.deleteSubtitle]}>
                {t("Permanently delete your account and saved data.")}</Text>
            </View>
            {deletingAccount ? (
              <ActivityIndicator color={colors.danger} />
            ) : (
              <Text style={[typography.bodyStrong, styles.deleteChevron]}>›</Text>
            )}
          </Pressable>
        </Card>

        {demo ? (
          <>
            <View style={{ height: Spacing.xxl }} />
            <Text style={styles.sectionLabel}>{t("Demo Mode")}</Text>
            <Card style={styles.section}>
              <Text style={[typography.caption, styles.muted]}>
                {t("External APIs are mocked. Saved places, profile, and search use local seeded data.")}</Text>
              <View style={{ height: Spacing.md }} />
              <Button
                title={t("Simulate nearby notification")}
                variant="secondary"
                onPress={handleSimulateNearby}
              />
              <View style={{ height: Spacing.sm }} />
              <Button
                title={t("Reset demo data")}
                variant="ghost"
                onPress={handleResetDemoData}
              />
              <View style={{ height: Spacing.md }} />
              <Text style={[typography.caption, styles.muted]}>
                {t("Disable Demo Mode by removing EXPO_PUBLIC_DEMO_MODE from your .env and restarting Metro.")}</Text>
            </Card>
          </>
        ) : null}

        {__DEV__ && isLocalUiSession ? (
          <>
            <View style={{ height: Spacing.lg }} />
            <Button
              title={t("Exit Local UI Mode")}
              variant="ghost"
              onPress={handleExitDevMode}
            />
          </>
        ) : null}
      </ScrollView>
      <HowNearrWorksModal
        visible={howNearrWorksVisible}
        primaryLabel={t("Got it")}
        secondaryLabel={t("Close")}
        onPrimary={() => closeHowNearrWorks('completed')}
        onSecondary={() => closeHowNearrWorks('skipped')}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function ThemeOption({
  label,
  active,
  onPress,
  colors,
  typography,
  styles,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useTheme>['colors'];
  typography: ReturnType<typeof useTheme>['typography'];
  styles: ReturnType<typeof createStyles>;
}) {
  useLocale();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active }} onPress={onPress} style={[styles.unitOption, active && styles.unitOptionActive]}>
      <Text style={[typography.label, { color: active ? colors.textInverse : colors.text }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function ToggleRow({
  label,
  sub,
  value,
  onValueChange,
  disabled,
}: {
  label: string;
  sub?: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  useLocale();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography, i18n.language]);
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.5 }]}>
      <View style={{ flex: 1 }}>
        <Text style={typography.bodyStrong}>{label}</Text>
        {sub ? (
          <Text style={[typography.caption, styles.muted, { marginTop: 2 }]}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Switch accessibilityLabel={label} accessibilityHint={sub} value={value} onValueChange={onValueChange} disabled={disabled} trackColor={{ false: colors.controlBorder, true: colors.primary }} />
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
  fontScale = 1,
) {
  return StyleSheet.create({
    scroll: { padding: Spacing.xl, paddingBottom: 64 },
    pageHeader: { flexDirection: 'row', alignItems: 'center', gap: 16, marginBottom: 24 },
    center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
    muted: { color: colors.textSecondary },

    sectionLabel: {
      ...typography.label,
      color: colors.textMuted,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
      marginBottom: Spacing.sm,
      marginTop: Spacing.lg,
    },
    section: { marginBottom: Spacing.sm, gap: Spacing.md, paddingHorizontal: 0, backgroundColor: 'transparent', borderWidth: 0, borderBottomWidth: 1, borderRadius: 0, paddingBottom: 24 },
    helpRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
    },
    helpCopy: {
      flex: 1,
    },
    helpBody: {
      marginTop: 2,
    },
    helpChevron: {
      color: colors.textMuted,
      marginLeft: Spacing.md,
    },
    deleteRow: {
      minHeight: 56,
      flexDirection: 'row',
      alignItems: 'center',
    },
    deleteTitle: {
      color: colors.danger,
    },
    deleteSubtitle: {
      color: colors.textSecondary,
      marginTop: 2,
    },
    deleteChevron: {
      color: colors.danger,
      marginLeft: Spacing.md,
    },

    unitRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    themeOptionsRow: {
      flexDirection: fontScale >= 1.5 ? 'column' : 'row',
      gap: Spacing.sm,
    },
    unitOption: {
      minHeight: 44,
      justifyContent: 'center',
      flex: fontScale >= 1.5 ? 0 : 1,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.controlBorder,
      backgroundColor: colors.bg,
      alignItems: 'center',
    },
    unitOptionActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },

    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: Spacing.xs,
    },

    quietGrid: { flexDirection: 'row' },
    quietField: { flex: 1, gap: Spacing.xs },
  });
}
