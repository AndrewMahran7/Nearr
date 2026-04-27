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
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Card, Input, Screen } from '@/components';
import { Colors, Radius, Spacing, Typography } from '@/constants';

import { getProfile } from '@/services/profileService';
import {
  deleteSavedPlace,
  getSavedPlace,
  updateSavedPlace,
} from '@/services/savedPlacesService';
import type { Profile, RadiusUnit, SavedPlaceWithPlace } from '@/types';

type RadiusMode = 'default' | 'miles' | 'minutes';

function modeFromSaved(s: SavedPlaceWithPlace): RadiusMode {
  if (s.radius_unit === 'miles') return 'miles';
  if (s.radius_unit === 'minutes') return 'minutes';
  return 'default';
}

export default function PlaceDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

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
        setNotifyOn(s.notifications_enabled);
        setMode(modeFromSaved(s));
        if (s.radius_unit === 'miles' && s.radius_value != null) {
          setMilesText(String(s.radius_value));
        }
        if (s.radius_unit === 'minutes' && s.radius_value != null) {
          setMinutesText(String(s.radius_value));
        }
        setNotes(s.notes ?? '');
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

  const defaultRadiusLabel = useMemo(() => {
    if (!profile) return 'Profile default';
    return `${profile.default_radius_value} ${profile.default_radius_unit}`;
  }, [profile]);

  async function handleSave() {
    if (!saved) return;

    let radiusValue: number | null = null;
    let radiusUnit: RadiusUnit | null = null;
    if (mode === 'miles') {
      const n = Number.parseFloat(milesText);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Invalid radius', 'Enter a positive number of miles.');
        return;
      }
      radiusValue = n;
      radiusUnit = 'miles';
    } else if (mode === 'minutes') {
      const n = Number.parseInt(minutesText, 10);
      if (!Number.isFinite(n) || n <= 0) {
        Alert.alert('Invalid radius', 'Enter a positive number of minutes.');
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
            try {
              await deleteSavedPlace(saved.id);
              router.back();
            } catch (e: any) {
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
        <Stack.Screen options={{ title: 'Place' }} />
        <View style={styles.center}>
          <ActivityIndicator />
        </View>
      </Screen>
    );
  }

  if (loadError || !saved) {
    return (
      <Screen>
        <Stack.Screen options={{ title: 'Place' }} />
        <Card>
          <Text style={[Typography.bodyStrong, { color: Colors.danger }]}>
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

  return (
    <Screen padded={false}>
      <Stack.Screen options={{ title: place.name }} />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Card style={{ marginBottom: Spacing.lg }}>
          <Text style={Typography.heading}>{place.name}</Text>
          {place.formatted_address ? (
            <Text style={[Typography.body, styles.muted]}>{place.formatted_address}</Text>
          ) : null}
          {place.category ? (
            <Text style={[Typography.caption, styles.muted, { marginTop: 2 }]}>
              {place.category}
            </Text>
          ) : null}
          {sourceText ? (
            <Pressable
              onPress={() => Linking.openURL(sourceText).catch(() => undefined)}
              style={{ marginTop: Spacing.md }}
            >
              <Text style={[Typography.caption, { color: Colors.accent }]} numberOfLines={1}>
                Source: {sourceText}
              </Text>
            </Pressable>
          ) : null}
        </Card>

        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={Typography.bodyStrong}>Notifications</Text>
            <Text style={[Typography.caption, styles.muted]}>
              Notify me when I&apos;m nearby.
            </Text>
          </View>
          <Switch value={notifyOn} onValueChange={setNotifyOn} />
        </View>

        <View style={styles.divider} />

        <Text style={[Typography.bodyStrong, { marginBottom: Spacing.sm }]}>
          Notification radius
        </Text>
        <View style={styles.radiusGroup}>
          <RadiusOption
            label={`Default (${defaultRadiusLabel})`}
            active={mode === 'default'}
            onPress={() => setMode('default')}
          />
          <RadiusOption
            label="Miles"
            active={mode === 'miles'}
            onPress={() => setMode('miles')}
          />
          <RadiusOption
            label="Minutes"
            active={mode === 'minutes'}
            onPress={() => setMode('minutes')}
          />
        </View>
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

        <View style={styles.divider} />

        <Text style={[Typography.bodyStrong, { marginBottom: Spacing.sm }]}>Notes</Text>
        <Input
          value={notes}
          onChangeText={setNotes}
          placeholder="Why you saved this..."
          multiline
          style={styles.notesInput}
        />

        <View style={{ height: Spacing.xl }} />
        <Button title="Save changes" onPress={handleSave} loading={saving} />
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
  return (
    <Pressable
      onPress={onPress}
      style={[styles.radiusOption, active && styles.radiusOptionActive]}
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

const styles = StyleSheet.create({
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xxl },
  center: { paddingVertical: Spacing.xxl, alignItems: 'center' },
  muted: { color: Colors.textMuted },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: Spacing.lg,
  },
  radiusGroup: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  radiusOption: {
    flex: 1,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.pill,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
  },
  radiusOptionActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  numberInput: { marginBottom: Spacing.sm },
  notesInput: { minHeight: 80, textAlignVertical: 'top' },
  deleteBtn: { borderWidth: 0 },
});
