/**
 * SelectedPlaceDetails — the editable saved-place details panel shown inside
 * the EXPANDED map bottom sheet (app/(tabs)/map.tsx).
 *
 * This moves the "normal use" actions off the standalone `/place/[id]`
 * screen and onto the map, so the primary flow is:
 *   tap marker → collapsed sheet → slide up → edit here.
 *
 * It reuses the SAME services + shared-cache API as the detail screen
 * (`updateSavedPlace` / `deleteSavedPlace` + `updateSavedPlacesCache` /
 * `removeSavedPlaceFromCache` / snapshot-restore) — no duplicated Supabase
 * calls, and offline mutations keep surfacing the friendly
 * `OfflineMutationError` message. The `/place/[id]` route is untouched and
 * still available as a deep-link / fallback.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Button, Card, Input } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { deleteSavedPlace, updateSavedPlace } from '@/services/savedPlacesService';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  updateSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { getPlaceRichDetails, type PlaceRichDetails } from '@/services/placesService';
import type { Profile, RadiusUnit, SavedPlaceWithPlace } from '@/types';

const richDetailsCache = new Map<string, PlaceRichDetails | null>();
const richDetailsInFlight = new Map<string, Promise<PlaceRichDetails | null>>();

async function fetchRichDetailsCached(
  googlePlaceId: string,
): Promise<PlaceRichDetails | null> {
  const cached = richDetailsCache.get(googlePlaceId);
  if (cached !== undefined) return cached;

  const inflight = richDetailsInFlight.get(googlePlaceId);
  if (inflight) return inflight;

  const promise = getPlaceRichDetails(googlePlaceId, { maxPhotos: 5, maxPhotoWidth: 1000 })
    .then((details) => {
      richDetailsCache.set(googlePlaceId, details);
      return details;
    })
    .catch((err) => {
      console.debug('[map] rich details unavailable', {
        googlePlaceId,
        message: err instanceof Error ? err.message : String(err),
      });
      richDetailsCache.set(googlePlaceId, null);
      return null;
    })
    .finally(() => {
      richDetailsInFlight.delete(googlePlaceId);
    });

  richDetailsInFlight.set(googlePlaceId, promise);
  return promise;
}

type RadiusMode = 'default' | 'miles' | 'minutes';

function modeFromSaved(s: SavedPlaceWithPlace): RadiusMode {
  if (s.radius_unit === 'miles') return 'miles';
  if (s.radius_unit === 'minutes') return 'minutes';
  return 'default';
}

function formatUnit(value: number, unit: RadiusUnit): string {
  const noun =
    unit === 'miles'
      ? value === 1
        ? 'mile'
        : 'miles'
      : value === 1
        ? 'minute'
        : 'minutes';
  return `${value} ${noun}`;
}

function sourceActionLabel(saved: SavedPlaceWithPlace): string {
  switch (saved.source_type) {
    case 'tiktok':
      return 'Open TikTok';
    case 'instagram':
      return 'Open Instagram';
    case 'link':
      return 'Open link';
    default:
      return 'Open original';
  }
}

function sanitizePhoneForTel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const hasPlusPrefix = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return `${hasPlusPrefix ? '+' : ''}${digits}`;
}

function normalizeWebsiteUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed);
    const candidate = hasScheme ? trimmed : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (!parsed.hostname) return null;
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

type Props = {
  saved: SavedPlaceWithPlace;
  profile: Profile | null;
  /** Open the platform maps app for this place (map screen owns this). */
  onGetDirections: () => void;
  /** Called after a successful delete so the map can dismiss the sheet. */
  onRequestDismiss: () => void;
  /** Called after a successful save so the map can refresh its `selected`. */
  onSaved?: (updated: SavedPlaceWithPlace) => void;
};

