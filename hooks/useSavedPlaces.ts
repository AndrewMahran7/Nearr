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
import type { SavedPlaceWithPlace } from '@/types';

type State = {
  data: SavedPlaceWithPlace[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
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
  });

  const fetch = useCallback(async (mode: 'initial' | 'refresh') => {
    setState((s) => ({
      ...s,
      loading: mode === 'initial' ? true : s.loading,
      refreshing: mode === 'refresh',
      error: null,
    }));
    console.log('[useSavedPlaces] querying, userId present=', !!userId);
    try {
      const data = await listSavedPlaces();
      console.log('[useSavedPlaces] query complete, count=', data.length);
      setState({ data, loading: false, refreshing: false, error: null });
    } catch (e: any) {
      console.warn('[useSavedPlaces] error', e?.message);
      setState((s) => ({
        ...s,
        loading: false,
        refreshing: false,
        error: e?.message ?? 'Could not load saved places.',
      }));
    }
  }, [userId]);

  useEffect(() => {
    // Wait until auth has finished initialising before touching Supabase.
    // Without this guard the query fires before the session is restored from
    // AsyncStorage (or before exchangeCodeForSession completes on a cold-start
    // magic-link), RLS returns [] silently, and the hook never re-fetches.
    if (authLoading) {
      console.log('[useSavedPlaces] auth loading, deferring query');
      return;
    }
    if (!userId) {
      // Signed out — clear the list immediately without a network call.
      console.log('[useSavedPlaces] no user, clearing list');
      setState({ data: [], loading: false, refreshing: false, error: null });
      return;
    }
    void fetch('initial');
  }, [authLoading, userId, fetch]);

  const refresh = useCallback(() => fetch('refresh'), [fetch]);

  return { ...state, refresh };
}
