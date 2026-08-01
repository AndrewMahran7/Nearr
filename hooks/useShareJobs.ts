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
import { isAsyncShareJobsEnabled } from '@/lib/featureFlags';
import { isDemoMode } from '@/lib/demoMode';
import { listShareJobs, type ShareJob } from '@/services/shareJobsService';

const ACTIVE_STATUSES: ShareJob['status'][] = ['queued', 'processing_metadata'];
const POLL_MS = 6_000;

export type ShareJobSections = {
  processing: ShareJob[];
  needsHelp: ShareJob[];
  recentlyFound: ShareJob[];
  failed: ShareJob[];
};

function sectionize(jobs: ShareJob[]): ShareJobSections {
  const processing: ShareJob[] = [];
  const needsHelp: ShareJob[] = [];
  const recentlyFound: ShareJob[] = [];
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
      case 'completed':
        recentlyFound.push(job);
        break;
      case 'failed':
        failed.push(job);
        break;
      default:
        break;
    }
  }
  return { processing, needsHelp, recentlyFound: recentlyFound.slice(0, 20), failed };
}

export function useShareJobs() {
  const { session, isDevSession, loading: authLoading } = useAuth();
  const userId = session?.user.id ?? null;
  const enabled = isAsyncShareJobsEnabled() && !!userId && !isDevSession && !isDemoMode();

  const [jobs, setJobs] = useState<ShareJob[]>([]);
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
        return;
      }
      if (mode === 'initial') setLoading(true);
      if (mode === 'refresh') setRefreshing(true);
      try {
        const data = await listShareJobs();
        if (!mountedRef.current) return;
        setJobs(data);
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
    const channel = supabase
      .channel(`share_jobs:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'share_jobs', filter: `user_id=eq.${userId}` },
        () => {
          void load('background');
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
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

  const load = useCallback(async () => {
    if (!enabled) {
      setCount(0);
      return;
    }
    try {
      const { count: c } = await supabase
        .from('share_jobs')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'needs_help');
      setCount(c ?? 0);
    } catch {
      // leave prior count
    }
  }, [enabled]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  useEffect(() => {
    if (!enabled || !userId) return;
    const channel = supabase
      .channel(`share_jobs_badge:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'share_jobs', filter: `user_id=eq.${userId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [enabled, userId, load]);

  return enabled ? count : 0;
}
