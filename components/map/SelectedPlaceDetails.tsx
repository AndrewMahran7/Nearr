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
 * `OfflineMutationError` message. The `/place/[id]` compatibility route now
 * redirects here so this remains the single presentation owner.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  Share,
  StyleSheet,
  Switch,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input } from '@/components';
import { WrongPlaceSheet } from '@/components/map/WrongPlaceSheet';
import { NoteEditorModal } from '@/components/map/NoteEditorModal';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { trackEvent } from '@/lib/analytics';
import { applySavedPlaceEdit } from '@/lib/savedPlaceEdits';
import {
  cancelNoteEditor,
  commitNoteEditor,
  openNoteEditor,
  type NoteEditorState,
} from '@/lib/noteEditor';
import { buildSavedPlaceShareContent } from '@/lib/placeShare';
import { reminderStatusLabel, savedPlaceNarrative } from '@/lib/placeDetailUi';
import { savedPlaceRemovalCopy } from '@/lib/savedPlaceRemoval';
import { adjacentPrefetchTargets, pageIndexFromOffset } from '@/lib/photoCarousel';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { deleteSavedPlace, updateSavedPlace } from '@/services/savedPlacesService';
import { CATEGORY_LABELS, savedPlaceCategory } from '@/lib/placeCategory';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  updateSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { getCachedPlaceRichDetails } from '@/lib/placeRichDetailsCache';
import type { PlaceRichDetails } from '@/services/placesService';
import type { Profile, RadiusUnit, SavedPlaceWithPlace } from '@/types';

const GALLERY_CARD_GAP = 18;
/** Focus treatment for non-centered pages. Interpolated from scroll offset. */
const GALLERY_INACTIVE_OPACITY = 0.45;
const GALLERY_INACTIVE_SCALE = 0.92;

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
    case 'instagram':
      return 'Watch post';
    case 'link':
      return 'Open link';
    default:
      return 'Open original';
  }
}