export function SelectedPlaceDetails({
  saved,
  profile,
  onGetDirections,
  onRequestDismiss,
  onSaved,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  const [notifyOn, setNotifyOn] = useState(saved.notifications_enabled);
  const [mode, setMode] = useState<RadiusMode>(modeFromSaved(saved));
  const [milesText, setMilesText] = useState(
    saved.radius_unit === 'miles' && saved.radius_value != null
      ? String(saved.radius_value)
      : '1',
  );
  const [minutesText, setMinutesText] = useState(
    saved.radius_unit === 'minutes' && saved.radius_value != null
      ? String(saved.radius_value)
      : '10',
  );
  const [notes, setNotes] = useState(saved.notes ?? '');
  const [reminderSettingsExpanded, setReminderSettingsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [richDetails, setRichDetails] = useState<PlaceRichDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, true>>({});

  const googlePlaceId =
    saved.place.google_place_id && saved.place.google_place_id.trim()
      ? saved.place.google_place_id.trim()
      : null;

  // Re-seed the editable state whenever a DIFFERENT place is selected. Keyed
  // on id so switching markers never shows the previous place's edits.
  useEffect(() => {
    setNotifyOn(saved.notifications_enabled);
    setMode(modeFromSaved(saved));
    setMilesText(
      saved.radius_unit === 'miles' && saved.radius_value != null
        ? String(saved.radius_value)
        : '1',
    );
    setMinutesText(
      saved.radius_unit === 'minutes' && saved.radius_value != null
        ? String(saved.radius_value)
        : '10',
    );
    setNotes(saved.notes ?? '');
    setReminderSettingsExpanded(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.id]);

  useEffect(() => {
    let canceled = false;
    setFailedPhotoUrls({});
    if (!googlePlaceId) {
      setRichDetails(null);
      setDetailsLoading(false);
      return () => {
        canceled = true;
      };
    }

    setDetailsLoading(true);
    void fetchRichDetailsCached(googlePlaceId)
      .then((details) => {
        if (!canceled) setRichDetails(details);
      })
      .finally(() => {
        if (!canceled) setDetailsLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [googlePlaceId]);

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

  const dirty = useMemo(() => {
    const nextNotes = notes.trim() ? notes.trim() : null;
    const savedNotes = saved.notes ?? null;
    if (notifyOn !== saved.notifications_enabled) return true;
    if (nextNotes !== savedNotes) return true;
    if (mode === 'default') {
      return saved.radius_unit !== null || saved.radius_value !== null;
    }
    if (mode === 'miles') {
      const parsed = Number.parseFloat(milesText);
      if (!Number.isFinite(parsed) || parsed <= 0) return true;
      return saved.radius_unit !== 'miles' || saved.radius_value !== parsed;
    }
    const parsed = Number.parseInt(minutesText, 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return true;
    return saved.radius_unit !== 'minutes' || saved.radius_value !== parsed;
  }, [milesText, minutesText, mode, notes, notifyOn, saved]);

  // Only offer the "open original" affordance when a non-empty source URL is
  // actually stored (share/paste flows). Manual saves have none → no button.
  const sourceUrl =
    saved.source_url && saved.source_url.trim() ? saved.source_url.trim() : null;

  const photoUrls = useMemo(() => {
    if (!richDetails?.photoUrls?.length) return [];
    return richDetails.photoUrls.filter((url) => !failedPhotoUrls[url]).slice(0, 5);
  }, [failedPhotoUrls, richDetails?.photoUrls]);

  const phoneRaw =
    richDetails?.internationalPhoneNumber ??
    richDetails?.formattedPhoneNumber ??
    null;
  const callablePhone = sanitizePhoneForTel(phoneRaw);
  const websiteUrl = normalizeWebsiteUrl(richDetails?.websiteUrl ?? null);

  async function openExternalUrl(args: {
    rawUrl: string | null;
    label: string;
    messageWhenUnavailable: string;
  }) {
    const raw = args.rawUrl?.trim();
    if (!raw) return;
    try {
      const canOpen = await Linking.canOpenURL(raw);
      if (!canOpen) {
        Alert.alert(
          `Couldn't open ${args.label.toLowerCase()}`,
          args.messageWhenUnavailable,
        );
        return;
      }
      await Linking.openURL(raw);
    } catch {
      Alert.alert(
        `Couldn't open ${args.label.toLowerCase()}`,
        `The ${args.label.toLowerCase()} could not be opened.`,
      );
    }
  }

  async function openSource() {
    await openExternalUrl({
      rawUrl: sourceUrl,
      label: sourceActionLabel(saved),
      messageWhenUnavailable: 'No app is available to open this source link.',
    });
  }

  async function openWebsite() {
    await openExternalUrl({
      rawUrl: websiteUrl,
      label: 'Website',
      messageWhenUnavailable: 'No browser is available to open this website.',
    });
  }

  async function callPlace() {
    if (!callablePhone) return;
    const telUrl = `tel:${callablePhone}`;
    try {
      const canOpen = await Linking.canOpenURL(telUrl);
      if (!canOpen) {
        Alert.alert(
          "Couldn't place call",
          'Calling is not available on this device.',
        );
        return;
      }
      await Linking.openURL(telUrl);
    } catch {
      Alert.alert("Couldn't place call", 'The phone number could not be dialed.');
    }
  }

  async function handleSave() {
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

    const nextNotes = notes.trim() ? notes.trim() : null;
    setSaving(true);
    try {
      await updateSavedPlace(saved.id, {
        radius_value: radiusValue,
        radius_unit: radiusUnit,
        notifications_enabled: notifyOn,
        notes: nextNotes,
      });
      // Push the new values into the shared cache so the map markers/list and
      // the sheet header stay consistent without a network refetch.
      const updated: SavedPlaceWithPlace = {
        ...saved,
        radius_value: radiusValue,
        radius_unit: radiusUnit,
        notifications_enabled: notifyOn,
        notes: nextNotes,
      };
      updateSavedPlacesCache((prev) =>
        prev.map((row) => (row.id === saved.id ? updated : row)),
      );
      void trackEvent('place_updated', {
        saved_place_id: saved.id,
        notifications_enabled: notifyOn,
      });
      onSaved?.(updated);
    } catch (e: any) {
      // Offline mutations throw OfflineMutationError whose message is the
      // friendly "Internet required to update saved places." string.
      Alert.alert('Save failed', e?.message ?? 'Unknown error.');
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete() {
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
            // Snapshot first so a failed delete can roll back, then
            // optimistically remove from the shared cache so the marker
            // disappears from the map instantly.
            const snapshot = getSavedPlacesCacheSnapshot();
            removeSavedPlaceFromCache(saved.id);
            try {
              await deleteSavedPlace(saved.id);
              onRequestDismiss();
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

  return (
    <View style={styles.wrap}>
      {detailsLoading ? (
        <View style={styles.photoLoadingWrap}>
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={[typography.caption, styles.muted]}>Loading photos…</Text>
        </View>
      ) : photoUrls.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.photoStripContent}
          style={styles.photoStrip}
          nestedScrollEnabled
        >
          {photoUrls.map((url) => (
            <Image
              key={url}
              source={{ uri: url }}
              style={styles.photoTile}
              resizeMode="cover"
              onError={() => {
                setFailedPhotoUrls((prev) => ({ ...prev, [url]: true }));
              }}
            />
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.quickActionsRow}>
        <ActionPill
          label="Directions"
          icon="navigation"
          onPress={onGetDirections}
          styles={styles}
        />
        {callablePhone ? (
          <ActionPill
            label="Call"
            icon="phone"
            onPress={() => {
              void callPlace();
            }}
            styles={styles}
          />
        ) : null}
        {websiteUrl ? (
          <ActionPill
            label="Website"
            icon="globe"
            onPress={() => {
              void openWebsite();
            }}
            styles={styles}
          />
        ) : null}
        {sourceUrl ? (
          <ActionPill
            label={sourceActionLabel(saved)}
            icon="arrow-up-right"
            onPress={() => {
              void openSource();
            }}
            styles={styles}
          />
        ) : null}
      </View>

      <Card style={styles.sectionCard}>
        <View style={styles.rowBetween}>
          <View style={{ flex: 1 }}>
            <Text style={typography.bodyStrong}>Nearby reminder</Text>
            <Text style={[typography.caption, styles.muted, styles.sectionCopy]}>
              {notifyOn
                ? 'Nearr will remind you when you’re nearby.'
                : 'Turn this on to be reminded when you’re nearby.'}
            </Text>
          </View>
          <Switch value={notifyOn} onValueChange={setNotifyOn} />
        </View>

        <View style={styles.reminderSummaryRow}>
          <Text style={[typography.caption, styles.helperText, { flex: 1 }]}>
            {notifyOn ? radiusHelperText : 'Nearby reminder is off'}
          </Text>
          {notifyOn ? (
            <Pressable onPress={() => setReminderSettingsExpanded((v) => !v)} hitSlop={12}>
              <Text style={styles.changeLink}>
                {reminderSettingsExpanded ? 'Hide' : 'Change'}
              </Text>
            </Pressable>
          ) : null}
        </View>

        {notifyOn && reminderSettingsExpanded ? (
          <View style={styles.advancedWrap}>
            <View style={styles.radiusGroup}>
              <RadiusOption label="Default" active={mode === 'default'} onPress={() => setMode('default')} />
              <RadiusOption label="Distance" active={mode === 'miles'} onPress={() => setMode('miles')} />
              <RadiusOption label="Time" active={mode === 'minutes'} onPress={() => setMode('minutes')} />
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
          </View>
        ) : null}
      </Card>

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
        <Button
          title="Save changes"
          variant="secondary"
          onPress={handleSave}
          loading={saving}
          style={styles.saveBtn}
        />
      ) : null}

      <Button
        title="Remove from saved"
        variant="ghost"
        onPress={confirmDelete}
        loading={deleting}
        style={styles.deleteBtn}
      />
    </View>
  );
}

function ActionPill({
  label,
  icon,
  onPress,
  styles,
}: {
  label: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.actionPill, pressed && styles.pressed]}>
      <Feather name={icon} size={16} color={colors.accent} />
      <Text style={[typography.caption, styles.actionPillText]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
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
      <Text style={[styles.radiusOptionText, active && styles.radiusOptionTextActive]}>
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
    wrap: { gap: Spacing.md },
    muted: { color: colors.textMuted },
    pressed: { opacity: 0.6 },
    photoLoadingWrap: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      minHeight: 28,
    },
    photoStrip: { maxHeight: 124 },
    photoStripContent: { gap: Spacing.sm, paddingRight: Spacing.sm },
    photoTile: {
      width: 160,
      height: 112,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
    },
    quickActionsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
      gap: Spacing.sm,
      marginTop: Spacing.xs,
    },
    actionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.pill,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
      minHeight: 44,
      width: '48.5%',
    },
    actionPillText: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 13,
    },
    sectionCard: { padding: Spacing.md, gap: Spacing.sm },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
    },
    sectionCopy: { marginTop: 2 },
    reminderSummaryRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.sm,
    },
    helperText: { color: colors.textSecondary },
    changeLink: {
      ...typography.bodyStrong,
      color: colors.accent,
    },
    advancedWrap: { gap: Spacing.sm, marginTop: Spacing.xs },
    radiusGroup: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    radiusOption: {
      flex: 1,
      paddingVertical: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      backgroundColor: colors.surface,
    },
    radiusOptionActive: {
      borderColor: colors.primary,
      backgroundColor: colors.surfaceElevated,
    },
    radiusOptionText: {
      ...typography.caption,
      color: colors.textSecondary,
    },
    radiusOptionTextActive: {
      color: colors.text,
      fontWeight: '700',
    },
    numberInput: { marginTop: Spacing.xs },
    notesInput: { minHeight: 72, textAlignVertical: 'top' },
    saveBtn: { width: '100%' },
    deleteBtn: { marginTop: -Spacing.xs },
  });
}
