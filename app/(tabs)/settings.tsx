/**
 * Settings screen.
 *
 * Reads / writes the current user's `profiles` row. All edits are local
 * until "Save changes" — that keeps validation predictable and avoids
 * round-trips on every keystroke / toggle.
 *
 * Fields:
 *   - default reminder distance value + unit (miles / minutes)
 *   - global notifications enabled
 *   - nearby notifications enabled (only meaningful when global is on)
 *   - quiet hours enabled
 *   - quiet hours start / end (HH:MM, only when quiet hours enabled)
 *
 * Validation runs before save:
 *   - radius must be a positive finite number
 *   - if quiet hours are enabled, both start and end must be valid HH:MM
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, DemoModeBanner, DevModeBanner, EmptyState, HowNearrWorksModal, Input, Screen, SetupChecklist } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';

import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { disableDevAuth } from '@/lib/devAuth';
import { isDemoMode } from '@/lib/demoMode';
import { LEGAL_ACCEPTANCE_REQUIRED, LEGAL_VERSION } from '@/constants';
import { getProfile, getLegalAcceptanceStatus, updateProfile } from '@/services/profileService';
import { signOut } from '@/services/auth';
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
import type { Profile, RadiusUnit } from '@/types';

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
  const router = useRouter();
  const { isDevSession, isLocalUiSession } = useAuth();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // editable state
  const [radiusText, setRadiusText] = useState('1');
  const [radiusUnit, setRadiusUnit] = useState<RadiusUnit>('miles');
  const [notificationsOn, setNotificationsOn] = useState(true);
  const [nearbyOn, setNearbyOn] = useState(true);
  const [quietOn, setQuietOn] = useState(false);
  const [quietStart, setQuietStart] = useState('');
  const [quietEnd, setQuietEnd] = useState('');
  const [howNearrWorksVisible, setHowNearrWorksVisible] = useState(false);
  const [legalAcceptedVersion, setLegalAcceptedVersion] = useState<string | null>(null);
  const [legalAcceptedAt, setLegalAcceptedAt] = useState<string | null>(null);

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
          setLoadError('Could not load your profile. Try again.');
        }
        return;
      }
      setProfile(p);
      setRadiusText(String(p.default_radius_value));
      setRadiusUnit(p.default_radius_unit);
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
  async function handleSave() {
    // --- validate reminder distance ---
    const radius = Number.parseFloat(radiusText);
    if (!Number.isFinite(radius) || radius <= 0) {
      Alert.alert(
        'Invalid reminder distance',
        `Enter a positive number of ${radiusUnit}.`,
      );
      return;
    }

    // --- validate quiet hours (only when enabled) ---
    let normalizedStart: string | null = null;
    let normalizedEnd: string | null = null;
    if (quietOn) {
      const s = quietStart.trim();
      const e = quietEnd.trim();
      if (!isValidHhmm(s) || !isValidHhmm(e)) {
        Alert.alert(
          'Invalid quiet hours',
          'Use 24-hour HH:MM format, e.g. 22:00 and 07:30.',
        );
        return;
      }
      if (s === e) {
        Alert.alert(
          'Invalid quiet hours',
          'Start and end times must be different.',
        );
        return;
      }
      normalizedStart = s;
      normalizedEnd = e;
    }

    setSaving(true);
    try {
      const updated = await updateProfile({
        default_radius_value: radius,
        default_radius_unit: radiusUnit,
        notifications_enabled: notificationsOn,
        nearby_notifications_enabled: nearbyOn,
        quiet_hours_enabled: quietOn,
        quiet_hours_start: normalizedStart,
        quiet_hours_end: normalizedEnd,
      });
      setProfile(updated);

      // Apply the proximity-watch side effect *after* the DB write succeeds,
      // so a failed save doesn't change runtime behavior. Permission is
      // requested lazily here — declining doesn't fail the save.
      const wantsWatch = notificationsOn && nearbyOn;
      if (wantsWatch) {
        const ok = await ensureNotificationPermission();
        if (!ok) {
          Alert.alert(
            'Notifications blocked',
            'Settings were saved, but enable notifications in system settings to receive nearby alerts.',
          );
        }
        await startProximityWatch();
        // Resync OS-level geofences in case master / nearby switches
        // were just turned back on. Non-blocking on failure.
        void syncGeofencesForSavedPlaces();
      } else {
        await stopProximityWatch();
        await stopNearrGeofencing();
      }

      Alert.alert('Saved', 'Your settings have been updated.');
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------------
  // Sign out
  // ---------------------------------------------------------------------
  function handleSignOut() {
    Alert.alert('Sign out?', 'You can sign back in any time with a magic link.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
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
            const { error } = await signOut();
            if (error) {
              console.warn('[signOut] supabase signOut returned error', error);
            } else {
              console.log('[signOut] step 3: supabase signOut OK');
            }
            console.log('[signOut] step 4: routing to /(auth)/sign-in');
            router.replace('/(auth)/sign-in');
          } catch (e: any) {
            console.warn('[signOut] failed', e);
            Alert.alert('Sign out failed', e?.message ?? 'Unknown error.');
          }
        },
      },
    ]);
  }

  async function handleExitDevMode() {
    await disableDevAuth();
    router.replace('/(auth)/sign-in');
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
      'Reset demo data?',
      'This restores the seeded demo profile and saved places. Your real account is not affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            try {
              await resetAllDemoData();
              await load();
              Alert.alert('Demo data reset', 'Seed data has been restored.');
            } catch (e: any) {
              Alert.alert('Reset failed', e?.message ?? 'Unknown error.');
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
    const ok = await ensureNotificationPermission();
    if (!ok) {
      Alert.alert(
        'Notifications blocked',
        'Enable notifications first to test local alerts.',
      );
      return;
    }
    await sendTestNotification();
  }

  function formatAcceptedAt(value: string | null): string | null {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString();
  }

  // ---------------------------------------------------------------------
  if (loading) {
    return (
      <Screen>
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (loadError && !profile) {
    return (
      <Screen>
        <EmptyState
          variant="error"
          title="Couldn&rsquo;t load your settings"
          body={loadError}
          actionTitle="Try again"
          onAction={load}
        />
      </Screen>
    );
  }

  // Local-UI session with no profile: show banner + Exit Dev Mode and skip
  // the form entirely (the form requires a real profile to load).
  if (isLocalUiSession && !profile) {
    return (
      <Screen padded={false}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <DevModeBanner visible />
          <Text style={[Typography.body, styles.muted]}>
            Settings are disabled in Local UI Mode because there is no
            Supabase profile to read or write. Exit Local UI Mode and sign in
            with a magic link to manage notification preferences.
          </Text>
          <View style={{ height: Spacing.xl }} />
          <Button
            title="Exit Local UI Mode"
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
        <DevModeBanner visible={isLocalUiSession} />
        <DemoModeBanner />
        {/* --- Default radius ------------------------------------------- */}
        <Text style={styles.sectionLabel}>Default reminder distance</Text>
        <Card style={styles.section}>
          <Text style={[Typography.caption, styles.muted]}>
            Used when a place uses your usual nearby reminder setting.
          </Text>

          <View style={styles.unitRow}>
            <UnitOption
              label="Distance"
              active={radiusUnit === 'miles'}
              onPress={() => setRadiusUnit('miles')}
            />
            <UnitOption
              label="Time away"
              active={radiusUnit === 'minutes'}
              onPress={() => setRadiusUnit('minutes')}
            />
          </View>

          <Input
            value={radiusText}
            onChangeText={setRadiusText}
            keyboardType={radiusUnit === 'miles' ? 'decimal-pad' : 'number-pad'}
            placeholder={radiusUnit === 'miles' ? 'e.g. 1.5' : 'e.g. 10'}
          />
        </Card>

        {/* --- Notifications ------------------------------------------- */}
        <Text style={styles.sectionLabel}>Nearby alerts</Text>
        <Card style={styles.section}>
          <ToggleRow
            label="Allow notifications"
            sub="Let Nearr send reminders and updates."
            value={notificationsOn}
            onValueChange={setNotificationsOn}
          />
          <View style={styles.divider} />
          <ToggleRow
            label="Nearby alerts"
            sub="Remind me when I&apos;m near a place I saved."
            value={nearbyOn}
            onValueChange={setNearbyOn}
            disabled={!notificationsOn}
          />
        </Card>

        {/* --- Quiet hours --------------------------------------------- */}
        <Text style={styles.sectionLabel}>Quiet hours</Text>
        <Card style={styles.section}>
          <ToggleRow
            label="Enable quiet hours"
            sub="Pause reminders during a daily window."
            value={quietOn}
            onValueChange={setQuietOn}
          />
          {quietOn ? (
            <View style={styles.quietGrid}>
              <View style={styles.quietField}>
                <Text style={[Typography.caption, styles.muted]}>Start (24h)</Text>
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
                <Text style={[Typography.caption, styles.muted]}>End (24h)</Text>
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
        <View style={{ height: Spacing.lg }} />
        <Button title="Save changes" onPress={handleSave} loading={saving} />

        {/* --- Help ---------------------------------------------------- */}
        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>Help</Text>
        <Card style={styles.section}>
          <Pressable style={styles.helpRow} onPress={openHowNearrWorks}>
            <View style={styles.helpCopy}>
              <Text style={Typography.bodyStrong}>How Nearr works</Text>
              <Text style={[Typography.caption, styles.muted, styles.helpBody]}>
                See the save to reminder to go loop again.
              </Text>
            </View>
            <Text style={[Typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
        </Card>

        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>Legal</Text>
        <Card style={styles.section}>
          <Pressable style={styles.helpRow} onPress={() => router.push('/legal/terms')}>
            <View style={styles.helpCopy}>
              <Text style={Typography.bodyStrong}>Terms of Service</Text>
              <Text style={[Typography.caption, styles.muted, styles.helpBody]}>
                Production draft for later public launch review.
              </Text>
            </View>
            <Text style={[Typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
          <View style={styles.divider} />
          <Pressable style={styles.helpRow} onPress={() => router.push('/legal/privacy')}>
            <View style={styles.helpCopy}>
              <Text style={Typography.bodyStrong}>Privacy Policy</Text>
              <Text style={[Typography.caption, styles.muted, styles.helpBody]}>
                How Nearr handles accounts, saved places, and nearby-reminder data.
              </Text>
            </View>
            <Text style={[Typography.bodyStrong, styles.helpChevron]}>›</Text>
          </Pressable>
          <View style={{ height: Spacing.xs }} />
          <Text style={[Typography.caption, styles.muted]}>
            Legal acceptance required now: {LEGAL_ACCEPTANCE_REQUIRED ? 'Yes' : 'No'}
          </Text>
          <Text style={[Typography.caption, styles.muted]}>
            Current legal version: {LEGAL_VERSION}
          </Text>
          {legalAcceptedVersion ? (
            <Text style={[Typography.caption, styles.muted]}>
              Accepted version: {legalAcceptedVersion}
              {formatAcceptedAt(legalAcceptedAt) ? ` on ${formatAcceptedAt(legalAcceptedAt)}` : ''}
            </Text>
          ) : null}
        </Card>

        {/* --- Setup -------------------------------------------------- */}
        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>Setup Nearr</Text>
        <SetupChecklist />

        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>Testing</Text>
        <Card style={styles.section}>
          <Text style={[Typography.caption, styles.muted]}>
            Beta only. Use this to confirm nearby reminders can appear on this device.
          </Text>
          <Button
            title="Send test notification"
            variant="secondary"
            onPress={() => void handleSendTestNotification()}
          />
        </Card>

        {/* --- Account ------------------------------------------------- */}
        <View style={{ height: Spacing.xxl }} />
        <Text style={styles.sectionLabel}>Account</Text>
        <Card style={styles.section}>
          {profile?.email ? (
            <Text style={[Typography.body, styles.muted]}>
              Signed in as {profile.email}
            </Text>
          ) : null}
          <View style={{ height: Spacing.md }} />
          <Button
            title="Sign out"
            variant="secondary"
            onPress={handleSignOut}
          />
        </Card>

        {demo ? (
          <>
            <View style={{ height: Spacing.xxl }} />
            <Text style={styles.sectionLabel}>Demo Mode</Text>
            <Card style={styles.section}>
              <Text style={[Typography.caption, styles.muted]}>
                External APIs are mocked. Saved places, profile, and search
                use local seeded data.
              </Text>
              <View style={{ height: Spacing.md }} />
              <Button
                title="Simulate nearby notification"
                variant="secondary"
                onPress={handleSimulateNearby}
              />
              <View style={{ height: Spacing.sm }} />
              <Button
                title="Reset demo data"
                variant="ghost"
                onPress={handleResetDemoData}
              />
              <View style={{ height: Spacing.md }} />
              <Text style={[Typography.caption, styles.muted]}>
                Disable Demo Mode by removing EXPO_PUBLIC_DEMO_MODE from
                your .env and restarting Metro.
              </Text>
            </Card>
          </>
        ) : null}

        {__DEV__ && isLocalUiSession ? (
          <>
            <View style={{ height: Spacing.lg }} />
            <Button
              title="Exit Local UI Mode"
              variant="ghost"
              onPress={handleExitDevMode}
            />
          </>
        ) : null}
      </ScrollView>
      <HowNearrWorksModal
        visible={howNearrWorksVisible}
        primaryLabel="Got it"
        secondaryLabel="Close"
        onPrimary={() => closeHowNearrWorks('completed')}
        onSecondary={() => closeHowNearrWorks('skipped')}
      />
    </Screen>
  );
}

// ---------------------------------------------------------------------------

function UnitOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.unitOption, active && styles.unitOptionActive]}
    >
      <Text
        style={[
          Typography.label,
          { color: active ? Colors.textInverse : Colors.text },
        ]}
      >
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
  return (
    <View style={[styles.toggleRow, disabled && { opacity: 0.5 }]}>
      <View style={{ flex: 1 }}>
        <Text style={Typography.bodyStrong}>{label}</Text>
        {sub ? (
          <Text style={[Typography.caption, styles.muted, { marginTop: 2 }]}>
            {sub}
          </Text>
        ) : null}
      </View>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  muted: { color: Colors.textSecondary },

  sectionLabel: {
    ...Typography.label,
    color: Colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: Spacing.sm,
    marginTop: Spacing.lg,
  },
  section: { marginBottom: Spacing.sm, gap: Spacing.md },
  helpRow: {
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
    color: Colors.textMuted,
    marginLeft: Spacing.md,
  },

  unitRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  unitOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    alignItems: 'center',
  },
  unitOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },

  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.xs,
  },

  quietGrid: { flexDirection: 'row' },
  quietField: { flex: 1, gap: Spacing.xs },
});
