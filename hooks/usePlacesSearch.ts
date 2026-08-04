import { useCallback, useEffect, useRef, useState } from 'react';
import {
  searchPlaces,
  PlaceCandidate,
  PlacesError,
  type LocationBias,
} from '@/services/placesService';

type State = {
  results: PlaceCandidate[];
  loading: boolean;
  error: PlacesError | null;
  /** Last query that actually hit the API (after trimming). */
  lastQuery: string | null;
};

/**
 * UI-friendly wrapper around `searchPlaces`. Tracks loading + error state and
 * ignores stale responses (out-of-order requests) using a request id.
 */
export function usePlacesSearch() {
  const [state, setState] = useState<State>({
    results: [],
    loading: false,
    error: null,
    lastQuery: null,
  });
  const reqId = useRef(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqId.current += 1;
    };
  }, []);

  const run = useCallback(async (query: string, locationBias?: LocationBias) => {
    const id = ++reqId.current;
    const q = query.trim();
    if (!q) {
      if (mountedRef.current) {
        setState({ results: [], loading: false, error: null, lastQuery: null });
      }
      return [];
    }
    if (mountedRef.current) {
      setState((s) => ({ ...s, loading: true, error: null, lastQuery: q }));
    }
    try {
      const results = await searchPlaces(q, locationBias);
      if (!mountedRef.current || id !== reqId.current) return results; // stale
      setState({ results, loading: false, error: null, lastQuery: q });
      return results;
    } catch (err) {
      if (!mountedRef.current || id !== reqId.current) return [];
      const e = err instanceof PlacesError ? err : new PlacesError('UNKNOWN', String(err));
      console.warn('[usePlacesSearch] error', e.code, e.message);
      setState({ results: [], loading: false, error: e, lastQuery: q });
      return [];
    }
  }, []);

  const reset = useCallback(() => {
    reqId.current++;
    if (mountedRef.current) {
      setState({ results: [], loading: false, error: null, lastQuery: null });
    }
  }, []);

  return { ...state, search: run, reset };
}
