/**
 * app/share-jobs/index.tsx — the in-app share-job queue (source of truth).
 *
 * Sections: Processing, Needs your help, Recently found, Failed. Works with
 * notifications disabled (it reads Supabase directly via useShareJobs).
 * Reachable from the map/home entry point; also the deep-link target for
 * `share_job_needs_help` notifications routes to the per-job detail screen.
 */
import { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { EmptyState, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useShareJobs } from '@/hooks/useShareJobs';
import type { ShareJob } from '@/services/shareJobsService';

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
  const first = job.candidate_payload?.candidates?.[0]?.name;
  if (job.status === 'needs_help') {
    if (job.needs_help_reason === 'multiple_candidates') return 'Multiple places found';
    if (first) return first;
    return 'Help find this place';
  }
  return platformLabel(job.source_platform) + ' post';
}

function jobSubtitle(job: ShareJob): string {
  switch (job.status) {
    case 'queued':
    case 'processing_metadata':
      return 'Finding the place from this post…';
    case 'needs_help':
      if (job.needs_help_reason === 'multiple_candidates') return 'Choose which ones to save';
      if (job.needs_help_reason === 'manual_search' || job.needs_help_reason === 'metadata_unavailable')
        return 'Tap to search for it';
      return 'Tap to confirm the place';
    case 'completed':
      return `Found · ${platformLabel(job.source_platform)}`;
    case 'failed':
      return "We couldn't finish this one — tap to search";
    default:
      return '';
  }
}

export default function ShareJobsQueueScreen() {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const { sections, loading, refreshing, refresh, enabled, authLoading } = useShareJobs();

  const isEmpty =
    sections.processing.length === 0 &&
    sections.needsHelp.length === 0 &&
    sections.recentlyFound.length === 0 &&
    sections.failed.length === 0;

  function openJob(job: ShareJob) {
    if (job.status === 'completed' && job.saved_place_id) {
      router.push({ pathname: '/(tabs)/map', params: { savedPlaceId: job.saved_place_id } });
      return;
    }
    if (job.status === 'queued' || job.status === 'processing_metadata') return;
    router.push({ pathname: '/share-jobs/[jobId]', params: { jobId: job.id } });
  }

  function renderRow(job: ShareJob) {
    const processing = job.status === 'queued' || job.status === 'processing_metadata';
    const host = hostOf(job.canonical_url ?? job.source_url);
    return (
      <Pressable
        key={job.id}
        onPress={() => openJob(job)}
        disabled={processing}
        style={({ pressed }) => [
          styles.row,
          pressed && !processing ? styles.rowPressed : null,
        ]}
        accessibilityRole="button"
      >
        <View style={styles.iconTile}>
          <Feather name={jobIcon(job)} size={16} color={colors.accent} />
        </View>
        <View style={styles.rowMain}>
          <Text style={[typography.body, styles.rowTitle]} numberOfLines={1}>
            {jobTitle(job)}
          </Text>
          <Text style={[typography.caption, styles.rowSubtitle]} numberOfLines={1}>
            {jobSubtitle(job)}
          </Text>
          {host ? (
            <Text style={[typography.caption, styles.rowMeta]} numberOfLines={1}>
              {host} · {relativeTime(job.created_at)}
            </Text>
          ) : null}
        </View>
        {processing ? (
          <ActivityIndicator color={colors.primary} />
        ) : job.status === 'needs_help' ? (
          <View style={styles.badgeDot} />
        ) : (
          <Feather name="chevron-right" size={18} color={colors.textMuted} />
        )}
      </Pressable>
    );
  }

  function renderSection(title: string, jobs: ShareJob[], badge = false) {
    if (jobs.length === 0) return null;
    return (
      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={[typography.label, styles.sectionTitle]}>{title}</Text>
          {badge ? (
            <View style={styles.countBadge}>
              <Text style={styles.countBadgeText}>{jobs.length}</Text>
            </View>
          ) : (
            <Text style={[typography.caption, styles.sectionCount]}>{jobs.length}</Text>
          )}
        </View>
        <View style={styles.card}>{jobs.map(renderRow)}</View>
      </View>
    );
  }

  if (!enabled) {
    // Cold-start deep link (e.g. the extension's "View queue"): the session is
    // still restoring. Show a spinner instead of the misleading "off" state so
    // we never render a wrong terminal state before auth settles.
    if (authLoading) {
      return (
        <Screen>
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        </Screen>
      );
    }
    return (
      <Screen>
        <EmptyState
          title="Share queue is off"
          body="Shared links open directly for now."
        />
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={colors.primary} />
        }
        showsVerticalScrollIndicator={false}
      >
        {loading && isEmpty ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : isEmpty ? (
          <EmptyState
            title="Nothing in your queue"
            body="Share an Instagram or TikTok post to Nearr and it'll show up here while we find the place."
          />
        ) : (
          <>
            {renderSection('Needs your help', sections.needsHelp, true)}
            {renderSection('Processing', sections.processing)}
            {renderSection('Recently found', sections.recentlyFound)}
            {renderSection("Couldn't finish", sections.failed)}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    content: { padding: Spacing.lg, paddingBottom: Spacing.xl },
    loadingWrap: { paddingTop: Spacing.xl * 2, alignItems: 'center' },
    section: { marginBottom: Spacing.lg },
    sectionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: Spacing.sm,
    },
    sectionTitle: { color: colors.textSecondary },
    sectionCount: { color: colors.textMuted },
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
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    rowPressed: { backgroundColor: colors.surfaceElevated },
    iconTile: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: colors.bg,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rowMain: { flex: 1, marginRight: Spacing.sm },
    rowTitle: { color: colors.text, fontWeight: '600' },
    rowSubtitle: { color: colors.textSecondary, marginTop: 2 },
    rowMeta: { color: colors.textMuted, marginTop: 2 },
    badgeDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
      backgroundColor: colors.primary,
    },
  });
}
