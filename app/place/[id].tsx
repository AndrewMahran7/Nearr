/**
 * Saved-place detail / edit screen.
 *
 * Route: `/place/[id]` where `id` is `saved_places.id`.
 *
 * The user can:
 *   - see the underlying canonical place (name / address / category / source)
 *   - toggle notifications on/off for this place
 *   - change the radius mode (use profile default / miles / minutes)
 *   - edit notes
 *   - remove the saved place (delete)
 *
 * Save closes the screen; delete confirms first then closes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, Input, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';

import { getProfile } from '@/services/profileService';
import {
  deleteSavedPlace,
  getSavedPlace,
  updateSavedPlace,
} from '@/services/savedPlacesService';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { trackEvent } from '@/lib/analytics';
import { useTheme } from '@/lib/theme';
import type { Profile, RadiusUnit, SavedPlaceWithPlace } from '@/types';

type RadiusMode = 'default' | 'miles' | 'minutes';

function modeFromSaved(s: SavedPlaceWithPlace): RadiusMode {
  if (s.radius_unit === 'miles') return 'miles';
  if (s.radius_unit === 'minutes') return 'minutes';
  return 'default';
}

function formatUnit(value: number, unit: RadiusUnit): string {
  const noun = unit === 'miles' ? (value === 1 ? 'mile' : 'miles') : value === 1 ? 'minute' : 'minutes';
  return `${value} ${noun}`;
}

function sourceDisplay(saved: SavedPlaceWithPlace): string | null {
  switch (saved.source_type) {
    case 'instagram':
      return 'Saved from Instagram';
    case 'tiktok':
      return 'Saved from TikTok';
    case 'link':
      return 'Saved from a link';
    default:
      return null;
  }
}

function sourceActionLabel(saved: SavedPlaceWithPlace): string {
  if (saved.source_type === 'link') return 'Open original link';
  return 'View original post';
}

function reminderDistanceSummary(
  mode: RadiusMode,
  profile: Profile | null,
  milesText: string,
  minutesText: string,
): string {
  if (mode === 'default') {
    if (!profile) return 'Using your usual nearby reminder setting';
    return 'Using your usual nearby reminder setting';
  }
  if (mode === 'miles') {
    const parsed = Number.parseFloat(milesText);
    return Number.isFinite(parsed) && parsed > 0
      ? 'Using a custom distance reminder'
      : 'Custom reminder distance';
  }
  const parsed = Number.parseInt(minutesText, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? 'Using a custom time-away reminder'
    : 'Custom reminder timing';
}

export default function PlaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  const [saved, setSaved] = useState<SavedPlaceWithPlace | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // editable state
  const [notifyOn, setNotifyOn] = useState(true);
  const [mode, setMode] = useState<RadiusMode>('default');
  const [milesText, setMilesText] = useState('1');
  const [minutesText, setMinutesText] = useState('10');
  const [notes, setNotes] = useState('');
  const [reminderSettingsExpanded, setReminderSettingsExpanded] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setLoadError(null);
    try {
      const [s, p] = await Promise.all([getSavedPlace(id), getProfile()]);
      if (!s) {
        setLoadError('This place no longer exists.');
        setSaved(null);
      } else {
        setSaved(s);
        void trackEvent('place_detail_opened', {
          saved_place_id: s.id,
          google_place_id: s.place.google_place_id ?? null,
          source_type: s.source_type ?? null,
        });
        setNotifyOn(s.notifications_enabled);
        setMode(modeFromSaved(s));
        if (s.radius_unit === 'miles' && s.radius_value != null) {
          setMilesText(String(s.radius_value));
        }
        if (s.radius_unit === 'minutes' && s.radius_value != null) {
          setMinutesText(String(s.radius_value));
        }
        setNotes(s.notes ?? '');
        setReminderSettingsExpanded(false);
      }
      setProfile(p);
    } catch (e: any) {
      setLoadError(e?.message ?? 'Could not load this place.');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const sourceLabel = useMemo(() => (saved ? sourceDisplay(saved) : null), [saved]);

  const dirty = useMemo(() => {
    if (!saved) return false;

    const nextNotes = notes.trim() ? notes.trim() : null;
    const savedNotes = saved.notes ?? null;

    if (notifyOn !== saved.notifications_enabled) return true;
    if (nextNotes !== savedNotes) return true;

    if (mode === 'default') {
      return saved.radius_unit !== null || saved.radius_value !== null;
    }

    if (mode === 'miles') {
      const parsedMiles = Number.parseFloat(milesText);
      if (!Number.isFinite(parsedMiles) || parsedMiles <= 0) return true;
      return saved.radius_unit !== 'miles' || saved.radius_value !== parsedMiles;
    }

    const parsedMinutes = Number.parseInt(minutesText, 10);
    if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) return true;
    return saved.radius_unit !== 'minutes' || saved.radius_value !== parsedMinutes;
  }, [milesText, minutesText, mode, notes, notifyOn, saved]);

  const radiusHelperText = useMemo(() => {
    if (mode === 'default') {
      return profile
        ? `Use your usual reminder distance: ${formatUnit(
            profile.default_radius_value,
            profile.default_radius_unit,
          )}.`
        : 'Use your usual reminder distance.';
    }
    if (mode === 'miles') {
      const parsed = Number.parseFloat(milesText);
      return Number.isFinite(parsed) && parsed > 0
        ? `Remind me when I’m within ${formatUnit(parsed, 'miles')}.`
        : 'Remind me when I’m within this many miles.';
    }
    const parsed = Number.parseInt(minutesText, 10);
    return Number.isFinite(parsed) && parsed > 0
      ? `Remind me when I’m about ${formatUnit(parsed, 'minutes')} away.`
      : 'Remind me when I’m about this many minutes away.';
  }, [milesText, minutesText, mode, profile]);

  const reminderSummary = useMemo(
    () => reminderDistanceSummary(mode, profile, milesText, minutesText),
    [milesText, minutesText, mode, profile],
  );

  async function handleSave() {
    if (!saved) return;

    let radiusValue: number | null = null;
    let radiusUnit: RadiusUnit | null = null;
    if (mode === 'miles') {
      const n = Number.parseFloat(milesText);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Invalid reminder distance', 'Enter a positive number of miles.');
        return;
      }
      radiusValue = n;
      radiusUnit = 'miles';
    } else if (mode === 'minutes') {
      const n = Number.parseInt(minutesText, 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Invalid reminder distance', 'Enter a positive number of minutes.');
        return;
      }
      radiusValue = n;
      radiusUnit = 'minutes';
    }

    setSaving(true);
    try {
      await updateSavedPlace(saved.id, {
        radius_value: radiusValue,
        radius_unit: radiusUnit,
        notifications_enabled: notifyOn,
        notes: notes.trim() ? notes.trim() : null,
      });
      router.back();
    } catch (e: any) {
      Alert.alert('Save failed', e?.message ?? 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
    if (!saved) return;
    Alert.alert(
      'Remove place?',
      `${saved.place.name} will be removed from your saved places.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setDeleting(true);
            // Snapshot first so a failed delete can be rolled back, then
            // optimistically remove from the shared cache so the marker
            // disappears from the already-mounted Map the instant we pop back.
            const snapshot = getSavedPlacesCacheSnapshot();
            removeSavedPlaceFromCache(saved.id);
            try {
              await deleteSavedPlace(saved.id);
              router.back();
            } catch (e: any) {
              restoreSavedPlacesCache(snapshot);
              Alert.alert('Delete failed', e?.message ?? 'Unknown error.');
            } finally {
              setDeleting(false);
            }
          },
        },
      ],
    );
  }

  if (loading) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Place details' }} />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (loadError || !saved) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Place details' }} />
        <Card>
          <Text style={[typography.bodyStrong, { color: colors.danger }]}>
            {loadError ?? 'Place not found.'}
          </Text>
          <View style={{ height: Spacing.md }} />
          <Button title="Go back" variant="secondary" onPress={() => router.back()} />
        </Card>
      </Screen>
    );
  }

  const place = saved.place;
  const sourceText = saved.source_url ?? null;
  const sourceActionText = sourceActionLabel(saved);

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: 'Place details' }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={styles.heroCard}>
          <Text style={typography.heading}>{place.name}</Text>
          {place.formatted_address ? (
            <Text style={[typography.body, styles.muted]}>{place.formatted_address}</Text>
          ) : null}
          {place.category ? (
            <Text style={[typography.caption, styles.metaText]}>
              {place.category}
            </Text>
          ) : null}
          {sourceText ? (
            <View style={styles.sourceRow}>
              {sourceLabel ? (
                <Text style={[typography.caption, styles.sourceText]} numberOfLines={1}>
                  {sourceLabel}
                </Text>
              ) : null}
              <Pressable
                onPress={() => Linking.openURL(sourceText).catch(() => undefined)}
                style={({ pressed }) => [
                  styles.sourceAction,
                  pressed && styles.sourceActionPressed,
                ]}
              >
                <Text style={[typography.bodyStrong, styles.linkText]} numberOfLines={1}>
                  {sourceActionText}
                </Text>
                <Feather name="arrow-up-right" size={18} color={colors.accent} />
              </Pressable>
            </View>
          ) : null}
        </Card>

        <Button
          title="Get directions"
          onPress={() => {
            router.replace({
              pathname: '/(tabs)/map',
              params: { savedPlaceId: saved.id },
            });
          }}
        />

        <View style={{ height: Spacing.md }} />

        <Card style={styles.sectionCard}>
          <View style={styles.rowBetween}>
            <View style={{ flex: 1 }}>
              <Text style={typography.bodyStrong}>Nearby reminder</Text>
              <Text style={[typography.caption, styles.muted, styles.sectionCopy]}>
                {notifyOn
                  ? 'Nearr will remind you when you’re nearby.'
                  : 'Turn this on if you want Nearr to remind you nearby.'}
              </Text>
            </View>
            <Switch value={notifyOn} onValueChange={setNotifyOn} />
          </View>

          <View style={styles.reminderSummaryRow}>
            <Text style={[typography.caption, styles.helperText, styles.reminderSummaryText]}>
              {notifyOn ? reminderSummary : 'Nearby reminder is off'}
            </Text>
            <Pressable
              onPress={() => setReminderSettingsExpanded((value) => !value)}
              hitSlop={12}
            >
              <Text style={styles.changeLink}>
                {reminderSettingsExpanded ? 'Hide' : 'Change'}
              </Text>
            </Pressable>
          </View>

          {reminderSettingsExpanded ? (
            <View style={styles.advancedWrap}>
              <Text style={[typography.bodyStrong, styles.advancedTitle]}>
                Reminder settings
              </Text>
              <View style={styles.radiusGroup}>
                <RadiusOption
                  label="Default"
                  active={mode === 'default'}
                  onPress={() => setMode('default')}
                />
                <RadiusOption
                  label="Distance"
                  active={mode === 'miles'}
                  onPress={() => setMode('miles')}
                />
                <RadiusOption
                  label="Time"
                  active={mode === 'minutes'}
                  onPress={() => setMode('minutes')}
                />
              </View>
              <Text style={[typography.caption, styles.helperText]}>{radiusHelperText}</Text>
              {mode === 'miles' ? (
                <Input
                  value={milesText}
                  onChangeText={setMilesText}
                  keyboardType="decimal-pad"
                  placeholder="e.g. 1.5"
                  style={styles.numberInput}
                />
              ) : null}
              {mode === 'minutes' ? (
                <Input
                  value={minutesText}
                  onChangeText={setMinutesText}
                  keyboardType="number-pad"
                  placeholder="e.g. 10"
                  style={styles.numberInput}
                />
              ) : null}
            </View>
          ) : null}
        </Card>

        <View style={{ height: Spacing.md }} />

        <Card style={styles.sectionCard}>
          <Text style={[typography.bodyStrong, { marginBottom: Spacing.sm }]}>Your note</Text>
          <Input
            value={notes}
            onChangeText={setNotes}
            placeholder="What should you remember about this place?"
            multiline
            style={styles.notesInput}
          />
        </Card>

        {dirty ? (
          <>
            <View style={{ height: Spacing.lg }} />
            <Button
              title="Save changes"
              variant="secondary"
              onPress={handleSave}
              loading={saving}
            />
          </>
        ) : null}
        <View style={{ height: Spacing.sm }} />
        <Button
          title="Remove from saved"
          variant="ghost"
          onPress={confirmDelete}
          loading={deleting}
          style={styles.deleteBtn}
        />
      </ScrollView>
    </Screen>
  );
}

function RadiusOption({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  return (
    <Pressable
      onPress={onPress}
      style={[styles.radiusOption, active && styles.radiusOptionActive]}
    >
      <Text
        style={[
          typography.label,
          { color: active ? colors.textInverse : colors.text },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
    center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
    heroCard: { marginBottom: Spacing.md, backgroundColor: colors.surfaceElevated },
    sectionCard: { backgroundColor: colors.surfaceElevated },
    muted: { color: colors.textSecondary },
    metaText: { color: colors.textMuted, marginTop: 2 },
    sourceRow: { marginTop: Spacing.md },
    sourceText: { color: colors.textSecondary, marginBottom: Spacing.sm },
    sourceAction: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
    },
    sourceActionPressed: {
      opacity: 0.75,
    },
    linkText: { color: colors.accent },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    sectionCopy: {
      marginTop: 2,
    },
    reminderSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
      marginTop: Spacing.md,
    },
    reminderSummaryText: {
      flex: 1,
      marginBottom: 0,
    },
    changeLink: {
      ...typography.label,
      color: colors.accent,
    },
    advancedWrap: {
      marginTop: Spacing.md,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    advancedTitle: {
      marginBottom: Spacing.sm,
    },
    radiusGroup: {
      flexDirection: 'row',
      gap: Spacing.sm,
      marginBottom: Spacing.sm,
    },
    helperText: {
      color: colors.textSecondary,
      marginBottom: Spacing.md,
    },
    radiusOption: {
      flex: 1,
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      alignItems: 'center',
    },
    radiusOptionActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    numberInput: { marginBottom: Spacing.sm },
    notesInput: { minHeight: 60, textAlignVertical: 'top' },
    deleteBtn: { borderWidth: 0 },
  });
}
