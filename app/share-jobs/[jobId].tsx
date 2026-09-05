/**
 * app/share-jobs/[jobId].tsx — resolve a single needs_help / failed job.
 *
 * Reuses the EXISTING save primitives — usePlacesSearch (same Google Places
 * source as add-place/share), saveSavedPlace (same two-step place+saved_place
 * write, preserving source_url/source_type), and the shared saved-places cache
 * — so the candidate-confirm, multi-select, and manual-search UX matches the
 * synchronous flow. Resolving a job updates it transactionally and never
 * deletes a saved place.
 *
 * Deep-link target for `share_job_needs_help` notifications.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  Platform,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Location from 'expo-location';

import { Button, ErrorBoundary, Input, ShareJobsHeader } from '@/components';
import { CandidateConfirmationCard } from '@/components/CandidateConfirmationCard';
import { PlaceImage } from '@/components/PlaceImage';
import { SourceEvidenceGallery } from '@/components/SourceEvidenceGallery';
import { ShareJobsSheet } from '@/components/ShareJobsSheet';
import { TokenSymbol } from '@/components/TokenSymbol';
import { VayrinPresentationHeader } from '@/components/VayrinPresentationHeader';
import { WrongPlaceSheet } from '@/components/map/WrongPlaceSheet';
import { Radius, Spacing } from '@/constants';
import { isVayrinProductUiEnabled } from '@/lib/featureFlags';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { buildShareJobDetailState } from '@/lib/shareJobDetailState';
import type { NormalizedCandidate } from '@/lib/shareJobsUi';
import { planOpenOriginal, validateSourceUrl } from '@/lib/openOriginalPost';
import { sanitizeErrorText } from '@/lib/sanitizeError';
import { logDebug } from '@/lib/logger';
import { alreadySavedActionCopy } from '@/lib/savedPlaceSourceMerge';
import { normalizeShareUrl } from '@/lib/shareAgent/tiktokUrl';
import { PHASE_1_COPY, splitPlaceAddress } from '@/lib/sharePhase1Ui';
import {
  buildVayrinPresentation,
  mapShareJobToVayrinPresentation,
  type VayrinIdentityLead,
} from '@/lib/vayrinPresentation';
import { buildPhase2PreviewJob, isPhase2PreviewId } from '@/lib/phase2Preview';
import {
  buildVayrinCandidateFixtureJob,
  getVayrinCandidateFixture,
  isVayrinCandidateFixtureId,
} from '@/lib/vayrinCandidateFixtures';
import {
  planShareSaveCompletion,
  normalizeResultCandidates,
  partialResultFromPayload,
  saveSelectedLabel,
  sourceTimestampLabel,
  type ShareJobResultCandidate,
  type SharePlaceSaveOutcome,
} from '@/lib/shareJobResult';
import {
  applyBatchSaveOutcomes,
  allEligibleBatchRowsSelected,
  allEligibleBatchTargets,
  batchCompletionSavedPlaceIds,
  chooseBatchCandidate,
  clearAllEligibleBatchRows,
  closeBatchSearch,
  dismissBatchRow,
  duplicateSelectionOwner,
  failBatchSearch,
  finishBatchSearch,
  openBatchSearch,
  reconcileMultiPlaceBatch,
  recoverableBatchRowCount,
  rowCandidate,
  selectAllEligibleBatchRows,
  selectedBatchTargets,
  setBatchSearchQuery,
  setCandidateSelector,
  startBatchSearch,
  successfulBatchSavedPlaceIds,
  toggleBatchRow,
  type MultiPlaceBatch,
  type MultiPlaceBatchRow,
} from '@/lib/multiPlaceBatch';
import {
  batchActionCounts,
  batchPrimaryActionLabel,
  batchResolutionProgress,
  evidenceFramesForMention,
  initialExpandedMentionId,
  mentionSummaryStatus,
  visibleMentionCandidates,
  visibleMentionSearchCandidates,
} from '@/lib/vayrinMultiPlaceReview';
import {
  claimInitialQuickCheckSearch,
  quickCheckSearchKey,
  selectedQuickCheckCandidate,
} from '@/lib/quickCheckResolution';
import { createMapGroupFocusRequest } from '@/lib/mapGroupFocus';
import {
  claimSaveCompletionSignal,
  executeSaveCompletionNavigation,
  planSaveCompletionNavigation,
} from '@/lib/saveCompletionNavigation';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { getSavedPlacesCacheSnapshot } from '@/hooks/useSavedPlaces';
import { useSavedPlaces } from '@/hooks/useSavedPlaces';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { observeOnboardingV2Result } from '@/lib/onboardingV2';
import { isExpectedOnboardingSource } from '@/lib/onboardingV2Core';
import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { setCurrentShareJobId } from '@/lib/diagnosticContext';
import { createOnceLatch } from '@/lib/onceLatch';
import {
  resolveOpenSavedPlaceRoute,
  type OpenSavedPlaceSource,
} from '@/lib/openSavedPlace';
import {
  geocodeContextText,
  getPlaceDetails,
  searchPlaces,
  type LocationBias,
  type PlaceCandidate,
} from '@/services/placesService';
import { getSavedPlace } from '@/services/savedPlacesService';
import type { SavedPlaceWithPlace } from '@/types';
import {
  persistShareJobCandidate,
  shareJobCandidateToPlaceCandidate,
  shareJobSourceType,
  type ShareJobCandidateSaveOutcome,
} from '@/services/shareJobCandidateSave';
import {
  archiveShareJob,
  getShareJob,
  markShareJobResolved,
  retryShareJob,
  type ShareJob,
  type ShareJobCandidate,
} from '@/services/shareJobsService';
import { CATEGORY_LABELS, resolvePlaceCategory } from '@/lib/placeCategory';
import { requestPremiumRecognition } from '@/lib/monetizationClient';
import { premiumRequestsEnabled } from '@/lib/premiumRequests';
import {
  clearPendingPremiumRequestJobId,
  setPendingPremiumRequestJobId,
} from '@/lib/pendingPremiumRequest';
import {
  confirmationMode,
  confirmationPrompt,
  candidateSaveLabel,
  isBroadCandidate,
  reviewSelectionMode,
  toggleCandidateSelection,
  visibleCandidateShortlist,
  type CandidateConfirmationPlace,
} from '@/lib/vayrinCandidateConfirmation';
import { QUICK_CHECK_LAYOUT } from '@/lib/quickCheckDensity';
import {
  geographicFieldsFromLabel,
  normalizeResolutionName,
  type NearbyResolvedMention,
  type PlacesResolutionContext,
} from '@/lib/contextAwarePlacesResolution';

/** Human platform label for the "Suggested from …" source-context row. */
function platformNoun(platform: string | null | undefined): string {
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return 'an Instagram post';
    case 'tiktok':
      return 'a TikTok video';
    case 'youtube':
      return 'a YouTube video';
    default:
      return 'a shared link';
  }
}

function platformName(platform: string | null | undefined): string {
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    default:
      return 'Shared link';
  }
}

/** Reuse Nearr's existing share-URL normalization for "is this the same post?". */
const shareUrlKey = (url: string): string => normalizeShareUrl(url).url;

function hasCoords(c: ShareJobCandidate): boolean {
  return Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
}

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function sourceResolutionSeed(job: ShareJob | null, query: string): {
  contextLabel: string | null;
  mentionTimestamp: number | null;
  nearbyResolvedMentions: NearbyResolvedMention[];
  noNearbyMatch: boolean;
} {
  const payload = objectRecord(job?.candidate_payload);
  const slots = Array.isArray(payload?.mentionSlots) ? payload!.mentionSlots : [];
  const foldedQuery = normalizeResolutionName(query);
  const parsed = slots.map(objectRecord).filter((slot): slot is Record<string, unknown> => !!slot);
  const target = parsed.find((slot) => {
    const name = typeof slot.displayName === 'string' ? normalizeResolutionName(slot.displayName) : '';
    return !!name && (foldedQuery === name || foldedQuery.startsWith(`${name} `) || name.startsWith(`${foldedQuery} `));
  }) ?? parsed[0] ?? null;
  const timestamps = Array.isArray(target?.sourceTimestamps)
    ? target!.sourceTimestamps.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    : [];
  const nearbyResolvedMentions: NearbyResolvedMention[] = [];
  for (const slot of parsed) {
    if (slot === target || !Array.isArray(slot.candidates)) continue;
    for (const rawCandidate of slot.candidates.slice(0, 3)) {
      const candidate = objectRecord(rawCandidate);
      if (!candidate) continue;
      const googlePlaceId = typeof candidate.googlePlaceId === 'string' ? candidate.googlePlaceId.trim() : '';
      const lat = candidate.latitude;
      const lng = candidate.longitude;
      if (!googlePlaceId || typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const fields = geographicFieldsFromLabel(
        typeof candidate.contextLabel === 'string'
          ? candidate.contextLabel
          : typeof candidate.formattedAddress === 'string'
            ? candidate.formattedAddress
            : null,
      );
      const slotTimes = Array.isArray(slot.sourceTimestamps)
        ? slot.sourceTimestamps.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
        : [];
      nearbyResolvedMentions.push({
        googlePlaceId,
        name: typeof candidate.name === 'string' ? candidate.name : null,
        coordinates: { lat, lng },
        locality: fields.locality,
        region: fields.region,
        country: fields.country,
        mentionTimestamp: slotTimes[0] ?? null,
      });
      break;
    }
  }
  return {
    contextLabel: typeof target?.contextLabel === 'string' ? target.contextLabel : null,
    mentionTimestamp: timestamps[0] ?? null,
    nearbyResolvedMentions,
    noNearbyMatch: target?.noNearbyMatch === true,
  };
}

function toResultCandidate(candidate: PlaceCandidate): ShareJobResultCandidate {
  return {
    googlePlaceId: candidate.googlePlaceId,
    name: candidate.name,
    formattedAddress: candidate.formattedAddress,
    latitude: candidate.latitude,
    longitude: candidate.longitude,
    types: candidate.rawTypes ?? [],
    primaryType: candidate.primaryType,
    primaryTypeDisplayName: candidate.primaryTypeDisplayName,
    googleMapsTypeLabel: candidate.googleMapsTypeLabel,
    shortFormattedAddress: candidate.shortFormattedAddress,
    businessStatus: candidate.businessStatus,
    matchScore: null,
    contextReason: candidate.contextReason ?? null,
    contextLabel: candidate.contextLabel ?? null,
    distanceKm: candidate.distanceKm ?? null,
    localityMatch: candidate.localityMatch === true,
    wideningTierKm: candidate.wideningTierKm ?? null,
  };
}

type SearchPhase = 'idle' | 'searching' | 'results' | 'empty' | 'error';

/**
 * Why a detail load did not produce a job. Recorded in the developer log and
 * the breadcrumb trail so a repeat of the "couldn't open this item" report is
 * diagnosable without a debugger. Low-cardinality tags only — never payloads.
 */
type DetailLoadFailure =
  | 'invalid_route_id'
  | 'not_found'
  | 'authorization_failed'
  | 'query_failed'
  | 'unexpected';

/** Classify a thrown load error WITHOUT retaining the raw message. */
function classifyLoadFailure(error: unknown): DetailLoadFailure {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/jwt|token|permission|denied|not authoriz|policy|row-level/i.test(message)) {
    return 'authorization_failed';
  }
  if (/network|fetch|timeout|offline|connection/i.test(message)) return 'query_failed';
  return 'unexpected';
}

/** A load failure the user can meaningfully retry (vs. a row that is gone). */
function isRetryableLoadFailure(failure: DetailLoadFailure | null): boolean {
  return failure === 'authorization_failed' || failure === 'query_failed' || failure === 'unexpected';
}

