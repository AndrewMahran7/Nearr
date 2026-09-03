import { useCallback, useEffect, useState } from 'react';

import {
  fetchPlaceFindSnapshot,
  isMonetizationEnabled,
  type PlaceFindSnapshot,
} from '@/lib/monetizationClient';

export function usePlaceFindBalance() {
  const enabled = isMonetizationEnabled();
  const [snapshot, setSnapshot] = useState<PlaceFindSnapshot | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      setSnapshot(await fetchPlaceFindSnapshot());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'balance_unavailable');
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { enabled, snapshot, loading, error, refresh, setSnapshot };
}

