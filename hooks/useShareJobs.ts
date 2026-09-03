/**
 * hooks/useShareJobs.ts
 *
 * State for the in-app share-job queue (the source of truth). The queue works
 * regardless of notification permission — it fetches from Supabase, subscribes
 * to realtime changes, and polls as a fallback while any job is still active.
 *
 *   useShareJobs()       — full list + sections for the queue screen.
 *   useNeedsHelpCount()  — lightweight badge count for the map/home entry.
 *
 * Both no-op (empty) when the async share-jobs flag is off.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { AppState, type AppStateStatus } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/hooks/useAuth';
import { recordBreadcrumb } from '@/lib/breadcrumbs';
import { isDemoMode } from '@/lib/demoMode';
import { canReachShareQueue } from '@/lib/shareQueueAccess';
import { dedupeJobsById } from '@/lib/shareJobsDedupe';
import { filterQueueVisible } from '@/lib/shareJobRouting';
import { normalizeActiveQueueRows } from '@/lib/queueInbox';
import { readDismissedQueueIds, subscribeQueueDismissals } from '@/lib/queueClearedState';
import { createShareJobsRealtimeSubscription } from '@/lib/shareJobsRealtime';
import {
  listRecentAutoSaves,
  listShareJobs,
  type RecentAutoSave,
  type ShareJob,
} from '@/services/shareJobsService';

const POLL_MS = 6_000;

export type ShareJobSections = {
  processing: ShareJob[];
  awaitingPurchase: ShareJob[];
  needsHelp: ShareJob[];
  failed: ShareJob[];
};

function sectionize(jobs: ShareJob[]): ShareJobSections {
  const processing: ShareJob[] = [];
  const awaitingPurchase: ShareJob[] = [];
  const needsHelp: ShareJob[] = [];
  const failed: ShareJob[] = [];
  for (const job of jobs) {
    switch (job.status) {
      case 'awaiting_purchase':
        awaitingPurchase.push(job);
        break;
      case 'queued':
      case 'processing_metadata':
        processing.push(job);
        break;
      case 'needs_help':
        needsHelp.push(job);
        break;
      case 'failed':
        failed.push(job);
        break;
      default:
        // completed / cancelled / unknown are terminal — never shown here.
        break;
    }
  }
  return { processing, awaitingPurchase, needsHelp, failed };
}

export function useShareJobs() {
  const { session, isDevSession, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;
  // Reachability, NOT the async-share rollout flag. A signed-in account can
  // always read its own jobs; when the flag is off there simply are none, and
  // the queue screen's empty state says so. Reading is never the thing the
  // rollout gates — creating jobs is (app/share.tsx, ShareExtension.tsx).
  const enabled = canReachShareQueue({
    signedIn: !!userId,
    isDevSession,
    isDemoMode: isDemoMode(),
  });

  const [jobs, setJobs] = useState<ShareJob[]>([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());
  const [recentAutoSaves, setRecentAutoSaves] = useState<RecentAutoSave[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);
  const activeUserRef = useRef(userId);
  activeUserRef.current = userId;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Clear queue state immediately when the signed-in user changes (account
  // switch / sign-out) so the previous user's jobs never flash for the next
  // account before the RLS-scoped reload lands.
  useEffect(() => {
    setJobs([]);
    setDismissedIds(new Set());
    setRecentAutoSaves([]);
    setError(null);
  }, [userId]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      setAppState(nextState);
    });
    return () => sub.remove();
  }, []);

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'background') => {
      const requestedUserId = userId;
      if (!enabled) {
        setJobs([]);
        setRecentAutoSaves([]);
        return;
      }
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const [data, recent, dismissed] = await Promise.all([
          listShareJobs(),
          listRecentAutoSaves(),
          readDismissedQueueIds(requestedUserId),
        ]);
        if (!mountedRef.current || requestedUserId !== activeUserRef.current) return;
        // Defensive dedupe + visibility filter by stable job id: the DB query
        // already excludes terminal jobs, but a realtime insert landing during
        // the initial fetch, a duplicate event, or a delayed event for a job
        // that has since resolved must never render a resolved/terminal card.
        setJobs(filterQueueVisible(dedupeJobsById(data)));
        setDismissedIds(dismissed);
        setRecentAutoSaves(recent);
        setError(null);
      } catch (err) {
        if (!mountedRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load queue');
      } finally {
        if (!mountedRef.current) return;
        if (mode === 'initial') setLoading(false);
        if (mode === 'refresh') setRefreshing(false);
      }
    },
    [enabled, userId],
  );

  // Initial fetch + refetch when the screen regains focus.
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      void load(jobs.length === 0 ? 'initial' : 'background');
      return () => setIsFocused(false);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load]),
  );

  const isScreenActive = enabled && isFocused && appState === 'active';

  useEffect(() => {
    if (!isScreenActive) return;
    void load('background');
  }, [isScreenActive, load]);

  // Realtime subscription (RLS-scoped to this user).
  useEffect(() => {
    if (!isScreenActive || !userId) return;
    return createShareJobsRealtimeSubscription({
      client: supabase,
      scope: 'share_jobs',
      userId,
      onInvalidate: () => {
        recordBreadcrumb('queue_realtime_event');
        void load('background');
      },
      onStatus: (status) => {
        recordBreadcrumb('queue_realtime_event', { result: `queue_${status.toLowerCase()}` });
      },
      onError: (realtimeError) => {
        recordBreadcrumb('queue_realtime_event', {
          result: 'queue_subscription_failed',
          errorName: realtimeError instanceof Error ? realtimeError.name : 'Error',
          errorMessage:
            realtimeError instanceof Error ? realtimeError.message : String(realtimeError),
        });
      },
    });
  }, [isScreenActive, userId, load]);

  const visibleJobs = useMemo(
    () => normalizeActiveQueueRows(jobs, dismissedIds),
    [dismissedIds, jobs],
  );
  const visibleSections = useMemo(() => sectionize(visibleJobs), [visibleJobs]);
  const hasActive = visibleSections.processing.length > 0;

  useEffect(() => subscribeQueueDismissals((changedUserId, ids) => {
    if (changedUserId === userId) setDismissedIds(ids);
  }), [userId]);

  // Poll while any job is still processing (realtime fallback).
  useEffect(() => {
    if (!isScreenActive || !hasActive) return;
    const id = setInterval(() => void load('background'), POLL_MS);
    return () => clearInterval(id);
  }, [isScreenActive, hasActive, load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  return {
    jobs: visibleJobs,
    recentAutoSaves,
    sections: visibleSections,
    loading,
    refreshing,
    error,
    refresh,
    needsHelpCount: visibleSections.awaitingPurchase.length + visibleSections.needsHelp.length,
    activeQueueCount: visibleJobs.length,
    enabled,
    // True while the Supabase session is still being restored (cold start).
    // The queue screen shows a spinner instead of the "queue is off" state.
    authLoading,
  };
}

/**
 * Map/home badge count from the exact normalized model used by the Queue
 * sheet. This includes Working + Needs-you and respects persisted dismissal.
 */
export function useActiveQueueCount(): number {
  const { activeQueueCount, enabled } = useShareJobs();
  return enabled ? activeQueueCount : 0;
}
