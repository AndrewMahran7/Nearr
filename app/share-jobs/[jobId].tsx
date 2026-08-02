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
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, ErrorBoundary, Input, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { classifyShareJobDetail } from '@/lib/shareJobRouting';
import { usePlacesSearch } from '@/hooks/usePlacesSearch';
import { upsertSavedPlaceIntoCache } from '@/hooks/useSavedPlaces';
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

function normalizeShareJobCandidates(input: unknown): ShareJobCandidate[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => ({
      googlePlaceId: typeof row.googlePlaceId === 'string' ? row.googlePlaceId : '',
      name: typeof row.name === 'string' ? row.name : '',
      formattedAddress: typeof row.formattedAddress === 'string' ? row.formattedAddress : null,
      latitude: typeof row.latitude === 'number' ? row.latitude : null,
      longitude: typeof row.longitude === 'number' ? row.longitude : null,
      types: Array.isArray(row.types)
        ? row.types.filter((v): v is string => typeof v === 'string')
        : [],
      matchScore: typeof row.matchScore === 'number' ? row.matchScore : null,
    }))
    .filter((row) => row.googlePlaceId.length > 0 && row.name.length > 0);
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
  const seededQueryRef = useRef(false);

  const { results, loading: searching, search } = usePlacesSearch();

  const load = useCallback(async () => {
    if (!jobId) return;
    try {
      const j = await getShareJob(jobId);
      setJob(j);
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

  function sourceHost(url: string | null): string | null {
    if (!url) return null;
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return null;
    }
  }

  async function persistCandidate(
    candidate: PlaceCandidate,
  ): Promise<{ savedPlaceId: string | null; duplicate: boolean }> {
    const result = await saveSavedPlace({
      candidate,
      radiusValue: null,
      radiusUnit: null,
      sourceType: sourceTypeFor(platform),
      sourceUrl,
    });
    if (result.status === 'saved') {
      upsertSavedPlaceIntoCache(result.saved);
      return { savedPlaceId: result.savedPlaceId, duplicate: false };
    }
    // Already in the user's saved places — reuse the existing row. NEVER a
    // duplicate insert and NEVER surfaced as an error.
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

  function goToMap(savedPlaceId: string | null) {
    if (savedPlaceId) {
      router.replace({ pathname: '/(tabs)/map', params: { savedPlaceId } });
    } else {
      router.replace('/(tabs)/map');
    }
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

  function renderManualSearch(prefillNote?: string) {
    return (
      <View style={styles.section}>
        {prefillNote ? (
          <Text style={[typography.body, styles.help]}>{prefillNote}</Text>
        ) : null}
        <View style={styles.searchRow}>
          <View style={styles.flex}>
            <Input
              placeholder="Search for the place"
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
            style={({ pressed }) => [styles.candidate, pressed ? styles.candidatePressed : null]}
          >
            <Text style={[typography.body, styles.candidateName]} numberOfLines={1}>
              {c.name}
            </Text>
            {c.formattedAddress ? (
              <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={1}>
                {c.formattedAddress}
              </Text>
            ) : null}
          </Pressable>
        ))}
      </View>
    );
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!job) {
    return (
      <Screen>
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
      <Screen>
        <Text style={[typography.heading, styles.title]}>{name || 'Saved to your map'}</Text>
        <Text style={[typography.body, styles.help]}>
          {alreadySaved ? 'This place is already in Nearr.' : 'This place is on your map.'}
        </Text>
        <Button
          title="View on map"
          onPress={() => goToMap(job.saved_place_id)}
          style={{ marginTop: Spacing.lg }}
        />
      </Screen>
    );
  }

  // Terminal dismissed (cancelled / unknown terminal) — safe, control-free view.
  if (detailMode === 'dismissed') {
    return (
      <Screen>
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

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {sourceHost(sourceUrl) ? (
          <View style={styles.sourceRow}>
            <Text style={[typography.caption, styles.sourceText]} numberOfLines={1}>
              From {sourceHost(sourceUrl)}
            </Text>
          </View>
        ) : null}
        {isProcessing ? (
          <View style={styles.section}>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.body, styles.help, { marginTop: Spacing.md }]}>
              Finding the place from this post…
            </Text>
          </View>
        ) : isMulti ? (
          <View style={styles.section}>
            <Text style={[typography.heading, styles.title]}>
              We found {candidates.length} places
            </Text>
            <Text style={[typography.body, styles.help]}>Choose which ones to save.</Text>
            {candidates.map((c) => {
              const id = c.googlePlaceId;
              const checked = !!id && selectedIds.has(id);
              return (
                <Pressable
                  key={id}
                  onPress={() => id && toggleSelect(id)}
                  style={({ pressed }) => [styles.candidate, pressed ? styles.candidatePressed : null]}
                >
                  <View style={styles.flex}>
                    <Text style={[typography.body, styles.candidateName]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    {c.formattedAddress ? (
                      <Text style={[typography.caption, styles.candidateAddr]} numberOfLines={1}>
                        {c.formattedAddress}
                      </Text>
                    ) : null}
                  </View>
                  <View style={[styles.checkbox, checked ? styles.checkboxOn : null]}>
                    {checked ? <Text style={styles.checkboxMark}>✓</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            <Button
              title={selectedIds.size === 0 ? 'Select places to save' : `Save selected (${selectedIds.size})`}
              onPress={() => void handleSaveSelected()}
              disabled={selectedIds.size === 0 || busy}
              style={{ marginTop: Spacing.md }}
            />
            <View style={styles.divider} />
            {renderManualSearch('Not what you meant? Search instead.')}
          </View>
        ) : isManual ? (
          renderManualSearch(
            job.status === 'failed'
              ? "We couldn't find this automatically. Search for it and we'll keep the original post attached."
              : 'Search for the place from this post.',
          )
        ) : (
          <View style={styles.section}>
            <Text style={[typography.heading, styles.title]}>Is this the place?</Text>
            {single ? (
              <View style={styles.candidate}>
                <View style={styles.flex}>
                  <Text style={[typography.body, styles.candidateName]}>{single.name}</Text>
                  {single.formattedAddress ? (
                    <Text style={[typography.caption, styles.candidateAddr]}>
                      {single.formattedAddress}
                    </Text>
                  ) : null}
                </View>
              </View>
            ) : null}
            <Button
              title="Save this place"
              onPress={() => single && void handleSaveStored(single)}
              disabled={busy || !single}
              style={{ marginTop: Spacing.md }}
            />
            <View style={styles.divider} />
            {renderManualSearch('Not it? Search for the right place.')}
          </View>
        )}

        <View style={styles.footer}>
          {job.status === 'failed' && !job.saved_place_id ? (
            <Button title="Retry" variant="secondary" onPress={() => void handleRetry()} />
          ) : null}
          <Pressable onPress={() => void handleRemove()} style={styles.removeBtn}>
            <Text style={[typography.body, styles.removeText]}>Remove from queue</Text>
          </Pressable>
        </View>
      </ScrollView>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: { padding: Spacing.lg, paddingBottom: Spacing.xl },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.lg },
    sourceRow: {
      alignSelf: 'flex-start',
      paddingVertical: 4,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Spacing.md,
    },
    sourceText: { color: colors.textSecondary },
    flex: { flex: 1 },
    section: { marginBottom: Spacing.lg },
    title: { color: colors.text, marginBottom: Spacing.xs },
    help: { color: colors.textSecondary, marginBottom: Spacing.md },
    searchRow: { flexDirection: 'row', alignItems: 'center' },
    searchBtn: { marginLeft: Spacing.sm },
    candidate: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      marginTop: Spacing.sm,
    },
    candidatePressed: { backgroundColor: colors.surfaceElevated },
    candidateName: { color: colors.text, fontWeight: '600' },
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
    checkboxMark: { color: colors.textInverse, fontSize: 14, fontWeight: '700' },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: Spacing.lg },
    footer: { marginTop: Spacing.sm, alignItems: 'center' },
    removeBtn: { paddingVertical: Spacing.md, marginTop: Spacing.sm },
    removeText: { color: colors.danger },
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
