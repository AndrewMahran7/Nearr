/**
 * SelectedPlaceDetails — THE canonical saved-place detail experience, shown
 * inside the EXPANDED map sheet (app/(tabs)/map.tsx).
 *
 * Every entry point converges here: a marker tap, the saved list, a completed
 * queue row, a single nearby notification, a member of a grouped notification,
 * and an "Also nearby" card. `/place/[id]` and `/opportunity/[id]` are thin
 * redirects into this same sheet, so there is exactly one presentation owner.
 *
 * Fieldnotes hierarchy: destination photo, identity, Directions, original
 * source, saved reason, nearby reminder, visit state, related places.
 * Management stays in More; all entry points retain this single owner.
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
  FlatList,
  Image,
  Linking,
  Modal,
  Switch,
  useWindowDimensions,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Button, Input } from '@/components';
import { SourceRibbon } from '@/components/SourceRibbon';
import { ensureNotificationPermission, ensureBackgroundLocationPermission } from '@/lib/notifications';
import { hapticSelection } from '@/lib/haptics';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { PhotoRolodexModal } from '@/components/PhotoRolodex';
import { PlaceVideoGalleryStrip } from '@/components/PlaceVideoGalleryStrip';
import { WrongPlaceSheet } from '@/components/map/WrongPlaceSheet';
import { NoteEditorModal } from '@/components/map/NoteEditorModal';
import { RecommendedPlaceDetails } from '@/components/map/RecommendedPlaceDetails';
import { PlaceCardRow } from '@/components/map/place/PlaceCardRow';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { trackEvent } from '@/lib/analytics';
import {
  advanceOnboardingV2PlaceTour,
} from '@/lib/onboardingV2';
import type { OnboardingPlaceTourStep } from '@/lib/onboardingV2Core';
import { isPlaceVideoGalleryEnabled } from '@/lib/featureFlags';
import { selectVideoHero, type PlaceVideoItem } from '@/lib/placeVideoGallery';
import { applySavedPlaceEdit } from '@/lib/savedPlaceEdits';
import {
  cancelNoteEditor,
  commitNoteEditor,
  openNoteEditor,
  type NoteEditorState,
} from '@/lib/noteEditor';
import {
  buildNativePlaceSharePayload,
  buildSavedPlaceShareContent,
} from '@/lib/placeShare';
import { createPublicPlaceShare } from '@/lib/publicPlace';
import {
  getUntrackedAcquisitionReferral,
  markAcquisitionFirstShareTracked,
} from '@/lib/sharedPlaceIntent';
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
import { resolvePlaceSource } from '@/lib/placeSource';
import { placeSourceCards, shouldShowMoreVideos } from '@/lib/placeSources';
import { placeSourcePreviewCandidates } from '@/lib/placeSourcePreviews';
import { splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { deleteSavedPlace, markVisited, updateSavedPlace } from '@/services/savedPlacesService';
import { loadPlaceSourceEvidencePreviewUrls } from '@/services/placeSourcePreviewsService';
import { loadPlaceVideos } from '@/services/placeVideosService';
import { CATEGORY_LABELS, savedPlaceCategory, type NearrCategory } from '@/lib/placeCategory';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
  updateSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { hydrateSavedPlace } from '@/lib/savedPlaceHydration';
import { loadPlaceRecommendations } from '@/services/placeRecommendationsService';
import type { PlaceRecommendation } from '@/lib/placeRecommendations';
import type { NearbyMapExplorerPayload } from '@/lib/nearbyMapExplorer';
import type { PlaceCandidate, PlaceRichDetails } from '@/services/placesService';
import type { RadiusUnit, SavedPlaceWithPlace } from '@/types';
import { logDebug } from '@/lib/logger';
import { placeCapabilities } from '@/lib/placeCapabilities';
import { offlineFixtureByPlaceId } from '@/onboarding/fixtures/offlineOnboardingFixtures';
import { offlineOnboardingMedia } from '@/onboarding/assets/offlineOnboardingAssets';

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
  /** Expands the current source group inside the owning selected-place sheet. */
  onViewSourceGroup?: () => void;
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
  /** Lets a source-group owner select the next live member after removal. */
  onRemoved?: (removedSavedPlaceId: string) => void;
  /** Called after a successful save so the map can refresh its `selected`. */
  onSaved?: (updated: SavedPlaceWithPlace) => void;
  onCorrected?: (updated: SavedPlaceWithPlace) => void;
};

