/**
 * SelectedPlaceDetails — THE canonical saved-place detail experience, shown
 * inside the EXPANDED map sheet (app/(tabs)/map.tsx).
 *
 * Every entry point converges here: a marker tap, the saved list, a completed
 * queue row, a single nearby notification, a member of a grouped notification,
 * and an "Also nearby" card. `/place/[id]` and `/opportunity/[id]` are thin
 * redirects into this same sheet, so there is exactly one presentation owner.
 *
 * Composition, top to bottom:
 *   action row (Directions · Watch post · Share │ nearby reminder)
 *   hero photo, with name / category / locality over it
 *   today's hours, in the VENUE's timezone or omitted
 *   Saved because…  (or "Your note" for a manual save)
 *   Did you go yet?
 *   Also nearby
 *   management footer (Wrong place? · Remove)
 *
 * Things that are deliberately true here:
 *   - It reuses the SAME services + shared-cache API as every other surface
 *     (`updateSavedPlace` / `deleteSavedPlace` + `updateSavedPlacesCache` /
 *     `removeSavedPlaceFromCache` / snapshot-restore) — no duplicated Supabase
 *     calls, and offline mutations keep surfacing the friendly
 *     `OfflineMutationError` message.
 *   - Nothing here is restaurant-shaped. A city, an island, a beach or a
 *     landmark has no address, no hours and no source post; each of those
 *     sections omits itself rather than rendering an empty shell.
 *   - Hours ride along on the one cached rich-details request this sheet
 *     already makes for photos. No extra provider call, no backend change.
 *   - Nearby-reminder ELIGIBILITY is untouched by this pass. The control is
 *     currently offered for every saved place, including a whole city, where a
 *     proximity radius is a questionable idea; that is a backend/reminder
 *     semantics question, deliberately left for its own task rather than
 *     silently changed here.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  FlatList,
  Image,
  Linking,
  Modal,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Input } from '@/components';
import { WrongPlaceSheet } from '@/components/map/WrongPlaceSheet';
import { NoteEditorModal } from '@/components/map/NoteEditorModal';
import { RecommendedPlaceDetails } from '@/components/map/RecommendedPlaceDetails';
import { PlaceCardRow } from '@/components/map/place/PlaceCardRow';
import { ReminderToggle } from '@/components/map/place/ReminderToggle';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { trackEvent } from '@/lib/analytics';
import {
  advanceOnboardingV2PlaceTour,
} from '@/lib/onboardingV2';
import type { OnboardingPlaceTourStep } from '@/lib/onboardingV2Core';
import { createOnceLatch, type OnceLatch } from '@/lib/onceLatch';
import { isPlaceRecommendationsEnabled } from '@/lib/featureFlags';
import { applySavedPlaceEdit } from '@/lib/savedPlaceEdits';
import {
  cancelNoteEditor,
  commitNoteEditor,
  openNoteEditor,
  type NoteEditorState,
} from '@/lib/noteEditor';
import { buildSavedPlaceShareContent } from '@/lib/placeShare';
import {
  reminderDistanceLabel,
  reminderStatusLabel,
  visitedDisplay,
  whySavedDisplay,
} from '@/lib/placeDetailUi';
import { describeTodayHours } from '@/lib/placeHours';
import {
  formatNearbyDistance,
  savedPlaceDistanceMeters,
  selectAlsoNearby,
} from '@/lib/alsoNearby';
import { selectSameSourcePlaces } from '@/lib/sameSourcePlaces';
import { savedPlaceRemovalCopy } from '@/lib/savedPlaceRemoval';
import {
  adjacentPrefetchTargets,
  galleryBackdropOpacity,
  galleryDragOffset,
  pageIndexFromOffset,
  shouldDismissGalleryOnRelease,
  GALLERY_DISMISS_ACTIVATE_DY,
  GALLERY_DISMISS_FAIL_DX,
  GALLERY_DISMISS_FAIL_DY,
} from '@/lib/photoCarousel';
import { resolvePlaceSource } from '@/lib/placeSource';
import { placeSourceCards, shouldShowMoreVideos } from '@/lib/placeSources';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { deleteSavedPlace, markVisited, updateSavedPlace } from '@/services/savedPlacesService';
import { CATEGORY_LABELS, savedPlaceCategory, type NearrCategory } from '@/lib/placeCategory';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  updateSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { getCachedPlaceRichDetails } from '@/lib/placeRichDetailsCache';
import { loadPlaceRecommendations } from '@/services/placeRecommendationsService';
import type { PlaceRecommendation } from '@/lib/placeRecommendations';
import type { NearbyMapExplorerPayload } from '@/lib/nearbyMapExplorer';
import type { PlaceCandidate, PlaceRichDetails } from '@/services/placesService';
import type { RadiusUnit, SavedPlaceWithPlace } from '@/types';

const GALLERY_CARD_GAP = 18;
/** Focus treatment for non-centered pages. Interpolated from scroll offset. */
const GALLERY_INACTIVE_OPACITY = 0.45;
const GALLERY_INACTIVE_SCALE = 0.92;
/** How long the committed dismissal takes to carry the gallery off-screen. */
const GALLERY_DISMISS_EXIT_MS = 180;
/** Settle for a drag that did not earn a dismissal. */
const GALLERY_DISMISS_SPRING = { damping: 22, stiffness: 240 } as const;

/**
 * Category glyphs for the hero's context line. Ionicons only (already bundled
 * via @expo/vector-icons — no new dependency), and every Nearr category is
 * mapped, because Place Detail must read as well for an island or a city as it
 * does for a restaurant.
 */
const CATEGORY_ICONS: Record<NearrCategory, string> = {
  restaurant: 'restaurant-outline',
  cafe: 'cafe-outline',
  bakery: 'restaurant-outline',
  bar: 'beer-outline',
  brewery: 'beer-outline',
  winery: 'wine-outline',
  dessert: 'ice-cream-outline',
  hotel: 'bed-outline',
  resort: 'bed-outline',
  hiking_trail: 'trail-sign-outline',
  park: 'leaf-outline',
  beach: 'sunny-outline',
  waterfall: 'water-outline',
  lake: 'water-outline',
  marina: 'boat-outline',
  island: 'earth-outline',
  scenic_spot: 'telescope-outline',
  attraction: 'sparkles-outline',
  museum: 'color-palette-outline',
  entertainment: 'film-outline',
  shopping: 'bag-handle-outline',
  nightlife: 'musical-notes-outline',
  sports: 'football-outline',
  fitness: 'barbell-outline',
  wellness: 'flower-outline',
  transportation: 'train-outline',
  education: 'school-outline',
  service: 'construct-outline',
  other: 'location-outline',
};

/** Shared geometry for one band of the hero's stacked-band scrim. */
const heroScrimBand = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.09)',
};

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

// Platform label / brand mark / accessibility copy all come from ONE place now
// (lib/placeSource.ts), so Instagram and TikTok can never drift apart again.

