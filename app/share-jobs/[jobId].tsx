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
  LayoutAnimation,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, ErrorBoundary, Input, ShareJobsHeader } from '@/components';
import { PlaceImage } from '@/components/PlaceImage';
import { ShareJobsSheet } from '@/components/ShareJobsSheet';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { trackEvent } from '@/lib/analytics';
import { classifyShareJobDetail } from '@/lib/shareJobRouting';
import { planOpenOriginal, validateSourceUrl } from '@/lib/openOriginalPost';
import {
  backTarget,
  findSavedPlaceIdByGooglePlaceId,
  normalizeShareJobCandidates,
} from '@/lib/shareJobsUi';
import { PHASE_1_COPY, splitPlaceAddress } from '@/lib/sharePhase1Ui';
import { buildFivePizzaPreviewJob, PHASE2_FIVE_PIZZA_PREVIEW_ID } from '@/lib/phase2Preview';
import {
  multiPlaceTitle,
  normalizeMentionSlots,
  preselectedCandidateIds,
  removeSuccessfulSelections,
  saveSelectedLabel,
  selectCandidateWithinMention,
  selectedUnsavedCandidates,
  type ShareJobMentionSlot,
} from '@/lib/shareJobResult';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { getSavedPlacesCacheSnapshot, upsertSavedPlaceIntoCache } from '@/hooks/useSavedPlaces';
import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { setCurrentShareJobId } from '@/lib/diagnosticContext';
import { createOnceLatch } from '@/lib/onceLatch';
import {
  resolveOpenSavedPlaceRoute,
  type OpenSavedPlaceSource,
} from '@/lib/openSavedPlace';
import { saveSavedPlace } from '@/services/savedPlacesService';
import type { PlaceCandidate } from '@/services/placesService';
import {
  cancelShareJob,
  deleteShareJob,
  getShareJob,
  markShareJobResolved,
  retryShareJob,
  type ShareJob,
  type ShareJobCandidate,
} from '@/services/shareJobsService';
import type { SourceType } from '@/types';

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

function sourceTypeFor(platform: string | null | undefined): SourceType {
  switch ((platform ?? '').toLowerCase()) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'tiktok';
    default:
      return 'link';
  }
}

function hasCoords(c: ShareJobCandidate): boolean {
  return Number.isFinite(c.latitude) && Number.isFinite(c.longitude);
}

function toPlaceCandidate(c: ShareJobCandidate): PlaceCandidate {
  return {
    googlePlaceId: c.googlePlaceId,
    name: c.name,
    formattedAddress: c.formattedAddress,
    latitude: c.latitude as number,
    longitude: c.longitude as number,
    category: null,
    googleMapsUrl: null,
    rawTypes: c.types,
  };
}

