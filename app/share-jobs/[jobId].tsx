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
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, ErrorBoundary, Input, Screen, ShareJobsHeader } from '@/components';
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
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { getSavedPlacesCacheSnapshot, upsertSavedPlaceIntoCache } from '@/hooks/useSavedPlaces';
import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { setCurrentShareJobId } from '@/lib/diagnosticContext';
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

  const { results, loading: searching, search } = usePlacesSearch();

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const j = await getShareJob(jobId);
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
      setLoading(false);
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
      goToMap(savedPlaceId);
      return;
    }
    if (duplicate) {
      goToMap(null);
      return;
    }
    throw new Error('Save succeeded but did not return an id. Please retry.');
  }

  async function handleSaveStored(candidate: ShareJobCandidate) {
    if (!job || busy) return;
    if (!candidate.googlePlaceId || !hasCoords(candidate)) {
      Alert.alert('Search for it', 'Use the search below to pick the exact place.');
      return;
    }
    setBusy(true);
    try {
      const { savedPlaceId, duplicate } = await persistCandidate(toPlaceCandidate(candidate));
      await resolveJobWith(job.id, savedPlaceId, duplicate);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveManual(candidate: PlaceCandidate) {
    if (!job || busy) return;
    setBusy(true);
    try {
      const { savedPlaceId, duplicate } = await persistCandidate(candidate);
      await resolveJobWith(job.id, savedPlaceId, duplicate);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSelected() {
    if (!job || busy) return;
    const chosen = candidates.filter(
      (c) => c.googlePlaceId && selectedIds.has(c.googlePlaceId) && hasCoords(c),
    );
    if (chosen.length === 0) return;
    setBusy(true);
    try {
      let firstSavedId: string | null = null;
      let anyDuplicate = false;
      for (const c of chosen) {
        const { savedPlaceId, duplicate } = await persistCandidate(toPlaceCandidate(c));
        if (!firstSavedId && savedPlaceId) firstSavedId = savedPlaceId;
        if (duplicate) anyDuplicate = true;
      }
      await resolveJobWith(job.id, firstSavedId, anyDuplicate);
    } catch (err) {
      Alert.alert('Could not save', err instanceof Error ? err.message : 'Please try again.');
    } finally {
      setBusy(false);
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
    } catch (err) {
      Alert.alert('Could not remove', err instanceof Error ? err.message : 'Please try again.');
    }
  }

  async function handleRetry() {
    if (!job) return;
    try {
      await retryShareJob(job.id);
      await load();
    } catch (err) {
      Alert.alert('Could not retry', err instanceof Error ? err.message : 'Please try again.');
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
    Alert.alert('Remove this save?', undefined, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void handleRemove() },
    ]);
  }

  function goToMap(savedPlaceId: string | null) {
    if (savedPlaceId) {
      router.replace({ pathname: '/(tabs)/map', params: { savedPlaceId } });
    } else {
      router.replace('/(tabs)/map');
    }
  }

  // The proposed place is already on the user's map. Resolve the job to that
  // existing saved place (no duplicate save) and open it. Resolving failures
  // are non-fatal — we still show the place.
  async function viewAlreadySaved(savedPlaceId: string) {
    if (job) {
      try {
        await markShareJobResolved(job.id, savedPlaceId);
      } catch {
        // Non-fatal: the place is saved regardless.
      }
    }
    goToMap(savedPlaceId);
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

  function renderManualSearch(opts?: { note?: string; onCancel?: () => void }) {
    return (
      <View style={styles.section}>
        <View style={styles.searchHeaderRow}>
          <Text style={[typography.label, styles.searchLabel]}>Search for a place</Text>
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
            <View style={styles.candidateIcon}>
              <Feather name="map-pin" size={16} color={colors.accent} />
            </View>
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
            <Text style={styles.openText}>Open original post</Text>
          </Pressable>
        ) : null}
        {openMsg ? <Text style={styles.openMsg}>{openMsg}</Text> : null}
        <Pressable
          onPress={confirmRemove}
          style={styles.removeBtn}
          accessibilityRole="button"
          accessibilityLabel="Remove from queue"
        >
          <Text style={[typography.caption, styles.removeText]}>Remove from queue</Text>
        </Pressable>
      </View>
    );
  }

  if (loading) {
    return (
      <Screen padded={false}>
        <ShareJobsHeader title="Confirm place" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!job) {
    return (
      <Screen padded={false}>
        <ShareJobsHeader title="Confirm place" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <Text style={[typography.body, styles.help]}>This job is no longer available.</Text>
          <Button title="Back to queue" onPress={backToQueue} style={{ marginTop: Spacing.lg }} />
        </View>
      </Screen>
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
      <Screen padded={false}>
        <ShareJobsHeader title="Confirm place" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <View style={styles.savedBadge}>
            <Feather name="check" size={26} color={colors.primary} />
          </View>
          <Text style={[typography.heading, styles.centeredTitle]}>{name || 'Saved to your map'}</Text>
          <Text style={[typography.body, styles.help, { textAlign: 'center' }]}>
            {alreadySaved ? 'Already on your map.' : 'This place is on your map.'}
          </Text>
          <Button
            title="View place"
            onPress={() => goToMap(job.saved_place_id)}
            style={styles.centeredPrimary}
          />
        </View>
      </Screen>
    );
  }

  // Terminal dismissed (cancelled / unknown terminal) — safe, control-free view.
  if (detailMode === 'dismissed') {
    return (
      <Screen padded={false}>
        <ShareJobsHeader title="Confirm place" onBack={backToQueue} backLabel="Back to queue" />
        <View style={styles.centered}>
          <Text style={[typography.body, styles.help]}>
            This item is no longer in your queue.
          </Text>
          <Button title="Back to queue" onPress={backToQueue} style={{ marginTop: Spacing.lg }} />
        </View>
      </Screen>
    );
  }

  const isMulti = job.decision === 'multi_candidate_confirmation';
  const isManual =
    job.status === 'failed' ||
    job.decision === 'manual_fallback' ||
    candidates.length === 0;
  const single = candidates[0];
  const alreadySavedId = single
    ? findSavedPlaceIdByGooglePlaceId(single.googlePlaceId, getSavedPlacesCacheSnapshot())
    : null;

  const sourceIcon: React.ComponentProps<typeof Feather>['name'] =
    platform === 'instagram'
      ? 'instagram'
      : platform === 'tiktok'
        ? 'video'
        : platform === 'youtube'
          ? 'youtube'
          : 'link';

  return (
    <Screen padded={false}>
      <ShareJobsHeader title="Confirm place" onBack={backToQueue} backLabel="Back to queue" />
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.sourceRow}>
          <Feather name={sourceIcon} size={14} color={colors.textSecondary} />
          <Text style={[typography.caption, styles.sourceText]} numberOfLines={1}>
            Suggested from {platformNoun(platform)}
          </Text>
        </View>

        {isProcessing ? (
          <View style={styles.section}>
            <View style={styles.processingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={[typography.body, styles.help, { marginBottom: 0 }]}>
                Finding the place from this post…
              </Text>
            </View>
          </View>
        ) : isMulti ? (
          <View style={styles.section}>
            <Text style={[typography.title, styles.title]}>We found {candidates.length} places</Text>
            <Text style={[typography.caption, styles.help]}>Choose which ones to save.</Text>
            {candidates.map((c) => {
              const id = c.googlePlaceId;
              const checked = !!id && selectedIds.has(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => id && toggleSelect(id)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked }}
                  accessibilityLabel={c.name}
                  style={({ pressed }) => [styles.candidate, pressed ? styles.candidatePressed : null]}
                >
                  <View style={styles.candidateIcon}>
                    <Feather name="map-pin" size={16} color={colors.accent} />
                  </View>
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
                  <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>
                    {checked ? <Feather name="check" size={14} color={colors.textInverse} /> : null}
                  </View>
                </Pressable>
              );
            })}
            <Button
              title={selectedIds.size === 0 ? 'Select places to save' : `Save selected (${selectedIds.size})`}
              onPress={() => void handleSaveSelected()}
              disabled={selectedIds.size === 0 || busy}
              loading={busy}
              style={styles.primaryBtn}
            />
            {searchExpanded ? (
              renderManualSearch({ onCancel: () => setSearchExpanded(false) })
            ) : (
              <Button
                title="Search for another place"
                variant="secondary"
                onPress={() => setSearchExpanded(true)}
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
              {alreadySavedId ? 'This place is already on your map' : 'I found a likely match'}
            </Text>
            <Text style={[typography.caption, styles.help]}>
              {alreadySavedId
                ? 'You saved this one before.'
                : 'Is this the place from the post?'}
            </Text>
            <View style={styles.candidateCard}>
              <View style={styles.candidateCardIcon}>
                <Feather name="map-pin" size={22} color={colors.accent} />
              </View>
              <View style={styles.flex}>
                <Text style={[typography.heading, styles.candidateCardName]} numberOfLines={2}>
                  {single?.name ?? 'This place'}
                </Text>
                {single?.formattedAddress ? (
                  <Text style={[typography.body, styles.candidateCardAddr]} numberOfLines={2}>
                    {single.formattedAddress}
                  </Text>
                ) : null}
              </View>
            </View>

            {alreadySavedId ? (
              <Button
                title="View place"
                variant="secondary"
                onPress={() => void viewAlreadySaved(alreadySavedId)}
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
                onCancel: () => setSearchExpanded(false),
              })
            ) : (
              <Button
                title="Not the right place? Search again"
                variant="secondary"
                onPress={() => {
                  if (!manualQuery) setManualQuery(job.suggested_query || single?.name || '');
                  setSearchExpanded(true);
                }}
                style={styles.secondaryBtn}
              />
            )}
          </View>
        )}

        {renderJobFooter()}
      </ScrollView>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
    centeredTitle: { color: colors.text, textAlign: 'center', marginTop: Spacing.md },
    centeredPrimary: { marginTop: Spacing.lg, minHeight: 56, alignSelf: 'stretch' },
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
      paddingVertical: 6,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
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
    candidateCardIcon: {
      width: 48,
      height: 48,
      borderRadius: 14,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    candidateCardName: { color: colors.text },
    candidateCardAddr: { color: colors.textSecondary, marginTop: 4 },
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
    searchLabel: { color: colors.textSecondary },
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
    candidateIcon: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
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
    openText: { color: colors.textSecondary, fontSize: 15, fontWeight: '600' },
    openMsg: { color: colors.textMuted, fontSize: 13, marginTop: Spacing.sm, textAlign: 'center' },
    removeBtn: { paddingVertical: Spacing.md, marginTop: Spacing.md, minHeight: 44, justifyContent: 'center' },
    removeText: { color: colors.danger, fontWeight: '600' },
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
