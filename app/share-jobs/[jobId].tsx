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

import { Button, ErrorBoundary, Input, ShareJobsHeader } from '@/components';
import { PlaceImage } from '@/components/PlaceImage';
import { ShareJobsSheet } from '@/components/ShareJobsSheet';
import { VayrinPresentationHeader } from '@/components/VayrinPresentationHeader';
import { WrongPlaceSheet } from '@/components/map/WrongPlaceSheet';
import { Radius, Spacing } from '@/constants';
import { isVayrinProductUiEnabled } from '@/lib/featureFlags';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { buildShareJobDetailState } from '@/lib/shareJobDetailState';
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
  planShareSaveCompletion,
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
import { getPlaceDetails, searchPlaces, type PlaceCandidate } from '@/services/placesService';
import { getSavedPlace } from '@/services/savedPlacesService';
import type { SavedPlaceWithPlace } from '@/types';
import {
  persistShareJobCandidate,
  shareJobCandidateToPlaceCandidate,
  shareJobSourceType,
} from '@/services/shareJobCandidateSave';
import {
  cancelShareJob,
  deleteShareJob,
  getShareJob,
  markShareJobResolved,
  retryShareJob,
  type ShareJob,
  type ShareJobCandidate,
} from '@/services/shareJobsService';
import { CATEGORY_LABELS, resolvePlaceCategory } from '@/lib/placeCategory';

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
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  // Expo Router can hand back an array or an empty value for a route param —
  // normalise ONCE so no downstream string call can throw on it.
  const routeJobId = typeof jobId === 'string' ? jobId.trim() : '';
  const { colors, typography } = useTheme();
  const vayrinEnabled = isVayrinProductUiEnabled();
  const { state: onboardingV2 } = useOnboardingV2();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [job, setJob] = useState<ShareJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailure, setLoadFailure] = useState<DetailLoadFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [manualSearchPhase, setManualSearchPhase] = useState<SearchPhase>('idle');
  const [manualSelected, setManualSelected] = useState<PlaceCandidate | null>(null);
  const [pickerSelectedId, setPickerSelectedId] = useState<string | null>(null);
  const [batch, setBatch] = useState<MultiPlaceBatch | null>(null);
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
  const batchSearchRequestsRef = useRef<Record<string, number>>({});
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { results, loading: searching, error: searchError, search, reset: resetSearch } = usePlacesSearch();
  const { data: savedPlaces } = useSavedPlaces();

  const runManualSearch = useCallback(async (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const requestId = ++manualRequestRef.current;
    if (vayrinEnabled) void trackEvent('vayrin_manual_fallback', { source: 'async' });
    setManualSelected(null);
    setManualSearchPhase('searching');
    const found = await search(trimmed);
    if (!mountedRef.current || requestId !== manualRequestRef.current) return;
    setManualSelected(selectedQuickCheckCandidate(trimmed, found));
    setManualSearchPhase(found.length > 0 ? 'results' : 'empty');
  }, [search]);

  function changeManualQuery(value: string) {
    manualRequestRef.current += 1;
    manualQueryEditedRef.current = true;
    setManualQuery(value);
    setManualSelected(null);
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
      const j = __DEV__ && isPhase2PreviewId(id)
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

  const platform = job?.source_platform ?? null;
  const sourceUrl = job?.canonical_url ?? job?.source_url ?? null;
  // ONE payload-tolerant mapping from the persisted row to what this screen
  // renders (lib/shareJobDetailState). Nothing below re-interprets
  // candidate_payload, so a drifted/partial payload can never throw here.
  const detail = useMemo(() => buildShareJobDetailState(job), [job]);
  const vayrinPresentation = useMemo(
    () => mapShareJobToVayrinPresentation(detail, job),
    [detail, job],
  );
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
  useEffect(() => {
    if (detail.kind !== 'picker') {
      setPickerSelectedId(null);
      return;
    }
    setPickerSelectedId((current) =>
      current && candidates.some((candidate) => candidate.googlePlaceId === current)
        ? current
        : null,
    );
  }, [candidates, detail.kind, job?.id]);
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
  const savedByGoogleId = useMemo(() => Object.fromEntries(
    savedSnapshot
      .filter((saved) => !!saved.place?.google_place_id)
      .map((saved) => [saved.place.google_place_id as string, saved.id]),
  ), [savedSnapshot]);
  const leadsByMention = useMemo(() => {
    const grouped = new Map<string, VayrinIdentityLead[]>();
    for (const lead of vayrinPresentation.leads) {
      const current = grouped.get(lead.mentionId) ?? [];
      current.push(lead);
      grouped.set(lead.mentionId, current);
    }
    return grouped;
  }, [vayrinPresentation.leads]);
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

  // Seed the manual search only for a job that genuinely has nothing to offer.
  useEffect(() => {
    if (!routeJobId || detail.kind !== 'manual' || !detail.canSearchManually) return;
    const query = manualQuery.trim();
    if (!query || manualQueryEditedRef.current) return;
    const key = quickCheckSearchKey(routeJobId, 'manual', query);
    if (!claimInitialQuickCheckSearch(key)) return;
    void runManualSearch(query);
  }, [detail.canSearchManually, detail.kind, routeJobId, manualQuery, runManualSearch]);

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
  ): Promise<{ savedPlaceId: string | null; duplicate: boolean }> {
    if (__DEV__ && isPhase2PreviewId(job?.id)) {
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

  // Resolve the job to the saved place. For an already-saved place whose exact
  // row id could not be recovered (rare), just open the map — the place IS in
  // Nearr, so "already saved" is never treated as a failure.
  async function resolveJobWith(
    jobId: string,
    savedPlaceId: string | null,
    duplicate: boolean,
  ): Promise<void> {
    if (vayrinEnabled) {
      void trackEvent('vayrin_saved', {
        job_id: jobId,
        source: 'async',
        duplicate,
      });
    }
    if (savedPlaceId) {
      await markShareJobResolved(jobId, savedPlaceId);
      completeManualSave(
        duplicate ? [] : [savedPlaceId],
        duplicate ? [savedPlaceId] : [],
      );
      return;
    }
    if (duplicate) {
      openExistingPlace({ source: 'share_job_saved' });
      return;
    }
    throw new Error('Save succeeded but did not return an id. Please retry.');
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
      const resolutionId = accumulated.createdSavedPlaceIds[0] ?? accumulated.duplicateSavedPlaceIds[0] ?? null;
      if (resolutionId) await markShareJobResolved(job.id, resolutionId);
      if (resolutionId) {
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
      } else {
        throw new Error('Save succeeded but did not return an id. Please retry.');
      }
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
      if (job.status === 'queued' || job.status === 'processing_metadata') {
        await cancelShareJob(job.id);
      } else {
        await deleteShareJob(job.id);
      }
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
      const found = (await searchPlaces(query)).map(toResultCandidate);
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
    setBatch((value) => value
      ? chooseBatchCandidate(value, row.logicalPlaceId, candidate, savedPlaceId)
      : value);
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
    const checkingKnownQuery = manualSearchPhase === 'idle' &&
      Boolean(manualQuery.trim()) &&
      !manualQueryEditedRef.current &&
      !searchExpanded;
    const showSearchAction = manualSearchPhase === 'empty' || manualSearchPhase === 'error' || (
      manualSearchPhase === 'idle' && !checkingKnownQuery
    );
    const selected = manualSelected;
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
        {results.map((c) => (
          <Pressable
            key={c.googlePlaceId}
            onPress={() => setManualSelected(c)}
            disabled={busy}
            accessibilityRole="radio"
            accessibilityLabel={`Choose ${c.name} as the place you meant`}
            accessibilityState={{ checked: selected?.googlePlaceId === c.googlePlaceId }}
            style={({ pressed }) => [
              styles.candidate,
              selected?.googlePlaceId === c.googlePlaceId ? styles.candidateSelected : null,
              pressed ? styles.candidatePressed : null,
            ]}
          >
            <View style={[
              styles.radio,
              selected?.googlePlaceId === c.googlePlaceId && styles.radioOn,
            ]}>
              {selected?.googlePlaceId === c.googlePlaceId ? <View style={styles.radioDot} /> : null}
            </View>
            <PlaceImage
              googlePlaceId={c.googlePlaceId}
              size={52}
              borderRadius={10}
              accessibilityLabel={`Photo of ${c.name}`}
            />
            <View style={styles.flex}>
              <Text style={[typography.bodyStrong, styles.candidateName]} numberOfLines={1}>
                {c.name}
              </Text>
              {c.formattedAddress ? (
                <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={2}>
                  {c.formattedAddress}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        {selected ? (
          <Button
            title="Save place"
            onPress={() => void handleSaveManual(selected)}
            disabled={busy}
            loading={busy}
            style={styles.primaryBtn}
          />
        ) : null}
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
        accessibilityLabel={`Possible lead, ${lead.displayName}${lead.contextLabel ? `, ${lead.contextLabel}` : ''}. Search this lead.`}
        style={({ pressed }) => [styles.leadCard, pressed && styles.candidatePressed]}
      >
        <View style={styles.leadIcon} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          <Feather name="search" size={18} color={colors.primary} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.leadLabel}>POSSIBLE LEAD</Text>
          <Text style={[typography.bodyStrong, styles.candidateName]} numberOfLines={2}>{lead.displayName}</Text>
          {lead.contextLabel ? (
            <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={2}>{lead.contextLabel}</Text>
          ) : null}
          {timeLabel ? <Text style={[typography.caption, styles.leadTime]}>{timeLabel}</Text> : null}
          <Text style={[typography.caption, styles.leadCaveat]}>Not verified yet</Text>
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
    return (
      <Pressable
        key={candidate.googlePlaceId}
        onPress={() => selectBatchCandidate(row, candidate)}
        accessibilityRole="radio"
        accessibilityLabel={`Choose ${candidate.name} as the match for ${row.extractedName}${candidate.formattedAddress ? `, ${candidate.formattedAddress}` : ''}`}
        accessibilityState={{ checked: selected }}
        style={({ pressed }) => [
          styles.batchCandidateChoice,
          selected && styles.batchCandidateChoiceSelected,
          pressed && styles.candidatePressed,
        ]}
      >
        <View style={[styles.radio, selected && styles.radioOn]}>
          {selected ? <View style={styles.radioDot} /> : null}
        </View>
        <PlaceImage
          googlePlaceId={candidate.googlePlaceId}
          size={46}
          borderRadius={10}
          accessibilityLabel={`Photo of ${candidate.name}`}
        />
        <View style={styles.flex}>
          <Text style={[typography.bodyStrong, styles.candidateName]} numberOfLines={1}>{candidate.name}</Text>
          {candidate.formattedAddress ? (
            <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={2}>{candidate.formattedAddress}</Text>
          ) : null}
          {savedPlaceId ? <Text style={[typography.caption, styles.savedText]}>Already saved</Text> : null}
        </View>
      </Pressable>
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
          <Text style={[typography.caption, styles.helpCompact]}>No matches yet. Edit the query and try again.</Text>
        ) : null}
        {row.search.phase === 'error' ? (
          <Text style={[typography.caption, styles.batchError]}>{row.search.error}</Text>
        ) : null}
        {row.search.candidates.map((candidate) => renderBatchCandidateChoice(row, candidate))}
      </View>
    );
  }

  function renderBatchRow(row: MultiPlaceBatchRow, index: number, total: number) {
    const candidate = rowCandidate(row);
    const duplicateOwner = batch ? duplicateSelectionOwner(batch, row.logicalPlaceId) : null;
    const persisted = row.persistence !== 'pending';
    const checked = row.selectedForSave && !duplicateOwner;
    const timestamp = sourceTimestampLabel(row.sourceTimestamps);
    const canChooseCandidates = row.candidates.length > 1 || row.resolution === 'ambiguous';
    const rowLeads = leadsByMention.get(row.logicalPlaceId) ?? [];
    return (
      <View
        key={row.logicalPlaceId}
        style={[styles.mentionCard, checked && styles.mentionCardSelected]}
      >
        <View style={styles.batchRowHeader}>
          <View style={styles.flex}>
            <Text
              accessibilityRole="header"
              accessibilityLabel={`Place ${index + 1} of ${total}: ${row.primaryVenueName ?? row.extractedName}`}
              style={[typography.heading, styles.mentionName]}
              numberOfLines={2}
            >
              {row.primaryVenueName ?? row.extractedName}
            </Text>
            {row.hostVenueName ? (
              <Text style={[typography.caption, styles.relationshipText]}>at {row.hostVenueName}</Text>
            ) : row.contextLabel ? (
              <Text style={[typography.caption, styles.relationshipText]}>{row.contextLabel}</Text>
            ) : null}
            {timestamp ? (
              <Text style={[typography.caption, styles.sourceTimestamp]}>{timestamp}</Text>
            ) : null}
          </View>
          {candidate && row.resolution === 'resolved' ? (
            persisted ? (
              <View style={styles.savedBadgeCompact}>
                <Feather name="check" size={14} color={colors.accent} />
              </View>
            ) : (
              <Pressable
                onPress={() => toggleBatchSelection(row)}
                accessibilityRole="checkbox"
                accessibilityLabel={`${checked ? 'Deselect' : 'Select'} ${candidate.name}`}
                accessibilityState={{ checked, disabled: !!duplicateOwner }}
                hitSlop={10}
                style={[styles.checkbox, checked && styles.checkboxOn, styles.batchCheckboxTarget]}
              >
                {checked ? <Feather name="check" size={14} color={colors.textInverse} /> : null}
              </Pressable>
            )
          ) : null}
        </View>

        {candidate && row.resolution === 'resolved' ? (
          <View style={styles.resolvedCandidate}>
            <PlaceImage
              googlePlaceId={candidate.googlePlaceId}
              size={52}
              borderRadius={10}
              accessibilityLabel={`Photo of ${candidate.name}`}
            />
            <View style={styles.flex}>
              <Text style={[typography.bodyStrong, styles.candidateName]} numberOfLines={1}>{candidate.name}</Text>
              <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={2}>
                {batchCandidateMeta(candidate, row) || candidate.formattedAddress}
              </Text>
              {row.persistence === 'already_saved' ? (
                <Text style={[typography.caption, styles.savedText]}>Already saved</Text>
              ) : row.persistence === 'saved' ? (
                <Text style={[typography.caption, styles.savedText]}>Saved</Text>
              ) : row.savedPlaceId ? (
                // Already on the map, but still selectable: saving attaches
                // this post to that existing place rather than duplicating it.
                <Text style={[typography.caption, styles.savedText]}>
                  Already on your map · this post will be attached
                </Text>
              ) : duplicateOwner ? (
                <Text style={[typography.caption, styles.batchWarning]}>Same place selected above · excluded from count</Text>
              ) : null}
            </View>
          </View>
        ) : null}

        {row.saveError ? <Text style={[typography.caption, styles.batchError]}>{row.saveError}</Text> : null}

        {(row.resolution === 'unmatched' || row.resolution === 'unavailable') && rowLeads.length > 0 ? (
          <View style={styles.unmatchedBlock}>
            {rowLeads.slice(0, 3).map((lead) => renderIdentityLead(lead, () => {
              if (!batch) return;
              setBatch(openBatchSearch(batch, row.logicalPlaceId));
              changeBatchSearchQuery(row.logicalPlaceId, lead.suggestedQuery);
              void trackEvent('vayrin_lead_opened', {
                job_id: job?.id ?? null,
                source: 'async_multi',
                evidence_kind: lead.evidenceKind,
              });
              void runBatchSearch(row.logicalPlaceId, lead.suggestedQuery);
            }))}
          </View>
        ) : null}

        {row.candidateSelectorExpanded ? (
          <View>
            <Pressable
              onPress={() => setBatch((value) => value
                ? setCandidateSelector(value, row.logicalPlaceId, false)
                : value)}
              accessibilityRole="button"
              accessibilityLabel={`Hide candidate choices for ${row.extractedName}`}
              accessibilityState={{ expanded: true }}
              style={styles.disclosureButton}
            >
              <Text style={styles.inlineActionText}>Choose the right place</Text>
              <Feather name="chevron-up" size={18} color={colors.accent} />
            </Pressable>
            {row.candidates.map((choice) => renderBatchCandidateChoice(row, choice))}
            <Pressable
              onPress={() => openSearchForBatchRow(row)}
              accessibilityRole="button"
              style={styles.inlineAction}
            >
              <Feather name="search" size={16} color={colors.accent} />
              <Text style={styles.inlineActionText}>Search manually</Text>
            </Pressable>
          </View>
        ) : row.resolution === 'ambiguous' ? (
          <>
            <Pressable
              onPress={() => setBatch((value) => value
                ? setCandidateSelector(value, row.logicalPlaceId, !row.candidateSelectorExpanded)
                : value)}
              accessibilityRole="button"
              accessibilityLabel={`Choose the right place for ${row.extractedName}`}
              accessibilityState={{ expanded: row.candidateSelectorExpanded }}
              style={styles.disclosureButton}
            >
              <Text style={styles.inlineActionText}>Choose the right place</Text>
              <Feather name={row.candidateSelectorExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.accent} />
            </Pressable>
          </>
        ) : row.resolution === 'unmatched' || row.resolution === 'unavailable' ? (
          <Pressable
            onPress={() => openSearchForBatchRow(row)}
            accessibilityRole="button"
            accessibilityLabel={`Search for ${row.extractedName}`}
            style={styles.inlineAction}
          >
            <Feather name="search" size={16} color={colors.accent} />
            <Text style={styles.inlineActionText}>
              {row.resolution === 'unavailable' ? 'Try searching again' : 'Search for this place'}
            </Text>
          </Pressable>
        ) : canChooseCandidates && !persisted ? (
          <Pressable
            onPress={() => setBatch((value) => value ? setCandidateSelector(value, row.logicalPlaceId, true) : value)}
            accessibilityRole="button"
            style={styles.inlineAction}
          >
            <Text style={styles.inlineActionText}>Change place</Text>
          </Pressable>
        ) : null}
        {renderBatchSearch(row)}
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
  const eligiblePendingCount = batch ? allEligibleBatchTargets(batch).length : 0;
  const everyEligibleSelected = batch ? allEligibleBatchRowsSelected(batch) : false;
  const showBatchSelectionControls = !!batch && batch.order.length >= 3 && eligiblePendingCount >= 2;
  const single = candidates[0];
  const pickerSelected = pickerSelectedId
    ? candidates.find((candidate) => candidate.googlePlaceId === pickerSelectedId) ?? null
    : null;
  // The user may already have this place (e.g. they saved it manually months
  // ago). That is not a reason to skip the save — running it is how this
  // post's source_url / ai_note reach that existing row. The copy just has to
  // describe what will actually happen.
  const alreadySaved = single?.googlePlaceId
    ? savedSnapshot.find((row) => row.place?.google_place_id === single.googlePlaceId) ?? null
    : null;
  const alreadySavedId = alreadySaved?.id ?? null;
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
            <ScrollView
              style={styles.batchScroll}
              contentContainerStyle={styles.batchContent}
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
              {vayrinEnabled ? (
                <VayrinPresentationHeader presentation={vayrinPresentation} />
              ) : (
                <>
                  <Text style={[typography.title, styles.title]}>
                    {`Found ${batch.order.length} ${batch.order.length === 1 ? 'place' : 'places'}`}
                  </Text>
                  <Text style={[typography.body, styles.help]}>
                    Choose the places you want to save. Uncertain matches stay separate until you choose one.
                  </Text>
                </>
              )}
              {showBatchSelectionControls ? (
                <View style={styles.batchSelectionActions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Select all eligible places"
                    onPress={selectEveryEligibleBatchRow}
                    hitSlop={8}
                  >
                    <Text style={styles.inlineActionText}>Select all</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Clear all eligible place selections"
                    onPress={clearEveryEligibleBatchRow}
                    hitSlop={8}
                  >
                    <Text style={styles.inlineActionText}>Clear all</Text>
                  </Pressable>
                </View>
              ) : null}
              {batch.order.length === 0 ? (
                <View style={styles.emptyBatch}>
                  <Text style={[typography.body, styles.help]}>No logical places were available to review.</Text>
                </View>
              ) : batch.order.map((id, index) => renderBatchRow(batch.rows[id]!, index, batch.order.length))}
              {automaticallySavedPlaceIds.length > 0 && savedBatchIds.length === 0 ? (
                <Text style={[typography.caption, styles.helpCompact]}>
                  {automaticallySavedPlaceIds.length} place{automaticallySavedPlaceIds.length === 1 ? ' was' : 's were'} already saved from this post.
                </Text>
              ) : null}
              {renderJobFooter()}
            </ScrollView>
            <View style={styles.batchFooter}>
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
              <Button
                title={saveSelectedLabel(selectedPendingCount)}
                accessibilityLabel={`${saveSelectedLabel(selectedPendingCount)} from this batch`}
                onPress={() => void handleSaveSelected()}
                disabled={selectedPendingCount === 0 || busy}
                loading={busy}
                style={styles.batchSaveButton}
              />
              {showBatchSelectionControls && !everyEligibleSelected ? (
                <Button
                  title={`Save all (${eligiblePendingCount})`}
                  accessibilityLabel={`Save all ${eligiblePendingCount} eligible places`}
                  variant="secondary"
                  onPress={() => void handleSaveAll()}
                  disabled={eligiblePendingCount === 0 || busy}
                  style={styles.batchSaveAllButton}
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
          </KeyboardAvoidingView>
        )}
      </ShareJobsSheet>
    );
  }

  if (isCandidatePicker) {
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
          {vayrinEnabled ? (
            <VayrinPresentationHeader presentation={vayrinPresentation} />
          ) : (
            <>
              <Text style={[typography.title, styles.title]}>{detail.copy.title}</Text>
              <Text style={[typography.body, styles.help]}>{detail.copy.body}</Text>
            </>
          )}
          <View style={styles.section}>
            {candidates.map((candidate) => {
              const address = splitPlaceAddress(candidate.formattedAddress);
              const category = resolvePlaceCategory({
                placeName: candidate.name,
                googleTypes: candidate.types,
              }).category;
              const meta = [address.locality, CATEGORY_LABELS[category]].filter(Boolean).join(' · ');
              return (
                <Pressable
                  key={candidate.googlePlaceId}
                  onPress={() => setPickerSelectedId(candidate.googlePlaceId)}
                  disabled={busy}
                  accessibilityRole="radio"
                  accessibilityLabel={`Choose ${candidate.name} as the place for this post${candidate.formattedAddress ? `, ${candidate.formattedAddress}` : ''}`}
                  accessibilityState={{ checked: pickerSelectedId === candidate.googlePlaceId }}
                  style={({ pressed }) => [
                    styles.candidate,
                    pickerSelectedId === candidate.googlePlaceId && styles.candidateSelected,
                    pressed && styles.candidatePressed,
                  ]}
                >
                  <View style={[
                    styles.radio,
                    pickerSelectedId === candidate.googlePlaceId && styles.radioOn,
                  ]}>
                    {pickerSelectedId === candidate.googlePlaceId ? <View style={styles.radioDot} /> : null}
                  </View>
                  <PlaceImage
                    googlePlaceId={candidate.googlePlaceId}
                    size={58}
                    borderRadius={11}
                    accessibilityLabel={`Photo of ${candidate.name}`}
                  />
                  <View style={styles.flex}>
                    <Text style={[typography.bodyStrong, styles.candidateName]} numberOfLines={2}>{candidate.name}</Text>
                    {meta ? <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={1}>{meta}</Text> : null}
                    {candidate.formattedAddress ? (
                      <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={2}>{candidate.formattedAddress}</Text>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
          {pickerSelected ? (
            <Button
              title="Save place"
              onPress={() => void handleSaveStored(pickerSelected)}
              disabled={busy}
              loading={busy}
              style={styles.primaryBtn}
            />
          ) : null}
          {searchExpanded ? (
            renderManualSearch({
              note: 'Search for the exact place and save it instead.',
              onCancel: hideSearch,
            })
          ) : (
            <Button
              title={vayrinEnabled ? 'Not it' : 'None of these'}
              variant="secondary"
              onPress={() => {
                if (vayrinEnabled) void trackEvent('vayrin_not_it', { job_id: job.id, source: 'async_picker' });
                revealSearch();
              }}
              style={styles.secondaryBtn}
            />
          )}
          {renderJobFooter()}
        </ScrollView>
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
                    : results.length === 1 && manualSelected
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
            {detail.canSearchManually ? renderManualSearch() : null}
          </View>
        ) : (
          <View style={styles.section}>
            {vayrinEnabled ? (
              <VayrinPresentationHeader presentation={vayrinPresentation} />
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
            <View style={styles.candidateCard}>
              <PlaceImage
                googlePlaceId={single?.googlePlaceId}
                size={88}
                borderRadius={12}
                accessibilityLabel={single?.name ? `Photo of ${single.name}` : undefined}
              />
              <View style={styles.flex}>
                <Text style={[typography.heading, styles.candidateCardName]} numberOfLines={2}>
                  {single?.name ?? 'This place'}
                </Text>
                {placeAddress.locality ? (
                  <Text style={[typography.body, styles.candidateCardLocality]} numberOfLines={1}>
                    {placeAddress.locality}
                  </Text>
                ) : null}
                {placeAddress.streetAddress || (!placeAddress.locality && single?.formattedAddress) ? (
                  <Text style={[typography.caption, styles.candidateCardAddr]} numberOfLines={2}>
                    {placeAddress.streetAddress ?? single?.formattedAddress}
                  </Text>
                ) : null}
              </View>
            </View>

            {alreadySavedCopy?.note ? (
              <Text style={[typography.caption, styles.help]}>{alreadySavedCopy.note}</Text>
            ) : null}

            {/* One action either way: the save path enriches an existing row
                instead of creating a second one, so it is safe to always run. */}
            <Button
              title={alreadySavedCopy?.action ?? 'Save to my map'}
              onPress={() => single && void handleSaveStored(single)}
              disabled={busy || !single}
              loading={busy}
              style={styles.primaryBtn}
            />

            {searchExpanded ? (
              renderManualSearch({
                note: 'Search for the exact place and save it instead.',
                onCancel: hideSearch,
              })
            ) : (
              <Button
                title={vayrinEnabled ? 'Not it' : PHASE_1_COPY.alternativeAction}
                variant="secondary"
                onPress={() => {
                  if (vayrinEnabled) void trackEvent('vayrin_not_it', { job_id: job.id, source: 'async_likely' });
                  revealSearch();
                }}
                style={styles.secondaryBtn}
              />
            )}
          </View>
        )}

        {renderJobFooter()}
      </ScrollView>
    </ShareJobsSheet>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
    batchKeyboardSurface: { flex: 1 },
    batchScroll: { flex: 1 },
    batchContent: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.lg,
    },
    batchFooter: {
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.bg,
    },
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
    sourceRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      alignSelf: 'flex-start',
      minHeight: 44,
      marginBottom: Spacing.lg,
    },
    sourceText: { color: colors.textSecondary },
    flex: { flex: 1 },
    section: { marginBottom: Spacing.lg },
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
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.md,
      marginTop: Spacing.md,
    },
    mentionCardSelected: { borderColor: colors.primary },
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
