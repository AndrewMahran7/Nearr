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
import { isAsyncShareJobsEnabled } from '@/lib/featureFlags';
import { isDemoMode } from '@/lib/demoMode';
import { dedupeJobsById } from '@/lib/shareJobsDedupe';
import { filterQueueVisible } from '@/lib/shareJobRouting';
import { createShareJobsRealtimeSubscription } from '@/lib/shareJobsRealtime';
import {
  listRecentAutoSaves,
  listShareJobs,
  type RecentAutoSave,
  type ShareJob,
} from '@/services/shareJobsService';

const ACTIVE_STATUSES: ShareJob['status'][] = ['queued', 'processing_metadata'];
const POLL_MS = 6_000;

export type ShareJobSections = {
  processing: ShareJob[];
  needsHelp: ShareJob[];
  failed: ShareJob[];
};

function sectionize(jobs: ShareJob[]): ShareJobSections {
  const processing: ShareJob[] = [];
  const needsHelp: ShareJob[] = [];
  const failed: ShareJob[] = [];
  for (const job of jobs) {
    switch (job.status) {
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
  return { processing, needsHelp, failed };
}

export function useShareJobs() {
  const { session, isDevSession, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;
  const enabled = isAsyncShareJobsEnabled() && !!userId && !isDevSession && !isDemoMode();

  const [jobs, setJobs] = useState<ShareJob[]>([]);
  const [recentAutoSaves, setRecentAutoSaves] = useState<RecentAutoSave[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [appState, setAppState] = useState<AppStateStatus>(AppState.currentState);
  const mountedRef = useRef(true);

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
      if (!enabled) {
        setJobs([]);
        setRecentAutoSaves([]);
        return;
      }
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const [data, recent] = await Promise.all([listShareJobs(), listRecentAutoSaves()]);
        if (!mountedRef.current) return;
        // Defensive dedupe + visibility filter by stable job id: the DB query
        // already excludes terminal jobs, but a realtime insert landing during
        // the initial fetch, a duplicate event, or a delayed event for a job
        // that has since resolved must never render a resolved/terminal card.
        setJobs(filterQueueVisible(dedupeJobsById(data)));
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
    [enabled],
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

  const sections = useMemo(() => sectionize(jobs), [jobs]);
  const hasActive = sections.processing.length > 0;

  // Poll while any job is still processing (realtime fallback).
  useEffect(() => {
    if (!isScreenActive || !hasActive) return;
    const id = setInterval(() => void load('background'), POLL_MS);
    return () => clearInterval(id);
  }, [isScreenActive, hasActive, load]);

  const refresh = useCallback(() => load('refresh'), [load]);

  return {
    jobs,
    recentAutoSaves,
    sections,
    loading,
    refreshing,
    error,
    refresh,
    needsHelpCount: sections.needsHelp.length,
    enabled,
    // True while the Supabase session is still being restored (cold start).
    // The queue screen shows a spinner instead of the "queue is off" state.
    authLoading,
  };
}

/**
 * Minimal needs_help badge count for the map/home entry point. Does a single
 * count query on focus and subscribes to realtime bumps. Does NOT badge
 * ordinary processing jobs.
 */
export function useNeedsHelpCount(): number {
  const { session, isDevSession } = useAuth();
  const userId = session?.user.id ?? null;
  const enabled = isAsyncShareJobsEnabled() && !!userId && !isDevSession && !isDemoMode();
  const [count, setCount] = useState(0);
  const activeUserRef = useRef(userId);
  activeUserRef.current = userId;

  const load = useCallback(async () => {
    const requestedUserId = userId;
    if (!enabled || !requestedUserId) {
      setCount(0);
      return;
    }
    try {
      const { count: c } = await supabase
        .from('share_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', requestedUserId)
        .in('status', ['needs_help', 'failed']);
      if (activeUserRef.current !== requestedUserId) return;
      setCount(c ?? 0);
    } catch (error) {
      recordBreadcrumb('queue_realtime_event', {
        result: 'badge_count_failed',
        errorName: error instanceof Error ? error.name : 'Error',
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled) setCount(0);
    else void load();
  }, [enabled, userId, load]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') void load();
    });
    return () => subscription.remove();
  }, [load]);

  useEffect(() => {
    if (!enabled || !userId) return;
    return createShareJobsRealtimeSubscription({
      client: supabase,
      scope: 'share_jobs_badge',
      userId,
      onInvalidate: () => void load(),
      onStatus: (status) => {
        recordBreadcrumb('queue_realtime_event', { result: `badge_${status.toLowerCase()}` });
      },
      onError: (error) => {
        recordBreadcrumb('queue_realtime_event', {
          result: 'badge_subscription_failed',
          errorName: error instanceof Error ? error.name : 'Error',
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      },
    });
  }, [enabled, userId, load]);

  return enabled ? count : 0;
}
