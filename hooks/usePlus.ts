import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './useAuth';
import { fetchPlusStatus, loadPlusOffer, type PlusOffer, type PlusStatus } from '../lib/plusClient';
import { hasVerifiedPlusAccess } from '../lib/plusEntitlements';
import { isFreeOnlyPlusStatus } from '../lib/plusReleasePolicy';

/** No persisted paid boolean or offline authorization. Offline maps and saves
 * remain available; only new online recognition work is gated. */
export function usePlus() {
  const { user } = useAuth(); const userId = user && !user.is_anonymous ? user.id : null;
  const generation = useRef(0); const [status, setStatus] = useState<PlusStatus | null>(null);
  const [offer, setOffer] = useState<PlusOffer | null>(null); const [loading, setLoading] = useState(false);
  const refresh = useCallback(async () => {
    const attempt = ++generation.current; setOffer(null);
    if (!userId) { setStatus(null); setLoading(false); return; }
    setLoading(true);
    try {
      const next = await fetchPlusStatus(userId); const product = await loadPlusOffer(userId, next).catch(() => null);
      if (generation.current === attempt) { setStatus(next); setOffer(product); }
    } catch { if (generation.current === attempt) { setStatus(null); setOffer(null); } }
    finally { if (generation.current === attempt) setLoading(false); }
  }, [userId]);
  useEffect(() => {
    setStatus(null); void refresh();
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    return () => { generation.current++; subscription.remove(); };
  }, [refresh]);
  const freeOnly = isFreeOnlyPlusStatus(status);
  const paidMode = status?.releaseMode !== 'free_only';
  return { userId, status, offer, loading, refresh, freeOnly,
    canOffer: paidMode && !!offer && status?.salesEnabled === true,
    hasPlus: paidMode && hasVerifiedPlusAccess(status?.entitlement ?? null),
    canManage: paidMode && status?.restoreAvailable === true };
}