function ShareJobDetailScreen() {
  const router = useRouter();
  const { jobId } = useLocalSearchParams<{ jobId: string }>();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [job, setJob] = useState<ShareJob | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [manualQuery, setManualQuery] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The alternative-place search is a SECONDARY action — collapsed by default
  // for single-candidate jobs, revealed on demand. Manual-only jobs start
  // expanded because search is their primary action.
  const [searchExpanded, setSearchExpanded] = useState(false);
  // Inline, non-blocking notice if the original post can no longer be opened.
  const [openMsg, setOpenMsg] = useState<string | null>(null);
  const seededQueryRef = useRef(false);
  const seededSelectionRef = useRef(false);
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
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const { results, loading: searching, search } = usePlacesSearch();

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const previewSaved = getSavedPlacesCacheSnapshot()?.find(
        (saved) => saved.place?.google_place_id,
      );
      const j = __DEV__ && jobId === PHASE2_FIVE_PIZZA_PREVIEW_ID
        ? buildFivePizzaPreviewJob(
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
        : await getShareJob(jobId);
      if (!mountedRef.current) return;
      setJob(j);
      if (j) {
        recordBreadcrumb('candidate_loaded', {
          jobId,
          result: j.status ?? null,
        });
      }
      if (j && !seededQueryRef.current && j.suggested_query) {
        setManualQuery(j.suggested_query);
        seededQueryRef.current = true;
      }
    } catch {
      // leave prior job
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [jobId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Track the current share-job id + queue-opened breadcrumb for diagnostics.
  useEffect(() => {
    if (!jobId) return;
    setCurrentShareJobId(jobId);
    recordBreadcrumb('queue_item_opened', { jobId });
    return () => setCurrentShareJobId(null);
  }, [jobId]);

  // Poll while the job is still processing so the detail updates live.
  const isProcessing = job?.status === 'queued' || job?.status === 'processing_metadata';
  useEffect(() => {
    if (!isProcessing) return;
    const id = setInterval(() => void load(), 4000);
    return () => clearInterval(id);
  }, [isProcessing, load]);

  const platform = job?.source_platform ?? null;
  const sourceUrl = job?.canonical_url ?? job?.source_url ?? null;
  const candidates = normalizeShareJobCandidates(job?.candidate_payload?.candidates);
  const mentionSlots = normalizeMentionSlots(
    (job?.candidate_payload as { mentionSlots?: unknown } | null)?.mentionSlots,
  );
  const savedSnapshot = getSavedPlacesCacheSnapshot();
  const alreadySavedGoogleIds = new Set(
    (savedSnapshot ?? [])
      .map((saved) => saved.place?.google_place_id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0),
  );

  useEffect(() => {
    if (seededSelectionRef.current || mentionSlots.length === 0) return;
    seededSelectionRef.current = true;
    setSelectedIds(preselectedCandidateIds(mentionSlots, alreadySavedGoogleIds));
  }, [mentionSlots, alreadySavedGoogleIds]);

  async function persistCandidate(
    candidate: PlaceCandidate,
  ): Promise<{ savedPlaceId: string | null; duplicate: boolean }> {
    recordBreadcrumb('save_started', { jobId: job?.id ?? null });
    const result = await saveSavedPlace({
      candidate,
      radiusValue: null,
      radiusUnit: null,
      sourceType: sourceTypeFor(platform),
      sourceUrl,
    });
    if (result.status === 'saved') {
      upsertSavedPlaceIntoCache(result.saved);
      recordBreadcrumb('save_response', {
        jobId: job?.id ?? null,
        savedPlaceId: result.savedPlaceId,
        result: 'saved',
      });
      return { savedPlaceId: result.savedPlaceId, duplicate: false };
    }
    // Already in the user's saved places — reuse the existing row. NEVER a
    // duplicate insert and NEVER surfaced as an error.
    recordBreadcrumb('already_saved_response', {
      jobId: job?.id ?? null,
      savedPlaceId: result.savedPlaceId ?? null,
      result: 'duplicate',
    });
    return { savedPlaceId: result.savedPlaceId ?? null, duplicate: true };
  }

  // Resolve the job to the saved place. For an already-saved place whose exact
  // row id could not be recovered (rare), just open the map — the place IS in
  // Nearr, so "already saved" is never treated as a failure.
  async function resolveJobWith(
    jobId: string,
    savedPlaceId: string | null,
    duplicate: boolean,
  ): Promise<void> {
    if (savedPlaceId) {
      await markShareJobResolved(jobId, savedPlaceId);
      openExistingPlace({ savedPlaceId, source: 'share_job_saved' });
      return;
    }
    if (duplicate) {
      openExistingPlace({ source: 'share_job_saved' });
      return;
    }
    throw new Error('Save succeeded but did not return an id. Please retry.');
  }

  async function handleSaveStored(candidate: ShareJobCandidate) {
    if (!job || resolvingRef.current) return;
    if (!candidate.googlePlaceId || !hasCoords(candidate)) {
      Alert.alert('Search for it', 'Use the search below to pick the exact place.');
      return;
    }
    resolvingRef.current = true;
    if (mountedRef.current) setBusy(true);
    try {
      const { savedPlaceId, duplicate } = await persistCandidate(toPlaceCandidate(candidate));
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

  async function handleSaveSelected() {
    if (!job || resolvingRef.current) return;
    const slotCandidates = selectedUnsavedCandidates(
      mentionSlots,
      selectedIds,
      alreadySavedGoogleIds,
    );
    const chosen = (mentionSlots.length > 0 ? slotCandidates : candidates).filter(
      (candidate) =>
        candidate.googlePlaceId && selectedIds.has(candidate.googlePlaceId) && hasCoords(candidate),
    );
    if (chosen.length === 0) return;
    resolvingRef.current = true;
    if (mountedRef.current) setBusy(true);
    try {
      const settled = await Promise.allSettled(
        chosen.map(async (candidate) => ({
          candidate,
          ...(await persistCandidate(toPlaceCandidate(candidate))),
        })),
      );
      const succeeded = settled
        .filter((result): result is PromiseFulfilledResult<{
          candidate: ShareJobCandidate;
          savedPlaceId: string | null;
          duplicate: boolean;
        }> => result.status === 'fulfilled')
        .map((result) => result.value);
      const failed = settled
        .map((result, index) => ({ result, candidate: chosen[index]! }))
        .filter((entry) => entry.result.status === 'rejected');

      if (failed.length > 0) {
        setSelectedIds((current) =>
          removeSuccessfulSelections(current, succeeded.map((entry) => entry.candidate.googlePlaceId)),
        );
        const failedNames = failed.map((entry) => entry.candidate.name).join(', ');
        Alert.alert(
          succeeded.length > 0 ? `Saved ${succeeded.length} of ${chosen.length}` : 'Could not save these places',
          `Please try again for: ${failedNames}`,
        );
        return;
      }
      const firstSavedId = succeeded.find((entry) => entry.savedPlaceId)?.savedPlaceId ?? null;
      await resolveJobWith(job.id, firstSavedId, succeeded.some((entry) => entry.duplicate));
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      resolvingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
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
    router.replace(resolveOpenSavedPlaceRoute(args));
  }

  // The proposed place is already on the user's map. Resolve the job to that
  // existing saved place (no duplicate save) and open it. Resolving failures
  // are non-fatal — we still open the place (the destination never depends on
  // the job staying active).
  async function viewAlreadySaved(savedPlaceId: string, googlePlaceId?: string | null) {
    if (resolvingRef.current) return;
    resolvingRef.current = true;
    if (job) {
      try {
        await markShareJobResolved(job.id, savedPlaceId);
      } catch {
        // Non-fatal: the place is saved regardless.
      }
    }
    openExistingPlace({ savedPlaceId, googlePlaceId, source: 'share_job_already_saved' });
  }

  function backToQueue() {
    if (router.canGoBack()) router.back();
    else router.replace('/share-jobs');
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleMentionCandidate(slot: ShareJobMentionSlot, candidateId: string) {
    setSelectedIds((current) =>
      slot.outcome === 'ambiguous_candidates'
        ? selectCandidateWithinMention(current, slot, candidateId)
        : toggleCandidate(current, candidateId),
    );
  }

  function toggleCandidate(current: ReadonlySet<string>, candidateId: string): Set<string> {
    const next = new Set(current);
    if (next.has(candidateId)) next.delete(candidateId);
    else next.add(candidateId);
    return next;
  }

  function searchForMention(slot: ShareJobMentionSlot) {
    setManualQuery(slot.primaryVenueName ?? slot.displayName);
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setSearchExpanded(true);
  }

  function renderManualSearch(opts?: { note?: string; onCancel?: () => void }) {
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
              onChangeText={setManualQuery}
              onSubmitEditing={() => void search(manualQuery)}
              returnKeyType="search"
              autoCorrect={false}
            />
          </View>
          <Button title="Search" onPress={() => void search(manualQuery)} style={styles.searchBtn} />
        </View>
        {searching ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: Spacing.md }} />
        ) : null}
        {results.map((c) => (
          <Pressable
            key={c.googlePlaceId}
            onPress={() => void handleSaveManual(c)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`Save ${c.name}`}
            style={({ pressed }) => [styles.candidate, pressed ? styles.candidatePressed : null]}
          >
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

  if (!job) {
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <Text style={[typography.body, styles.help]}>This save is no longer available.</Text>
          <Button title="Back to queue" onPress={backToQueue} style={{ marginTop: Spacing.lg }} />
        </View>
      </ShareJobsSheet>
    );
  }

  const detailMode = classifyShareJobDetail(job);

  // Terminal success (incl. already-saved) — offer the saved place. NEVER render
  // candidate/save controls for a job that is already resolved.
  if (detailMode === 'completed') {
    const alreadySaved =
      (job.extraction_payload as { alreadySaved?: boolean } | null)?.alreadySaved === true;
    const name = (job.extraction_payload as { savedPlaceName?: string } | null)?.savedPlaceName;
    return (
      <ShareJobsSheet onDismiss={backToQueue} size="detail">
        <ShareJobsHeader title={PHASE_1_COPY.detailTitle} onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <View style={styles.savedBadge}>
            <Feather name="check" size={26} color={colors.primary} />
          </View>
          <Text style={[typography.heading, styles.centeredTitle]}>
            {alreadySaved ? PHASE_1_COPY.alreadySavedHeading : 'Saved to your map'}
          </Text>
          <Text style={[typography.body, styles.help, { textAlign: 'center' }]}>
            {alreadySaved ? PHASE_1_COPY.alreadySavedBody : 'This place is ready on your map.'}
          </Text>
          <View style={[styles.candidateCard, styles.completedCard]}>
            <PlaceImage
              googlePlaceId={job.candidate_payload?.candidates?.[0]?.googlePlaceId}
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
              openExistingPlace({
                savedPlaceId: job.saved_place_id,
                source: 'share_job_completed',
              })
            }
            style={styles.centeredPrimary}
          />
        </View>
      </ShareJobsSheet>
    );
  }

  // Terminal dismissed (cancelled / unknown terminal) — safe, control-free view.
  if (detailMode === 'dismissed') {
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

  const isMulti = job.decision === 'multi_candidate_confirmation';
  const selectedPendingCount = mentionSlots.length > 0
    ? selectedUnsavedCandidates(mentionSlots, selectedIds, alreadySavedGoogleIds).filter(hasCoords).length
    : candidates.filter((candidate) => selectedIds.has(candidate.googlePlaceId) && hasCoords(candidate)).length;
  const isManual =
    job.status === 'failed' ||
    job.decision === 'manual_fallback' ||
    candidates.length === 0;
  const single = candidates[0];
  const alreadySavedId = single
    ? findSavedPlaceIdByGooglePlaceId(single.googlePlaceId, getSavedPlacesCacheSnapshot())
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

        {isProcessing ? (
          <View style={styles.section}>
            <View style={styles.processingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[typography.body, styles.help, { marginBottom: 0 }]}>
                I’m still checking this post.
              </Text>
            </View>
          </View>
        ) : isMulti ? (
          <View style={styles.section}>
            <Text style={[typography.title, styles.title]}>
              {multiPlaceTitle(mentionSlots.length || candidates.length)}
            </Text>
            <Text style={[typography.body, styles.help]}>Choose which ones you want to save.</Text>
            {mentionSlots.length > 0
              ? mentionSlots.map((slot) => (
                  <View key={slot.mentionId} style={styles.mentionCard}>
                    <Text style={[typography.heading, styles.mentionName]}>{slot.displayName}</Text>
                    {slot.hostVenueName ? (
                      <Text style={[typography.caption, styles.relationshipText]}>
                        {slot.primaryVenueName} is featured at {slot.hostVenueName}. Confirm the exact place below.
                      </Text>
                    ) : null}
                    {slot.outcome === 'ambiguous_candidates' ? (
                      <Text style={[typography.caption, styles.helpCompact]}>
                        I found a few possible locations for this one.
                      </Text>
                    ) : null}
                    {slot.outcome === 'no_match' || slot.outcome === 'rejected_insufficient_evidence' ? (
                      <View style={styles.unmatchedBlock}>
                        <Text style={[typography.caption, styles.helpCompact]}>
                          I found the name, but I need your help locating it.
                        </Text>
                        <Pressable
                          onPress={() => searchForMention(slot)}
                          accessibilityRole="button"
                          style={styles.inlineAction}
                        >
                          <Feather name="search" size={16} color={colors.accent} />
                          <Text style={styles.inlineActionText}>Search for this place</Text>
                        </Pressable>
                      </View>
                    ) : slot.outcome === 'provider_error' ? (
                      <View style={styles.unmatchedBlock}>
                        <Text style={[typography.caption, styles.helpCompact]}>
                          I couldn't verify this one right now. It may be a temporary issue.
                        </Text>
                        <Pressable
                          onPress={() => searchForMention(slot)}
                          accessibilityRole="button"
                          style={styles.inlineAction}
                        >
                          <Feather name="search" size={16} color={colors.accent} />
                          <Text style={styles.inlineActionText}>Search for this place</Text>
                        </Pressable>
                      </View>
                    ) : null}
                    {slot.candidates.map((candidate) => {
                      const checked = selectedIds.has(candidate.googlePlaceId);
                      const savedPlaceId = findSavedPlaceIdByGooglePlaceId(
                        candidate.googlePlaceId,
                        savedSnapshot,
                      );
                      return (
                        <Pressable
                          key={candidate.googlePlaceId}
                          onPress={() =>
                            savedPlaceId
                              ? void viewAlreadySaved(savedPlaceId, candidate.googlePlaceId)
                              : toggleMentionCandidate(slot, candidate.googlePlaceId)
                          }
                          accessibilityRole={savedPlaceId ? 'button' : 'checkbox'}
                          accessibilityState={savedPlaceId ? undefined : { checked }}
                          accessibilityLabel={savedPlaceId ? `View ${candidate.name}` : candidate.name}
                          style={({ pressed }) => [
                            styles.candidate,
                            checked ? styles.candidateSelected : null,
                            pressed ? styles.candidatePressed : null,
                          ]}
                        >
                          <PlaceImage
                            googlePlaceId={candidate.googlePlaceId}
                            size={52}
                            borderRadius={10}
                            accessibilityLabel={`Photo of ${candidate.name}`}
                          />
                          <View style={styles.flex}>
                            <Text style={[typography.bodyStrong, styles.candidateName]}>{candidate.name}</Text>
                            {candidate.formattedAddress ? (
                              <Text style={[typography.caption, styles.candidateAddr]}>
                                {candidate.formattedAddress}
                              </Text>
                            ) : null}
                            {savedPlaceId ? (
                              <Text style={[typography.caption, styles.savedText]}>Already on your map · View place</Text>
                            ) : slot.outcome === 'verified_single' ? (
                              <Text style={[typography.caption, styles.bestMatchText]}>Best match</Text>
                            ) : null}
                          </View>
                          {!savedPlaceId ? (
                            <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>
                              {checked ? <Feather name="check" size={14} color={colors.textInverse} /> : null}
                            </View>
                          ) : (
                            <Feather name="chevron-right" size={18} color={colors.textMuted} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                ))
              : candidates.map((candidate) => {
                  const checked = selectedIds.has(candidate.googlePlaceId);
                  return (
                    <Pressable
                      key={candidate.googlePlaceId}
                      onPress={() => toggleSelect(candidate.googlePlaceId)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked }}
                      style={({ pressed }) => [styles.candidate, pressed ? styles.candidatePressed : null]}
                    >
                      <PlaceImage
                        googlePlaceId={candidate.googlePlaceId}
                        size={52}
                        borderRadius={10}
                        accessibilityLabel={`Photo of ${candidate.name}`}
                      />
                      <View style={styles.flex}>
                        <Text style={[typography.bodyStrong, styles.candidateName]}>{candidate.name}</Text>
                        {candidate.formattedAddress ? (
                          <Text style={[typography.caption, styles.candidateAddr]}>{candidate.formattedAddress}</Text>
                        ) : null}
                      </View>
                      <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>
                        {checked ? <Feather name="check" size={14} color={colors.textInverse} /> : null}
                      </View>
                    </Pressable>
                  );
                })}
            <Button
              title={saveSelectedLabel(selectedPendingCount)}
              onPress={() => void handleSaveSelected()}
              disabled={selectedPendingCount === 0 || busy}
              loading={busy}
              style={styles.primaryBtn}
            />
            {searchExpanded ? (
              renderManualSearch({ onCancel: hideSearch })
            ) : (
              <Button
                title={PHASE_1_COPY.alternativeAction}
                variant="secondary"
                onPress={revealSearch}
                style={styles.secondaryBtn}
              />
            )}
          </View>
        ) : isManual ? (
          <View style={styles.section}>
            <Text style={[typography.title, styles.title]}>Search for this place</Text>
            <Text style={[typography.caption, styles.help]}>
              {job.status === 'failed'
                ? "We couldn't find it automatically. Search for it and we'll keep the original post attached."
                : 'Search for the place from this post.'}
            </Text>
            {job.status === 'failed' && !job.saved_place_id ? (
              <Button
                title="Try automatically again"
                variant="secondary"
                onPress={() => void handleRetry()}
                style={styles.secondaryBtn}
              />
            ) : null}
            {renderManualSearch()}
          </View>
        ) : (
          <View style={styles.section}>
            <Text style={[typography.title, styles.title]}>
              {alreadySavedId ? PHASE_1_COPY.alreadySavedHeading : PHASE_1_COPY.suggestedHeading}
            </Text>
            <Text style={[typography.caption, styles.help]}>
              {alreadySavedId
                ? PHASE_1_COPY.alreadySavedBody
                : PHASE_1_COPY.suggestedBody}
            </Text>
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

            {alreadySavedId ? (
              <Button
                title={PHASE_1_COPY.viewOnMap}
                onPress={() => void viewAlreadySaved(alreadySavedId, single?.googlePlaceId)}
                style={styles.primaryBtn}
              />
            ) : (
              <Button
                title="Save to my map"
                onPress={() => single && void handleSaveStored(single)}
                disabled={busy || !single}
                loading={busy}
                style={styles.primaryBtn}
              />
            )}

            {searchExpanded ? (
              renderManualSearch({
                note: 'Search for the exact place and save it instead.',
                onCancel: hideSearch,
              })
            ) : (
              <Button
                title={PHASE_1_COPY.alternativeAction}
                variant="secondary"
                onPress={revealSearch}
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
    mentionCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      padding: Spacing.md,
      marginTop: Spacing.md,
    },
    mentionName: { color: colors.text },
    relationshipText: { color: colors.textSecondary, marginTop: Spacing.xs, lineHeight: 18 },
    helpCompact: { color: colors.textSecondary, marginTop: Spacing.sm, lineHeight: 18 },
    unmatchedBlock: { marginTop: Spacing.xs },
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
