/**
 * app/share-jobs/index.tsx — the in-app share-job queue (source of truth).
 *
 * Sections: Processing, Needs your help, Recently found, Failed. Works with
 * notifications disabled (it reads Supabase directly via useShareJobs).
 * Reachable from the map/home entry point; also the deep-link target for
 * `share_job_needs_help` notifications routes to the per-job detail screen.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { ErrorBoundary, ShareJobsHeader } from '@/components';
import { PlaceImage } from '@/components/PlaceImage';
import { ShareJobsSheet } from '@/components/ShareJobsSheet';
import { SwipeableRow } from '@/components/SwipeableRow';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/hooks/useAuth';
import { useShareJobs } from '@/hooks/useShareJobs';
import { routeShareJobCard } from '@/lib/shareJobRouting';
import { createMapGroupFocusRequest } from '@/lib/mapGroupFocus';
import { PHASE2_PREVIEW_FIXTURES } from '@/lib/phase2Preview';
import {
  QUEUE_EMPTY_COPY,
  clearCompletedLabel,
  queueAccessibilityActions,
  queueSwipeAvailability,
  type QueueRow,
  type QueueSwipeAction,
} from '@/lib/queueInbox';
import {
  addClearedQueueIds,
  addDismissedQueueIds,
  readClearedQueueIds,
  readDismissedQueueIds,
} from '@/lib/queueClearedState';
import {
  getSavedPlacesCacheSnapshot,
  removeSavedPlaceFromCache,
  restoreSavedPlacesCache,
} from '@/hooks/useSavedPlaces';
import { trackEvent } from '@/lib/analytics';
import { autoSaveUndoElapsedBucket } from '@/lib/autoSaveUndo';
import { CATEGORY_LABELS, displayCategory } from '@/lib/placeCategory';
import {
  actionableCount,
  actionableJobs,
  backTarget,
  isQueueEmpty,
  processingJobs,
} from '@/lib/shareJobsUi';
import { PHASE_1_COPY, processingMessage, queueIntro, splitPlaceAddress } from '@/lib/sharePhase1Ui';
import {
  cancelShareJob,
  undoAutoSavedPlace,
  type RecentAutoSave,
  type ShareJob,
} from '@/services/shareJobsService';

// A processing job older than this is very likely stuck (the worker never
// claimed it). We surface an honest "taking longer than expected" state with a
// safe escape hatch instead of an eternal spinner — WITHOUT pretending the job
// is progressing.
const STALE_PROCESSING_MS = 3 * 60 * 1000;

function isStalledProcessing(job: ShareJob): boolean {
  if (job.status !== 'queued' && job.status !== 'processing_metadata') return false;
  const created = new Date(job.created_at).getTime();
  if (!Number.isFinite(created)) return false;
  return Date.now() - created > STALE_PROCESSING_MS;
}

function platformLabel(p: string | null | undefined): string {
  switch ((p ?? '').toLowerCase()) {
    case 'instagram':
      return 'Instagram';
    case 'tiktok':
      return 'TikTok';
    case 'youtube':
      return 'YouTube';
    case 'twitter':
      return 'X';
    default:
      return 'Link';
  }
}

function jobIcon(job: ShareJob): React.ComponentProps<typeof Feather>['name'] {
  switch ((job.source_platform ?? '').toLowerCase()) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'video';
    case 'youtube':
      return 'youtube';
    default:
      return 'link';
  }
}

function hostOf(url: string | null | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const diff = Date.now() - then;
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

function jobTitle(job: ShareJob): string {
  if (job.status === 'completed') {
    const name = (job.extraction_payload as { savedPlaceName?: string } | null)?.savedPlaceName;
    return name || 'Saved place';
  }
  const candidates = job.candidate_payload?.candidates;
  const first = Array.isArray(candidates) ? candidates[0]?.name : undefined;
  if (job.status === 'needs_help') {
    if (job.needs_help_reason === 'multiple_candidates') return 'A few possible places';
    if (first) return first;
    return 'Place from your post';
  }
  return platformLabel(job.source_platform) + ' post';
}

function jobSubtitle(job: ShareJob, stalled = false): string {
  switch (job.status) {
    case 'queued':
    case 'processing_metadata':
      return processingMessage(job.status, stalled ? STALE_PROCESSING_MS + 1 : 0);
    case 'needs_help':
      if (job.needs_help_reason === 'multiple_candidates') return 'Choose which ones to save';
      if (job.needs_help_reason === 'manual_search' || job.needs_help_reason === 'metadata_unavailable')
        return 'Tap to search for it';
      return 'Does this look right?';
    case 'failed':
      return "Couldn't find it — tap to search";
    default:
      return '';
  }
}

/** Show the raw domain only when the icon can't communicate the source — i.e.
 *  for generic links. For Instagram/TikTok/YouTube the platform icon already
 *  says it, so we drop the noisy "instagram.com" repetition. */