export function SelectedPlaceDetails({
  saved,
  allSavedPlaces,
  savedProviderPlaceIds,
  onSelectNearby,
  onViewSourceGroup,
  onSaveRecommendation,
  onGetDirections,
  onSeeMap,
  onRequestDismiss,
  onRemoved,
  onSaved,
  onCorrected,
}: Props) {
  const { colors, typography } = useTheme();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const reduceMotion = useReduceMotion();
  const [moreOpen, setMoreOpen] = useState(false);
  const [reminderBusy, setReminderBusy] = useState(false);
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const { session } = useAuth();
  const { state: onboardingState } = useOnboardingV2();
  const capabilities = useMemo(() => placeCapabilities(saved), [saved]);
  const tutorialPhotoUris = useMemo(() => {
    const fixture = offlineFixtureByPlaceId(saved.place.id);
    if (!fixture) return [];
    return offlineOnboardingMedia(fixture.assetKey).placePhotoAssets
      .map((asset) => Image.resolveAssetSource(asset).uri)
      .filter(Boolean)
      .slice(0, 5);
  }, [saved.place.id]);
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
  const [sourceEvidencePreviewUrls, setSourceEvidencePreviewUrls] = useState<Record<string, string>>({});
  const [failedSourcePreviewUrls, setFailedSourcePreviewUrls] = useState<Record<string, true>>({});
  const [ownerPlaceVideos, setOwnerPlaceVideos] = useState<PlaceVideoItem[]>([]);
  const [communityPlaceVideos, setCommunityPlaceVideos] = useState<PlaceVideoItem[]>([]);
  const [placeVideoCount, setPlaceVideoCount] = useState(0);
  const videoHeroTrackedRef = useRef('');
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryIndex, setGalleryIndex] = useState(0);
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

  // Provider-backed "Also nearby" previously ran a Nearby Search whenever a
  // saved detail mounted. That violates the saved-open zero-request contract;
  // the user's own locally computed "Saved nearby" section remains available.
  const recommendationsEnabled = false;
  const videoGalleryEnabled = isPlaceVideoGalleryEnabled();
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
    if (tutorialPhotoUris.length) {
      setRichDetails({
        googlePlaceId: '',
        name: saved.place.name,
        formattedAddress: saved.place.formatted_address,
        latitude: saved.place.latitude,
        longitude: saved.place.longitude,
        category: savedPlaceCategory(saved),
        googleMapsUrl: null,
        websiteUrl: null,
        formattedPhoneNumber: null,
        internationalPhoneNumber: null,
        photoUrls: tutorialPhotoUris,
        openingHours: null,
        utcOffsetMinutes: null,
      });
      setDetailsLoading(false);
      return () => { canceled = true; };
    }
    const userId = session?.user?.id ?? null;
    if (!userId) {
      setRichDetails(null);
      setDetailsLoading(false);
      return () => {
        canceled = true;
      };
    }

    setDetailsLoading(true);
    const knownImageUri = placeSourceCards(saved).find((source) => !!source.thumbnailUrl)?.thumbnailUrl ?? null;
    void hydrateSavedPlace({ userId, saved, trigger: 'map_detail', knownImageUri })
      .then((hydrated) => {
        if (!canceled) setRichDetails(hydrated.details);
      })
      .finally(() => {
        if (!canceled) setDetailsLoading(false);
      });

    return () => {
      canceled = true;
    };
    // Re-run only for a new saved/provider identity. Unrelated cache updates
    // while the sheet is open are not additional "opens" for cost telemetry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [googlePlaceId, saved.id, session?.user?.id, tutorialPhotoUris]);

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
    if (!capabilities.canEdit) return false;
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
  }, [capabilities.canEdit, milesText, minutesText, mode, notifyOn, saved]);

  // Only offer the "open original" affordance when a non-empty source URL is
  // actually stored (share/paste flows). Manual saves have none → no button.
  const sourceCards = useMemo(() => placeSourceCards(saved), [saved]);
  const sourceCardsKey = sourceCards
    .map((source) => `${source.key}|${source.url}|${source.thumbnailUrl ?? ''}`)
    .join('\n');

  // Retained evidence is an enhancement, never a gate for opening the sheet.
  // Match every frame to its exact source post, then let the renderer fall
  // through to the stored source thumbnail (and finally the platform tile).
  useEffect(() => {
    let canceled = false;
    setSourceEvidencePreviewUrls({});
    setFailedSourcePreviewUrls({});
    if (videoGalleryEnabled || !shouldShowMoreVideos(sourceCards)) {
      return () => {
        canceled = true;
      };
    }

    void loadPlaceSourceEvidencePreviewUrls(saved.id, sourceCards)
      .then((urls) => {
        if (!canceled) setSourceEvidencePreviewUrls(urls);
      })
      .catch((error) => {
        logDebug('place-source-previews', `load failed: ${error instanceof Error ? error.message : 'unknown'}`);
      });

    return () => {
      canceled = true;
    };
    // A stable projection avoids refetching after unrelated Saved Place edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.id, sourceCardsKey]);

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
    if (tutorialPhotoUris.length) return tutorialPhotoUris.filter((url) => !failedPhotoUrls[url]);
    if (!richDetails?.photoUrls?.length) return [];
    return richDetails.photoUrls.filter((url) => !failedPhotoUrls[url]).slice(0, 5);
  }, [failedPhotoUrls, richDetails?.photoUrls, tutorialPhotoUris]);

  const photoRolodexItems = useMemo(() => photoUrls.map((uri, index) => ({
    key: uri,
    uri,
    accessibilityLabel: `${saved.place.name}, photo ${index + 1} of ${photoUrls.length}`,
    footerLabel: `Destination photo ? ${saved.place.name}`,
  })), [photoUrls, saved.place.name]);

  // Owner media is requested first; the privacy-filtered community page is a
  // second, non-blocking request so public discovery never delays Place Detail.
  useEffect(() => {
    let canceled = false;
    setOwnerPlaceVideos([]);
    setCommunityPlaceVideos([]);
    setPlaceVideoCount(0);
    if (!videoGalleryEnabled) return () => { canceled = true; };
    void loadPlaceVideos({ placeId: saved.place.id, includeCommunity: false, limit: 20 })
      .then((gallery) => {
        if (canceled) return;
        setOwnerPlaceVideos(gallery.ownerVideos);
        setPlaceVideoCount(gallery.totalVideoCount);
        return loadPlaceVideos({ placeId: saved.place.id, includeCommunity: true, limit: 5 });
      })
      .then((gallery) => {
        if (!gallery || canceled) return;
        setOwnerPlaceVideos(gallery.ownerVideos);
        setCommunityPlaceVideos(gallery.communityVideos);
        setPlaceVideoCount(gallery.totalVideoCount);
        if (gallery.totalVideoCount) void trackEvent('place_video_gallery_viewed', { place_id: gallery.placeId, owner_count: gallery.ownerVideos.length, community_count: gallery.communityVideos.length });
        gallery.communityVideos.forEach((video) => void trackEvent('community_video_impression', { place_id: gallery.placeId, source_id: video.sourceId, platform: video.platform }));
      })
      .catch((error) => logDebug('place-video-gallery', `load failed: ${error instanceof Error ? error.message : 'unknown'}`));
    return () => { canceled = true; };
  }, [saved.place.id, videoGalleryEnabled]);

  const videoHero = useMemo(
    () => selectVideoHero(
      photoUrls,
      videoGalleryEnabled ? ownerPlaceVideos : [],
      videoGalleryEnabled ? communityPlaceVideos : [],
    ),
    [communityPlaceVideos, ownerPlaceVideos, photoUrls, videoGalleryEnabled],
  );
  const sourceHeroUri = primarySource?.thumbnailUrl?.trim() || null;
  const heroUri = videoHero?.uri ?? sourceHeroUri;
  useEffect(() => {
    if (!videoHero || videoHero.kind === 'PROVIDER' || !videoHero.video) return;
    const key = `${saved.place.id}:${videoHero.video.sourceId}`;
    if (videoHeroTrackedRef.current === key) return;
    videoHeroTrackedRef.current = key;
    void trackEvent('hero_video_frame_used', { place_id: saved.place.id, source_id: videoHero.video.sourceId, ownership: videoHero.video.ownership, platform: videoHero.video.platform });
  }, [saved.place.id, videoHero]);

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

  const hasReason = !!whySaved.text;

  async function changeReminderEnabled(next: boolean) {
    if (reminderBusy) return;
    setReminderBusy(true);
    try {
      if (next) {
        const notificationsAllowed = await ensureNotificationPermission();
        const locationAllowed = notificationsAllowed && await ensureBackgroundLocationPermission();
        if (!notificationsAllowed || !locationAllowed) {
          Alert.alert('Allow nearby reminders', 'Notifications and background location are needed to remind you when you are near this place.', [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => { void Linking.openSettings(); } },
          ]);
          return;
        }
      }
      await updateSavedPlace(saved.id, { notifications_enabled: next });
      const updated = applySavedPlaceEdit(saved, { notifications_enabled: next });
      updateSavedPlacesCache((current) => current.map((row) => row.id === saved.id ? updated : row));
      setNotifyOn(next);
      onSaved?.(updated);
      if (next) hapticSelection();
    } catch {
      Alert.alert('Couldn?t update reminder', 'Your previous reminder setting is unchanged. Check your connection and try again.');
    } finally {
      setReminderBusy(false);
    }
  }

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

  async function openPlaceVideo(video: PlaceVideoItem) {
    void trackEvent('place_video_thumbnail_tapped', { place_id: saved.place.id, source_id: video.sourceId, ownership: video.ownership, platform: video.platform });
    try {
      const canOpen = await Linking.canOpenURL(video.originalUrl);
      if (!canOpen) throw new Error('unavailable');
      await Linking.openURL(video.originalUrl);
      void trackEvent('place_video_original_opened', { place_id: saved.place.id, source_id: video.sourceId, ownership: video.ownership, platform: video.platform });
      void trackEvent(video.ownership === 'OWNER' ? 'owner_video_opened' : 'community_video_opened', { place_id: saved.place.id, source_id: video.sourceId, platform: video.platform });
    } catch {
      Alert.alert('Post unavailable', 'The original post can no longer be opened.');
    }
  }

  // Sharing is about the canonical place. The original post stays available
  // through the separate source action above, never as the primary payload.
  async function sharePlace() {
    if (!capabilities.isServerAddressable) {
      const address = saved.place.formatted_address?.trim();
      await Share.share({
        title: saved.place.name,
        message: [saved.place.name, address].filter(Boolean).join('\n'),
      });
      return;
    }
    let publicPlaceId = saved.place.id;
    let referralId: string | null = null;
    try {
      const share = await createPublicPlaceShare(saved.place.id, 'place_detail');
      publicPlaceId = share.publicPlaceId;
      referralId = share.referralId;
    } catch (error) {
      if (__DEV__) console.debug('[map] referral creation failed; sharing canonical URL', error);
    }
    const content = buildSavedPlaceShareContent(
      { ...saved, place: { ...saved.place, id: publicPlaceId } },
      referralId,
    );
    void trackEvent('place_shared', {
      public_place_id: publicPlaceId,
      referral_id: referralId,
      has_url: !!content.url,
      share_kind: content.kind,
    });
    if (!content.url) {
      Alert.alert("Couldn't share this place", 'This place does not have a valid Nearr link yet.');
      return;
    }
    try {
      const result = await Share.share(
        buildNativePlaceSharePayload(content, Platform.OS),
        { subject: content.title },
      );
      if (result.action === Share.sharedAction) {
        const acquisitionRef = await getUntrackedAcquisitionReferral();
        if (acquisitionRef) {
          void trackEvent('shared_link_first_independent_share', {
            acquisition_referral_id: acquisitionRef,
            public_place_id: publicPlaceId,
          });
          await markAcquisitionFirstShareTracked();
        }
      }
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
      Alert.alert('Couldn?t save changes', 'Your previous settings are unchanged. Check your connection and try again.');
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
    setGalleryOpen(true);
  }

  function openHeroMedia() {
    if (!videoHero) return;
    if (videoHero.kind === 'PROVIDER') openGalleryAt(0);
    else if (videoHero.video) void openPlaceVideo(videoHero.video);
  }

  // The one close path: the X button, the hardware/system back gesture, and a
  // committed swipe-down all end here, so no route leaves modal state behind.
  // Stable identity — the dismiss gesture calls it across the JS bridge.
  const closeGallery = useCallback(() => {
    setGalleryOpen(false);
  }, []);

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
              if (onRemoved) onRemoved(saved.id);
              else onRequestDismiss();
            } catch (e: any) {
              restoreSavedPlacesCache(snapshot);
              Alert.alert('Couldn?t remove place', 'Your saved place is still here. Check your connection and try again.');
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
      <View style={styles.detailNavigation}>
        <Text style={styles.detailNavigationLabel}>Your saved place</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`More options for ${saved.place.name}`} onPress={() => setMoreOpen(true)} style={styles.moreButton}>
          <Feather name="more-horizontal" size={22} color={colors.text} />
        </Pressable>
      </View>

      {/* Hero: the photo carries the page. Name + context sit ON the image
          under a layered scrim so the first thing read is the place itself,
          not a stack of equal-weight cards. The same geometry is used when
          there is no photo, so the layout never jumps once photos resolve. */}
      <Pressable
        disabled={!videoHero}
        onPress={openHeroMedia}
        accessibilityRole={videoHero ? 'button' : undefined}
        accessibilityLabel={videoHero?.kind === 'PROVIDER' ? `View photos of ${saved.place.name}` : videoHero ? `Open original video for ${saved.place.name}` : undefined}
        style={({ pressed }) => [styles.hero, pressed && styles.heroPressed]}
      >
        {heroUri ? (
          <Image
            source={{ uri: heroUri }}
            style={styles.heroImage}
            resizeMode="cover"
            onError={() => {
              if (videoHero?.kind === 'PROVIDER') setFailedPhotoUrls((prev) => ({ ...prev, [videoHero.uri]: true }));
              else if (videoHero?.video?.ownership === 'OWNER') setOwnerPlaceVideos((current) => current.filter((video) => video.sourceId !== videoHero.video?.sourceId));
              else if (videoHero?.video) setCommunityPlaceVideos((current) => current.filter((video) => video.sourceId !== videoHero.video?.sourceId));
            }}
          />
        ) : (
          <View style={styles.heroFallback}>
            {detailsLoading ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <><Feather name="image" size={28} color={colors.textSecondary} /><Text style={styles.noPhotoLabel}>No destination photo yet</Text></>
            )}
          </View>
        )}

        {photoUrls.length > 0 ? (
          <View style={styles.photoCountPill}>
            <Feather name="image" size={13} color="#FFFFFF" />
            <Text style={styles.photoCountText}>1 / {photoUrls.length}</Text>
          </View>
        ) : null}

        {videoHero && videoHero.kind !== 'PROVIDER' ? (
          <View style={styles.videoHeroPill}>
            <Feather name="play" size={13} color="#FFFFFF" />
            <Text style={styles.photoCountText}>{videoHero.kind === 'OWNER_VIDEO' ? 'Saved by you' : 'Nearr community'}</Text>
          </View>
        ) : null}

        {!videoHero && heroUri ? <View style={styles.videoHeroPill}><Text style={styles.photoCountText}>From your post</Text></View> : null}
      </Pressable>

      {photoUrls.length > 1 && !largeText ? (
        <View style={styles.photoThumbnails} accessibilityLabel={`${photoUrls.length} destination photos`}>
          {photoUrls.map((uri, index) => <Pressable key={uri} onPress={() => openGalleryAt(index)} accessibilityRole="button" accessibilityLabel={`View destination photo ${index + 1} of ${photoUrls.length}`} style={styles.photoThumbnailButton}>
            <Image source={{ uri }} resizeMode="cover" style={styles.photoThumbnail} />
          </Pressable>)}
        </View>
      ) : null}
      {photoUrls.length > 1 && largeText ? <Button title={`View ${photoUrls.length} photos`} variant="text" onPress={() => openGalleryAt(0)} /> : null}

      <View style={styles.heroCaption}>
        <Text accessibilityRole="header" style={styles.placeName}>{saved.place.name}</Text>
        <Text style={styles.heroMetaText}>{[categoryLabel, locality].filter(Boolean).join(' ? ')}</Text>
      </View>
      <View style={[styles.destinationActions, largeText && styles.destinationActionsLarge]}>
        <Button title="Directions" icon="navigation" accessibilityLabel={`Get directions to ${saved.place.name}`} onPress={onGetDirections} style={styles.directionsButton} />
        {!largeText ? <Pressable onPress={() => void sharePlace()} accessibilityRole="button" accessibilityLabel={`Share ${saved.place.name}`} style={styles.shareButton}><Feather name="share" size={21} color={colors.text} /></Pressable> : null}
      </View>
      {onboardingTourStep && ['source', 'directions', 'close'].includes(onboardingTourStep) ? <PlaceTourCallout step={onboardingTourStep} placeName={saved.place.name} onContinue={onboardingTourStep === 'close' ? skipOnboardingTour : advanceOnboardingTour} onSkip={skipOnboardingTour} /> : null}
      {sourceAttribution ? <SourceRibbon
        title={primarySource?.creator ? `@${primarySource.creator.replace(/^@/, '')}` : 'Your original post'}
        platform={sourceAttribution.platformName}
        thumbnail={primarySource ? placeSourcePreviewCandidates(sourceEvidencePreviewUrls[primarySource.key], primarySource.thumbnailUrl).find((url) => !failedSourcePreviewUrls[url]) ?? null : null}
        caption={primarySource?.caption ?? undefined}
        onPress={sourceUrl && capabilities.canWatchSource ? () => void openSource() : undefined}
        unavailable={!sourceUrl}
      /> : null}

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

      <PhotoRolodexModal
        visible={galleryOpen}
        items={photoRolodexItems}
        initialIndex={galleryIndex}
        onClose={closeGallery}
        prefetchAdjacent={false}
        loadOnlyVisited
        resizeMode="contain"
      />

      <View style={styles.savedBecauseCard} accessibilityLiveRegion="polite">
        <View style={styles.savedBecauseHeader}>
          <Text style={styles.savedBecauseTitle}>WHY YOU SAVED IT</Text>
          {hasReason && capabilities.canEdit ? <Pressable onPress={() => beginNoteEdit(whySaved.seedFromSourceNote)} accessibilityRole="button" accessibilityLabel="Edit why you saved this place" style={styles.textAction}><Text style={styles.changeLink}>Edit</Text></Pressable> : null}
        </View>
        {hasReason ? <>
          <Text style={styles.reasonText}>{whySaved.text}</Text>
          <Text style={styles.attributionText}>{whySaved.origin === 'user' ? 'Your note' : 'From the post'}</Text>
        </> : capabilities.canEdit ? <Pressable onPress={() => beginNoteEdit()} accessibilityRole="button" accessibilityLabel="Add why you saved this place" style={styles.textAction}><Text style={styles.addNoteLink}>Add a note for someday</Text></Pressable> : null}
      </View>
      {capabilities.canSetReminder ? <View style={[styles.reminderRow, largeText && styles.reminderRowLarge]}>
        <View style={styles.reminderCopy}>
          <Text style={styles.reminderTitle}>Remind me nearby</Text>
          <Text style={styles.reminderDescription}>A little nudge when you?re close.</Text>
          {notifyOn ? <Pressable onPress={() => setReminderSettingsExpanded((value) => !value)} accessibilityRole="button" accessibilityLabel={`Nearby reminder, ${reminderStatus}. Change distance`} accessibilityState={{ expanded: reminderSettingsExpanded }} style={styles.reminderControl}><Text style={styles.reminderDistanceText}>{reminderDistance} · Change distance</Text><Feather name={reminderSettingsExpanded ? 'chevron-down' : 'chevron-right'} size={16} color={colors.textSecondary} /></Pressable> : null}
        </View>
        {reminderBusy ? <ActivityIndicator accessibilityLabel="Updating reminder" color={colors.primary} /> : <Switch value={notifyOn} onValueChange={(next) => void changeReminderEnabled(next)} accessibilityLabel={`Nearby reminder for ${saved.place.name}`} trackColor={{ false: colors.controlBorder, true: colors.primary }} />}
      </View> : null}

      {/* Reminder distance settings — unchanged behaviour, just no longer a
          permanently-open card competing with the place itself. */}
      {capabilities.canSetReminder && notifyOn && reminderSettingsExpanded ? (
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

      {/* Have I gone yet? A saved place can be BOTH saved and visited —
          answering this never removes the place from the map, and the answer
          persists, so reopening never asks again as if nothing happened. */}
      {capabilities.canMarkVisited ? <View style={styles.visitCard}>
        <View style={styles.visitIcon}>
          <Feather
            name={visited.visited ? 'check-circle' : 'clipboard'}
            size={16}
            color={colors.accent}
          />
        </View>
        <View style={styles.visitCopy}>
          <Text style={styles.visitTitle}>
            {visited.visited ? 'You went here' : visited.prompt}
          </Text>
          <Text style={styles.visitSupport}>
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
      </View> : null}

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
          title={`${sourceAttribution.siblingSectionTitle} · ${sameSourceEntries.length + 1}`}
          entries={sameSourceEntries}
          actionLabel={onViewSourceGroup ? 'See all' : undefined}
          onAction={onViewSourceGroup}
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

      {!videoGalleryEnabled && shouldShowMoreVideos(sourceCards) ? (
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
              const previewUrl = placeSourcePreviewCandidates(
                sourceEvidencePreviewUrls[item.key],
                item.thumbnailUrl,
              ).find((url) => !failedSourcePreviewUrls[url]) ?? null;
              return (
                <Pressable
                  onPress={() => { void openSourceCard(item.url, attribution.platformName); }}
                  accessibilityRole="link"
                  accessibilityLabel={`Open ${item.primary ? 'original ' : ''}${attribution.platformName} video for ${saved.place.name}`}
                  style={({ pressed }) => [styles.sourceCard, pressed && styles.pressed]}
                >
                  <View style={styles.sourceCardMedia}>
                    {previewUrl ? (
                      <Image
                        source={{ uri: previewUrl }}
                        style={styles.sourceCardImage}
                        resizeMode="cover"
                        accessible={false}
                        onError={() => {
                          setFailedSourcePreviewUrls((current) => current[previewUrl]
                            ? current
                            : { ...current, [previewUrl]: true });
                        }}
                      />
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

      {videoGalleryEnabled ? (
        <PlaceVideoGalleryStrip
          placeName={saved.place.name}
          providerPhotos={photoUrls}
          ownerVideos={ownerPlaceVideos}
          communityVideos={communityPlaceVideos}
          totalVideoCount={placeVideoCount}
          onOpenProvider={openGalleryAt}
          onOpenVideo={(video) => { void openPlaceVideo(video); }}
          onSeeAll={() => router.push({ pathname: '/place/[id]/videos', params: { id: saved.place.id } })}
        />
      ) : null}

      <Modal visible={moreOpen} transparent animationType={reduceMotion ? 'none' : 'fade'} onRequestClose={() => setMoreOpen(false)}>
        <View style={styles.moreBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close place options" onPress={() => setMoreOpen(false)} />
          <ScrollView style={styles.moreMenu} contentContainerStyle={styles.moreMenuContent} accessibilityViewIsModal>
            <Text accessibilityRole="header" style={styles.moreTitle}>{saved.place.name}</Text>
            {capabilities.canEdit ? <Button title="Edit note" variant="text" icon="edit-3" onPress={() => { setMoreOpen(false); beginNoteEdit(whySaved.seedFromSourceNote); }} /> : null}
            <Button title="Share place" variant="text" icon="share" onPress={() => { setMoreOpen(false); void sharePlace(); }} />
            {capabilities.canMarkVisited && !visited.visited ? <Button title="Mark as visited" variant="text" icon="check-circle" onPress={() => { setMoreOpen(false); void handleMarkVisited(); }} /> : null}
            {capabilities.canReportWrongPlace ? <Button title="Wrong place?" accessibilityLabel="Wrong place? Correct this saved place" variant="text" icon="map-pin" onPress={() => { setMoreOpen(false); setWrongPlaceOpen(true); }} /> : null}
            {capabilities.canDelete ? <Button title="Remove saved place" accessibilityLabel={`Remove ${saved.place.name} from saved places`} variant="destructive" disabled={deleting} onPress={() => { setMoreOpen(false); confirmDelete(); }} /> : null}
            <Button title="Done" variant="secondary" onPress={() => setMoreOpen(false)} />
          </ScrollView>
        </View>
      </Modal>

      {capabilities.canReportWrongPlace ? <WrongPlaceSheet
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
        onRejected={() => {
          setWrongPlaceOpen(false);
          if (onRemoved) onRemoved(saved.id);
          else onRequestDismiss();
        }}
      /> : null}
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
    detailNavigation: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
    detailNavigationLabel: { ...typography.caption, color: colors.textSecondary },
    moreButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.pill, backgroundColor: colors.surface },
    destinationActions: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    destinationActionsLarge: { flexDirection: 'column', alignItems: 'stretch' },
    directionsButton: { flex: 1 },
    shareButton: { width: 50, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, backgroundColor: colors.surfaceElevated },
    photoThumbnails: { flexDirection: 'row', gap: Spacing.xs },
    photoThumbnailButton: { flex: 1, minHeight: 44, maxWidth: 72, padding: 2 },
    photoThumbnail: { width: '100%', height: 44, borderRadius: Radius.sm },
    noPhotoLabel: { ...typography.caption, color: colors.textSecondary, marginTop: Spacing.sm },
    reminderRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.lg, paddingVertical: Spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    reminderRowLarge: { flexWrap: 'wrap' },
    reminderCopy: { flex: 1, minWidth: 160 },
    reminderTitle: { ...typography.bodyStrong, color: colors.text },
    reminderDescription: { ...typography.caption, color: colors.textSecondary, marginTop: Spacing.xs },
    moreBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: colors.modalBackdrop },
    moreMenu: { maxHeight: '85%', flexGrow: 0, borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: colors.surface },
    moreMenuContent: { gap: Spacing.xs, padding: Spacing.xl, paddingBottom: 40 },
    moreTitle: { ...typography.heading, color: colors.text, marginBottom: Spacing.sm },
    hero: {
      aspectRatio: 4 / 3,
      borderRadius: Radius.md,
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
    photoCountPill: {
      position: 'absolute',
      right: Spacing.md,
      bottom: Spacing.md,
      minHeight: 30,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      borderRadius: Radius.pill,
      backgroundColor: 'rgba(0,0,0,0.72)',
    },
    photoCountText: { ...typography.caption, color: '#FFFFFF', fontWeight: '700' },
    videoHeroPill: {
      position: 'absolute', right: Spacing.md, top: Spacing.md, minHeight: 30,
      flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10,
      borderRadius: Radius.pill, backgroundColor: 'rgba(0,0,0,0.64)',
    },
    heroCaption: {
      paddingTop: Spacing.sm,
      gap: Spacing.sm,
    },
    placeName: {
      ...typography.title,
      color: colors.text,
      fontSize: 32,
      lineHeight: 38,
      fontWeight: '600',
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
      color: colors.textSecondary,
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
      paddingVertical: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
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
      fontSize: 11,
      lineHeight: 15,
      letterSpacing: 1.2,
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
      fontSize: 17,
      lineHeight: 24,
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
      flexWrap: 'wrap',
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
