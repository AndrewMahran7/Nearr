/**
 * useSavedPlaces — list + refresh state for the current user's saved places.
 *
 * Wraps `listSavedPlaces()` so the Home/Places screens don't have to manage
 * loading/error/refresh boilerplate. Auto-fetches on mount and re-fetches
 * whenever `refresh()` is called (e.g. pull-to-refresh, after a delete, or
 * when the screen regains focus).
 */

import { useCallback, useEffect, useState } from 'react';
import { listSavedPlaces } from '@/services/savedPlacesService';
import type { SavedPlaceWithPlace } from '@/types';

type State = {
  data: SavedPlaceWithPlace[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
};

export function useSavedPlaces() {
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
    try {
      const data = await listSavedPlaces();
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
  }, []);

  useEffect(() => {
    void fetch('initial');
  }, [fetch]);

  const refresh = useCallback(() => fetch('refresh'), [fetch]);

  return { ...state, refresh };
}