type Props = {
  saved: SavedPlaceWithPlace;
  /** The user's whole saved collection, for the "Also nearby" row. */
  allSavedPlaces?: SavedPlaceWithPlace[];
  /** Provider identities from every save, including rows without map-safe coordinates. */
  savedProviderPlaceIds?: string[];
  /** Select another saved place by its exact row (map owns the selection). */
  onSelectNearby?: (next: SavedPlaceWithPlace) => void;
  /** Explicit save from an opened (still-unsaved) recommendation detail. */
  onSaveRecommendation?: (candidate: PlaceCandidate) => Promise<boolean>;
  /** Open the platform maps app for this place (map screen owns this). */
  onGetDirections: () => void;
  /**
   * Hand the current nearby projection to the production map. Used by
   * "See map" on Saved nearby / Also nearby; no route is pushed.
   */
  onSeeMap?: (payload: NearbyMapExplorerPayload) => void;
  /** Called after a successful delete so the map can dismiss the sheet. */
  onRequestDismiss: () => void;
  /** Called after a successful save so the map can refresh its `selected`. */
  onSaved?: (updated: SavedPlaceWithPlace) => void;
  onCorrected?: (updated: SavedPlaceWithPlace) => void;
};

export function SelectedPlaceDetails({
  saved,
  allSavedPlaces,
  savedProviderPlaceIds,
  onSelectNearby,
  onSaveRecommendation,
  onGetDirections,
  onSeeMap,
  onRequestDismiss,
  onSaved,
  onCorrected,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const { state: onboardingState } = useOnboardingV2();
  const onboardingTourStep = onboardingState?.stage === 'place_tour' &&
    onboardingState.tutorialSave?.savedPlaceId === saved.id
    ? onboardingState.placeTourStep
    : null;
  const onboardingTourAvailability = { aiNote: !!saved.ai_note?.trim(), source: !!saved.source_url?.trim() };
  const advanceOnboardingTour = () => {
    void advanceOnboardingV2PlaceTour(onboardingTourAvailability);
  };
  const skipOnboardingTour = () => {
    onRequestDismiss();
  };

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
  const [recommendations, setRecommendations] = useState<PlaceRecommendation[]>([]);
  const [recommendationsLoading, setRecommendationsLoading] = useState(false);
  const [selectedRecommendation, setSelectedRecommendation] = useState<PlaceRecommendation | null>(null);
  // Local mirror so "I went" flips the UI immediately; the row itself is
  // updated in the shared cache (never removed) so the map keeps the marker.
  const [visitedAt, setVisitedAt] = useState<string | null>(saved.visited_at ?? null);
  const [visitBusy, setVisitBusy] = useState(false);
  // Purely cosmetic acknowledgement of "Not yet" — no mutation, no persistence.
  const [visitDeferred, setVisitDeferred] = useState(false);
  useEffect(() => {
    setVisitedAt(saved.visited_at ?? null);
  }, [saved.id, saved.visited_at]);
  const galleryListRef = useRef<FlatList<string> | null>(null);
  // One latch per gallery opening. X, system back, and the swipe animation may
  // converge on the same close callback; only the first is allowed to mutate
  // modal state. A new opening receives a new latch.
  const galleryDismissLatchRef = useRef<OnceLatch | null>(null);
  // Interactive dismiss offset: the gallery follows the finger downward and
  // either continues off-screen or springs back. A Reanimated shared value, so
  // every frame of the drag runs on the UI thread — no setState, no re-render,
  // and no image reload while the finger is down.
  const galleryDragY = useSharedValue(0);
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
    setSelectedRecommendation(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.id]);

  const recommendationsEnabled = isPlaceRecommendationsEnabled();
  const recommendationSourceCategory = savedPlaceCategory(saved);
  const savedGooglePlaceIds = useMemo(
    () =>
      savedProviderPlaceIds ??
      (allSavedPlaces ?? [])
        .map((entry) => entry.place.google_place_id?.trim())
        .filter((id): id is string => !!id),
    [allSavedPlaces, savedProviderPlaceIds],
  );
  const savedGooglePlaceIdsKey = savedGooglePlaceIds.slice().sort().join('|');

  // Secondary and non-blocking: the saved detail paints independently, then
  // this one cached provider request fills (or quietly omits) the row.
  useEffect(() => {
    let canceled = false;
    if (!recommendationsEnabled) {
      setRecommendations([]);
      setRecommendationsLoading(false);
      return () => {
        canceled = true;
      };
    }

    setRecommendations([]);
    setRecommendationsLoading(true);
    void loadPlaceRecommendations({
      source: {
        googlePlaceId: saved.place.google_place_id,
        name: saved.place.name,
        latitude: saved.place.latitude,
        longitude: saved.place.longitude,
        category: recommendationSourceCategory,
      },
      savedGooglePlaceIds,
    }).then((next) => {
      if (canceled) return;
      setRecommendations(next);
      if (next.length > 0) {
        void trackEvent('recommendations_shown', {
          saved_place_id: saved.id,
          count: next.length,
          category: recommendationSourceCategory,
        });
      }
    }).finally(() => {
      if (!canceled) setRecommendationsLoading(false);
    });

    return () => {
      canceled = true;
    };
    // The sorted key makes saved-state changes invalidate filtering without
    // tying the request effect to array identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    recommendationSourceCategory,
    recommendationsEnabled,
    saved.id,
    saved.place.google_place_id,
    saved.place.latitude,
    saved.place.longitude,
    saved.place.name,
    savedGooglePlaceIdsKey,
  ]);

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
      // A category-aware distance applies. Not naming a specific number here
      // keeps the copy correct without exposing internal category buckets.
      return "We'll pick a sensible reminder distance for this type of place.";
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
  }, [milesText, minutesText, mode]);

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
  const sourceCards = useMemo(() => placeSourceCards(saved), [saved]);
  const primarySource = sourceCards.find((source) => source.primary) ?? sourceCards[0] ?? null;
  const sourceUrl = primarySource?.url ??
    (saved.source_url && saved.source_url.trim() ? saved.source_url.trim() : null);
  // Canonical `source_type` first, host only as a fallback. Null for manual
  // saves, which render NO source affordance rather than a fake platform.
  const sourceAttribution = useMemo(
    () => resolvePlaceSource(primarySource
      ? { source_type: primarySource.platform, source_url: primarySource.url }
      : saved),
    [primarySource, saved],
  );

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
  // A city / island / beach frequently has no street address at all, in which
  // case `locality` is null and the hero simply shows one less line.
  const categoryKey = savedPlaceCategory(saved);
  const categoryLabel = CATEGORY_LABELS[categoryKey];
  // Persisted source cue (saved_places.ai_note) + the user's own note, kept
  // strictly separate. Read from the live row every render (not captured into
  // state) because enrichment can land well after the initial save — map.tsx
  // re-points `selected` at the refreshed cached row when that happens.
  const whySaved = useMemo(
    () => whySavedDisplay({ notes, ai_note: saved.ai_note }),
    [notes, saved.ai_note],
  );
  const visited = useMemo(
    () => visitedDisplay({ visited_at: visitedAt }),
    [visitedAt],
  );
  /**
   * The user's other saves from the SAME post. A semantic relationship, so it
   * is deliberately not distance-bounded: one Nicaragua reel can hold Granada,
   * León and Ometepe, and they stay siblings however far apart they are.
   * Empty for a manual save, and empty when nothing else came from the post —
   * the section then renders nothing at all rather than an empty heading.
   */
  const sameSource = useMemo(
    () => selectSameSourcePlaces(saved, allSavedPlaces ?? []),
    [allSavedPlaces, saved],
  );
  const sameSourceIds = useMemo(
    () => sameSource.map((entry) => entry.id),
    [sameSource],
  );

  // The user's OWN saves near this one. Never a provider lookup.
  //
  // Same-post siblings are excluded so a place cannot appear under two
  // headings at once, and the freed slots fill with the next eligible saves.
  // `categoryOf` turns on the modest diversity preference — bounded by a ~2
  // mile detour budget, so a nearer place always wins a real distance contest.
  const alsoNearby = useMemo(
    () =>
      selectAlsoNearby(saved, allSavedPlaces ?? [], {
        excludeIds: sameSourceIds,
        categoryOf: savedPlaceCategory,
      }),
    [allSavedPlaces, saved, sameSourceIds],
  );
  // Same card shape as Also nearby, so the two rows read as one design system
  // — the heading is what distinguishes "from this post" from "near this".
  // Distance is shown when both places have coordinates, and omitted rather
  // than faked when one of them does not.
  const sameSourceEntries = useMemo(
    () =>
      sameSource.map((entry) => {
        const meters = savedPlaceDistanceMeters(saved, entry);
        const distance = meters === null ? null : formatNearbyDistance(meters);
        return {
          key: entry.id,
          name: entry.place.name,
          googlePlaceId: entry.place.google_place_id,
          meta: distance,
          a11yLabel: distance
            ? `Open ${entry.place.name}, also saved from this post, ${distance} away`
            : `Open ${entry.place.name}, also saved from this post`,
          onPress: () => onSelectNearby?.(entry),
        };
      }),
    [onSelectNearby, sameSource, saved],
  );

  // Built once per selection rather than on every render, so scrolling the
  // sheet or toggling a switch never rebuilds the row's card list.
  const alsoNearbyEntries = useMemo(
    () =>
      alsoNearby.map((entry) => ({
        key: entry.saved.id,
        name: entry.saved.place.name,
        googlePlaceId: entry.saved.place.google_place_id,
        meta: formatNearbyDistance(entry.distanceMeters),
        a11yLabel: `Open ${entry.saved.place.name}, ${formatNearbyDistance(entry.distanceMeters)} away`,
        onPress: () => onSelectNearby?.(entry.saved),
      })),
    [alsoNearby, onSelectNearby],
  );
  const recommendationEntries = useMemo(
    () =>
      recommendations.map((entry, index) => {
        const distance = formatNearbyDistance(entry.distanceMeters);
        const category = CATEGORY_LABELS[entry.nearrCategory];
        return {
          key: entry.googlePlaceId,
          name: entry.name,
          googlePlaceId: null,
          photoUrl: entry.photoUrl,
          saved: false,
          meta: `${category} · ${distance}`,
          a11yLabel: `Open ${entry.name}, ${category}, ${distance} away`,
          onPress: () => {
            setSelectedRecommendation(entry);
            void trackEvent('recommendation_opened', {
              source_saved_place_id: saved.id,
              google_place_id: entry.googlePlaceId,
              rank: index + 1,
            });
          },
        };
      }),
    [recommendations, saved.id],
  );
  const openNearbyMapExplorer = useCallback(() => {
    onSeeMap?.({
      anchor: saved,
      savedNearby: alsoNearby,
      alsoNearby: recommendations,
      recommendationsPending: recommendationsLoading,
    });
  }, [alsoNearby, onSeeMap, recommendations, recommendationsLoading, saved]);
  const reminderStatus = useMemo(
    () => reminderStatusLabel({
      enabled: notifyOn,
      mode,
      milesText,
      minutesText,
    }),
    [milesText, minutesText, mode, notifyOn],
  );
  // Just the magnitude for the compact action-row control; the adjacent switch
  // already communicates on/off.
  const reminderDistance = useMemo(
    () => reminderDistanceLabel({ mode, milesText, minutesText }),
    [milesText, minutesText, mode],
  );

  /**
   * Today's hours, in the VENUE's timezone.
   *
   * The data rides along on the rich-details request this sheet already makes
   * for photos — no extra provider call, no backend change. `describeTodayHours`
   * returns null whenever the truth is unknown (no published hours, or no
   * `utc_offset` to anchor the venue's clock), and the row below is omitted
   * entirely in that case. A city, a beach, or an island simply has no hours,
   * and that is a valid saved place, not a hole in the layout.
   */
  const todayHours = useMemo(
    () =>
      describeTodayHours({
        hours: richDetails?.openingHours,
        utcOffsetMinutes: richDetails?.utcOffsetMinutes,
      }),
    [richDetails?.openingHours, richDetails?.utcOffsetMinutes],
  );
  // Hold the row's height while the (cached) details resolve so the hero does
  // not visibly shove the rest of the sheet down a beat later.
  const hoursPending = detailsLoading && !!googlePlaceId && !todayHours;

  // ONE surface, headed by where it came from. A manual save has no post to
  // credit, so it is honestly labelled as the user's own note instead of
  // wearing a "saved because" frame with nothing behind it — and when there IS
  // a post but no reason yet, the heading states the fact we actually have
  // ("Saved from Instagram") rather than making an unanswered question the
  // centrepiece of the card.
  const savedBecauseLabel = !sourceAttribution
    ? 'Your note'
    : whySaved.text
      ? 'Saved because…'
      : `Saved from ${sourceAttribution.platformName}`;
  // Decided ONCE from the shared helper, so the heading's Edit affordance and
  // the body can never disagree about whether there is a note to show.
  const hasReason = !!whySaved.text;

  /**
   * The action row fits at every supported width WITHOUT a fallback layout.
   *
   * The previous pass used a `viewportWidth < 390` breakpoint and shipped
   * "Watch p…" plus a switch hanging off the right edge — on a 390pt iPhone,
   * where `390 < 390` is false and the inline layout ran anyway. Rather than
   * move the breakpoint, the fixed cost came down: the 51pt system `Switch`
   * became a 40pt `ReminderToggle`, the divider margins shrank, and the row
   * gap went to zero (each action carries its own padding).
   *
   * Remaining budget for the three actions, after 9pt divider + ~68pt bell
   * cluster + 40pt toggle:
   *   375pt viewport → 343 content → ~75pt each
   *   390pt          → 358         → ~80pt each
   *   430pt          → 398         → ~93pt each
   * The widest label, "Directions"/"Watch post" at 11pt semibold, measures
   * ~61pt. There is real headroom at the narrowest size, not one spare point.
   */
  const reminderCluster = (
    <>
      <Pressable
        onPress={() => {
          if (notifyOn) setReminderSettingsExpanded((value) => !value);
        }}
        disabled={!notifyOn}
        accessibilityRole={notifyOn ? 'button' : undefined}
        accessibilityLabel={
          notifyOn ? `Nearby reminder, ${reminderStatus}. Change distance` : undefined
        }
        accessibilityState={{ expanded: reminderSettingsExpanded }}
        style={({ pressed }) => [styles.reminderControl, pressed && notifyOn && styles.pressed]}
      >
        <Feather name="bell" size={16} color={notifyOn ? colors.accent : colors.textMuted} />
        <Text style={styles.reminderDistanceText} numberOfLines={1}>
          {notifyOn ? reminderDistance : 'Off'}
        </Text>
        {notifyOn ? (
          <Feather
            name={reminderSettingsExpanded ? 'chevron-down' : 'chevron-right'}
            size={13}
            color={colors.textMuted}
          />
        ) : null}
      </Pressable>
      <ReminderToggle
        value={notifyOn}
        onValueChange={setNotifyOn}
        accessibilityLabel={`Nearby reminder for ${saved.place.name}`}
      />
    </>
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
      label: sourceAttribution?.actionLabel ?? 'Open original',
      messageWhenUnavailable: 'No app is available to open this source link.',
    });
  }

  async function openSourceCard(url: string, platformName: string) {
    await openExternalUrl({
      rawUrl: url,
      label: `${platformName} post`,
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
    // A previous open may have ended by flinging the gallery off the bottom of
    // the screen. Clear that translation BEFORE the modal becomes visible so a
    // reopen never renders from the last gesture's resting position.
    galleryDragY.value = 0;
    galleryDismissLatchRef.current = createOnceLatch();
    setGalleryOpenSeed((s) => s + 1);
    setGalleryOpen(true);
  }

  // The one close path: the X button, the hardware/system back gesture, and a
  // committed swipe-down all end here, so no route leaves modal state behind.
  // Stable identity — the dismiss gesture calls it across the JS bridge.
  const closeGallery = useCallback(() => {
    if (!galleryDismissLatchRef.current?.acquire()) return;
    setGalleryOpen(false);
  }, []);

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

  /**
   * Swipe-down-to-dismiss.
   *
   * Why the previous two attempts did not hold: both were built on the JS
   * responder system (`PanResponder`), and on iOS the carousel is a real
   * `UIScrollView`. Its `panGestureRecognizer` begins after roughly 10pt of
   * movement in ANY direction and then cancels the touches feeding the JS
   * responder — so the dismiss layer was told the gesture had been terminated
   * at just about the distance it needed in order to claim it. Sometimes JS
   * saw one move sample past the threshold first and it worked; usually it did
   * not. That race is precisely the reported "does not reliably dismiss".
   *
   * The fix moves the arbitration to where the scroll view lives — native
   * gesture recognisers, via react-native-gesture-handler (already a
   * dependency, already rooted in app/_layout.tsx):
   *
   *   - `failOffsetX` / `failOffsetY` make the dismiss gesture FAIL the instant
   *     a drag shows sideways or upward intent.
   *   - `activeOffsetY` activates it only on decisively downward movement.
   *   - `blocksExternalGesture(galleryScrollGesture)` makes the carousel's own
   *     scroll recogniser WAIT for that verdict instead of racing it. Wrapping
   *     the list in `Gesture.Native()` is what lets RNGH recognise the
   *     UIScrollView's pan as a handler it may order.
   *
   * The result is a real directional lock: horizontal (and diagonal-horizontal)
   * drags page photos and can no longer dismiss, downward drags always reach
   * the dismiss layer, and neither side can steal the touch back mid-gesture.
   */
  const galleryScrollGesture = useMemo(() => Gesture.Native(), []);

  const galleryDismissGesture = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY(GALLERY_DISMISS_ACTIVATE_DY)
        .failOffsetX([-GALLERY_DISMISS_FAIL_DX, GALLERY_DISMISS_FAIL_DX])
        .failOffsetY(-GALLERY_DISMISS_FAIL_DY)
        .blocksExternalGesture(galleryScrollGesture)
        .onUpdate((event) => {
          // Downward-only: dragging back up settles at 0 rather than lifting
          // the gallery off the top of the screen.
          galleryDragY.value = galleryDragOffset(event.translationY);
        })
        .onEnd((event, success) => {
          const dismissing =
            success &&
            shouldDismissGalleryOnRelease({ dy: event.translationY, vy: event.velocityY });
          if (dismissing) {
            // Carry the motion off-screen instead of cutting to a fade, so the
            // dismissal reads as the continuation of the user's own gesture.
            // The modal is torn down only once that has finished, so there is
            // exactly one close path and no half-dismissed state.
            galleryDragY.value = withTiming(
              viewportHeight,
              { duration: GALLERY_DISMISS_EXIT_MS },
              (finished) => {
                // Resetting the shared value on an immediate reopen cancels an
                // old exit animation. Its callback still runs with
                // `finished=false`; never let it close the new opening.
                if (finished) runOnJS(closeGallery)();
              },
            );
            return;
          }
          galleryDragY.value = withSpring(0, GALLERY_DISMISS_SPRING);
        })
        .onFinalize((_event, success) => {
          // Interruption (a second finger, a system gesture) must not strand
          // the gallery part-way down the screen.
          if (!success) galleryDragY.value = withSpring(0, GALLERY_DISMISS_SPRING);
        }),
    [closeGallery, galleryDragY, galleryScrollGesture, viewportHeight],
  );

  // Both driven off the UI thread from the same shared value, so the backdrop
  // fade stays locked to the finger even while JS is busy.
  const galleryContentStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: galleryDragY.value }],
  }));
  const galleryBackdropStyle = useAnimatedStyle(() => ({
    opacity: galleryBackdropOpacity(galleryDragY.value, viewportHeight),
  }));

  /**
   * "I went" — record the visit WITHOUT deleting the memory.
   *
   * `markVisited` stamps `visited_at` and turns reminders off, which is what
   * stops future "you should go here" nudges. The saved place itself stays in
   * the collection: the shared cache row is UPDATED, never removed, so the
   * marker survives on the map and the detail sheet stays open on the same
   * place. (The old nearby-reminder flow called `removeSavedPlaceFromCache`
   * here, which made a visited place vanish from the map until the next
   * refetch — the server never deleted anything.)
   */
  async function handleMarkVisited() {
    if (visitBusy || visited.visited) return;
    setVisitBusy(true);
    const nowIso = new Date().toISOString();
    const snapshot = getSavedPlacesCacheSnapshot();
    setVisitedAt(nowIso);
    // Built directly rather than through applySavedPlaceEdit: `visited_at` is
    // a state stamp, not one of the user-editable fields that patch type owns.
    const updated: SavedPlaceWithPlace = {
      ...saved,
      visited_at: nowIso,
      notifications_enabled: false,
    };
    updateSavedPlacesCache((current) =>
      current.map((row) => (row.id === saved.id ? updated : row)),
    );
    try {
      await markVisited(saved.id);
      setNotifyOn(false);
      void trackEvent('place_marked_visited', { saved_place_id: saved.id });
      onSaved?.(updated);
    } catch (e: any) {
      setVisitedAt(saved.visited_at ?? null);
      restoreSavedPlacesCache(snapshot);
      Alert.alert('Could not update', e?.message ?? 'Please try again.');
    } finally {
      setVisitBusy(false);
    }
  }

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
      {/* Action row. Going there is the point of the page, so Directions leads;
          the nearby reminder sits behind a divider as a setting rather than a
          verb, exactly as compact as the other three. */}
      <View style={styles.actionRow}>
        <ActionButton
          icon="navigation"
          label="Directions"
          a11yLabel={`Get directions to ${saved.place.name}`}
          onPress={onGetDirections}
          styles={styles}
          tint={colors.accent}
        />
        {sourceUrl && sourceAttribution ? (
          <Pressable
            onPress={() => {
              void openSource();
            }}
            accessibilityRole="button"
            accessibilityLabel={`${sourceAttribution.actionA11yLabel} for ${saved.place.name}`}
            style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
          >
            {/* Ionicons carries real brand marks for BOTH TikTok and Instagram,
                so neither platform is reduced to a generic play/video glyph. */}
            <Ionicons
              name={sourceAttribution.brandIcon as React.ComponentProps<typeof Ionicons>['name']}
              size={20}
              color={colors.text}
            />
            <Text style={styles.actionButtonText} numberOfLines={1}>
              {sourceAttribution.actionLabel}
            </Text>
          </Pressable>
        ) : null}
        <ActionButton
          icon="share"
          label="Share"
          a11yLabel={`Share ${saved.place.name}`}
          onPress={() => {
            void sharePlace();
          }}
          styles={styles}
          tint={colors.text}
        />

        <View style={styles.actionDivider} />
        {reminderCluster}
      </View>

      {onboardingTourStep && ['source', 'directions', 'close'].includes(onboardingTourStep) ? (
        <PlaceTourCallout
          step={onboardingTourStep}
          placeName={saved.place.name}
          onContinue={onboardingTourStep === 'close' ? skipOnboardingTour : advanceOnboardingTour}
          onSkip={skipOnboardingTour}
        />
      ) : null}

      {/* Reminder distance settings — unchanged behaviour, just no longer a
          permanently-open card competing with the place itself. */}
      {notifyOn && reminderSettingsExpanded ? (
        <View style={styles.reminderSettings}>
          <View style={styles.radiusGroup}>
            <RadiusOption label="Auto" active={mode === 'default'} onPress={() => setMode('default')} />
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

      {dirty ? (
        <Button
          title="Save changes"
          variant="secondary"
          onPress={handleSave}
          loading={saving}
          style={styles.saveBtn}
        />
      ) : null}

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
            this project). Six thin steps instead of three thick ones, so the
            ramp reads as a fade rather than as stripes across the photo. */}
        <View pointerEvents="none" style={styles.heroScrim6} />
        <View pointerEvents="none" style={styles.heroScrim5} />
        <View pointerEvents="none" style={styles.heroScrim4} />
        <View pointerEvents="none" style={styles.heroScrim3} />
        <View pointerEvents="none" style={styles.heroScrim2} />
        <View pointerEvents="none" style={styles.heroScrim1} />

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
            <Ionicons
              name={CATEGORY_ICONS[categoryKey] as React.ComponentProps<typeof Ionicons>['name']}
              size={14}
              color="rgba(255,255,255,0.92)"
            />
            <Text style={styles.heroMetaText} numberOfLines={1}>{categoryLabel}</Text>
          </View>
          {/* Omitted rather than faked when the place has no street address —
              a saved city or island legitimately has none. */}
          {locality ? (
            <View style={styles.heroMetaRow}>
              <Feather name="map-pin" size={14} color="rgba(255,255,255,0.92)" />
              <Text style={styles.heroMetaText} numberOfLines={1}>{locality}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>

      {onboardingTourStep && ['found', 'ai_note'].includes(onboardingTourStep) ? (
        <PlaceTourCallout
          step={onboardingTourStep}
          placeName={saved.place.name}
          onContinue={advanceOnboardingTour}
          onSkip={skipOnboardingTour}
        />
      ) : null}

      {/* Today's hours, in the venue's own timezone or not at all. */}
      {todayHours ? (
        <View style={styles.hoursRow}>
          <Feather name="clock" size={15} color={colors.textMuted} />
          <Text
            style={[
              styles.hoursLabel,
              todayHours.kind === 'open' || todayHours.kind === 'open_24h'
                ? styles.hoursLabelOpen
                : styles.hoursLabelClosed,
            ]}
          >
            {todayHours.label}
          </Text>
          {todayHours.detail ? (
            <Text style={styles.hoursDetail} numberOfLines={1}>
              · {todayHours.detail}
            </Text>
          ) : null}
        </View>
      ) : hoursPending ? (
        <View style={styles.hoursRow}>
          <View style={styles.hoursSkeleton} />
        </View>
      ) : null}

      {photoUrls.length > 0 ? (
        <Modal
          visible={galleryOpen}
          animationType="fade"
          transparent
          onRequestClose={closeGallery}
          statusBarTranslucent
        >
          {/* RNGH needs its own root inside a Modal — the modal's content lives
              in a separate view hierarchy, and on Android gestures are simply
              not delivered without it. Visually it is a plain flex container. */}
          <GestureHandlerRootView style={styles.galleryRoot}>
          {/* The dismiss gesture sits on the ROOT so a downward swipe anywhere
              in the gallery closes it. Taps still reach the close button and
              the carousel: a pan only activates on decisively downward
              movement, and never on touch-start. */}
          <GestureDetector gesture={galleryDismissGesture}>
          <View style={styles.galleryRoot}>
            <Reanimated.View
              pointerEvents="none"
              style={[styles.galleryBackdrop, galleryBackdropStyle]}
            />
            <Reanimated.View style={[styles.galleryContent, galleryContentStyle]}>
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

            <View style={styles.galleryCarouselArea}>
              {/* Focus dimming is driven by the NATIVE scroll offset, not by
                  React state. The centered page reaches full opacity exactly
                  as it centers — mid-drag, mid-momentum, and while the JS
                  thread is busy. `galleryIndex` below only backs the counter,
                  the dots, and the prefetch window. */}
              {/* Wrapping the list in a Native gesture is what puts its scroll
                  recogniser under RNGH's arbitration, so the dismiss pan above
                  can order it to wait rather than race it. The list itself is
                  unchanged — same props, same paging, same image loading. */}
              <GestureDetector gesture={galleryScrollGesture}>
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
              </GestureDetector>
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
            </Reanimated.View>
          </View>
          </GestureDetector>
          </GestureHandlerRootView>
        </Modal>
      ) : null}

      {/* Why this place is on the user's map at all.
          ONE surface, not an "AI note" card stacked on a "Your note" card.
          What is shown is `notes ?? ai_note`; any edit writes to `notes` and
          leaves `ai_note` provenance untouched (see lib/placeDetailUi). The
          heading, the media tile, the attribution and the watch action all
          appear only when a real source backs them. */}
      <View style={styles.savedBecauseCard} accessibilityLiveRegion="polite">
        <View style={styles.savedBecauseHeader}>
          <Feather name="bookmark" size={15} color={colors.accent} />
          <Text style={styles.savedBecauseTitle}>{savedBecauseLabel}</Text>
          {hasReason ? (
            <Pressable
              onPress={() => beginNoteEdit(whySaved.seedFromSourceNote)}
              accessibilityRole="button"
              accessibilityLabel="Edit why you saved this place"
              hitSlop={8}
              style={styles.textAction}
            >
              <Text style={styles.changeLink}>Edit</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.savedBecauseBody}>
          {sourceUrl && sourceAttribution ? (
            // Nearr does not store the post's own thumbnail, so this is a
            // branded platform tile rather than a fake video still — honest
            // about what it is, and it opens the real post.
            <Pressable
              onPress={() => {
                void openSource();
              }}
              accessibilityRole="button"
              accessibilityLabel={sourceAttribution.actionA11yLabel}
              style={({ pressed }) => [styles.sourceTile, pressed && styles.pressed]}
            >
              <Ionicons
                name={sourceAttribution.brandIcon as React.ComponentProps<typeof Ionicons>['name']}
                size={26}
                color={colors.text}
              />
              <View style={styles.sourcePlayBadge}>
                <Feather name="play" size={11} color={colors.textInverse} />
              </View>
            </Pressable>
          ) : null}

          <View style={styles.savedBecauseCopy}>
            {hasReason ? (
              <Text style={styles.reasonText}>{`“${whySaved.text}”`}</Text>
            ) : (
              // No note and none was extracted. Nothing is invented; the offer
              // to write one is a quiet link, not the headline.
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Add why you saved this place"
                onPress={() => beginNoteEdit()}
                hitSlop={8}
                style={styles.textAction}
              >
                <Text style={styles.addNoteLink}>Add a note</Text>
              </Pressable>
            )}
            {/* The platform is already in the heading when there is no reason,
                so this line would just repeat it. */}
            {sourceAttribution && hasReason ? (
              <View
                style={styles.attributionRow}
                accessible
                accessibilityLabel={sourceAttribution.sourceA11yLabel}
              >
                <Ionicons
                  name={sourceAttribution.brandIcon as React.ComponentProps<typeof Ionicons>['name']}
                  size={13}
                  color={colors.textSecondary}
                />
                <Text style={styles.attributionText} numberOfLines={1}>
                  {sourceAttribution.platformName}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        {/* No second "Watch post" button here. The action row at the top of
            the sheet is the one guaranteed source-opening affordance; a
            full-width CTA repeating it made this card the tallest thing on the
            screen for no added capability. The tile above still opens the
            post, and carries a play badge so that is not a secret. */}
      </View>

      {shouldShowMoreVideos(sourceCards) ? (
        <View style={styles.moreVideosSection}>
          <Text style={styles.moreVideosTitle}>More videos from this place</Text>
          <FlatList
            data={sourceCards}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.moreVideosList}
            keyExtractor={(item) => item.key}
            renderItem={({ item }) => {
              const attribution = resolvePlaceSource({
                source_type: item.platform,
                source_url: item.url,
              });
              if (!attribution) return null;
              return (
                <Pressable
                  onPress={() => { void openSourceCard(item.url, attribution.platformName); }}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${item.primary ? 'original ' : ''}${attribution.platformName} video for ${saved.place.name}`}
                  style={({ pressed }) => [styles.sourceCard, pressed && styles.pressed]}
                >
                  <View style={styles.sourceCardMedia}>
                    {item.thumbnailUrl ? (
                      <Image source={{ uri: item.thumbnailUrl }} style={styles.sourceCardImage} resizeMode="cover" />
                    ) : (
                      <Ionicons
                        name={attribution.brandIcon as React.ComponentProps<typeof Ionicons>['name']}
                        size={30}
                        color={colors.text}
                      />
                    )}
                    <View style={styles.sourceCardPlatformBadge}>
                      <Ionicons
                        name={attribution.brandIcon as React.ComponentProps<typeof Ionicons>['name']}
                        size={12}
                        color={colors.textInverse}
                      />
                    </View>
                    {item.primary ? (
                      <View style={styles.sourceCardPrimaryBadge}>
                        <Text style={styles.sourceCardPrimaryText}>Original</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.sourceCardCreator} numberOfLines={1}>
                    {item.creator ? `@${item.creator.replace(/^@/, '')}` : attribution.platformName}
                  </Text>
                  {item.caption ? (
                    <Text style={styles.sourceCardCaption} numberOfLines={2}>{item.caption}</Text>
                  ) : null}
                </Pressable>
              );
            }}
          />
        </View>
      ) : null}

      {/* Have I gone yet? A saved place can be BOTH saved and visited —
          answering this never removes the place from the map, and the answer
          persists, so reopening never asks again as if nothing happened. */}
      <View style={styles.visitCard}>
        <View style={styles.visitIcon}>
          <Feather
            name={visited.visited ? 'check-circle' : 'clipboard'}
            size={16}
            color={colors.accent}
          />
        </View>
        <View style={styles.visitCopy}>
          <Text style={styles.visitTitle} numberOfLines={1}>
            {visited.visited ? 'You went here' : visited.prompt}
          </Text>
          <Text style={styles.visitSupport} numberOfLines={2}>
            {visited.visited ? 'Nearby reminders are paused.' : visited.supportCopy}
          </Text>
        </View>
        {/* Thumbs, NOT a rating. Up means "I went", down means "not yet" —
            never like/dislike, so there is no green/red and no negative
            signal recorded anywhere. The labels carry the meaning the icons
            alone would leave ambiguous. Both call exactly the handlers the
            Yes / Not yet buttons did. */}
        {visited.visited ? (
          // Answered. The thumbs-up stays, selected, so reopening shows the
          // answer rather than asking again — and it is not a button, because
          // the current model has no "un-visit".
          <View
            style={[styles.thumbButton, styles.thumbButtonSelected]}
            accessible
            accessibilityLabel={`You went to ${saved.place.name}`}
          >
            <Feather name="thumbs-up" size={18} color={colors.accent} />
          </View>
        ) : (
          <View style={styles.visitActions}>
            <Pressable
              onPress={() => void handleMarkVisited()}
              disabled={visitBusy}
              accessibilityRole="button"
              accessibilityState={{ selected: false, busy: visitBusy }}
              accessibilityLabel={`Yes, I went to ${saved.place.name}`}
              accessibilityHint="Marks it visited and pauses its nearby reminders"
              hitSlop={6}
              style={({ pressed }) => [styles.thumbButton, pressed && styles.pressed]}
            >
              {visitBusy ? (
                <ActivityIndicator size="small" color={colors.accent} />
              ) : (
                <Feather name="thumbs-up" size={18} color={colors.textSecondary} />
              )}
            </Pressable>
            {/* Deliberately inert: "not yet" is the status quo, never a
                mutation and never destructive. */}
            <Pressable
              onPress={() => setVisitDeferred(true)}
              accessibilityRole="button"
              accessibilityState={{ selected: visitDeferred }}
              accessibilityLabel={`No, not yet — keep ${saved.place.name} as a place to go`}
              hitSlop={6}
              style={({ pressed }) => [
                styles.thumbButton,
                visitDeferred && styles.thumbButtonSelected,
                pressed && styles.pressed,
              ]}
            >
              <Feather
                name="thumbs-down"
                size={18}
                color={visitDeferred ? colors.accent : colors.textSecondary}
              />
            </Pressable>
          </View>
        )}
      </View>

      {/* The user's OWN saves around this one — never Google discovery, and
          the same selection semantics as a marker tap (exact saved_places.id).
          Anything already listed under the same-post row above is excluded, so
          the two sections never show the same card twice. */}
      {/* The other destinations from the same post. Sits above Also nearby
          because "the video I saved this from also showed me these" is a
          stronger reason than "this happens to be close" — two different
          relationships, two sections, never merged into one opaque score. */}
      {sameSourceEntries.length > 0 && sourceAttribution ? (
        <PlaceCardRow
          title={sourceAttribution.siblingSectionTitle}
          entries={sameSourceEntries}
        />
      ) : null}

      {alsoNearbyEntries.length > 0 ? (
        <PlaceCardRow
          title="Saved nearby"
          entries={alsoNearbyEntries}
          actionLabel={onSeeMap && recommendationEntries.length === 0 ? 'See map' : undefined}
          onAction={onSeeMap && recommendationEntries.length === 0 ? openNearbyMapExplorer : undefined}
        />
      ) : null}

      {recommendationsEnabled && recommendationEntries.length > 0 ? (
        <PlaceCardRow
          title="Also nearby"
          entries={recommendationEntries}
          actionLabel={onSeeMap ? 'See map' : undefined}
          onAction={onSeeMap ? openNearbyMapExplorer : undefined}
        />
      ) : recommendationsEnabled && recommendationsLoading ? (
        <View style={styles.recommendationsLoading} accessibilityLabel="Loading nearby places">
          <ActivityIndicator size="small" color={colors.accent} />
          <Text style={styles.recommendationsLoadingText}>Finding places nearby…</Text>
        </View>
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
      <RecommendedPlaceDetails
        recommendation={selectedRecommendation}
        onClose={() => setSelectedRecommendation(null)}
        onSave={onSaveRecommendation
          ? async (candidate) => onSaveRecommendation(candidate)
          : undefined}
      />
    </View>
  );
}

/** One icon-over-label action in the top row. */
function ActionButton({
  label,
  a11yLabel,
  icon,
  tint,
  onPress,
  styles,
}: {
  label: string;
  a11yLabel?: string;
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      style={({ pressed }) => [styles.actionButton, pressed && styles.pressed]}
    >
      <Feather name={icon} size={21} color={tint} />
      <Text style={styles.actionButtonText} numberOfLines={1}>
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

function PlaceTourCallout({
  step,
  placeName,
  onContinue,
  onSkip,
}: {
  step: OnboardingPlaceTourStep;
  placeName: string;
  onContinue: () => void;
  onSkip: () => void;
}) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const sentence = step === 'source'
    ? 'The original post stays with every place you save.'
    : step === 'directions'
      ? 'Directions turns a saved find into a plan.'
      : step === 'close'
        ? 'That’s it. Head back to your map when you’re ready.'
        : `This is ${placeName}, exactly as it now lives on your map.`;
  return (
    <View style={styles.onboardingCallout} accessibilityLiveRegion="polite">
      <View style={styles.onboardingCalloutPointer} />
      <Feather name="bookmark" size={16} color={colors.accent} />
      <Text style={styles.onboardingCalloutText}>{sentence}</Text>
      <Pressable onPress={onContinue} hitSlop={8} accessibilityRole="button">
        <Text style={styles.onboardingCalloutAction}>{step === 'close' ? 'Back to map' : 'Got it'}</Text>
      </Pressable>
      {step !== 'close' ? (
        <Pressable onPress={onSkip} hitSlop={8} accessibilityRole="button">
          <Text style={styles.onboardingCalloutSkip}>Skip tour</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    // Hierarchy comes from spacing, typography and imagery — not from wrapping
    // every section in its own bordered box.
    // Density comes from tight, consistent section spacing — not from smaller
    // type. One gap value for the whole page.
    wrap: { gap: Spacing.md },
    pressed: { opacity: 0.6 },
    onboardingCallout: {
      position: 'relative',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: 14,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.accentBorder,
    },
    onboardingCalloutPointer: {
      position: 'absolute',
      top: -5,
      left: 28,
      width: 10,
      height: 10,
      backgroundColor: colors.surfaceElevated,
      borderLeftWidth: 1,
      borderTopWidth: 1,
      borderColor: colors.accentBorder,
      transform: [{ rotate: '45deg' }],
    },
    onboardingCalloutText: {
      ...typography.caption,
      flex: 1,
      color: colors.textSecondary,
      lineHeight: 18,
    },
    onboardingCalloutAction: { color: colors.accent, fontSize: 12, fontWeight: '800' },
    onboardingCalloutSkip: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
    recommendationsLoading: {
      minHeight: 36,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
    },
    recommendationsLoadingText: {
      ...typography.caption,
      color: colors.textMuted,
    },

    // ----- action row ------------------------------------------------------
    // Zero row gap on purpose: each action carries its own padding, and those
    // reclaimed points are what let "Watch post" render in full at 375pt.
    actionRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingBottom: 2,
    },
    actionButton: {
      flex: 1,
      minWidth: 0,
      minHeight: 48,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 4,
      paddingHorizontal: 1,
    },
    actionButtonText: {
      ...typography.caption,
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    actionDivider: {
      width: StyleSheet.hairlineWidth,
      height: 28,
      marginHorizontal: Spacing.xs,
      backgroundColor: colors.border,
    },
    reminderControl: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      minHeight: 44,
      paddingHorizontal: Spacing.xs,
    },
    reminderDistanceText: {
      ...typography.caption,
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    reminderSettings: {
      gap: Spacing.sm,
      padding: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },

    // ----- hero ------------------------------------------------------------
    // Cinematic 1.9:1 rather than the old boxy 358×250 (1.43:1), and it bleeds
    // past the sheet's own padding so the photo — not the margin — is what the
    // eye lands on. Height follows width, so it stays proportional at every
    // device size instead of being a fixed 250pt slab on a small screen.
    hero: {
      marginHorizontal: -Spacing.sm,
      aspectRatio: 1.9,
      borderRadius: 18,
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
    // Stacked bands approximate a bottom-up gradient without pulling in a
    // native gradient dependency.
    //
    // The previous version used three bands at 0.18 / 0.32 / 0.45, which
    // compounded to ~0.69 over the bottom fifth and left two hard horizontal
    // seams straight across the photo — clearly visible on device, and the
    // reason the lower hero read as a black slab. This is six thin bands at
    // 0.09 each: the same legibility floor (~0.54 behind the text) reached in
    // steps small enough not to draw an edge, and it stops well short of the
    // solid darkness the old ramp produced.
    heroScrim6: { ...heroScrimBand, height: '58%' },
    heroScrim5: { ...heroScrimBand, height: '48%' },
    heroScrim4: { ...heroScrimBand, height: '39%' },
    heroScrim3: { ...heroScrimBand, height: '30%' },
    heroScrim2: { ...heroScrimBand, height: '21%' },
    heroScrim1: { ...heroScrimBand, height: '12%' },
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
      paddingBottom: Spacing.md,
      gap: 3,
    },
    placeName: {
      ...typography.title,
      color: '#FFFFFF',
      fontSize: 24,
      lineHeight: 28,
      marginBottom: 2,
      textShadowColor: 'rgba(0,0,0,0.45)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 6,
    },
    heroMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    heroMetaText: {
      ...typography.caption,
      flexShrink: 1,
      fontSize: 13,
      fontWeight: '600',
      color: 'rgba(255,255,255,0.92)',
      textShadowColor: 'rgba(0,0,0,0.4)',
      textShadowOffset: { width: 0, height: 1 },
      textShadowRadius: 4,
    },

    // ----- today's hours ---------------------------------------------------
    // One line, no card. It is a fact about the place, not a section.
    hoursRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minHeight: 18,
      marginTop: -2,
      paddingHorizontal: 2,
    },
    hoursLabel: { ...typography.caption, fontSize: 13, fontWeight: '700' },
    hoursLabelOpen: { color: colors.success },
    hoursLabelClosed: { color: colors.textSecondary },
    hoursDetail: {
      ...typography.caption,
      flexShrink: 1,
      fontSize: 13,
      color: colors.textSecondary,
    },
    hoursSkeleton: {
      width: 150,
      height: 11,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
    },

    // ----- saved because ---------------------------------------------------
    savedBecauseCard: {
      gap: Spacing.sm,
      padding: Spacing.md - 2,
      borderRadius: Radius.md,
      backgroundColor: colors.accentSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accentBorder,
    },
    savedBecauseHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      minHeight: 22,
    },
    savedBecauseTitle: {
      ...typography.bodyStrong,
      flex: 1,
      minWidth: 0,
      fontSize: 14,
      color: colors.accent,
    },
    savedBecauseBody: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.sm + 2,
    },
    sourceTile: {
      width: 64,
      height: 64,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sourcePlayBadge: {
      position: 'absolute',
      right: 4,
      bottom: 4,
      width: 18,
      height: 18,
      borderRadius: 9,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    savedBecauseCopy: { flex: 1, minWidth: 0, gap: 5 },
    reasonText: {
      ...typography.body,
      color: colors.text,
      fontSize: 14,
      lineHeight: 20,
    },
    addNoteLink: { ...typography.bodyStrong, fontSize: 14, color: colors.accent },
    attributionRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    attributionText: {
      ...typography.caption,
      flexShrink: 1,
      fontSize: 12,
      color: colors.textSecondary,
      fontWeight: '600',
    },
    // ----- multi-source videos -------------------------------------------
    moreVideosSection: { gap: Spacing.sm },
    moreVideosTitle: { ...typography.bodyStrong, color: colors.text, fontSize: 16 },
    moreVideosList: { gap: Spacing.sm, paddingRight: Spacing.md },
    sourceCard: { width: 148, gap: 5, paddingBottom: 2 },
    sourceCardMedia: {
      width: 148,
      height: 94,
      borderRadius: Radius.md,
      overflow: 'hidden',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    sourceCardImage: { width: '100%', height: '100%' },
    sourceCardPlatformBadge: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      width: 24,
      height: 24,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.72)',
    },
    sourceCardPrimaryBadge: {
      position: 'absolute',
      left: 6,
      top: 6,
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.72)',
    },
    sourceCardPrimaryText: {
      ...typography.caption,
      color: '#FFFFFF',
      fontSize: 10,
      fontWeight: '700',
    },
    sourceCardCreator: { ...typography.caption, color: colors.text, fontWeight: '700' },
    sourceCardCaption: { ...typography.caption, color: colors.textSecondary, lineHeight: 16 },
    // ----- did you go yet? -------------------------------------------------
    // One horizontal band: icon, copy, both answers. Previously a stacked card
    // roughly twice this tall.
    visitCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm + 2,
      paddingVertical: Spacing.sm + 2,
      paddingHorizontal: Spacing.md - 2,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    visitIcon: {
      width: 32,
      height: 32,
      borderRadius: Radius.sm,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    visitCopy: { flex: 1, minWidth: 0, gap: 1 },
    visitTitle: { ...typography.bodyStrong, fontSize: 14, color: colors.text },
    visitSupport: {
      ...typography.caption,
      fontSize: 11,
      color: colors.textSecondary,
      lineHeight: 15,
    },
    visitActions: { flexDirection: 'row', gap: 6 },
    // Square-ish icon targets: 36pt visible, 48pt with hitSlop. Neutral by
    // default and accent when chosen — never red/green, because this is not a
    // rating.
    thumbButton: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
    },
    thumbButtonSelected: {
      backgroundColor: colors.accentSoft,
      borderColor: colors.accentBorder,
    },
    galleryRoot: {
      flex: 1,
    },
    // Separated from the content layer so the backdrop can fade with the drag
    // while the gallery itself translates.
    galleryBackdrop: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(0,0,0,0.96)',
    },
    galleryContent: {
      flex: 1,
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
    textAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center' },
    helperText: { color: colors.textSecondary },
    changeLink: {
      ...typography.bodyStrong,
      fontSize: 15,
      color: colors.accent,
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
