/**
 * useSavedPlaces — list + refresh state for the current user's saved places.
 *
 * Wraps `listSavedPlaces()` so the Home/Places/Map screens don't have to
 * manage loading/error/refresh boilerplate. Auth-aware: defers fetching until
 * the Supabase session is ready so that a cold-start magic-link sign-in does
 * not race the query and return an empty RLS-filtered result.
 *
 * Caching (map-first: instant tab switches):
 *   - A module-level in-memory cache holds the last good list per user, so a
 *     screen mounting on tab switch hydrates INSTANTLY (no spinner, no map
 *     reset) instead of refetching from scratch.
 *   - In-flight requests are deduped, so two screens mounting at once share a
 *     single Supabase round-trip.
 *   - Stale-while-revalidate: `revalidate()` (used by focus effects) only hits
 *     the network when the cached copy is older than STALE_MS, and never shows
 *     a loading/refreshing state. `refresh()` (pull-to-refresh, post-mutation)
 *     always forces a fetch.
 *   - AsyncStorage offline cache behavior is preserved as the on-error fallback.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
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

type FetchMode = 'initial' | 'refresh' | 'background';

// How long an in-memory copy is considered fresh enough that a focus-triggered
// revalidate skips the network entirely.
const STALE_MS = 30_000;

// ---- module-level shared cache + in-flight dedupe -------------------------
type MemoryEntry = {
  userId: string;
  data: SavedPlaceWithPlace[];
  fetchedAt: number;
};

let memoryCache: MemoryEntry | null = null;
let inflight: { userId: string; promise: Promise<SavedPlaceWithPlace[]> } | null = null;

function getMemory(userId: string | null): MemoryEntry | null {
  if (!userId) return null;
  if (memoryCache && memoryCache.userId === userId) return memoryCache;
  return null;
}

function runListSavedPlaces(userId: string): Promise<SavedPlaceWithPlace[]> {
  // Coalesce concurrent callers (e.g. two screens mounting at once) onto one
  // Supabase round-trip.
  if (inflight && inflight.userId === userId) return inflight.promise;
  const promise = listSavedPlaces();
  inflight = { userId, promise };
  void promise
    .catch(() => undefined)
    .finally(() => {
      if (inflight?.promise === promise) inflight = null;
    });
  return promise;
}

export function useSavedPlaces() {
  // Auth state — we need to know when loading finishes and who the user is
  // so we don't fire the query before the session is established (which would
  // return an empty RLS-filtered result and never re-fetch after sign-in).
  const { session, loading: authLoading } = useAuth();
  const userId = session?.user?.id ?? null;

  // Hydrate synchronously from the in-memory cache so a tab switch shows data
  // on the first frame with no loading flash.
  const [state, setState] = useState<State>(() => {
    const mem = getMemory(userId);
    return {
      data: mem?.data ?? [],
      loading: !mem,
      refreshing: false,
      error: null,
      offline: false,
      lastSyncedAt: null,
    };
  });

  // Avoid setState after unmount.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetch = useCallback(
    async (mode: FetchMode) => {
      if (!userId) return;
      setState((s) => ({
        ...s,
        loading: mode === 'initial' ? s.data.length === 0 : s.loading,
        refreshing: mode === 'refresh',
        error: null,
      }));
      logDebug('useSavedPlaces', 'querying', { hasUserId: !!userId, mode });
      try {
        const data = await runListSavedPlaces(userId);
        logDebug('useSavedPlaces', 'query complete', { count: data.length, mode });
        memoryCache = { userId, data, fetchedAt: Date.now() };
        if (mountedRef.current) {
          setState({
            data,
            loading: false,
            refreshing: false,
            error: null,
            offline: false,
            lastSyncedAt: null,
          });
        }
        // Best-effort: persist the freshest copy for the next cold start.
        void writeSavedPlacesCache(userId, data);
      } catch (e: any) {
        console.warn('[useSavedPlaces] error', e?.message);
        const offlineLikely = isLikelyOfflineError(e);
        // Background revalidation must never disrupt the visible list: keep
        // showing the cached/in-memory data, just flag offline quietly.
        if (mode === 'background') {
          if (mountedRef.current) {
            setState((s) => ({ ...s, offline: offlineLikely ? true : s.offline }));
          }
          return;
        }
        // Offline / transient-network fallback: serve the last good cache so
        // the user can still see their saved places. We only swap to cached
        // data on the FIRST failure (initial load) — pull-to-refresh keeps
        // showing the current data but surfaces the offline banner.
        const cached = offlineLikely ? await readSavedPlacesCache(userId) : null;
        if (cached) {
          console.log('[offline] using_cached_saved_places');
          if (mountedRef.current) {
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
          }
          return;
        }
        if (mountedRef.current) {
          setState((s) => ({
            ...s,
            loading: false,
            refreshing: false,
            error: e?.message ?? 'Could not load saved places.',
            offline: offlineLikely,
          }));
        }
      }
    },
    [userId],
  );

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
      // Signed out — clear the list and shared cache without a network call.
      logDebug('useSavedPlaces', 'no user, clearing list');
      memoryCache = null;
      inflight = null;
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

    const mem = getMemory(userId);
    if (mem) {
      // Instant hydrate from memory; quietly revalidate only if stale.
      setState((s) => ({ ...s, data: mem.data, loading: false }));
      if (Date.now() - mem.fetchedAt > STALE_MS) {
        void fetch('background');
      }
      return;
    }
    void fetch('initial');
  }, [authLoading, userId, fetch]);

  // Force a network refetch (pull-to-refresh, after a save/delete).
  const refresh = useCallback(() => fetch('refresh'), [fetch]);

  // Stale-while-revalidate: used by screen focus effects. Skips the network
  // when the in-memory copy is still fresh, so tab switches feel instant and
  // never trigger a visible reload.
  const revalidate = useCallback(() => {
    const mem = getMemory(userId);
    if (mem && Date.now() - mem.fetchedAt <= STALE_MS) {
      setState((s) =>
        s.data === mem.data ? s : { ...s, data: mem.data, loading: false },
      );
      return Promise.resolve();
    }
    return fetch('background');
  }, [userId, fetch]);

  return { ...state, refresh, revalidate };
}
