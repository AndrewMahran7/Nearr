/**
 * useSavedPlaces — list + refresh state for the current user's saved places.
 *
 * Wraps `listSavedPlaces()` so the Home/Places screens don't have to manage
 * loading/error/refresh boilerplate. Auth-aware: defers fetching until the
 * Supabase session is ready so that a cold-start magic-link sign-in does not
 * race the query and return an empty RLS-filtered result. Re-fetches
 * automatically whenever the signed-in user changes (covers sign-in after a
 * magic link and sign-out → sign-in flows). Also re-fetches whenever
 * `refresh()` is called (pull-to-refresh, after save/delete, focus).
 */

import { useCallback, useEffect, useState } from 'react';
import { listSavedPlaces } from '@/services/savedPlacesService';
import { useAuth } from '@/hooks/useAuth';
import { logDebug } from '@/lib/logger';
import {
  isLikelyOfflineError,
  readSavedPlacesCache,
  writeSavedPlacesCache,
} from '@/lib/savedPlacesCache';
import type { SavedPlaceWithPlace } from '@/types';

type State = {
  data: SavedPlaceWithPlace[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  /**
   * True when the visible list is being served from the local cache
   * because the network fetch failed (offline or transient error).
   * Cleared on the next successful fetch.
   */
  offline: boolean;
  /** ISO timestamp of the cache write that produced `data`. Null when fresh. */
  lastSyncedAt: string | null;
};

export function useSavedPlaces() {
  // Auth state — we need to know when loading finishes and who the user is
  // so we don't fire the query before the session is established (which would
  // return an empty RLS-filtered result and never re-fetch after sign-in).
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  const [state, setState] = useState<State>({
    data: [],
    loading: true,
    refreshing: false,
    error: null,
    offline: false,
    lastSyncedAt: null,
  });

  const fetch = useCallback(async (mode: 'initial' | 'refresh') => {
    setState((s) => ({
      ...s,
      loading: mode === 'initial' ? true : s.loading,
      refreshing: mode === 'refresh',
      error: null,
    }));
    logDebug('useSavedPlaces', 'querying', { hasUserId: !!userId, mode });
    try {
      const data = await listSavedPlaces();
      logDebug('useSavedPlaces', 'query complete', { count: data.length, mode });
      setState({
        data,
        loading: false,
        refreshing: false,
        error: null,
        offline: false,
        lastSyncedAt: null,
      });
      // Best-effort: persist the freshest copy for the next cold start.
      void writeSavedPlacesCache(userId, data);
    } catch (e: any) {
      console.warn('[useSavedPlaces] error', e?.message);
      // Offline / transient-network fallback: serve the last good cache so
      // the user can still see their saved places. We only swap to cached
      // data on the FIRST failure (initial load) — pull-to-refresh keeps
      // showing the current data but surfaces the offline banner.
      const offlineLikely = isLikelyOfflineError(e);
      const cached = offlineLikely ? await readSavedPlacesCache(userId) : null;
      if (cached) {
        console.log('[offline] using_cached_saved_places');
        setState((s) => ({
          ...s,
          // Preserve current data on refresh; replace empty initial state.
          data: s.data.length > 0 ? s.data : cached.data,
          loading: false,
          refreshing: false,
          // Clear the raw error string — the offline banner is the UX.
          error: null,
          offline: true,
          lastSyncedAt: cached.lastSyncedAt,
        }));
        return;
      }
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: e?.message ?? 'Could not load saved places.',
        offline: offlineLikely,
      }));
    }
  }, [userId]);

  useEffect(() => {
    // Wait until auth has finished initialising before touching Supabase.
    // Without this guard the query fires before the session is restored from
    // AsyncStorage (or before exchangeCodeForSession completes on a cold-start
    // magic-link), RLS returns [] silently, and the hook never re-fetches.
    if (authLoading) {
      logDebug('useSavedPlaces', 'auth loading, deferring query');
      return;
    }
    if (!userId) {
      // Signed out — clear the list immediately without a network call.
      logDebug('useSavedPlaces', 'no user, clearing list');
      setState({
        data: [],
        loading: false,
        refreshing: false,
        error: null,
        offline: false,
        lastSyncedAt: null,
      });
      return;
    }
    void fetch('initial');
  }, [authLoading, userId, fetch]);

  const refresh = useCallback(() => fetch('refresh'), [fetch]);

  return { ...state, refresh };
}