function shouldShowHost(job: ShareJob): boolean {
  return !['instagram', 'tiktok', 'youtube'].includes((job.source_platform ?? '').toLowerCase());
}

function ShareJobsQueueScreen() {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { jobs, recentAutoSaves, loading, refreshing, refresh, enabled, authLoading } = useShareJobs();
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [actingId, setActingId] = useState<string | null>(null);
  const [clearedIds, setClearedIds] = useState<Set<string>>(new Set());
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  // Locally acknowledged completed rows stay hidden across launches. This never
  // deletes a saved place or mutates a job.
  useEffect(() => {
    let active = true;
    void Promise.all([readClearedQueueIds(userId), readDismissedQueueIds(userId)]).then(([cleared, dismissed]) => {
      if (active) {
        setClearedIds(cleared);
        setDismissedIds(dismissed);
      }
    });
    return () => {
      active = false;
    };
  }, [userId]);

  // Presentation grouping (visibility already filtered upstream by the hook):
  // needs_help + failed are both actionable → one "Needs you" section;
  // queued/processing_metadata → "Working". Terminal jobs never appear.
  const visibleJobs = useMemo(
    () => jobs.filter((job) => !dismissedIds.has(job.id)),
    [dismissedIds, jobs],
  );
  const actionable = useMemo(() => actionableJobs(visibleJobs), [visibleJobs]);
  const processing = useMemo(() => processingJobs(visibleJobs), [visibleJobs]);
  const completedRows = useMemo(
    () => recentAutoSaves.filter((item) => !clearedIds.has(item.resultId)),
    [recentAutoSaves, clearedIds],
  );
  const count = actionableCount(visibleJobs);
  const empty = isQueueEmpty(visibleJobs);
  const hasContent = !empty || completedRows.length > 0;
  const clearableCount = completedRows.length;

  async function clearCompleted() {
    if (actingId || clearableCount === 0) return;
    setActingId('clear-completed');
    try {
      const ids = completedRows.map((item) => item.resultId);
      setClearedIds(await addClearedQueueIds(userId, ids));
    } finally {
      setActingId(null);
    }
  }

  /** Swipe/accessibility model for an actionable or processing job row. */
  function queueRowFor(job: ShareJob): QueueRow {
    const candidates = job.candidate_payload?.candidates;
    return {
      id: job.id,
      status: job.status,
      hasResolvedCandidate: Array.isArray(candidates) && candidates.length === 1,
      savedPlaceId: job.saved_place_id ?? null,
    };
  }

  function handleRowAction(job: ShareJob, action: QueueSwipeAction) {
    if (action === 'dismiss') {
      // Active jobs are dismissed locally only; backend processing continues.
      if (job.status === 'queued' || job.status === 'processing_metadata') {
        void addDismissedQueueIds(userId, [job.id]).then(setDismissedIds);
      } else {
        // Actionable rows can be explicitly removed from the queue via the
        // existing cancel/delete mutation.
        void removeFromQueue(job);
      }
      return;
    }
    // Saving requires the full confirm path so ownership, dedupe, and map focus
    // all run exactly as they do from Quick check.
    openJob(job);
  }

  // Never leave the user trapped: go back if there's a Nearr route to return
  // to, otherwise fall back to the map (cold deep-link entry from the
  // extension's "View queue" has no previous route).
  function goBack() {
    const target = backTarget(router.canGoBack(), '/(tabs)/map');
    if (target.kind === 'back') router.back();
    else router.replace(target.route);
  }

  async function removeFromQueue(job: ShareJob) {
    if (actingId) return;
    setActingId(job.id);
    try {
      await cancelShareJob(job.id);
    } catch {
      Alert.alert('Could not remove', 'Please try again in a moment.');
    } finally {
      setActingId(null);
      refresh();
    }
  }

  async function undoRecent(item: RecentAutoSave) {
    if (actingId) return;
    setActingId(item.savedPlaceId);
    const snapshot = getSavedPlacesCacheSnapshot();
    removeSavedPlaceFromCache(item.savedPlaceId);
    try {
      await undoAutoSavedPlace(item.savedPlaceId);
      void trackEvent('auto_save_undone', {
        surface: 'share_queue',
        elapsed_bucket: autoSaveUndoElapsedBucket(item.finalizedAt),
        category: item.savedPlace.category ?? 'other',
      });
    } catch (error) {
      restoreSavedPlacesCache(snapshot);
      Alert.alert('Could not undo', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setActingId(null);
      await refresh();
    }
  }

  function renderRecentAutoSave(item: RecentAutoSave) {
    const busy = actingId === item.savedPlaceId || actingId === 'all-auto-saves';
    const category = CATEGORY_LABELS[displayCategory(item.savedPlace.category)];
    return (
      <Pressable
        onPress={() => router.push({ pathname: '/(tabs)/map', params: { savedPlaceId: item.savedPlaceId } })}
        disabled={busy}
        style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
        accessibilityRole="button"
        accessibilityLabel={`Open ${item.savedPlace.place.name}`}
      >
        <PlaceImage googlePlaceId={item.savedPlace.place.google_place_id} size={64} borderRadius={12} />
        <View style={styles.rowMain}>
          <Text style={[typography.bodyStrong, styles.rowTitle]} numberOfLines={2}>{item.savedPlace.place.name}</Text>
          <View style={styles.autoSaveMeta}>
            <Text style={styles.categoryBadge}>{category}</Text>
            <Text style={[typography.caption, styles.rowMeta]}>{relativeTime(item.finalizedAt)}</Text>
          </View>
        </View>
        <Pressable
          onPress={() => void undoRecent(item)}
          disabled={busy}
          hitSlop={8}
          style={styles.undoButton}
          accessibilityRole="button"
          accessibilityLabel={`Undo saving ${item.savedPlace.place.name}`}
        >
          {busy ? <ActivityIndicator color={colors.primary} /> : <Feather name="rotate-ccw" size={19} color={colors.primary} />}
        </Pressable>
      </Pressable>
    );
  }

  // Honest escape hatch for a job the backend has not advanced. We never
  // pretend the job is progressing; we let the user open the original post or
  // remove it from the queue.
  function openStalledActions(job: ShareJob) {
    const original = job.canonical_url ?? job.source_url;
    const buttons: Parameters<typeof Alert.alert>[2] = [];
    if (original) {
      buttons.push({
        text: 'Open original post',
        onPress: () => {
          Linking.openURL(original).catch(() => {
            Alert.alert('Could not open link');
          });
        },
      });
    }
    buttons.push({
      text: 'Remove from queue',
      style: 'destructive',
      onPress: () => void removeFromQueue(job),
    });
    buttons.push({ text: 'Keep waiting', style: 'cancel' });
    Alert.alert(
      'Taking longer than expected',
      "This one hasn't finished yet. You can open the original post or remove it from your queue.",
      buttons,
    );
  }

  function openJob(job: ShareJob) {
    // Processing jobs aren't actionable; a stalled one gets an honest escape hatch.
    if (job.status === 'queued' || job.status === 'processing_metadata') {
      if (isStalledProcessing(job)) openStalledActions(job);
      return;
    }
    // Everything else routes by OUTCOME (never assume the card is actionable):
    // a completed/already-saved job opens its saved place; an actionable job
    // opens the detail route; a terminal/unknown job is a safe no-op.
    const route = routeShareJobCard(job);
    switch (route.kind) {
      case 'saved_place':
        router.push({ pathname: '/(tabs)/map', params: { savedPlaceId: route.savedPlaceId } });
        break;
      case 'queue_item':
        router.push({ pathname: '/share-jobs/[jobId]', params: { jobId: route.jobId } });
        break;
      case 'map':
        router.push('/(tabs)/map');
        break;
      case 'queue_root':
      default:
        break; // already on the queue
    }
  }

  function openMapGroupPreview() {
    const savedPlaceIds = (getSavedPlacesCacheSnapshot() ?? [])
      .slice(0, 8)
      .map((place) => place.id);
    if (savedPlaceIds.length < 2) {
      Alert.alert('Add two saved places first', 'The group map preview uses your current local cache and never writes data.');
      return;
    }
    const request = createMapGroupFocusRequest({
      savedPlaceIds,
      source: 'development_preview',
      failedCount: 2,
    });
    if (!request) return;
    router.push({ pathname: '/(tabs)/map', params: { mapGroupId: request.id } });
  }

  function renderRow(job: ShareJob) {
    const isProcessing = job.status === 'queued' || job.status === 'processing_metadata';
    const stalled = isProcessing && isStalledProcessing(job);
    const busy = actingId === job.id;
    const actionableRow = !isProcessing || stalled;
    const subtitle = jobSubtitle(job, stalled);
    const firstCandidate = Array.isArray(job.candidate_payload?.candidates)
      ? job.candidate_payload?.candidates[0]
      : null;
    const locality = splitPlaceAddress(firstCandidate?.formattedAddress).locality;
    return (
      <Pressable
        onPress={() => openJob(job)}
        disabled={!actionableRow || busy}
        style={({ pressed }) => [styles.row, pressed && actionableRow ? styles.rowPressed : null]}
        accessibilityRole="button"
        accessibilityLabel={`${jobTitle(job)}. ${subtitle}`}
      >
        <PlaceImage
          googlePlaceId={firstCandidate?.googlePlaceId}
          size={64}
          borderRadius={12}
          accessibilityLabel={firstCandidate?.name ? `Photo of ${firstCandidate.name}` : undefined}
        />
        <View style={styles.rowMain}>
          <Text style={[typography.bodyStrong, styles.rowTitle]} numberOfLines={2}>
            {jobTitle(job)}
          </Text>
          {locality ? (
            <Text style={[typography.caption, styles.rowLocality]} numberOfLines={1}>{locality}</Text>
          ) : null}
          <View style={styles.rowDetail}>
            <Text style={[typography.caption, styles.rowSubtitle]} numberOfLines={1}>{subtitle}</Text>
            <Text style={[typography.caption, styles.rowMeta]} numberOfLines={1}>
              {shouldShowHost(job)
                ? `${hostOf(job.canonical_url ?? job.source_url)} · ${relativeTime(job.created_at)}`.replace(/^ · /, '')
                : relativeTime(job.created_at)}
            </Text>
          </View>
        </View>
        {busy ? (
          <ActivityIndicator color={colors.primary} />
        ) : stalled ? (
          <Feather name="alert-circle" size={20} color={colors.textMuted} />
        ) : isProcessing ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Feather
            name="chevron-right"
            size={20}
            color={job.status === 'needs_help' ? colors.primary : colors.textMuted}
          />
        )}
      </Pressable>
    );
  }

  function renderSection(title: string, sectionJobs: ShareJob[]) {
    if (sectionJobs.length === 0) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[typography.label, styles.sectionTitle]}>{title}</Text>
        </View>
        <View style={styles.card}>
          {sectionJobs.map((job, i) => {
            const row = queueRowFor(job);
            const availability = queueSwipeAvailability(row);
            return (
              <View key={job.id}>
                {i > 0 ? <View style={styles.separator} /> : null}
                <SwipeableRow
                  availability={availability}
                  actions={queueAccessibilityActions(row)}
                  onAction={(action) => handleRowAction(job, action)}
                  disabled={actingId === job.id}
                  accessibilityLabel={jobTitle(job)}
                >
                  {renderRow(job)}
                </SwipeableRow>
              </View>
            );
          })}
        </View>
      </View>
    );
  }

  // The header is rendered in EVERY state so the back control is always
  // available — even while auth restores, when the flag is off, or when empty.
  const header = (
    <ShareJobsHeader title="Your queue" onBack={goBack} backLabel="Close queue" icon="close" />
  );

  if (!enabled) {
    return (
      <ShareJobsSheet onDismiss={goBack} size="compact">
        {header}
        {authLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : (
          <View style={styles.stateWrap}>
            <Text style={[typography.heading, styles.emptyTitle]}>Sharing is unavailable</Text>
            <Text style={[typography.body, styles.emptyBody]}>Shared links open directly for now.</Text>
          </View>
        )}
      </ShareJobsSheet>
    );
  }

  return (
    <ShareJobsSheet onDismiss={goBack} size={hasContent ? 'queue' : 'compact'}>
      {header}
      <ScrollView
        contentContainerStyle={styles.content}
        contentInsetAdjustmentBehavior="automatic"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && !hasContent ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !hasContent ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}><Feather name="inbox" size={22} color={colors.primary} /></View>
            <Text style={[typography.heading, styles.emptyTitle]}>{QUEUE_EMPTY_COPY.title}</Text>
            <Text style={[typography.body, styles.emptyBody]}>{QUEUE_EMPTY_COPY.body}</Text>
          </View>
        ) : (
          <>
            {actionable.length > 0 ? (
              <Text style={[typography.body, styles.intro]}>{queueIntro(count)}</Text>
            ) : null}
            {renderSection('Needs you', actionable)}
            {renderSection('Working', processing)}
          </>
        )}
        {completedRows.length > 0 ? (
          <View style={styles.section}>
            <View style={styles.sectionHeader}>
              <Text style={[typography.label, styles.sectionTitle]}>Recently completed</Text>
              <Pressable
                onPress={() => void clearCompleted()}
                disabled={!!actingId}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={clearCompletedLabel(clearableCount)}
              >
                <Text style={styles.undoAllText}>Clear completed</Text>
              </Pressable>
            </View>
            <View style={styles.card}>
              {completedRows.map((item, index) => (
                <View key={item.resultId}>
                  {index > 0 ? <View style={styles.separator} /> : null}
                  {renderRecentAutoSave(item)}
                </View>
              ))}
            </View>
          </View>
        ) : null}
        {__DEV__ ? (
          <View style={styles.previewSection}>
            <Text style={[typography.label, styles.sectionTitle]}>Development previews</Text>
            <Text style={[typography.caption, styles.previewHelp]}>Read-only fixtures. No save mutations run.</Text>
            <View style={styles.previewActions}>
              {PHASE2_PREVIEW_FIXTURES.map((fixture) => (
                <Pressable
                  key={fixture.id}
                  onPress={() => router.push({ pathname: '/share-jobs/[jobId]', params: { jobId: fixture.id } })}
                  style={styles.previewButton}
                >
                  <Text style={styles.previewButtonText}>{fixture.label}</Text>
                </Pressable>
              ))}
              <Pressable onPress={openMapGroupPreview} style={styles.previewButton}>
                <Text style={styles.previewButtonText}>Current group map</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>
    </ShareJobsSheet>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: { paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.xxl },
    loadingWrap: { paddingTop: Spacing.xl * 2, alignItems: 'center' },
    stateWrap: { paddingTop: Spacing.xl, paddingHorizontal: Spacing.lg },
    intro: { color: colors.textSecondary, lineHeight: 22, marginBottom: Spacing.xl },
    section: { marginBottom: Spacing.xl },
    previewSection: { marginTop: Spacing.lg, marginBottom: Spacing.xl },
    previewHelp: { color: colors.textSecondary, marginTop: 4, marginBottom: Spacing.md },
    previewActions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
    previewButton: {
      minHeight: 38,
      justifyContent: 'center',
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    previewButtonText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    sectionTitle: { color: colors.text, fontWeight: '700' },
    countBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    countBadgeText: { color: colors.textInverse, fontSize: 12, fontWeight: '700' },
    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
      minHeight: 104,
      paddingVertical: Spacing.lg,
      paddingHorizontal: Spacing.lg,
    },
    rowPressed: { backgroundColor: colors.surfaceElevated },
    separator: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.border,
      marginLeft: 40 + Spacing.md * 2,
    },
    rowMain: { flex: 1, minWidth: 0, marginRight: Spacing.xs },
    rowTitle: { color: colors.text },
    rowLocality: { color: colors.textSecondary, marginTop: 2 },
    rowDetail: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: 5 },
    rowSubtitle: { color: colors.textSecondary, flexShrink: 1 },
    rowMeta: { color: colors.textMuted, marginLeft: 'auto' },
    autoSaveMeta: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
    categoryBadge: {
      color: colors.textSecondary,
      backgroundColor: colors.surfaceElevated,
      borderRadius: Radius.sm,
      paddingHorizontal: Spacing.sm,
      paddingVertical: 3,
      fontSize: 12,
      fontWeight: '600',
    },
    undoButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
    undoAllText: { color: colors.primary, fontSize: 14, fontWeight: '700' },
    emptyState: { alignItems: 'center', paddingHorizontal: Spacing.xl, paddingTop: 72 },
    emptyIcon: {
      width: 52,
      height: 52,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      marginBottom: Spacing.lg,
    },
    emptyTitle: { color: colors.text, textAlign: 'center' },
    emptyBody: { color: colors.textSecondary, textAlign: 'center', lineHeight: 22, marginTop: Spacing.sm },
  });
}

// Route-level error boundary so a single malformed job row (or any unexpected
// render error) shows a friendly retry + a SANITIZED log line, instead of
// dropping the whole app to the generic global boundary.
export default function ShareJobsQueueRoute() {
  return (
    <ErrorBoundary
      name="share-jobs"
      fallbackTitle="Couldn't open your queue"
      fallbackBody="Something went wrong loading the queue. Try again."
    >
      <ShareJobsQueueScreen />
    </ErrorBoundary>
  );
}