/** Consumer-legible cue for where the save came from. Never shows a raw URL. */
function sourceActionIcon(saved: SavedPlaceWithPlace): keyof typeof Feather.glyphMap {
  switch (saved.source_type) {
    case 'tiktok':
      return 'video';
    case 'instagram':
      return 'instagram';
    case 'link':
      return 'link';
    default:
      return 'arrow-up-right';
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
  onCorrected?: (updated: SavedPlaceWithPlace) => void;
};

export function SelectedPlaceDetails({
  saved,
  profile,
  onGetDirections,
  onRequestDismiss,
  onSaved,
  onCorrected,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();

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
  const [notes, setNotes] = useState(() => saved.notes ?? '');
  const [noteEditor, setNoteEditor] = useState<NoteEditorState>(() => ({
    ...openNoteEditor(saved.notes),
    open: false,
  }));
  const [reminderSettingsExpanded, setReminderSettingsExpanded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [richDetails, setRichDetails] = useState<PlaceRichDetails | null>(null);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [failedPhotoUrls, setFailedPhotoUrls] = useState<Record<string, true>>({});
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
  const [galleryOpenSeed, setGalleryOpenSeed] = useState(0);
  const [wrongPlaceOpen, setWrongPlaceOpen] = useState(false);
  const galleryStartYRef = useRef(0);
  const galleryListRef = useRef<FlatList<string> | null>(null);
  // Native-thread scroll position. Owns the focus dimming so the centered
  // photo never waits on a JS re-render to look active.
  const galleryScrollX = useRef(new Animated.Value(0)).current;
  // Mirrors galleryIndex for effects that must NOT re-run as the index changes.
  const galleryIndexRef = useRef(0);
  galleryIndexRef.current = galleryIndex;
  // Photos already handed to the image loader for this mounted sheet. Bounded
  // by the place's photo list (max 5) and released when the sheet unmounts.
  const prefetchedPhotoUrlsRef = useRef<Set<string>>(new Set());

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
    setNoteEditor({ ...openNoteEditor(saved.notes), open: false });
    setReminderSettingsExpanded(false);
    setWrongPlaceOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.id]);

  // Provider correction intentionally keeps saved.id stable. Re-seed the
  // provider-derived presentation when that association changes in place.
  useEffect(() => {
    setRichDetails(null);
    setFailedPhotoUrls({});
  }, [saved.place.google_place_id]);

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
    void getCachedPlaceRichDetails(googlePlaceId)
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
    if (notifyOn !== saved.notifications_enabled) return true;
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
  }, [milesText, minutesText, mode, notifyOn, saved]);

  // Only offer the "open original" affordance when a non-empty source URL is
  // actually stored (share/paste flows). Manual saves have none → no button.
  const sourceUrl =
    saved.source_url && saved.source_url.trim() ? saved.source_url.trim() : null;

  const photoUrls = useMemo(() => {
    if (!richDetails?.photoUrls?.length) return [];
    return richDetails.photoUrls.filter((url) => !failedPhotoUrls[url]).slice(0, 5);
  }, [failedPhotoUrls, richDetails?.photoUrls]);

  const safeGalleryIndex = useMemo(() => {
    if (photoUrls.length === 0) return 0;
    return Math.max(0, Math.min(galleryIndex, photoUrls.length - 1));
  }, [galleryIndex, photoUrls.length]);

  const galleryListKey = useMemo(
    () => `gallery-${galleryOpenSeed}-${photoUrls.length}`,
    [galleryOpenSeed, photoUrls.length],
  );

  const galleryCardWidth = useMemo(
    () => Math.max(220, Math.round(viewportWidth * 0.76)),
    [viewportWidth],
  );
  const galleryCardHeight = useMemo(
    () => Math.max(220, Math.round(viewportHeight * 0.54)),
    [viewportHeight],
  );
  const gallerySideSpacing = useMemo(
    () => Math.max(0, Math.round((viewportWidth - galleryCardWidth) / 2)),
    [galleryCardWidth, viewportWidth],
  );
  const gallerySnapInterval = useMemo(
    () => galleryCardWidth + GALLERY_CARD_GAP,
    [galleryCardWidth],
  );

  // One native-driven scroll binding. The JS listener only advances the page
  // counter/dots/prefetch window — the visible brightness never depends on it,
  // and setState is skipped entirely while the page is unchanged.
  const handleGalleryScroll = useMemo(
    () =>
      Animated.event(
        [{ nativeEvent: { contentOffset: { x: galleryScrollX } } }],
        {
          useNativeDriver: true,
          listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
            const next = pageIndexFromOffset(
              event.nativeEvent.contentOffset.x,
              gallerySnapInterval,
              photoUrls.length,
            );
            setGalleryIndex((current) => (current === next ? current : next));
          },
        },
      ),
    [galleryScrollX, gallerySnapInterval, photoUrls.length],
  );

  const locality = splitPlaceAddress(saved.place.formatted_address).locality;
  const categoryLabel = CATEGORY_LABELS[savedPlaceCategory(saved)];
  // Persisted source cue (saved_places.ai_note) + the user's own note, kept
  // strictly separate. Read from the live row every render (not captured into
  // state) because enrichment can land well after the initial save — map.tsx
  // re-points `selected` at the refreshed cached row when that happens.
  const narrative = useMemo(
    () => savedPlaceNarrative({ notes, ai_note: saved.ai_note }),
    [notes, saved.ai_note],
  );
  const reminderStatus = useMemo(
    () => reminderStatusLabel({
      enabled: notifyOn,
      mode,
      profile,
      milesText,
      minutesText,
    }),
    [milesText, minutesText, mode, notifyOn, profile],
  );

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

  // Sharing prefers the ORIGINAL public source the place came from — especially
  // its social post — and only falls back to Google Maps when none is usable.
  // Temporary media, internal endpoints, and
  // signed URLs are rejected by lib/placeShare.ts. No private fields (notes,
  // reminder settings, ids) are ever included.
  async function sharePlace() {
    const content = buildSavedPlaceShareContent(saved);
    void trackEvent('place_shared', {
      saved_place_id: saved.id,
      google_place_id: saved.place.google_place_id ?? null,
      has_url: !!content.url,
      share_kind: content.kind,
    });
    if (!content.url) {
      Alert.alert("Couldn't share this place", 'No public source or map link is available.');
      return;
    }
    try {
      await Share.share(
        { message: content.message, title: content.title, url: content.url },
        { subject: content.title },
      );
    } catch (err) {
      // User cancellation on Android rejects the promise — treat as a no-op.
      if (__DEV__) console.debug('[map] share place dismissed', err);
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

    setSaving(true);
    try {
      await updateSavedPlace(saved.id, {
        radius_value: radiusValue,
        radius_unit: radiusUnit,
        notifications_enabled: notifyOn,
      });
      // Push the new values into the shared cache so the map markers/list and
      // the sheet header stay consistent without a network refetch.
      const updated = applySavedPlaceEdit(saved, {
        radius_value: radiusValue,
        radius_unit: radiusUnit,
        notifications_enabled: notifyOn,
      });
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

  function beginNoteEdit(useAiSuggestion = false) {
    setNoteEditor(openNoteEditor(notes, saved.ai_note, useAiSuggestion));
  }

  async function saveNote(nextNotes: string | null) {
    await updateSavedPlace(saved.id, { notes: nextNotes });
    const updated = applySavedPlaceEdit(saved, { notes: nextNotes });
    updateSavedPlacesCache((current) =>
      current.map((row) => (row.id === saved.id ? updated : row)),
    );
    setNotes(nextNotes ?? '');
    setNoteEditor((current) => commitNoteEditor({ ...current, draft: nextNotes ?? '' }).state);
    onSaved?.(updated);
  }

  function openGalleryAt(index: number) {
    if (photoUrls.length === 0) return;
    const nextIndex = Math.max(0, Math.min(index, photoUrls.length - 1));
    setGalleryIndex(nextIndex);
    // Seed the animated offset so the opened page renders bright on its very
    // first frame instead of fading up once the first scroll event lands.
    galleryScrollX.setValue(nextIndex * gallerySnapInterval);
    setGalleryOpenSeed((s) => s + 1);
    setGalleryOpen(true);
  }

  function closeGallery() {
    setGalleryOpen(false);
  }

  // Restore the opened page's offset ONCE per open. This must not depend on
  // `galleryIndex`: that now updates continuously while scrolling, and
  // re-running scrollToOffset mid-gesture would fight the user's drag.
  useEffect(() => {
    if (!galleryOpen || photoUrls.length === 0) return;
    const targetIndex = Math.max(0, Math.min(galleryIndexRef.current, photoUrls.length - 1));
    const frameId = requestAnimationFrame(() => {
      galleryListRef.current?.scrollToOffset({
        offset: targetIndex * gallerySnapInterval,
        animated: false,
      });
    });
    return () => cancelAnimationFrame(frameId);
  }, [galleryOpen, galleryOpenSeed, gallerySnapInterval, photoUrls.length]);

  // Warm the neighbours of the centered photo while the gallery is open — the
  // user has shown intent to browse. Bounded to one page each side, deduped
  // per open sheet, and never runs for a single-photo place, so this cannot
  // turn into background downloading of every saved place's gallery.
  useEffect(() => {
    if (!galleryOpen) return;
    const targets = adjacentPrefetchTargets(photoUrls, galleryIndex);
    for (const url of targets) {
      if (prefetchedPhotoUrlsRef.current.has(url)) continue;
      prefetchedPhotoUrlsRef.current.add(url);
      // Fire-and-forget: a failed warm-up must never surface to the user, and
      // the <Image> below still requests the photo normally.
      void Image.prefetch(url).catch(() => undefined);
    }
  }, [galleryIndex, galleryOpen, photoUrls]);

  const galleryPanResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_evt, gestureState) => {
          const { dx, dy } = gestureState;
          if (dy <= 8) return false;
          return Math.abs(dy) > Math.abs(dx) * 1.2;
        },
        onPanResponderGrant: (_evt, gestureState) => {
          galleryStartYRef.current = gestureState.moveY;
        },
        onPanResponderRelease: (_evt, gestureState) => {
          const movedDown = gestureState.moveY - galleryStartYRef.current;
          if (movedDown > 90 && Math.abs(gestureState.dy) > Math.abs(gestureState.dx) * 1.2) {
            closeGallery();
          }
        },
        onPanResponderTerminate: () => undefined,
      }),
    [],
  );

  function confirmDelete() {
    const copy = savedPlaceRemovalCopy(saved.place.name);
    Alert.alert(
      copy.title,
      copy.message,
      [
        { text: copy.cancelLabel, style: 'cancel' },
        {
          text: copy.confirmLabel,
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
      {/* Hero: the photo carries the page. Name + context sit ON the image
          under a layered scrim so the first thing read is the place itself,
          not a stack of equal-weight cards. The same geometry is used when
          there is no photo, so the layout never jumps once photos resolve. */}
      <Pressable
        disabled={photoUrls.length === 0}
        onPress={() => openGalleryAt(0)}
        accessibilityRole={photoUrls.length > 0 ? 'button' : undefined}
        accessibilityLabel={photoUrls.length > 0 ? `View photos of ${saved.place.name}` : undefined}
        style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
      >
        {photoUrls[0] ? (
          <Image
            source={{ uri: photoUrls[0] }}
            style={styles.heroImage}
            resizeMode="cover"
            onError={() => setFailedPhotoUrls((prev) => ({ ...prev, [photoUrls[0]!]: true }))}
          />
        ) : (
          <View style={styles.heroFallback}>
            {detailsLoading ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Feather name="map-pin" size={34} color={colors.accent} />
            )}
          </View>
        )}

        {/* Stacked bands stand in for a gradient (no gradient dependency in
            this project). Keeps the title legible over any photograph. */}
        <View pointerEvents="none" style={styles.heroScrimSoft} />
        <View pointerEvents="none" style={styles.heroScrimMid} />
        <View pointerEvents="none" style={styles.heroScrimStrong} />

        {photoUrls.length > 1 ? (
          <View style={styles.photoCountPill}>
            <Feather name="image" size={13} color="#FFFFFF" />
            <Text style={styles.photoCountText}>{photoUrls.length}</Text>
          </View>
        ) : null}

        <View pointerEvents="none" style={styles.heroCaption}>
          <Text accessibilityRole="header" style={styles.placeName} numberOfLines={3}>
            {saved.place.name}
          </Text>
          <View style={styles.heroMetaRow}>
            <View style={styles.categoryPill}>
              <Text style={styles.categoryPillText} numberOfLines={1}>{categoryLabel}</Text>
            </View>
            {locality ? (
              <Text style={styles.heroLocality} numberOfLines={1}>{locality}</Text>
            ) : null}
          </View>
        </View>
      </Pressable>

      {photoUrls.length > 0 ? (
        <Modal
          visible={galleryOpen}
          animationType="fade"
          transparent
          onRequestClose={closeGallery}
          statusBarTranslucent
        >
          <View style={styles.galleryBackdrop}>
            <View style={[styles.galleryCounterWrap, { top: insets.top + Spacing.md }]}>
              <View style={styles.galleryCounterPill}>
                <Text style={styles.galleryCounterText}>
                  {safeGalleryIndex + 1} / {photoUrls.length}
                </Text>
              </View>
            </View>

            <Pressable
              style={[styles.galleryCloseButton, { top: insets.top + Spacing.sm }]}
              onPress={closeGallery}
              accessibilityRole="button"
              accessibilityLabel="Close photo gallery"
            >
              <Feather name="x" size={22} color="#FFFFFF" />
            </Pressable>

            <View style={styles.galleryCarouselArea} {...galleryPanResponder.panHandlers}>
              {/* Focus dimming is driven by the NATIVE scroll offset, not by
                  React state. The centered page reaches full opacity exactly
                  as it centers — mid-drag, mid-momentum, and while the JS
                  thread is busy. `galleryIndex` below only backs the counter,
                  the dots, and the prefetch window. */}
              <Animated.FlatList
                ref={galleryListRef}
                key={galleryListKey}
                data={photoUrls}
                horizontal
                snapToInterval={gallerySnapInterval}
                snapToAlignment="start"
                decelerationRate="fast"
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: gallerySideSpacing }}
                initialScrollIndex={safeGalleryIndex}
                scrollEventThrottle={16}
                onScroll={handleGalleryScroll}
                getItemLayout={(_data: unknown, index: number) => ({
                  length: gallerySnapInterval,
                  offset: gallerySnapInterval * index,
                  index,
                })}
                onScrollToIndexFailed={(info: { index: number }) => {
                  const safeIndex = Math.max(0, Math.min(info.index, photoUrls.length - 1));
                  setGalleryIndex(safeIndex);
                  requestAnimationFrame(() => {
                    galleryListRef.current?.scrollToOffset({
                      offset: safeIndex * gallerySnapInterval,
                      animated: false,
                    });
                  });
                }}
                keyExtractor={(url: string) => `gallery-${url}`}
                renderItem={({ item, index }: { item: string; index: number }) => {
                  // Centered => 1; one page away in either direction => dimmed.
                  const inputRange = [
                    (index - 1) * gallerySnapInterval,
                    index * gallerySnapInterval,
                    (index + 1) * gallerySnapInterval,
                  ];
                  const opacity = galleryScrollX.interpolate({
                    inputRange,
                    outputRange: [GALLERY_INACTIVE_OPACITY, 1, GALLERY_INACTIVE_OPACITY],
                    extrapolate: 'clamp',
                  });
                  const scale = galleryScrollX.interpolate({
                    inputRange,
                    outputRange: [GALLERY_INACTIVE_SCALE, 1, GALLERY_INACTIVE_SCALE],
                    extrapolate: 'clamp',
                  });
                  return (
                    <Animated.View
                      style={[
                        styles.galleryItem,
                        {
                          opacity,
                          transform: [{ scale }],
                          width: galleryCardWidth,
                          marginRight: index === photoUrls.length - 1 ? 0 : GALLERY_CARD_GAP,
                        },
                      ]}
                    >
                      <View
                        style={[
                          styles.galleryPhotoShell,
                          { width: galleryCardWidth, height: galleryCardHeight },
                        ]}
                      >
                        <Image
                          source={{ uri: item }}
                          style={styles.galleryImage}
                          resizeMode="cover"
                        />
                      </View>
                    </Animated.View>
                  );
                }}
              />
            </View>

            <View style={styles.galleryDots}>
              {photoUrls.map((url, index) => (
                <View
                  key={`dot-${url}`}
                  style={[styles.galleryDot, index === safeGalleryIndex && styles.galleryDotActive]}
                />
              ))}
            </View>

            <Text style={styles.galleryHint}>↓ Swipe down to close</Text>
          </View>
        </Modal>
      ) : null}

      {/* Going there is the point of the page, so Directions is the only
          filled action; everything else is a quiet companion. */}
      <View style={styles.quickActionsRow}>
        <Pressable
          onPress={onGetDirections}
          accessibilityRole="button"
          accessibilityLabel={`Get directions to ${saved.place.name}`}
          style={({ pressed }) => [styles.primaryAction, pressed && styles.pressed]}
        >
          <Feather name="navigation" size={17} color={colors.textInverse} />
          <Text style={styles.primaryActionText}>Directions</Text>
        </Pressable>
        {sourceUrl ? (
          <ActionPill
            label={sourceActionLabel(saved)}
            a11yLabel={`${sourceActionLabel(saved)} for ${saved.place.name}`}
            icon={sourceActionIcon(saved)}
            onPress={() => {
              void openSource();
            }}
            styles={styles}
          />
        ) : null}
        <ActionPill
          label="Share"
          a11yLabel={`Share ${saved.place.name}`}
          icon="share"
          onPress={() => {
            void sharePlace();
          }}
          styles={styles}
        />
      </View>

      {/* The emotional core: why this place looked worth saving. Rendered only
          when a source cue was actually persisted — an empty state here would
          read as broken rather than intentional. */}
      {narrative.showSourceNote ? (
        <View style={styles.sourceNoteCard} accessibilityLiveRegion="polite">
          <View style={styles.sourceNoteAccent} />
          <View style={styles.sourceNoteBody}>
            <Text style={styles.sourceNoteLabel}>WHY YOU SAVED IT</Text>
            <Text style={styles.sourceNoteText}>{narrative.sourceNote}</Text>
            {narrative.canPromoteSourceNote ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Use this as my note"
                onPress={() => beginNoteEdit(true)}
                style={styles.textAction}
              >
                <Text style={styles.changeLink}>Use as my note</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {narrative.userNote ? (
        <View style={styles.personalSection}>
          <View style={styles.rowBetween}>
            <Text style={styles.sectionTitle}>Your note</Text>
            <Pressable
              onPress={() => beginNoteEdit()}
              accessibilityRole="button"
              accessibilityLabel="Edit your note"
              style={styles.textAction}
            >
              <Text style={styles.changeLink}>Edit</Text>
            </Pressable>
          </View>
          <Text style={[typography.body, styles.noteText]}>{narrative.userNote}</Text>
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add your own note"
          onPress={() => beginNoteEdit()}
          style={({ pressed }) => [styles.addNoteRow, pressed && styles.pressed]}
        >
          <Feather name="edit-3" size={16} color={colors.accent} />
          <Text style={styles.changeLink}>Add your own note</Text>
        </Pressable>
      )}

      {/* Compact by design: useful, but it must not outweigh the place. The
          whole row toggles distance settings; the switch stays a separate
          target so enabling/disabling is never an accidental expand. */}
      <View style={styles.reminderCard}>
        <View style={styles.reminderRow}>
          <Pressable
            onPress={() => {
              if (notifyOn) setReminderSettingsExpanded((value) => !value);
            }}
            disabled={!notifyOn}
            accessibilityRole={notifyOn ? 'button' : undefined}
            accessibilityLabel={notifyOn ? `Nearby reminder, ${reminderStatus}. Change distance` : undefined}
            accessibilityState={{ expanded: reminderSettingsExpanded }}
            style={({ pressed }) => [styles.reminderIdentity, pressed && notifyOn && styles.pressed]}
          >
            <Feather name="bell" size={16} color={notifyOn ? colors.accent : colors.textMuted} />
            <Text style={styles.reminderTitle} numberOfLines={1}>Nearby reminder</Text>
            <Text style={styles.reminderStatus} numberOfLines={1}>{reminderStatus}</Text>
            {notifyOn ? (
              <Feather
                name={reminderSettingsExpanded ? 'chevron-up' : 'chevron-down'}
                size={16}
                color={colors.textMuted}
              />
            ) : null}
          </Pressable>
          <Switch
            value={notifyOn}
            onValueChange={setNotifyOn}
            accessibilityLabel="Nearby reminder"
          />
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
            <Text style={[typography.caption, styles.helperText]}>{radiusHelperText}</Text>
          </View>
        ) : null}
      </View>

      {dirty ? (
        <Button
          title="Save changes"
          variant="secondary"
          onPress={handleSave}
          loading={saving}
          style={styles.saveBtn}
        />
      ) : null}

      {/* Management actions stay reachable but never compete with the place
          or with Directions. */}
      <View style={styles.manageRow}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Wrong place? Correct this saved place"
          onPress={() => setWrongPlaceOpen(true)}
          style={({ pressed }) => [styles.manageAction, pressed && styles.pressed]}
        >
          <Text style={styles.manageText}>Wrong place?</Text>
        </Pressable>
        <View style={styles.manageDivider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${saved.place.name} from saved places`}
          onPress={confirmDelete}
          disabled={deleting}
          style={({ pressed }) => [styles.manageAction, pressed && styles.pressed]}
        >
          {deleting ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Text style={styles.manageText}>Remove</Text>
          )}
        </Pressable>
      </View>

      <WrongPlaceSheet
        visible={wrongPlaceOpen}
        saved={saved}
        actingUserId={session?.user?.id ?? null}
        extractedName={saved.place.name}
        onClose={() => setWrongPlaceOpen(false)}
        onCorrected={(updated) => {
          onSaved?.(updated);
          onCorrected?.(updated);
          setWrongPlaceOpen(false);
        }}
      />
      <NoteEditorModal
        visible={noteEditor.open}
        initialValue={noteEditor.draft}
        aiNote={saved.ai_note}
        onClose={() => setNoteEditor((current) => cancelNoteEditor(current))}
        onSave={saveNote}
      />
    </View>
  );
}

function ActionPill({
  label,
  a11yLabel,
  icon,
  onPress,
  styles,
}: {
  label: string;
  a11yLabel?: string;
  icon: keyof typeof Feather.glyphMap;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  const { colors, typography } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      style={({ pressed }) => [styles.actionPill, pressed && styles.pressed]}
    >
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
    pressed: { opacity: 0.6 },
    hero: {
      height: 250,
      borderRadius: Radius.lg,
      overflow: 'hidden',
      backgroundColor: colors.surface,
      justifyContent: 'flex-end',
    },
    heroPressed: { opacity: 0.92 },
    heroImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
    heroFallback: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    // Three stacked bands approximate a bottom-up gradient without pulling in
    // a gradient dependency. Tuned so white type stays legible on bright food
    // photography as well as dark interiors.
    heroScrimSoft: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: '62%',
      backgroundColor: 'rgba(0,0,0,0.18)',
    },
    heroScrimMid: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: '40%',
      backgroundColor: 'rgba(0,0,0,0.32)',
    },
    heroScrimStrong: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      height: '22%',
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    photoCountPill: {
      position: 'absolute',
      right: Spacing.md,
      top: Spacing.md,
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.55)',
    },
    photoCountText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
    heroCaption: {
      paddingHorizontal: Spacing.lg,
      paddingBottom: Spacing.lg,
      gap: Spacing.sm,
    },
    placeName: {
      ...typography.title,
      color: '#FFFFFF',
      fontSize: 27,
      lineHeight: 32,
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 6,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    heroLocality: {
      ...typography.caption,
      flexShrink: 1,
      color: 'rgba(255,255,255,0.86)',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },
    categoryPill: {
      alignSelf: 'flex-start',
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(255,106,26,0.92)',
    },
    categoryPillText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
    galleryBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.96)',
    },
    galleryCloseButton: {
      position: 'absolute',
      right: 22,
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.16)',
      zIndex: 6,
    },
    galleryCounterWrap: {
      position: 'absolute',
      left: 0,
      right: 0,
      alignItems: 'center',
      zIndex: 5,
    },
    galleryCounterPill: {
      paddingHorizontal: 10,
      paddingVertical: 4,
      borderRadius: 999,
      backgroundColor: 'rgba(0,0,0,0.65)',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.18)',
    },
    galleryCounterText: {
      ...typography.caption,
      color: '#FFFFFF',
      fontWeight: '700',
    },
    galleryCarouselArea: {
      flex: 1,
      justifyContent: 'center',
      zIndex: 2,
      paddingTop: 64,
      paddingBottom: 118,
    },
    galleryItem: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Spacing.md,
    },
    galleryPhotoShell: {
      borderRadius: 18,
      overflow: 'hidden',
      backgroundColor: 'transparent',
    },
    galleryImage: {
      width: '100%',
      height: '100%',
      borderRadius: 18,
      shadowColor: '#000000',
      shadowOpacity: 0.26,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    galleryDots: {
      position: 'absolute',
      bottom: 82,
      left: 0,
      right: 0,
      flexDirection: 'row',
      justifyContent: 'center',
      gap: 8,
      zIndex: 4,
    },
    galleryDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
      backgroundColor: 'rgba(255,255,255,0.35)',
    },
    galleryDotActive: {
      width: 7,
      height: 7,
      borderRadius: 3.5,
      backgroundColor: '#FFFFFF',
    },
    galleryHint: {
      position: 'absolute',
      bottom: 48,
      left: 0,
      right: 0,
      zIndex: 4,
      ...typography.caption,
      textAlign: 'center',
      color: 'rgba(255,255,255,0.65)',
    },
    quickActionsRow: {
      flexDirection: 'row',
      gap: Spacing.sm,
    },
    primaryAction: {
      flex: 1.25,
      minWidth: 0,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
    },
    primaryActionText: {
      color: colors.textInverse,
      fontWeight: '800',
      fontSize: 14,
    },
    actionPill: {
      flex: 1,
      minWidth: 0,
      minHeight: 52,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      paddingHorizontal: Spacing.sm,
    },
    actionPillText: {
      color: colors.text,
      fontWeight: '700',
      fontSize: 12,
    },
    sectionTitle: { ...typography.bodyStrong, color: colors.text },
    personalSection: { gap: Spacing.xs },
    // The source cue reads as a quote from the post, not as another form row.
    sourceNoteCard: {
      flexDirection: 'row',
      borderRadius: Radius.md,
      overflow: 'hidden',
      backgroundColor: 'rgba(255,106,26,0.09)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: 'rgba(255,106,26,0.28)',
    },
    sourceNoteAccent: { width: 3, backgroundColor: colors.accent },
    sourceNoteBody: {
      flex: 1,
      gap: 6,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
    },
    sourceNoteLabel: {
      ...typography.caption,
      color: colors.accent,
      fontWeight: '800',
      letterSpacing: 0.7,
      fontSize: 11,
    },
    sourceNoteText: {
      ...typography.body,
      color: colors.text,
      lineHeight: 23,
    },
    textAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    addNoteRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      minHeight: 48,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    reminderCard: {
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingHorizontal: Spacing.md,
    },
    reminderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      minHeight: 56,
    },
    reminderIdentity: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      minHeight: 48,
    },
    reminderTitle: { ...typography.body, color: colors.text, flexShrink: 1 },
    reminderStatus: {
      ...typography.caption,
      color: colors.textSecondary,
      flexShrink: 1,
      marginLeft: 'auto',
    },
    rowBetween: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Spacing.md,
    },
    helperText: { color: colors.textSecondary },
    changeLink: {
      ...typography.bodyStrong,
      color: colors.accent,
    },
    advancedWrap: {
      gap: Spacing.sm,
      paddingTop: Spacing.md,
      paddingBottom: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
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
    noteText: { color: colors.textSecondary, lineHeight: 22 },
    saveBtn: { width: '100%' },
    manageRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.md,
      paddingTop: Spacing.xs,
    },
    manageAction: {
      minHeight: 44,
      paddingHorizontal: Spacing.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    manageText: { ...typography.caption, color: colors.textMuted, fontWeight: '600' },
    manageDivider: {
      width: StyleSheet.hairlineWidth,
      height: 14,
      backgroundColor: colors.border,
    },
  });
}