function formatLeadTimestamp(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function ShareJobDetailScreen() {
  const router = useRouter();
  const safeAreaInsets = useSafeAreaInsets();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  // Expo Router can hand back an array or an empty value for a route param —
  // normalise ONCE so no downstream string call can throw on it.
  const routeJobId = typeof jobId === 'string' ? jobId.trim() : '';
  const { colors, typography } = useTheme();
  const vayrinEnabled = isVayrinProductUiEnabled();
  const premiumRequestsAvailable = premiumRequestsEnabled();
  const { state: onboardingV2 } = useOnboardingV2();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [job, setJob] = useState<ShareJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<DetailLoadFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [premiumBusy, setPremiumBusy] = useState(false);
  const [premiumOfferDismissed, setPremiumOfferDismissed] = useState(false);
  const premiumOfferTrackedRef = useRef<string | null>(null);
  const areaMatchIncompleteTrackedRef = useRef<string | null>(null);
  const [manualQuery, setManualQuery] = useState('');
  const [manualSearchPhase, setManualSearchPhase] = useState<SearchPhase>('idle');
  const [manualSelectedIds, setManualSelectedIds] = useState<string[]>([]);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([]);
  const [batch, setBatch] = useState<MultiPlaceBatch | null>(null);
  const [expandedMentionId, setExpandedMentionId] = useState<string | null>(null);
  // The alternative-place search is a SECONDARY action — collapsed by default
  // for single-candidate jobs, revealed on demand. Manual-only jobs start
  // expanded because search is their primary action.
  const [searchExpanded, setSearchExpanded] = useState(false);
  // Inline, non-blocking notice if the original post can no longer be opened.
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctionSaved, setCorrectionSaved] = useState<SavedPlaceWithPlace | null>(null);
  const seededQueryRef = useRef(false);
  const manualQueryEditedRef = useRef(false);
  // SYNCHRONOUS re-entrancy guard for the terminal save+resolve+navigate. The
  // `busy` state above drives the UI spinner, but state updates are async: two
  // taps fired in the same tick both read `busy === false` and would each run a
  // full save + navigation. This ref flips synchronously so the second tap is
  // dropped immediately. Also guarantees "navigate exactly once".
  const resolvingRef = useRef(false);
  const navigateOnceRef = useRef(createOnceLatch());
  // Ignore async completions (setState / navigation) after the screen unmounts
  // — a realtime/poll update or a late save response must never touch an
  // unmounted tree or fire a second navigation.
  const mountedRef = useRef(true);
  const manualRequestRef = useRef(0);
  const rawResolutionQueryRef = useRef<string | null>(null);
  const batchSearchRequestsRef = useRef<Record<string, number>>({});
  const disclosureInitializedJobRef = useRef<string | null>(null);
  const userLocationRef = useRef<LocationBias | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;
        const last = await Location.getLastKnownPositionAsync({});
        if (alive && last) {
          userLocationRef.current = { lat: last.coords.latitude, lng: last.coords.longitude };
        }
      } catch {
        // Manual proximity is best-effort and never prompts from this screen.
      }
    })();
    return () => { alive = false; };
  }, []);

  const { results, loading: searching, error: searchError, search, reset: resetSearch } = usePlacesSearch();
  const { data: savedPlaces } = useSavedPlaces();

  const runManualSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const requestId = ++manualRequestRef.current;
    if (vayrinEnabled) {
      void trackEvent('vayrin_manual_fallback', { source: 'async' });
      void trackEvent('vayrin_manual_search_started', { source: 'async' });
      if (rawResolutionQueryRef.current === trimmed) {
        void trackEvent('vayrin_raw_name_resolution_attempt', { source: 'async' });
      }
    }
    setManualSelectedIds([]);
    setManualSearchPhase('searching');
    const fixture = __DEV__ && isVayrinCandidateFixtureId(job?.id)
      ? getVayrinCandidateFixture(job.id)
      : null;
    const seed = sourceResolutionSeed(job, trimmed);
    const fields = geographicFieldsFromLabel(seed.contextLabel);
    const sourceCoordinates = seed.contextLabel
      ? await geocodeContextText(seed.contextLabel)
      : null;
    const sourceContextAvailable = !!(
      seed.contextLabel || sourceCoordinates || seed.nearbyResolvedMentions.length > 0
    );
    const resolutionContext: PlacesResolutionContext = sourceContextAvailable
      ? {
          mode: 'source',
          inferredLocality: fields.locality,
          inferredRegion: fields.region,
          inferredCountry: fields.country,
          inferredCoordinates: sourceCoordinates,
          regionConfidence: seed.contextLabel ? 'strong' : 'medium',
          sourceEvidence: seed.contextLabel ? ['video_region'] : ['nearby_resolved_video_place'],
          mentionTimestamp: seed.mentionTimestamp,
          nearbyResolvedMentions: seed.nearbyResolvedMentions,
          userLocation: null,
        }
      : {
          mode: 'manual',
          userLocation: userLocationRef.current,
          regionConfidence: 'none',
        };
    const searchBias = sourceCoordinates ??
      seed.nearbyResolvedMentions[0]?.coordinates ??
      (!sourceContextAvailable ? userLocationRef.current : null) ??
      undefined;
    const found = fixture?.manualResults
      ? fixture.manualResults.map((candidate) => shareJobCandidateToPlaceCandidate(candidate))
      : await search(trimmed, searchBias, resolutionContext);
    if (!mountedRef.current || requestId !== manualRequestRef.current) return;
    const initial = selectedQuickCheckCandidate(trimmed, found);
    setManualSelectedIds(initial ? [initial.googlePlaceId] : []);
    setManualSearchPhase(found.length > 0 ? 'results' : 'empty');
    if (vayrinEnabled && rawResolutionQueryRef.current === trimmed) {
      void trackEvent(found.length > 0
        ? 'vayrin_raw_name_resolution_success'
        : 'vayrin_raw_name_resolution_failure', {
        source: 'async',
        candidate_count_internal: found.length,
        candidate_count_shown: Math.min(found.length, 3),
      });
    }
  }, [job, search, vayrinEnabled]);

  function changeManualQuery(value: string) {
    manualRequestRef.current += 1;
    manualQueryEditedRef.current = true;
    setManualQuery(value);
    setManualSelectedIds([]);
    setManualSearchPhase('idle');
    resetSearch();
  }

  const load = useCallback(async () => {
    // A bad id must resolve to an honest state, not an endless spinner.
    const id = routeJobId;
    if (!id) {
      logDebug('share-job-detail', 'load_failed reason=invalid_route_id');
      recordBreadcrumb('candidate_loaded', { result: 'load_failed:invalid_route_id' });
      if (mountedRef.current) {
        setLoadFailure('invalid_route_id');
        setLoading(false);
      }
      return;
    }
    try {
      const previewSaved = getSavedPlacesCacheSnapshot()?.find(
        (saved) => saved.place?.google_place_id,
      );
      const j = __DEV__ && isVayrinCandidateFixtureId(id)
        ? buildVayrinCandidateFixtureJob(id)
        : __DEV__ && isPhase2PreviewId(id)
          ? buildPhase2PreviewJob(
            id,
            previewSaved?.place?.google_place_id
              ? {
                  googlePlaceId: previewSaved.place.google_place_id,
                  name: previewSaved.place.name,
                  formattedAddress: previewSaved.place.formatted_address,
                  latitude: previewSaved.place.latitude,
                  longitude: previewSaved.place.longitude,
                  types: [],
                  matchScore: 1,
                }
              : null,
            )
          : await getShareJob(id);
      if (!mountedRef.current) return;
      setJob(j);
      // A row the user can no longer read (deleted, or RLS-scoped away) comes
      // back as null rather than an error — that is "not found", not a crash.
      setLoadFailure(j ? null : 'not_found');
      // `reason` names the payload interpretation that was chosen, so a future
      // report distinguishes "job not found" from "payload had no candidates".
      const outcome = j ? buildShareJobDetailState(j).reason : 'not_found';
      logDebug('share-job-detail', `load_ok status=${j?.status ?? 'none'} state=${outcome}`);
      recordBreadcrumb('candidate_loaded', { jobId: id, result: outcome });
      if (j && !seededQueryRef.current && j.suggested_query) {
        manualQueryEditedRef.current = false;
        setManualQuery(j.suggested_query);
        seededQueryRef.current = true;
      }
    } catch (error) {
      if (!mountedRef.current) return;
      const failure = classifyLoadFailure(error);
      // Sanitized: never logs tokens, signed URLs, or provider payloads.
      logDebug(
        'share-job-detail',
        `load_failed reason=${failure} detail=${sanitizeErrorText(error)}`,
      );
      recordBreadcrumb('candidate_loaded', { jobId: id, result: `load_failed:${failure}` });
      setLoadFailure(failure);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [routeJobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Track the current share-job id + queue-opened breadcrumb for diagnostics.
  useEffect(() => {
    if (!routeJobId) return;
    setCurrentShareJobId(routeJobId);
    recordBreadcrumb('queue_item_opened', { jobId: routeJobId });
    return () => setCurrentShareJobId(null);
  }, [routeJobId]);

  // Poll while the job is still processing so the detail updates live.
  // (Same set as detail.kind === 'processing'; kept status-based because this
  // runs above the payload mapping.)
  const isProcessing = job?.status === 'queued' || job?.status === 'processing_metadata';
  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [isProcessing, load]);

  useEffect(() => {
    if (job?.status !== 'awaiting_purchase') return;
    router.replace({ pathname: '/monetization', params: { jobId: job.id, entry: 'job' } });
  }, [job?.id, job?.status, router]);

  useEffect(() => {
    if (!premiumRequestsAvailable || job?.premium_state !== 'eligible' || premiumOfferTrackedRef.current === job.id) return;
    premiumOfferTrackedRef.current = job.id;
    void trackEvent('premium_request_offer_viewed', { job_id: job.id });
  }, [job?.id, job?.premium_state, premiumRequestsAvailable]);

  const startPremiumRequest = useCallback(async () => {
    if (!premiumRequestsAvailable || !job || premiumBusy) return;
    setPremiumBusy(true);
    const partial = partialResultFromPayload(job.candidate_payload);
    void trackEvent('premium_request_cta_tapped', {
      job_id: job.id,
      token_cost: 1,
      ...(partial?.resultClass === 'area_match_incomplete' ? {
        resolved_specificity: partial.resolvedSpecificity,
        intended_specificity: partial.intendedSpecificity,
        source_platform: job.source_platform ?? null,
        premium_eligible: job.premium_state === 'eligible',
      } : {}),
    });
    try {
      const result = await requestPremiumRecognition(job.id);
      if (result.requiresPurchase) {
        await setPendingPremiumRequestJobId(job.id);
        router.push({ pathname: '/monetization', params: { premiumJobId: job.id, entry: 'premium_request' } });
        return;
      }
      await clearPendingPremiumRequestJobId(job.id);
      await load();
    } catch {
      Alert.alert('Premium Request unavailable', 'Nothing was charged. Please try again.');
      void trackEvent('premium_request_failed', { job_id: job.id, stage: 'request' });
    } finally {
      if (mountedRef.current) setPremiumBusy(false);
    }
  }, [job, load, premiumBusy, premiumRequestsAvailable, router]);

  const platform = job?.source_platform ?? null;
  const sourceUrl = job?.canonical_url ?? job?.source_url ?? null;
  const extractionPayload = job?.extraction_payload && typeof job.extraction_payload === 'object'
    ? job.extraction_payload as Record<string, unknown>
    : null;
  const overallSourceFrameUrl = typeof extractionPayload?.sourceFrameUrl === 'string'
    ? extractionPayload.sourceFrameUrl
    : typeof extractionPayload?.source_frame_url === 'string'
      ? extractionPayload.source_frame_url
      : null;
  // ONE payload-tolerant mapping from the persisted row to what this screen
  // renders (lib/shareJobDetailState). Nothing below re-interprets
  // candidate_payload, so a drifted/partial payload can never throw here.
  const detail = useMemo(() => buildShareJobDetailState(job), [job]);
  const areaMatchIncomplete = detail.partialResult?.resultClass === 'area_match_incomplete';
  const incompleteArea = areaMatchIncomplete ? detail.partialResult : null;
  const areaName = incompleteArea?.area?.name ?? incompleteArea?.locality ?? null;
  const areaLocation = incompleteArea
    ? [areaName, incompleteArea.area?.country]
      .filter((value, index, values): value is string => !!value && values.indexOf(value) === index)
      .join(', ')
    : null;
  const premiumState = job?.premium_state ?? 'not_eligible';
  const vayrinPresentation = useMemo(
    () => mapShareJobToVayrinPresentation(detail, job),
    [detail, job],
  );
  useEffect(() => {
    if (!job || !areaMatchIncomplete || areaMatchIncompleteTrackedRef.current === job.id) return;
    areaMatchIncompleteTrackedRef.current = job.id;
    void trackEvent('area_match_incomplete_shown', {
      job_id: job.id,
      resolved_specificity: incompleteArea?.resolvedSpecificity,
      intended_specificity: incompleteArea?.intendedSpecificity,
      source_platform: job.source_platform ?? null,
      premium_eligible: job.premium_state === 'eligible',
    });
  }, [areaMatchIncomplete, incompleteArea?.intendedSpecificity, incompleteArea?.resolvedSpecificity, job]);
  const onboardingShare = isExpectedOnboardingSource(
    onboardingV2?.pendingShare ?? null,
    sourceUrl,
  );
  useEffect(() => {
    if (!onboardingShare || !sourceUrl) return;
    if (detail.kind === 'confirm' || detail.kind === 'completed') {
      void observeOnboardingV2Result(sourceUrl, 'found');
    } else if (detail.kind === 'picker' || detail.kind === 'multi') {
      void observeOnboardingV2Result(sourceUrl, 'multiple');
    } else if (detail.kind === 'manual') {
      void observeOnboardingV2Result(sourceUrl, 'not_enough');
    }
  }, [detail.kind, onboardingShare, sourceUrl]);
  const candidates = detail.candidates;
  const mentionSlots = detail.mentionSlots;
  const persistedConfirmationCandidates = useMemo(
    () => normalizeResultCandidates(
      job?.candidate_payload && typeof job.candidate_payload === 'object'
        ? (job.candidate_payload as { candidates?: unknown }).candidates
        : [],
    ),
    [job?.candidate_payload],
  );
  const rankedConfirmationCandidates = useMemo(() => candidates.map((candidate) => {
    const slot = mentionSlots.find((item) =>
      item.candidates.some((choice) => choice.googlePlaceId === candidate.googlePlaceId));
    const persisted = slot?.candidates.find((choice) => choice.googlePlaceId === candidate.googlePlaceId)
      ?? persistedConfirmationCandidates.find((choice) => choice.googlePlaceId === candidate.googlePlaceId);
    const evidenceItems = (slot?.noteEvidence ?? []).map((item) => ({
      source: item.source,
      timestampSeconds: item.timestampSeconds,
    }));
    return {
      ...candidate,
      photoUrls: persisted?.photoUrls ?? [],
      evidence: persisted?.evidence ?? [],
      reasons: persisted?.reasons ?? [],
      matchStrength: persisted?.matchStrength ?? null,
      sourceFrameUrl: candidate.sourceFrameUrl ?? slot?.sourceFrameUrl ?? overallSourceFrameUrl,
      sourceTimestamps: candidate.sourceTimestamps.length > 0
        ? candidate.sourceTimestamps
        : slot?.sourceTimestamps ?? [],
      matchedFrameTimestamps: evidenceItems
        .filter((item) => item.source === 'frame' && item.timestampSeconds != null)
        .map((item) => item.timestampSeconds!),
      analyzedFrameCount: detail.evidenceFrames.length,
      evidenceItems,
    } satisfies CandidateConfirmationPlace;
  }), [candidates, detail.evidenceFrames.length, mentionSlots, overallSourceFrameUrl, persistedConfirmationCandidates]);
  const confirmationCandidates = useMemo(
    () => visibleCandidateShortlist(rankedConfirmationCandidates),
    [rankedConfirmationCandidates],
  );
  const candidateMode = confirmationMode(confirmationCandidates);
  const pickerSelectionMode = reviewSelectionMode(mentionSlots);
  const candidateConfirmationPresentation = {
    ...vayrinPresentation,
    headline: candidateMode === 'multiple'
      ? 'A few places match this video.'
      : confirmationPrompt(candidateMode),
    body: candidateMode === 'broad'
      ? 'This is an area match. Search nearby to choose an exact destination.'
      : candidateMode === 'multiple'
        ? 'Compare the photos, frames, and match evidence.'
        : 'Compare the photos, frames, and match evidence before saving.'
  };
  useEffect(() => {
    if (detail.kind !== 'picker') {
      setPickerSelectedIds([]);
      return;
    }
    setPickerSelectedIds((current) => {
      const retained = current.filter((id) =>
        confirmationCandidates.some((candidate) => candidate.googlePlaceId === id));
      return pickerSelectionMode === 'exclusive' ? retained.slice(0, 1) : retained;
    });
  }, [confirmationCandidates, detail.kind, job?.id, pickerSelectionMode]);
  const reviewSlots = useMemo(() => {
    if (mentionSlots.length > 0) return mentionSlots;
    return candidates.map((candidate) => ({
      mentionId: `provider:${candidate.googlePlaceId}`,
      displayName: candidate.name,
      contextLabel: candidate.formattedAddress,
      primaryVenueName: null,
      hostVenueName: null,
      relationshipType: null,
      outcome: 'verified_single' as const,
      candidates: [candidate],
      aiNote: candidate.aiNote ?? null,
      saveState: 'pending' as const,
      savedPlaceId: null,
    }));
  }, [candidates, mentionSlots]);
  const automaticallySavedPlaceIds = detail.savedPlaceIds;
  const savedSnapshot = useMemo(
    () => savedPlaces.length > 0 ? savedPlaces : getSavedPlacesCacheSnapshot() ?? [],
    [savedPlaces],
  );
  const fixtureAlreadySavedGooglePlaceIds = useMemo(
    () => Array.isArray(extractionPayload?.fixtureAlreadySavedGooglePlaceIds)
      ? extractionPayload.fixtureAlreadySavedGooglePlaceIds.filter((value): value is string => typeof value === 'string')
      : [],
    [extractionPayload],
  );
  const savedByGoogleId = useMemo(() => Object.fromEntries(
    [
      ...savedSnapshot
      .filter((saved) => !!saved.place?.google_place_id)
      .map((saved) => [saved.place.google_place_id as string, saved.id] as const),
      ...fixtureAlreadySavedGooglePlaceIds.map((googlePlaceId) => [googlePlaceId, `fixture-saved:${googlePlaceId}`] as const),
    ],
  ), [fixtureAlreadySavedGooglePlaceIds, savedSnapshot]);
  const presentationEventRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vayrinEnabled || !job?.id) return;
    const key = `${job.id}:${vayrinPresentation.kind}`;
    if (presentationEventRef.current === key) return;
    presentationEventRef.current = key;
    void trackEvent('vayrin_result_shown', {
      job_id: job.id,
      result_type: vayrinPresentation.kind,
      source: 'async',
    });
  }, [job?.id, vayrinEnabled, vayrinPresentation.kind]);

  const confirmationViewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vayrinEnabled || !job?.id || (detail.kind !== 'confirm' && detail.kind !== 'picker')) return;
    const key = `${job.id}:${candidateMode}:${confirmationCandidates.length}`;
    if (confirmationViewedRef.current === key) return;
    confirmationViewedRef.current = key;
    void trackEvent('vayrin_confirmation_viewed', {
      job_id: job.id,
      candidate_count: confirmationCandidates.length,
      candidate_count_internal: rankedConfirmationCandidates.length,
      candidate_count_shown: confirmationCandidates.length,
      candidate_type: candidateMode,
      has_place_photo: confirmationCandidates.some((candidate) => Boolean(candidate.photoUrl || candidate.googlePlaceId)),
      has_video_frame_fallback: confirmationCandidates.some((candidate) => Boolean(candidate.sourceFrameUrl)),
    });
  }, [candidateMode, confirmationCandidates, detail.kind, job?.id, rankedConfirmationCandidates.length, vayrinEnabled]);

  // Keyed off the mapped view, so a grouped job identified by its persisted
  // slots (rather than by `decision`) still builds its batch instead of
  // spinning forever behind the "Review places" header.
  useEffect(() => {
    if (!job?.id || detail.kind !== 'multi') return;
    setBatch((current) => reconcileMultiPlaceBatch({
      jobId: job.id,
      slots: reviewSlots,
      savedByGoogleId,
      previous: current,
    }));
  }, [detail.kind, job?.id, reviewSlots, savedByGoogleId]);

  useEffect(() => {
    if (!batch) return;
    if (disclosureInitializedJobRef.current !== batch.jobId) {
      disclosureInitializedJobRef.current = batch.jobId;
      setExpandedMentionId(initialExpandedMentionId(batch));
      return;
    }
    if (expandedMentionId && !batch.rows[expandedMentionId]) setExpandedMentionId(null);
  }, [batch, expandedMentionId]);

  // Seed the manual search only for a job that genuinely has nothing to offer.
  useEffect(() => {
    if (!routeJobId || detail.kind !== 'manual' || !detail.canSearchManually ||
        vayrinPresentation.leads.length > 0 || detail.partialResult?.discoveryOnly) return;
    const query = manualQuery.trim();
    if (!query || manualQueryEditedRef.current) return;
    const key = quickCheckSearchKey(routeJobId, 'manual', query);
    if (!claimInitialQuickCheckSearch(key)) return;
    void runManualSearch(query);
  }, [detail.canSearchManually, detail.kind, detail.partialResult?.discoveryOnly, routeJobId, manualQuery, runManualSearch, vayrinPresentation.leads.length]);

  useEffect(() => {
    if (
      searchError &&
      !searching &&
      (manualSearchPhase === 'searching' || manualSearchPhase === 'empty')
    ) {
      setManualSearchPhase('error');
    }
  }, [manualSearchPhase, searchError, searching]);

  async function persistCandidate(
    candidate: PlaceCandidate,
    aiNote: string | null = null,
  ): Promise<ShareJobCandidateSaveOutcome> {
    if (__DEV__ && (isPhase2PreviewId(job?.id) || isVayrinCandidateFixtureId(job?.id))) {
      throw new Error('This development preview is read-only.');
    }
    return persistShareJobCandidate({
      candidate,
      jobId: job?.id ?? null,
      platform,
      sourceUrl,
      aiNote,
    });
  }

  // Resolve the job to the exact canonical saved place returned by the shared
  // save boundary. Created, reused and enriched saves all carry this identity.
  async function resolveJobWith(
    jobId: string,
    savedPlaceId: string,
    duplicate: boolean,
  ): Promise<void> {
    if (vayrinEnabled) {
      void trackEvent('vayrin_saved', {
        job_id: jobId,
        source: 'async',
        duplicate,
      });
      void trackEvent('vayrin_candidate_saved', {
        job_id: jobId,
        source: 'async',
        duplicate,
      });
    }
    await markShareJobResolved(jobId, savedPlaceId);
    completeManualSave(
      duplicate ? [] : [savedPlaceId],
      duplicate ? [savedPlaceId] : [],
    );
  }

  function openNewlySavedPlaces(savedPlaceIds: string[], failedCount = 0) {
    completeManualSave(savedPlaceIds, [], failedCount);
  }

  function completeManualSave(
    createdSavedPlaceIds: string[],
    duplicateSavedPlaceIds: string[],
    failedCount = 0,
  ) {
    const completionIds = [...createdSavedPlaceIds, ...duplicateSavedPlaceIds];
    if (
      completionIds.length === 0 ||
      !navigateOnceRef.current.acquire()
    ) return;
    const shouldNavigate = claimSaveCompletionSignal(completionIds);
    recordBreadcrumb('actual_navigation', {
      savedPlaceId: completionIds[0] ?? null,
      result: createdSavedPlaceIds.length > 1 ? 'open_saved_group' : 'open_saved_place:share_job_saved',
    });
    // A grouped fit is only requested when there is genuinely more than one new
    // place; the planner falls back to single focus if the request can't be made.
    const request =
      completionIds.length > 1
        ? createMapGroupFocusRequest({
            savedPlaceIds: completionIds,
            source: 'share_job_saved',
            failedCount,
          })
        : null;
    const plan = planSaveCompletionNavigation({
      createdSavedPlaceIds,
      duplicateSavedPlaceIds,
      canDismiss: router.canDismiss(),
      mapGroupId: request?.id ?? null,
      failedCount,
    });
    executeSaveCompletionNavigation(plan, router, shouldNavigate);
  }

  async function handleSaveStored(candidate: ShareJobCandidate) {
    if (!job || resolvingRef.current) return;
    if (!candidate.googlePlaceId) {
      Alert.alert('Search for it', 'Use the search below to pick the exact place.');
      return;
    }
    resolvingRef.current = true;
    if (vayrinEnabled) {
      void trackEvent('vayrin_candidate_selected', {
        job_id: job.id,
        source: 'async',
        result_type: vayrinPresentation.kind,
      });
    }
    if (mountedRef.current) setBusy(true);
    try {
      // Older persisted payloads may omit coordinates or optional presentation
      // fields. The provider identity is authoritative, so hydrate that exact
      // Place ID instead of discarding the candidate or running a fuzzy search.
      const placeCandidate = hasCoords(candidate)
        ? shareJobCandidateToPlaceCandidate(candidate)
        : await getPlaceDetails(candidate.googlePlaceId);
      const { savedPlaceId, duplicate } = await persistCandidate(
        placeCandidate,
        candidate.aiNote ?? null,
      );
      await resolveJobWith(job.id, savedPlaceId, duplicate);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      resolvingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleSaveManual(candidate: PlaceCandidate) {
    if (!job || resolvingRef.current) return;
    resolvingRef.current = true;
    if (mountedRef.current) setBusy(true);
    try {
      const { savedPlaceId, duplicate } = await persistCandidate(candidate);
      await resolveJobWith(job.id, savedPlaceId, duplicate);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      resolvingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleSaveCanonicalCandidates(
    selected: readonly (NormalizedCandidate | ShareJobCandidate | PlaceCandidate)[],
    source: 'async_picker' | 'raw_name_search',
  ) {
    if (!job || resolvingRef.current || selected.length === 0) return;
    const unique = [...new Map(selected.map((candidate) => [candidate.googlePlaceId, candidate])).values()];
    resolvingRef.current = true;
    if (mountedRef.current) setBusy(true);
    void trackEvent('vayrin_candidate_selected', {
      job_id: job.id,
      source,
      candidate_count_selected: unique.length,
      multi_select_count: unique.length,
    });
    try {
      const settled = await Promise.allSettled(unique.map(async (candidate) => {
        const hydrated: PlaceCandidate = 'googleMapsUrl' in candidate
          ? candidate
          : hasCoords(candidate as ShareJobCandidate)
            ? shareJobCandidateToPlaceCandidate(candidate as ShareJobCandidate)
            : await getPlaceDetails(candidate.googlePlaceId);
        const result = await persistCandidate(
          hydrated,
          'aiNote' in candidate ? candidate.aiNote ?? null : null,
        );
        return result;
      }));
      const created: string[] = [];
      const duplicates: string[] = [];
      let failed = 0;
      for (const result of settled) {
        if (result.status === 'rejected') {
          failed += 1;
        } else if (result.value.duplicate) {
          duplicates.push(result.value.savedPlaceId);
        } else {
          created.push(result.value.savedPlaceId);
        }
      }
      const resolutionId = created[0] ?? duplicates[0] ?? null;
      if (resolutionId) await markShareJobResolved(job.id, resolutionId);
      if (resolutionId) {
        void trackEvent('vayrin_saved', {
          job_id: job.id,
          source,
          saved_count: created.length,
          duplicate_count: duplicates.length,
          candidate_count_selected: unique.length,
          multi_select_count: unique.length,
        });
        completeManualSave(created, duplicates, failed);
      } else {
        throw new Error('No selected places could be saved. Please retry.');
      }
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      resolvingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleSaveBatch(
    activeBatch: MultiPlaceBatch,
    action: 'selected' | 'all',
  ) {
    if (!job || resolvingRef.current) return;
    const targets = action === 'all'
      ? allEligibleBatchTargets(activeBatch)
      : selectedBatchTargets(activeBatch);
    if (targets.length === 0) return;
    void trackEvent(action === 'all' ? 'multi_place_save_all' : 'multi_place_save_selected', {
      source_type: platform ?? 'link',
      job_id: job.id,
      selected_count: targets.length,
      logical_place_count: activeBatch.order.length,
    });
    resolvingRef.current = true;
    if (mountedRef.current) setBusy(true);
    try {
      const settled = await Promise.allSettled(
        targets.map(async (target) => {
          const result = await persistCandidate(
            shareJobCandidateToPlaceCandidate(target.candidate),
            target.aiNote ?? target.candidate.aiNote ?? null,
          );
          return { target, ...result };
        }),
      );
      const outcomes: SharePlaceSaveOutcome[] = settled.map((result, index) => {
        const target = targets[index]!;
        if (result.status === 'rejected') {
          return {
            logicalPlaceId: target.logicalPlaceId,
            candidateId: target.candidate.googlePlaceId,
            status: 'failed',
            savedPlaceId: null,
          };
        }
        return {
          logicalPlaceId: target.logicalPlaceId,
          candidateId: target.candidate.googlePlaceId,
          status: result.value.duplicate ? 'duplicate' : 'saved',
          savedPlaceId: result.value.savedPlaceId,
        };
      });
      const completion = planShareSaveCompletion(outcomes);
      const nextBatch = applyBatchSaveOutcomes(activeBatch, outcomes);
      if (mountedRef.current) setBatch(nextBatch);
      const remainingRecovery = recoverableBatchRowCount(nextBatch);
      if (completion.failedCandidateIds.length > 0 || remainingRecovery > 0) {
        const createdCount = completion.createdSavedPlaceIds.length;
        const duplicateCount = completion.duplicateSavedPlaceIds.length;
        const newAttemptCount = createdCount + completion.failedCandidateIds.length;
        Alert.alert(
          createdCount > 0
            ? `Saved ${createdCount} of ${newAttemptCount} ${newAttemptCount === 1 ? 'place' : 'places'}`
            : duplicateCount > 0
              ? 'No new places were saved'
              : 'Could not save these places',
          `${duplicateCount > 0 ? `${duplicateCount} ${duplicateCount === 1 ? 'place was' : 'places were'} already saved. ` : ''}${
            remainingRecovery > 0
              ? `${remainingRecovery} ${remainingRecovery === 1 ? 'place still needs' : 'places still need'} your attention.`
              : 'The failed places remain selected and ready to retry.'
          }`,
        );
        return;
      }
      const accumulated = batchCompletionSavedPlaceIds(nextBatch);
      const successfulOutcome = outcomes.find((outcome) => outcome.status !== 'failed');
      if (!successfulOutcome) {
        console.error('[share-jobs] batch completed without a successful canonical outcome', {
          jobId: job.id,
          targetCount: targets.length,
        });
        return;
      }
      const resolutionId = accumulated.createdSavedPlaceIds[0] ??
        accumulated.duplicateSavedPlaceIds[0] ??
        successfulOutcome.savedPlaceId;
      await markShareJobResolved(job.id, resolutionId);
      if (vayrinEnabled) {
        void trackEvent('vayrin_saved', {
          job_id: job.id,
          source: 'async_multi',
          saved_count: accumulated.createdSavedPlaceIds.length,
          duplicate_count: accumulated.duplicateSavedPlaceIds.length,
        });
      }
      completeManualSave(
        accumulated.createdSavedPlaceIds,
        accumulated.duplicateSavedPlaceIds,
      );
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      resolvingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  }

  async function handleSaveSelected() {
    if (!batch) return;
    await handleSaveBatch(batch, 'selected');
  }

  async function handleSaveAll() {
    if (!batch) return;
    const selectedAll = selectAllEligibleBatchRows(batch);
    if (mountedRef.current) setBatch(selectedAll);
    await handleSaveBatch(selectedAll, 'all');
  }

  async function handleRemove() {
    if (!job) return;
    try {
      await archiveShareJob(job.id);
      router.back();
    } catch {
      Alert.alert('Could not remove', 'Please try again in a moment.');
    }
  }

  async function handleRetry() {
    if (!job) return;
    try {
      await retryShareJob(job.id);
      await load();
    } catch {
      Alert.alert('Could not retry', 'Please try again in a moment.');
    }
  }

  // Open the original post in the source app (via https universal link → native
  // app when installed, otherwise the browser). Validates the untrusted source
  // URL against the HTTPS platform allow-list first, NEVER resolves/cancels/
  // removes the job, and shows a small inline notice on failure.
  async function openOriginalPost() {
    const plan = planOpenOriginal(sourceUrl);
    if (plan.kind !== 'open') {
      setOpenMsg("This post can't be opened anymore.");
      return;
    }
    setOpenMsg(null);
    void trackEvent('share_job_original_post_opened', {
      job_id: job?.id ?? null,
      platform,
      host: plan.host,
    });
    try {
      await Linking.openURL(plan.url);
    } catch {
      setOpenMsg("Couldn't open the original post.");
    }
  }

  // Lightweight confirmation before a destructive remove.
  function confirmRemove() {
    Alert.alert(PHASE_1_COPY.removeTitle, PHASE_1_COPY.removeMessage, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void handleRemove() },
    ]);
  }

  function revealSearch() {
    if (!manualQuery) setManualQuery(job?.suggested_query || candidates[0]?.name || '');
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSearchExpanded(true);
  }

  function hideSearch() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSearchExpanded(false);
  }

  // ONE canonical way to open an EXISTING saved place on the map. Validates the
  // identifiers (lib/openSavedPlace), records a sanitized breadcrumb, and
  // navigates AT MOST ONCE (the once-latch). Resolving by saved_places.id first
  // and google_place_id second is what makes "View place" reliably open the
  // place that is actually on the user's map — even when the share job is
  // already terminal / removed from the queue, and without any candidate data.
  function openExistingPlace(args: {
    savedPlaceId?: string | null;
    googlePlaceId?: string | null;
    source: OpenSavedPlaceSource;
  }) {
    if (!navigateOnceRef.current.acquire()) return;
    recordBreadcrumb('actual_navigation', {
      savedPlaceId: args.savedPlaceId ?? null,
      result: `open_saved_place:${args.source}`,
    });
    // Tear down the queue + detail modals first so the map is never covered.
    if (router.canDismiss()) {
      try {
        router.dismissAll();
      } catch {
        // Cold deep-link entry: nothing to dismiss.
      }
    }
    router.replace(resolveOpenSavedPlaceRoute(args));
  }

  // NOTE: there is deliberately no "already saved → just open it" shortcut.
  // Skipping the save is what dropped the shared post's source context on the
  // floor; `handleSaveStored` runs for both cases and enriches the existing
  // row through the canonical save path.

  function backToQueue() {
    if (router.canGoBack()) router.back();
    else router.replace('/share-jobs');
  }

  function openSearchForBatchRow(row: MultiPlaceBatchRow) {
    if (!batch) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedMentionId(row.logicalPlaceId);
    setBatch(openBatchSearch(batch, row.logicalPlaceId));
    if (row.search.phase === 'closed' || row.search.phase === 'idle') {
      void runBatchSearch(row.logicalPlaceId, row.search.query || row.primaryVenueName || row.extractedName);
    }
  }

  async function runBatchSearch(logicalPlaceId: string, queryOverride?: string) {
    const current = batch?.rows[logicalPlaceId];
    const query = (queryOverride ?? current?.search.query ?? '').trim();
    if (!current || !query) return;
    const requestId = (batchSearchRequestsRef.current[logicalPlaceId] ?? 0) + 1;
    batchSearchRequestsRef.current[logicalPlaceId] = requestId;
    setBatch((value) => value ? startBatchSearch(value, logicalPlaceId) : value);
    try {
      const fixture = __DEV__ && isVayrinCandidateFixtureId(job?.id)
        ? getVayrinCandidateFixture(job.id)
        : null;
      let found: ShareJobResultCandidate[];
      if (fixture?.manualResults) {
        found = fixture.manualResults;
      } else {
        const fields = geographicFieldsFromLabel(current.contextLabel);
        const coordinates = current.contextLabel
          ? await geocodeContextText(current.contextLabel)
          : null;
        const nearbyResolvedMentions: NearbyResolvedMention[] = batch.order
          .filter((id) => id !== logicalPlaceId)
          .flatMap((id) => {
            const other = batch.rows[id];
            const candidate = other ? rowCandidate(other) : null;
            if (!candidate || !Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return [];
            const nearbyFields = geographicFieldsFromLabel(other?.contextLabel ?? candidate.formattedAddress);
            return [{
              googlePlaceId: candidate.googlePlaceId,
              name: candidate.name,
              coordinates: { lat: candidate.latitude!, lng: candidate.longitude! },
              locality: nearbyFields.locality,
              region: nearbyFields.region,
              country: nearbyFields.country,
              mentionTimestamp: other?.sourceTimestamps[0] ?? null,
            }];
          });
        const sourceContextAvailable = !!(current.contextLabel || coordinates || nearbyResolvedMentions.length);
        const context: PlacesResolutionContext = sourceContextAvailable
          ? {
              mode: 'source',
              inferredLocality: fields.locality,
              inferredRegion: fields.region,
              inferredCountry: fields.country,
              inferredCoordinates: coordinates,
              regionConfidence: current.contextLabel ? 'strong' : 'medium',
              sourceEvidence: current.contextLabel ? ['video_region'] : ['nearby_resolved_video_place'],
              mentionTimestamp: current.sourceTimestamps[0] ?? null,
              nearbyResolvedMentions,
              userLocation: null,
            }
          : { mode: 'manual', userLocation: userLocationRef.current, regionConfidence: 'none' };
        const bias = coordinates ?? nearbyResolvedMentions[0]?.coordinates ??
          (!sourceContextAvailable ? userLocationRef.current : null) ?? undefined;
        found = (await searchPlaces(query, bias, context)).map(toResultCandidate);
      }
      if (!mountedRef.current || batchSearchRequestsRef.current[logicalPlaceId] !== requestId) return;
      setBatch((value) => value ? finishBatchSearch(value, logicalPlaceId, found) : value);
    } catch {
      if (!mountedRef.current || batchSearchRequestsRef.current[logicalPlaceId] !== requestId) return;
      setBatch((value) => value ? failBatchSearch(value, logicalPlaceId) : value);
    }
  }

  function changeBatchSearchQuery(logicalPlaceId: string, query: string) {
    batchSearchRequestsRef.current[logicalPlaceId] = (batchSearchRequestsRef.current[logicalPlaceId] ?? 0) + 1;
    setBatch((value) => value ? setBatchSearchQuery(value, logicalPlaceId, query) : value);
  }

  function selectBatchCandidate(row: MultiPlaceBatchRow, candidate: ShareJobResultCandidate) {
    const savedPlaceId = savedByGoogleId[candidate.googlePlaceId] ?? null;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBatch((value) => value
      ? chooseBatchCandidate(value, row.logicalPlaceId, candidate, savedPlaceId)
      : value);
    setExpandedMentionId(null);
    void trackEvent('multi_place_selection_changed', {
      job_id: job?.id ?? null,
      logical_place_id: row.logicalPlaceId,
      selected: true,
    });
  }

  function toggleMentionDisclosure(logicalPlaceId: string) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedMentionId((current) => current === logicalPlaceId ? null : logicalPlaceId);
  }

  function dismissMention(row: MultiPlaceBatchRow) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setBatch((value) => value ? dismissBatchRow(value, row.logicalPlaceId) : value);
    setExpandedMentionId(null);
  }

  function toggleBatchSelection(row: MultiPlaceBatchRow) {
    if (!batch) return;
    const next = toggleBatchRow(batch, row.logicalPlaceId);
    if (next === batch) return;
    setBatch(next);
    void trackEvent('multi_place_selection_changed', {
      job_id: job?.id ?? null,
      logical_place_id: row.logicalPlaceId,
      selected: next.rows[row.logicalPlaceId]?.selectedForSave === true,
    });
  }

  function selectEveryEligibleBatchRow() {
    if (!batch) return;
    const next = selectAllEligibleBatchRows(batch);
    setBatch(next);
    void trackEvent('multi_place_selection_changed', {
      job_id: job?.id ?? null,
      action: 'select_all',
      selected_count: selectedBatchTargets(next).length,
    });
  }

  function clearEveryEligibleBatchRow() {
    if (!batch) return;
    const next = clearAllEligibleBatchRows(batch);
    setBatch(next);
    void trackEvent('multi_place_selection_changed', {
      job_id: job?.id ?? null,
      action: 'clear_all',
      selected_count: 0,
    });
  }

  function renderManualSearch(opts?: { note?: string; onCancel?: () => void }) {
    const emptyContext = sourceResolutionSeed(job, manualQuery);
    const checkingKnownQuery = manualSearchPhase === 'idle' &&
      Boolean(manualQuery.trim()) &&
      !manualQueryEditedRef.current &&
      !searchExpanded &&
      vayrinPresentation.leads.length === 0;
    const showSearchAction = manualSearchPhase === 'empty' || manualSearchPhase === 'error' || (
      manualSearchPhase === 'idle' && !checkingKnownQuery
    );
    const visibleResults = visibleCandidateShortlist(results);
    return (
      <View style={[styles.section, styles.searchSection]}>
        <View style={styles.searchHeaderRow}>
          <Text style={[typography.label, styles.searchLabel]}>{PHASE_1_COPY.searchLabel}</Text>
          {opts?.onCancel ? (
            <Pressable onPress={opts.onCancel} hitSlop={8} accessibilityRole="button">
              <Text style={styles.cancelLink}>Cancel</Text>
            </Pressable>
          ) : null}
        </View>
        {opts?.note ? (
          <Text style={[typography.caption, styles.help]}>{opts.note}</Text>
        ) : null}
        <View style={styles.searchRow}>
          <View style={styles.flex}>
            <Input
              placeholder="Name or address"
              value={manualQuery}
              onChangeText={changeManualQuery}
              onSubmitEditing={() => void runManualSearch(manualQuery)}
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
          {showSearchAction ? (
            <Button title={manualSearchPhase === 'error' ? 'Retry' : 'Search'} onPress={() => void runManualSearch(manualQuery)} style={styles.searchBtn} />
          ) : null}
        </View>
        {searching || manualSearchPhase === 'searching' || checkingKnownQuery ? (
          <View style={styles.processingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.caption, styles.helpCompact]}>Searching for {manualQuery.trim()}…</Text>
          </View>
        ) : null}
        {manualSearchPhase === 'error' ? (
          <Text style={[typography.caption, styles.help]}>Couldn&apos;t check right now. Your search is ready to retry.</Text>
        ) : null}
        {manualSearchPhase === 'empty' ? (
          emptyContext.noNearbyMatch && emptyContext.contextLabel ? (
            <Text style={[typography.caption, styles.help]}>
              {`No matching location found near ${emptyContext.contextLabel}. Search manually or edit the area to widen it.`}
            </Text>
          ) : (
            <Text style={[typography.caption, styles.help]}>Couldn&apos;t find an exact place.</Text>
          )
        ) : null}
        {visibleResults.map((c, index) => {
          const address = splitPlaceAddress(c.formattedAddress);
          return (
            <CandidateConfirmationCard
              key={c.googlePlaceId}
              candidate={{ ...c, sourceFrameUrl: overallSourceFrameUrl }}
              locality={address.locality ?? c.formattedAddress}
              selected={manualSelectedIds.includes(c.googlePlaceId)}
              selectable
              compact
              rank={index + 1}
              selectionRole="checkbox"
              onPress={() => setManualSelectedIds((current) =>
                toggleCandidateSelection(current, c.googlePlaceId, 'multiple'))}
            />
          );
        })}
      </View>
    );
  }

  // Shared bottom actions: open the original post (below the alternative
  // search), then a restrained destructive remove.
  function renderJobFooter() {
    const canOpenSource = validateSourceUrl(sourceUrl).ok;
    return (
      <View style={styles.footer}>
        {canOpenSource ? (
          <Pressable
            onPress={() => void openOriginalPost()}
            style={({ pressed }) => [styles.openBtn, pressed ? styles.openBtnPressed : null]}
            accessibilityRole="button"
            accessibilityLabel={`Open ${platformNoun(platform)}`}
          >
            <Feather name="external-link" size={16} color={colors.textSecondary} />
            <Text style={styles.openText}>View original post</Text>
          </Pressable>
        ) : null}
        {openMsg ? <Text style={styles.openMsg}>{openMsg}</Text> : null}
        <Pressable
          onPress={confirmRemove}
          style={styles.removeBtn}
          accessibilityRole="button"
          accessibilityLabel="Remove this save"
        >
          <Feather name="more-horizontal" size={16} color={colors.textMuted} />
          <Text style={[typography.caption, styles.removeText]}>Remove this save</Text>
        </Pressable>
      </View>
    );
  }

  function openIdentityLead(lead: VayrinIdentityLead) {
    rawResolutionQueryRef.current = lead.suggestedQuery.trim();
    changeManualQuery(lead.suggestedQuery);
    setSearchExpanded(true);
    void trackEvent('vayrin_lead_opened', {
      job_id: job?.id ?? null,
      source: 'async',
      evidence_kind: lead.evidenceKind,
    });
    void runManualSearch(lead.suggestedQuery);
  }

  function renderIdentityLead(
    lead: VayrinIdentityLead,
    onPress: () => void,
  ) {
    const timeLabel = lead.timestamps.length > 0
      ? `Seen at ${lead.timestamps.slice(0, 3).map(formatLeadTimestamp).join(', ')}`
      : null;
    return (
      <Pressable
        key={`${lead.mentionId}:${lead.displayName}:${lead.contextLabel ?? ''}`}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${lead.displayName}${lead.contextLabel ? `, ${lead.contextLabel}` : ''}. Search for this place.`}
        style={({ pressed }) => [styles.leadCard, pressed && styles.candidatePressed]}
      >
        <View style={styles.leadIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Feather name="search" size={18} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.leadLabel}>SEARCH SUGGESTION</Text>
          <Text style={[typography.bodyStrong, styles.candidateName]} numberOfLines={2}>{lead.displayName}</Text>
          {lead.contextLabel ? (
            <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={2}>{lead.contextLabel}</Text>
          ) : null}
          {timeLabel ? <Text style={[typography.caption, styles.leadTime]}>{timeLabel}</Text> : null}
          <Text style={[typography.caption, styles.leadCaveat]}>Search places</Text>
        </View>
        <Feather name="chevron-right" size={18} color={colors.textMuted} />
      </Pressable>
    );
  }

  function batchCandidateMeta(candidate: ShareJobResultCandidate, row: MultiPlaceBatchRow): string {
    const address = splitPlaceAddress(candidate.formattedAddress);
    const category = resolvePlaceCategory({
      placeName: candidate.name,
      googlePrimaryType: candidate.primaryType,
      googleTypes: candidate.types,
    }).category;
    return [address.locality ?? row.contextLabel, CATEGORY_LABELS[category]]
      .filter(Boolean)
      .join(' · ');
  }

  function renderBatchCandidateChoice(row: MultiPlaceBatchRow, candidate: ShareJobResultCandidate) {
    const savedPlaceId = savedByGoogleId[candidate.googlePlaceId] ?? null;
    const selected = row.selectedCandidateId === candidate.googlePlaceId;
    const persisted = row.persistence !== 'pending';
    const rank = visibleMentionCandidates(row).findIndex((item) => item.googlePlaceId === candidate.googlePlaceId) + 1;
    return (
      <CandidateConfirmationCard
        key={candidate.googlePlaceId}
        candidate={candidate}
        locality={batchCandidateMeta(candidate, row) || candidate.formattedAddress}
        selected={selected && (row.selectedForSave || persisted)}
        selectable={!persisted}
        saved={Boolean(savedPlaceId || persisted)}
        onPress={persisted ? undefined : () => selectBatchCandidate(row, candidate)}
        compact
        compactPhotoHeight={104}
        compactThumbnailWidth={96}
        rank={rank > 0 ? rank : undefined}
        selectionRole="radio"
      />
    );
  }

  function renderBatchSearch(row: MultiPlaceBatchRow) {
    if (row.search.phase === 'closed') return null;
    return (
      <View style={styles.batchSearch}>
        <View style={styles.searchHeaderRow}>
          <Text style={[typography.label, styles.searchLabel]}>Search for this place</Text>
          <Pressable
            onPress={() => setBatch((value) => value ? closeBatchSearch(value, row.logicalPlaceId) : value)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={`Close search for ${row.extractedName}`}
          >
            <Text style={styles.cancelLink}>Close</Text>
          </Pressable>
        </View>
        <View style={styles.searchRow}>
          <View style={styles.flex}>
            <Input
              value={row.search.query}
              onChangeText={(query) => changeBatchSearchQuery(row.logicalPlaceId, query)}
              onSubmitEditing={() => void runBatchSearch(row.logicalPlaceId)}
              placeholder="Name or address"
              returnKeyType="search"
              autoCorrect={false}
              autoFocus
              accessibilityLabel={`Search query for ${row.extractedName}`}
            />
          </View>
          {row.search.phase !== 'searching' ? (
            <Button
              title={row.search.phase === 'error' ? 'Retry' : 'Search'}
              onPress={() => void runBatchSearch(row.logicalPlaceId)}
              disabled={!row.search.query.trim()}
              style={styles.searchBtn}
            />
          ) : null}
        </View>
        {row.search.phase === 'searching' ? (
          <View style={styles.processingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.caption, styles.helpCompact]}>Searching…</Text>
          </View>
        ) : null}
        {row.search.phase === 'empty' ? (
          <Text style={[typography.caption, styles.helpCompact]}>
            {row.noNearbyMatch && row.contextLabel
              ? `No matching location found near ${row.contextLabel}. Edit the area to search wider.`
              : 'No matches yet. Edit the query and try again.'}
          </Text>
        ) : null}
        {row.search.phase === 'error' ? (
          <Text style={[typography.caption, styles.batchError]}>{row.search.error}</Text>
        ) : null}
        {visibleMentionSearchCandidates(row).map((candidate) => renderBatchCandidateChoice(row, candidate))}
      </View>
    );
  }

  function renderBatchRow(row: MultiPlaceBatchRow, index: number, total: number) {
    const persisted = row.persistence !== 'pending';
    const timestamp = sourceTimestampLabel(row.sourceTimestamps);
    const expanded = expandedMentionId === row.logicalPlaceId;
    const status = mentionSummaryStatus(row);
    const visibleCandidates = expanded ? visibleMentionCandidates(row) : [];
    const evidenceFrames = expanded
      ? evidenceFramesForMention(row, detail.evidenceFrames).slice(0, 1)
      : [];
    const mentionName = row.primaryVenueName ?? row.extractedName;
    return (
      <View
        key={row.logicalPlaceId}
        style={[styles.mentionCard, row.selectedForSave && styles.mentionCardSelected, expanded && styles.mentionCardExpanded]}
        testID={`mention-${row.logicalPlaceId}`}
      >
        <Pressable
          onPress={() => toggleMentionDisclosure(row.logicalPlaceId)}
          accessibilityRole="button"
          accessibilityLabel={`Place ${index + 1} of ${total}: ${mentionName}. ${status}.`}
          accessibilityHint={expanded ? 'Collapses place details' : 'Expands place details'}
          accessibilityState={{ expanded }}
          style={({ pressed }) => [styles.mentionSummary, pressed && styles.mentionSummaryPressed]}
          testID="mention-summary"
        >
          <View style={styles.mentionSequence} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            <Text style={styles.mentionSequenceText}>{index + 1}</Text>
          </View>
          <View style={styles.flex}>
            <Text style={styles.mentionSummaryName} numberOfLines={2}>{mentionName}</Text>
            <Text style={styles.mentionSummaryStatus} numberOfLines={1}>{status}</Text>
            {timestamp ? <Text style={styles.mentionSummaryTimestamp}>Seen around {timestamp.replace(/^At /, '')}</Text> : null}
          </View>
          <View style={styles.mentionSummaryIcons} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
            {persisted ? <Feather name="check-circle" size={18} color={colors.accent} /> : null}
            <Feather name={expanded ? 'chevron-up' : 'chevron-right'} size={22} color={colors.textMuted} />
          </View>
        </Pressable>

        {expanded ? (
          <View style={styles.mentionDetails} testID="expanded-mention-details">
            {row.hostVenueName ? <Text style={[typography.caption, styles.relationshipText]}>at {row.hostVenueName}</Text> : null}
            {row.contextLabel ? <Text style={[typography.caption, styles.sourceTimestamp]} numberOfLines={2}>{row.contextLabel}</Text> : null}
            {evidenceFrames.length > 0 ? (
              <SourceEvidenceGallery frames={evidenceFrames} compact preview />
            ) : null}
            {row.saveError ? <Text style={[typography.caption, styles.batchError]}>{row.saveError}</Text> : null}
            {visibleCandidates.length > 0 ? (
              <View style={styles.possiblePlaces}>
                <Text style={styles.possiblePlacesTitle}>Possible places</Text>
                {visibleCandidates.map((choice) => renderBatchCandidateChoice(row, choice))}
                {row.candidates.length > visibleCandidates.length ? (
                  <Text style={[typography.caption, styles.candidateCapCopy]}>Showing the 3 strongest matches.</Text>
                ) : null}
              </View>
            ) : null}
            {row.userDismissed ? <Text style={[typography.caption, styles.unresolvedCopy]}>No place selected. Other selections are unchanged.</Text> : null}
            {!persisted && row.search.phase === 'closed' ? (
              <View style={styles.mentionActions}>
                <Pressable onPress={() => openSearchForBatchRow(row)} accessibilityRole="button" accessibilityLabel={`Search another place for ${row.extractedName}`} style={styles.inlineAction}>
                  <Feather name="search" size={16} color={colors.accent} />
                  <Text style={styles.inlineActionText}>Search another place</Text>
                </Pressable>
                <Pressable
                  onPress={() => dismissMention(row)}
                  accessibilityRole="button"
                  accessibilityLabel={`None of these for ${row.extractedName}`}
                  style={styles.noneAction}
                >
                  <Text style={styles.noneActionText}>None of these</Text>
                </Pressable>
              </View>
            ) : null}
            {renderBatchSearch(row)}
          </View>
        ) : null}
      </View>
    );
  }

  if (loading) {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </ShareJobsSheet>
    );
  }

  // Only a row that truly disappeared or could not be read reaches this state.
  // A transient failure keeps a retry available instead of dead-ending.
  if (!job) {
    const retryable = isRetryableLoadFailure(loadFailure);
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <Text style={[typography.body, styles.help]}>
            {retryable
              ? "Couldn't open this one just now."
              : 'This save is no longer available.'}
          </Text>
          {retryable ? (
            <Button
              title="Try again"
              onPress={() => {
                setLoading(true);
                void load();
              }}
              style={{ marginTop: Spacing.lg }}
            />
          ) : null}
          <Button
            title="Back to queue"
            variant={retryable ? 'secondary' : 'primary'}
            onPress={backToQueue}
            style={{ marginTop: Spacing.md }}
          />
        </View>
      </ShareJobsSheet>
    );
  }

  if (premiumRequestsAvailable && !areaMatchIncomplete && !premiumOfferDismissed && (premiumState === 'eligible' || premiumState === 'awaiting_token')) {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title="Premium Request" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered} testID="premium-request-offer">
          <View style={styles.premiumIcon}><TokenSymbol size={26} /></View>
          <Text style={[typography.heading, styles.centeredTitle]}>We couldn&apos;t find enough identifying information.</Text>
          <Text style={[typography.body, styles.help, styles.premiumBody]}>
            Normal recognition was free, but couldn&apos;t identify a specific place. A Premium Request uses stronger analysis on this same post.
          </Text>
          <Button
            title={premiumState === 'awaiting_token' ? 'Choose tokens' : 'Try Premium Request · 1 token'}
            onPress={() => {
              if (premiumState === 'awaiting_token') {
                void setPendingPremiumRequestJobId(job.id);
                router.push({ pathname: '/monetization', params: { premiumJobId: job.id, entry: 'premium_request' } });
              } else {
                void startPremiumRequest();
              }
            }}
            disabled={premiumBusy}
            loading={premiumBusy}
            style={styles.centeredPrimary}
          />
          <Text style={[typography.caption, styles.premiumReassurance]}>Charged only if Premium finds a useful, specific result.</Text>
          <Button title="Search manually" variant="secondary" onPress={() => setPremiumOfferDismissed(true)} style={styles.secondaryBtn} />
        </View>
      </ShareJobsSheet>
    );
  }

  if (premiumState === 'reserved' || premiumState === 'processing') {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title="Premium Request" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered} testID="premium-request-processing">
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={[typography.heading, styles.centeredTitle]}>Digging deeper</Text>
          <Text style={[typography.body, styles.help, styles.premiumBody]}>Using deeper analysis on your original shared post. You can leave this screen—we&apos;ll keep working.</Text>
        </View>
      </ShareJobsSheet>
    );
  }

  if (!premiumOfferDismissed && (premiumState === 'no_useful_result' || premiumState === 'failed' || premiumState === 'cancelled')) {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title="Premium Request" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered} testID="premium-request-returned">
          <View style={styles.premiumIcon}><Feather name="rotate-ccw" size={25} color={colors.primary} /></View>
          <Text style={[typography.heading, styles.centeredTitle]}>We still couldn&apos;t pin this one down.</Text>
          <Text style={[typography.body, styles.help, styles.premiumBody]}>
            Premium didn&apos;t produce a useful, specific place. Your token was returned.
          </Text>
          <Button title="Search manually" onPress={() => setPremiumOfferDismissed(true)} style={styles.centeredPrimary} />
          <Button title="Done" variant="secondary" onPress={backToQueue} style={styles.secondaryBtn} />
        </View>
      </ShareJobsSheet>
    );
  }

  // Terminal success (incl. already-saved) — offer the saved place. NEVER render
  // candidate/save controls for a job that is already resolved.
  if (detail.kind === 'completed') {
    const name = detail.savedPlaceName;
    const completedSavedId = automaticallySavedPlaceIds[0] ?? detail.savedPlaceId;
    const completedSaved = completedSavedId
      ? savedSnapshot.find((saved) => saved.id === completedSavedId) ?? null
      : null;
    const correctionTarget = correctionSaved ?? completedSaved;
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          {vayrinEnabled ? (
            <VayrinPresentationHeader presentation={vayrinPresentation} />
          ) : (
            <>
              <View style={styles.savedBadge}>
                <Feather name="check" size={26} color={colors.primary} />
              </View>
              <Text style={[typography.heading, styles.centeredTitle]}>{detail.copy.title}</Text>
              <Text style={[typography.body, styles.help, { textAlign: 'center' }]}>
                {detail.copy.body}
              </Text>
            </>
          )}
          {premiumState === 'useful_result' ? <Text style={styles.premiumResultLabel}>PREMIUM REQUEST COMPLETE</Text> : null}
          <View style={[styles.candidateCard, styles.completedCard]}>
            <PlaceImage
              googlePlaceId={detail.candidates[0]?.googlePlaceId}
              size={72}
              borderRadius={12}
              accessibilityLabel={name ? `Photo of ${name}` : undefined}
            />
            <Text style={[typography.heading, styles.completedPlaceName]} numberOfLines={2}>
              {name || 'Saved place'}
            </Text>
          </View>
          <Button
            title={PHASE_1_COPY.viewOnMap}
            onPress={() =>
              automaticallySavedPlaceIds.length > 1
                ? openNewlySavedPlaces(automaticallySavedPlaceIds)
                : openExistingPlace({
                    savedPlaceId: automaticallySavedPlaceIds[0] ?? detail.savedPlaceId,
                    source: 'share_job_completed',
                  })
            }
            style={styles.centeredPrimary}
          />
          {vayrinEnabled ? (
            <Button
              title="Not it"
              variant="secondary"
              onPress={async () => {
                void trackEvent('vayrin_not_it', { job_id: job.id, source: 'async_found' });
                const saved = completedSaved ?? (completedSavedId ? await getSavedPlace(completedSavedId).catch(() => null) : null);
                if (saved) {
                  setCorrectionSaved(saved);
                  setCorrectionOpen(true);
                } else {
                  openExistingPlace({ savedPlaceId: completedSavedId, source: 'share_job_completed' });
                }
              }}
              style={styles.secondaryBtn}
            />
          ) : null}
        </View>
        {correctionTarget ? (
          <WrongPlaceSheet
            visible={correctionOpen}
            saved={correctionTarget}
            actingUserId={job.user_id}
            extractedName={name ?? correctionTarget.place.name}
            finderMode={vayrinEnabled}
            onClose={() => setCorrectionOpen(false)}
            onCorrected={(updated) => {
              void trackEvent('vayrin_saved', { job_id: job.id, source: 'correction' });
              if (premiumState === 'useful_result') {
                void trackEvent('premium_result_corrected', { job_id: job.id });
              }
              setCorrectionOpen(false);
              openExistingPlace({ savedPlaceId: updated.id, source: 'share_job_saved' });
            }}
          />
        ) : null}
      </ShareJobsSheet>
    );
  }

  // Terminal dismissed (cancelled / unknown terminal) — safe, control-free view.
  if (detail.kind === 'dismissed') {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <Text style={[typography.body, styles.help]}>
            This item is no longer in your queue.
          </Text>
          <Button title="Back to queue" onPress={backToQueue} style={{ marginTop: Spacing.lg }} />
        </View>
      </ShareJobsSheet>
    );
  }

  // Review style comes from the payload mapping, never from status/decision
  // alone — a job whose media fallback failed still shows the candidates the
  // metadata resolver already persisted.
  const isMulti = detail.kind === 'multi';
  const isCandidatePicker = detail.kind === 'picker';
  const isManual = detail.kind === 'manual';
  const selectedPendingCount = batch ? selectedBatchTargets(batch).length : 0;
  const batchCounts = batch ? batchActionCounts(batch) : { total: 0, newPlaces: 0, sourceAttachments: 0 };
  const batchProgress = batch ? batchResolutionProgress(batch) : { resolved: 0, total: 0 };
  const single = candidates[0];
  const confirmationSingle = confirmationCandidates[0] ?? null;
  const broadSingle = confirmationSingle ? isBroadCandidate(confirmationSingle) : false;
  const pickerSelected = pickerSelectedIds.flatMap((id) => {
    const candidate = candidates.find((item) => item.googlePlaceId === id);
    return candidate ? [candidate] : [];
  });
  const manualSelected = manualSelectedIds
    .map((id) => results.find((candidate) => candidate.googlePlaceId === id))
    .filter((candidate): candidate is PlaceCandidate => Boolean(candidate));
  // The user may already have this place (e.g. they saved it manually months
  // ago). That is not a reason to skip the save — running it is how this
  // post's source_url / ai_note reach that existing row. The copy just has to
  // describe what will actually happen.
  const alreadySaved = single?.googlePlaceId
    ? savedSnapshot.find((row) => row.place?.google_place_id === single.googlePlaceId) ?? null
    : null;
  const alreadySavedId = alreadySaved?.id ?? (single?.googlePlaceId ? savedByGoogleId[single.googlePlaceId] ?? null : null);
  const alreadySavedCopy = alreadySaved
    ? alreadySavedActionCopy(
        alreadySaved,
        { sourceUrl, sourceType: shareJobSourceType(platform), aiNote: single?.aiNote ?? null },
        shareUrlKey,
      )
    : null;
  const placeAddress = splitPlaceAddress(single?.formattedAddress);

  const sourceIcon: React.ComponentProps<typeof Feather>['name'] =
    platform === 'instagram'
      ? 'instagram'
      : platform === 'tiktok'
        ? 'video'
        : platform === 'youtube'
          ? 'youtube'
          : 'link';

  if (isMulti) {
    const savedBatchIds = batch ? successfulBatchSavedPlaceIds(batch) : [];
    const recoveryCount = batch ? recoverableBatchRowCount(batch) : 0;
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title="Review places" onBack={backToQueue} backLabel="Back to queue" />
        {!batch ? (
          <View style={styles.centered}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <KeyboardAvoidingView
            style={styles.batchKeyboardSurface}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
            <FlatList
              style={styles.batchScroll}
              data={batch.order}
              keyExtractor={(id) => id}
              renderItem={({ item: id, index }) => renderBatchRow(batch.rows[id]!, index, batch.order.length)}
              contentContainerStyle={styles.batchContent}
              contentInsetAdjustmentBehavior="automatic"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              initialNumToRender={2}
              maxToRenderPerBatch={2}
              windowSize={3}
              removeClippedSubviews
              ListHeaderComponent={(
                <View style={styles.batchIntro}>
                  <View style={styles.sourceRow}>
                    <Feather name={sourceIcon} size={14} color={colors.textSecondary} />
                    <Text style={[typography.caption, styles.sourceText]} numberOfLines={1}>{platformName(platform)} · From the original post</Text>
                  </View>
                  <Text style={[typography.title, styles.batchTitle]}>{batch.order.length} places found</Text>
                  <Text style={[typography.caption, styles.batchHelp]}>Open one place at a time to review its matches.</Text>
                  <Text accessibilityLiveRegion="polite" style={styles.batchProgress}>
                    {batchProgress.resolved} of {batchProgress.total} places resolved
                  </Text>
                </View>
              )}
              ListEmptyComponent={<View style={styles.emptyBatch}><Text style={[typography.body, styles.help]}>No places were available to review.</Text></View>}
              ListFooterComponent={(
                <View>
                  {automaticallySavedPlaceIds.length > 0 && savedBatchIds.length === 0 ? (
                    <Text style={[typography.caption, styles.helpCompact]}>{automaticallySavedPlaceIds.length} place{automaticallySavedPlaceIds.length === 1 ? ' was' : 's were'} already saved from this post.</Text>
                  ) : null}
                  {renderJobFooter()}
                </View>
              )}
            />
            {batchCounts.total > 0 || batch.feedback || (savedBatchIds.length > 0 && recoveryCount > 0) ? (
              <View style={[styles.batchFooter, { paddingBottom: Math.max(safeAreaInsets.bottom, Spacing.sm) }]}>
              {batch.feedback ? (
                <Text
                  accessibilityLiveRegion="polite"
                  style={[typography.caption, batch.feedback.failed > 0 ? styles.batchError : styles.batchFeedback]}
                >
                  {batch.feedback.failed > 0
                    ? `Saved ${batch.feedback.saved} of ${batch.feedback.saved + batch.feedback.failed} places.${batch.feedback.alreadySaved > 0 ? ` ${batch.feedback.alreadySaved} ${batch.feedback.alreadySaved === 1 ? 'was' : 'were'} already saved.` : ''} ${batch.feedback.failed} ${batch.feedback.failed === 1 ? 'place is' : 'places are'} ready to retry.`
                    : batch.feedback.saved > 0 && recoveryCount > 0
                      ? `Saved ${batch.feedback.saved} ${batch.feedback.saved === 1 ? 'place' : 'places'}. ${recoveryCount} still ${recoveryCount === 1 ? 'needs' : 'need'} attention.`
                      : batch.feedback.alreadySaved > 0
                        ? `${batch.feedback.alreadySaved} ${batch.feedback.alreadySaved === 1 ? 'place was' : 'places were'} already saved.`
                        : `Saved ${batch.feedback.saved} ${batch.feedback.saved === 1 ? 'place' : 'places'}.`}
                </Text>
              ) : null}
              {batchCounts.total > 0 ? (
                <Button
                  title={batchPrimaryActionLabel(batchCounts)}
                  accessibilityLabel={`${batchPrimaryActionLabel(batchCounts)} from this review`}
                  onPress={() => void handleSaveSelected()}
                  disabled={selectedPendingCount === 0 || busy}
                  loading={busy}
                  style={styles.batchSaveButton}
                />
              ) : null}
              {savedBatchIds.length > 0 && recoveryCount > 0 ? (
                <Button
                  title={`View ${savedBatchIds.length} saved ${savedBatchIds.length === 1 ? 'place' : 'places'}`}
                  variant="secondary"
                  onPress={() => openNewlySavedPlaces(savedBatchIds, recoveryCount)}
                  style={styles.batchViewSavedButton}
                />
              ) : null}
              </View>
            ) : null}
          </KeyboardAvoidingView>
        )}
      </ShareJobsSheet>
    );
  }

  if (isCandidatePicker) {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" compact />
        <ScrollView
          contentContainerStyle={[styles.content, styles.quickCheckContent]}
          contentInsetAdjustmentBehavior="automatic"
          automaticallyAdjustKeyboardInsets
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.sourceRow, styles.quickCheckSourceRow]}>
            <Feather name={sourceIcon} size={14} color={colors.textSecondary} />
            <Text style={[typography.caption, styles.sourceText]} numberOfLines={1}>
              {platformName(platform)} · From the original post
            </Text>
          </View>
          <SourceEvidenceGallery
            frames={detail.evidenceFrames}
            analysisAttempted={job.analysis_attempted}
            compact
            dense
          />
          <View style={[styles.section, styles.quickCheckCandidates]}>
            {confirmationCandidates.map((candidate, index) => {
              const address = splitPlaceAddress(candidate.formattedAddress);
              const broad = isBroadCandidate(candidate);
              return (
                <CandidateConfirmationCard
                  key={candidate.googlePlaceId}
                  candidate={candidate}
                  locality={address.locality ?? candidate.formattedAddress}
                  selected={pickerSelectedIds.includes(candidate.googlePlaceId)}
                  selectable
                  compact
                  rank={index + 1}
                  bestMatch={index === 0 && confirmationCandidates.length > 1}
                  selectionRole={pickerSelectionMode === 'exclusive' ? 'radio' : 'checkbox'}
                  saved={Boolean(savedByGoogleId[candidate.googlePlaceId])}
                  onPress={() => {
                    if (broad) {
                      changeManualQuery(candidate.name);
                      revealSearch();
                      void runManualSearch(candidate.name);
                      return;
                    }
                    setPickerSelectedIds((current) =>
                      toggleCandidateSelection(current, candidate.googlePlaceId, pickerSelectionMode));
                    if (vayrinEnabled) void trackEvent('vayrin_candidate_selected', {
                      job_id: job.id,
                      source: 'async_picker',
                      candidate_count_internal: rankedConfirmationCandidates.length,
                      candidate_count_shown: confirmationCandidates.length,
                    });
                  }}
                />
              );
            })}
          </View>
          {searchExpanded ? (
            renderManualSearch({
              note: 'Search for the exact place and save it instead.',
              onCancel: hideSearch,
            })
          ) : (
            <>
              <Button
                title="None of these"
                variant="secondary"
                onPress={() => {
                  if (vayrinEnabled) {
                    void trackEvent('vayrin_not_it', { job_id: job.id, source: 'async_picker' });
                    void trackEvent('vayrin_none_selected', { job_id: job.id, source: 'async_picker' });
                  }
                  revealSearch();
                }}
                style={styles.secondaryBtn}
              />
              <Pressable
                onPress={revealSearch}
                accessibilityRole="button"
                accessibilityLabel="Search for the place"
                style={styles.searchForPlaceAction}
              >
                <Feather name="search" size={17} color={colors.accent} />
                <Text style={styles.searchForPlaceText}>Search for the place</Text>
              </Pressable>
            </>
          )}
          {renderJobFooter()}
        </ScrollView>
        {(
          <View
            style={[styles.stickySaveBar, { paddingBottom: Math.max(safeAreaInsets.bottom, Spacing.sm) }]}
            testID="quick-check-sticky-save-bar"
          >
            <Button
              title={candidateSaveLabel(searchExpanded ? manualSelected.length : pickerSelected.length)}
              accessibilityLabel={`${candidateSaveLabel(searchExpanded ? manualSelected.length : pickerSelected.length)} from selected candidates`}
              onPress={() => void handleSaveCanonicalCandidates(
                searchExpanded ? manualSelected : pickerSelected,
                searchExpanded ? 'raw_name_search' : 'async_picker',
              )}
              disabled={busy || (searchExpanded ? manualSelected.length : pickerSelected.length) === 0}
              loading={busy}
              style={styles.stickySaveButton}
            />
          </View>
        )}
      </ShareJobsSheet>
    );
  }

  return (
    <ShareJobsSheet onDismiss={backToQueue} size="detail">
      <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        automaticallyAdjustKeyboardInsets
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sourceRow}>
          <Feather name={sourceIcon} size={14} color={colors.textSecondary} />
          <Text style={[typography.caption, styles.sourceText]} numberOfLines={1}>
            {platformName(platform)} · From the original post
          </Text>
        </View>

        {automaticallySavedPlaceIds.length > 0 ? (
          <Button
            title={`View ${automaticallySavedPlaceIds.length} saved ${automaticallySavedPlaceIds.length === 1 ? 'place' : 'places'}`}
            variant="secondary"
            onPress={() => openNewlySavedPlaces(automaticallySavedPlaceIds)}
            style={styles.secondaryBtn}
          />
        ) : null}

        {isProcessing ? (
          <View style={styles.section}>
            {vayrinEnabled ? (
              <VayrinPresentationHeader presentation={vayrinPresentation} />
            ) : (
              <View style={styles.processingRow}>
                <ActivityIndicator color={colors.primary} />
                <Text style={[typography.body, styles.help, { marginBottom: 0 }]}>
                  I’m still checking this post.
                </Text>
              </View>
            )}
          </View>
        ) : isManual ? (
          <View style={styles.section}>
            {vayrinEnabled ? (
              <VayrinPresentationHeader
                presentation={
                  manualSearchPhase !== 'idle' || results.length > 0
                    ? buildVayrinPresentation({ kind: 'correcting', source: 'async' })
                    : vayrinPresentation
                }
              />
            ) : (
              <>
                <Text style={[typography.title, styles.title]}>
                  {manualSearchPhase === 'searching' || (manualSearchPhase === 'idle' && manualQuery.trim())
                    ? 'Checking this place'
                    : results.length === 1 && manualSelected.length > 0
                      ? 'Is this the place?'
                      : results.length > 1
                        ? 'Which place is it?'
                        : detail.copy.title}
                </Text>
                <Text style={[typography.caption, styles.help]}>
                  {manualSearchPhase === 'searching' || (manualSearchPhase === 'idle' && manualQuery.trim())
                    ? 'A possible name was found. Looking for the right place.'
                    : detail.copy.body}
                </Text>
              </>
            )}
            {detail.canRetry ? (
              <Button
                title={vayrinEnabled ? 'Try again' : 'Try automatically again'}
                variant="secondary"
                onPress={() => void handleRetry()}
                style={styles.secondaryBtn}
              />
            ) : null}
            {vayrinEnabled && vayrinPresentation.kind === 'leads_unverified' ? (
              <View style={styles.leadsSection}>
                {vayrinPresentation.leads.slice(0, 5).map((lead) =>
                  renderIdentityLead(lead, () => openIdentityLead(lead)))}
              </View>
            ) : null}
            {areaMatchIncomplete && areaName ? (
              <View style={styles.areaSummary} testID="area-match-incomplete">
                <Text style={styles.areaResultLabel}>AREA FOUND</Text>
                <Text style={[typography.heading, styles.areaName]}>{areaName}</Text>
                {areaLocation ? <Text style={[typography.caption, styles.areaLocation]}>{areaLocation}</Text> : null}
              </View>
            ) : null}
            {premiumRequestsAvailable && areaMatchIncomplete && (premiumState === 'eligible' || premiumState === 'awaiting_token') ? (
              <View style={styles.premiumInlineCard} testID="area-match-premium-offer">
                <View style={styles.premiumInlineHeading}>
                  <TokenSymbol size={20} />
                  <Text style={[typography.heading, styles.premiumInlineTitle]}>Want us to dig deeper?</Text>
                </View>
                <Text style={[typography.body, styles.premiumInlineBody]}>Use a Premium Request to look for the exact place.</Text>
                <Button
                  title={premiumState === 'awaiting_token' ? 'Choose tokens' : 'Make Premium Request · 1 token'}
                  onPress={() => {
                    if (premiumState === 'awaiting_token') {
                      void setPendingPremiumRequestJobId(job.id);
                      router.push({ pathname: '/monetization', params: { premiumJobId: job.id, entry: 'premium_request' } });
                    } else {
                      void startPremiumRequest();
                    }
                  }}
                  disabled={premiumBusy}
                  loading={premiumBusy}
                  style={styles.primaryBtn}
                />
                <Text style={[typography.caption, styles.premiumInlineReassurance]}>Charged only if Premium finds a useful, specific result.</Text>
              </View>
            ) : null}
            {areaMatchIncomplete ? (
              !searchExpanded ? <>
                <Button
                  title="See places in this area"
                  variant="secondary"
                  onPress={() => {
                    const query = incompleteArea?.searchQuery ?? areaName ?? '';
                    void trackEvent('area_match_browse_tapped', {
                      job_id: job.id,
                      resolved_specificity: incompleteArea?.resolvedSpecificity,
                      source_platform: job.source_platform ?? null,
                    });
                    changeManualQuery(query);
                    revealSearch();
                    void runManualSearch(query);
                  }}
                  style={styles.secondaryBtn}
                />
                <Pressable
                  onPress={() => {
                    void trackEvent('manual_search_from_area_match', {
                      job_id: job.id,
                      resolved_specificity: incompleteArea?.resolvedSpecificity,
                      source_platform: job.source_platform ?? null,
                    });
                    revealSearch();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Search manually"
                  style={styles.searchForPlaceAction}
                >
                  <Feather name="search" size={17} color={colors.accent} />
                  <Text style={styles.searchForPlaceText}>Search manually</Text>
                </Pressable>
              </> : detail.canSearchManually
                ? renderManualSearch({ note: 'Search for the exact place and save it instead.', onCancel: hideSearch })
                : null
            ) : detail.canSearchManually ? renderManualSearch() : null}
          </View>
        ) : (
          <View style={styles.section}>
            {vayrinEnabled ? (
              <VayrinPresentationHeader presentation={candidateConfirmationPresentation} />
            ) : (
              <>
                <Text style={[typography.title, styles.title]}>
                  {alreadySavedId ? PHASE_1_COPY.alreadySavedHeading : detail.copy.title}
                </Text>
                <Text style={[typography.caption, styles.help]}>
                  {alreadySavedId ? PHASE_1_COPY.alreadySavedBody : detail.copy.body}
                </Text>
              </>
            )}
            <SourceEvidenceGallery
              frames={detail.evidenceFrames}
              analysisAttempted={job.analysis_attempted}
            />
            {confirmationSingle ? (
              <CandidateConfirmationCard
                candidate={confirmationSingle}
                locality={placeAddress.locality ?? confirmationSingle.formattedAddress}
                saved={Boolean(alreadySavedId)}
              />
            ) : null}

            {alreadySavedCopy?.note ? (
              <Text style={[typography.caption, styles.help]}>{alreadySavedCopy.note}</Text>
            ) : null}

            {/* One action either way: the save path enriches an existing row
                instead of creating a second one, so it is safe to always run. */}
            {broadSingle ? (
              <Button
                title="See places in this area"
                onPress={() => {
                  if (!confirmationSingle) return;
                  changeManualQuery(confirmationSingle.name);
                  revealSearch();
                  void runManualSearch(confirmationSingle.name);
                }}
                disabled={busy || !single}
                style={styles.primaryBtn}
              />
            ) : null}

            {searchExpanded ? (
              renderManualSearch({
                note: 'Search for the exact place and save it instead.',
                onCancel: hideSearch,
              })
            ) : (
              <>
                <Button
                  title={broadSingle ? 'Not this area' : 'Not this place'}
                  variant="secondary"
                  onPress={() => {
                    if (vayrinEnabled) {
                      void trackEvent('vayrin_not_it', { job_id: job.id, source: 'async_likely' });
                      void trackEvent('vayrin_none_selected', { job_id: job.id, source: 'async_likely' });
                    }
                    revealSearch();
                  }}
                  style={styles.secondaryBtn}
                />
                <Pressable
                  onPress={revealSearch}
                  accessibilityRole="button"
                  accessibilityLabel="Search for the place"
                  style={styles.searchForPlaceAction}
                >
                  <Feather name="search" size={17} color={colors.accent} />
                  <Text style={styles.searchForPlaceText}>Search for the place</Text>
                </Pressable>
              </>
            )}
          </View>
        )}

        {renderJobFooter()}
      </ScrollView>
      {manualSelected.length > 0 ? (
        <View style={[styles.stickySaveBar, { paddingBottom: Math.max(safeAreaInsets.bottom, Spacing.sm) }]}>
          <Button
            title={candidateSaveLabel(manualSelected.length)}
            accessibilityLabel={`${candidateSaveLabel(manualSelected.length)} from selected search results`}
            onPress={() => void handleSaveCanonicalCandidates(manualSelected, 'raw_name_search')}
            disabled={busy}
            loading={busy}
            style={styles.stickySaveButton}
          />
        </View>
      ) : confirmationSingle && !broadSingle && !searchExpanded && !isManual && !isProcessing ? (
        <View style={[styles.stickySaveBar, { paddingBottom: Math.max(safeAreaInsets.bottom, Spacing.sm) }]}>
          <Button
            title="Save this place"
            accessibilityLabel={`Save ${confirmationSingle.name}`}
            onPress={() => { if (single) void handleSaveStored(single); }}
            disabled={busy || !single}
            loading={busy}
            style={styles.stickySaveButton}
          />
        </View>
      ) : null}
    </ShareJobsSheet>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl + 72 },
    quickCheckContent: { paddingTop: QUICK_CHECK_LAYOUT.scrollContentTop, paddingBottom: QUICK_CHECK_LAYOUT.scrollBottomPadding },
    batchKeyboardSurface: { flex: 1 },
    batchScroll: { flex: 1 },
    batchContent: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xxl,
    },
    batchIntro: { paddingBottom: Spacing.xs },
    batchTitle: { color: colors.text, marginTop: Spacing.sm },
    batchHelp: { color: colors.textSecondary, marginTop: 2, lineHeight: 18 },
    vayrinLabel: { color: colors.accent, fontSize: 11, lineHeight: 16, fontWeight: '800', letterSpacing: 1.6, marginTop: Spacing.lg },
    batchProgress: { color: colors.textSecondary, fontSize: 13, lineHeight: 18, fontWeight: '700', marginTop: Spacing.xs },
    batchFooter: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.bg,
    },
    stickySaveBar: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.bg,
    },
    stickySaveButton: { minHeight: 56 },
    batchSaveButton: { minHeight: 56 },
    batchSaveAllButton: { minHeight: 48, marginTop: Spacing.sm },
    batchViewSavedButton: { minHeight: 48, marginTop: Spacing.sm },
    batchFeedback: { color: colors.textSecondary, marginBottom: Spacing.sm, textAlign: 'center' },
    emptyBatch: { minHeight: 120, justifyContent: 'center', alignItems: 'center' },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
    centeredTitle: { color: colors.text, textAlign: 'center', marginTop: Spacing.md },
    centeredPrimary: { marginTop: Spacing.lg, minHeight: 52, alignSelf: 'stretch' },
    completedCard: { alignSelf: 'stretch', alignItems: 'center', marginTop: Spacing.sm },
    completedPlaceName: { color: colors.text, flex: 1 },
    savedBadge: {
      width: 60,
      height: 60,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,106,26,0.14)',
      borderWidth: 1,
      borderColor: 'rgba(255,106,26,0.3)',
    },
    premiumIcon: {
      width: 60,
      height: 60,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,106,26,0.14)',
      borderWidth: 1,
      borderColor: 'rgba(255,106,26,0.3)',
    },
    premiumBody: { textAlign: 'center', maxWidth: 340 },
    premiumReassurance: { color: colors.textMuted, textAlign: 'center', marginTop: Spacing.sm },
    premiumResultLabel: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4, marginTop: Spacing.sm },
    areaSummary: {
      padding: Spacing.md,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Spacing.md,
    },
    areaResultLabel: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.4 },
    areaName: { color: colors.text, marginTop: Spacing.xs },
    areaLocation: { color: colors.textSecondary, marginTop: 2 },
    premiumInlineCard: {
      padding: Spacing.md,
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: 'rgba(255,106,26,0.3)',
      marginBottom: Spacing.md,
    },
    premiumInlineHeading: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    premiumInlineTitle: { color: colors.text, flex: 1 },
    premiumInlineBody: { color: colors.textSecondary, marginTop: Spacing.sm },
    premiumInlineReassurance: { color: colors.textMuted, marginTop: Spacing.sm },
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      alignSelf: 'flex-start',
      minHeight: 44,
      marginBottom: Spacing.lg,
    },
    sourceText: { color: colors.textSecondary },
    quickCheckSourceRow: {
      minHeight: QUICK_CHECK_LAYOUT.sourceLineHeight,
      marginBottom: QUICK_CHECK_LAYOUT.sourceLineBottomGap,
    },
    flex: { flex: 1 },
    section: { marginBottom: Spacing.lg },
    quickCheckCandidates: { marginBottom: Spacing.sm },
    title: { color: colors.text, marginBottom: Spacing.xs },
    help: { color: colors.textSecondary, marginBottom: Spacing.md },
    processingRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
    // Polished single-candidate "Suggested place" card.
    candidateCard: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.lg,
    },
    candidateCardName: { color: colors.text },
    candidateCardLocality: { color: colors.textSecondary, marginTop: 5 },
    candidateCardAddr: { color: colors.textMuted, marginTop: 3, lineHeight: 18 },
    suggestedLabel: {
      color: colors.accent,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.4,
      marginTop: Spacing.sm,
    },
    primaryBtn: { marginTop: Spacing.lg, minHeight: 56 },
    secondaryBtn: { marginTop: Spacing.md, minHeight: 52 },
    searchForPlaceAction: {
      minHeight: 48,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      marginTop: Spacing.sm,
    },
    searchForPlaceText: { color: colors.accent, fontSize: 15, fontWeight: '700' },
    searchHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    searchSection: {
      marginTop: Spacing.lg,
      paddingTop: Spacing.lg,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    searchLabel: { color: colors.text, fontWeight: '700' },
    cancelLink: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    searchRow: { flexDirection: 'row', alignItems: 'center' },
    searchBtn: { marginLeft: Spacing.sm },
    candidate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      marginTop: Spacing.sm,
    },
    candidatePressed: { backgroundColor: colors.surfaceElevated },
    candidateSelected: { borderColor: colors.primary },
    candidateName: { color: colors.text },
    candidateAddr: { color: colors.textMuted, marginTop: 2 },
    checkbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 1.5,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      marginLeft: Spacing.sm,
    },
    checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
    radio: {
      width: 24,
      height: 24,
      borderRadius: 12,
      borderWidth: 2,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    radioOn: { borderColor: colors.primary },
    radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.primary },
    mentionCard: {
      overflow: 'hidden',
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginTop: Spacing.sm,
    },
    mentionCardSelected: { borderColor: colors.primary },
    mentionCardExpanded: { borderColor: colors.accentBorder },
    mentionSummary: {
      minHeight: 72,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      paddingHorizontal: Spacing.md,
      paddingVertical: Spacing.sm,
    },
    mentionSummaryPressed: { backgroundColor: colors.surfaceElevated },
    mentionSequence: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.accent,
    },
    mentionSequenceText: { color: colors.accent, fontSize: 15, lineHeight: 19, fontWeight: '800' },
    mentionSummaryName: { color: colors.text, fontSize: 16, lineHeight: 20, fontWeight: '700' },
    mentionSummaryStatus: { color: colors.textSecondary, fontSize: 13, lineHeight: 17, fontWeight: '700', marginTop: 1 },
    mentionSummaryTimestamp: { color: colors.textMuted, fontSize: 11, lineHeight: 15, marginTop: 1 },
    mentionSummaryIcons: { minWidth: 24, flexDirection: 'row', alignItems: 'center', gap: 5 },
    mentionDetails: {
      paddingHorizontal: Spacing.md,
      paddingBottom: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    mentionPositionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 },
    mentionPosition: { color: colors.accent, fontSize: 10, lineHeight: 15, fontWeight: '800', letterSpacing: 1.1 },
    batchRowHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.md },
    batchCheckboxTarget: { width: 44, height: 44, marginLeft: 0 },
    savedBadgeCompact: {
      width: 44,
      height: 44,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,106,26,0.12)',
    },
    resolvedCandidate: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      marginTop: Spacing.sm,
    },
    disclosureButton: {
      minHeight: 48,
      marginTop: Spacing.sm,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    batchCandidateChoice: {
      minHeight: 64,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      paddingVertical: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    batchCandidateChoiceSelected: { backgroundColor: colors.surfaceElevated },
    batchSelectionActions: {
      minHeight: 44,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    possiblePlaces: { marginTop: Spacing.sm },
    possiblePlacesTitle: { color: colors.text, fontSize: 15, lineHeight: 20, fontWeight: '700' },
    candidateCapCopy: { color: colors.textMuted, marginTop: Spacing.sm, lineHeight: 18 },
    unresolvedCopy: { color: colors.textSecondary, marginTop: Spacing.md, lineHeight: 18 },
    mentionActions: { marginTop: Spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
    noneAction: { minHeight: 44, alignItems: 'flex-start', justifyContent: 'center' },
    noneActionText: { color: colors.textSecondary, fontSize: 14, lineHeight: 20, fontWeight: '700' },
    batchSearch: {
      marginTop: Spacing.md,
      paddingTop: Spacing.md,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
    },
    batchError: { color: colors.danger, marginTop: Spacing.sm, lineHeight: 18 },
    batchWarning: { color: colors.accent, marginTop: Spacing.xs, lineHeight: 18 },
    mentionName: { color: colors.text },
    relationshipText: { color: colors.textSecondary, marginTop: Spacing.xs, lineHeight: 18 },
    sourceTimestamp: { color: colors.textMuted, marginTop: 2, lineHeight: 18 },
    helpCompact: { color: colors.textSecondary, marginTop: Spacing.sm, lineHeight: 18 },
    unmatchedBlock: { marginTop: Spacing.xs },
    leadsSection: { marginBottom: Spacing.md },
    leadCard: {
      minHeight: 76,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.accentBorder,
      padding: Spacing.md,
      marginTop: Spacing.sm,
    },
    leadIcon: {
      width: 44,
      height: 44,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accentSoft,
    },
    leadLabel: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 0.8 },
    leadTime: { color: colors.textSecondary, marginTop: 3 },
    leadCaveat: { color: colors.textMuted, marginTop: 3, fontWeight: '600' },
    inlineAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      minHeight: 44,
      alignSelf: 'flex-start',
    },
    inlineActionText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    savedText: { color: colors.accent, marginTop: Spacing.xs },
    bestMatchText: { color: colors.textSecondary, marginTop: Spacing.xs },
    // Bottom actions: open original (secondary) then a restrained destructive
    // remove.
    footer: { marginTop: Spacing.md, alignItems: 'center' },
    openBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.sm,
      alignSelf: 'stretch',
      minHeight: 48,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    openBtnPressed: { backgroundColor: colors.surfaceElevated },
    openText: { color: colors.text, fontSize: 15, fontWeight: '600' },
    openMsg: { color: colors.textMuted, fontSize: 13, marginTop: Spacing.sm, textAlign: 'center' },
    removeBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingVertical: Spacing.md,
      marginTop: Spacing.sm,
      minHeight: 44,
      justifyContent: 'center',
    },
    removeText: { color: colors.textMuted, fontWeight: '600' },
  });
}

// Route-level error boundary so a stale / malformed / terminal job can never
// drop the whole app to the global "Something went wrong" boundary — it shows a
// contained retry + a sanitized diagnostic instead (matches the queue screen).
export default function ShareJobDetailRoute() {
  return (
    <ErrorBoundary
      name="share-job-detail"
      fallbackTitle="Couldn't open this item"
      fallbackBody="Something went wrong opening this queue item. Try again."
    >
      <ShareJobDetailScreen />
    </ErrorBoundary>
  );
}
