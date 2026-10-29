import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './useAuth';
import { fetchPlusStatus, loadPaidCatalog, pendingPurchase, type PlusOffer, type PlusStatus, type TokenOffer } from '../lib/plusClient';
import { paidUsage } from '../lib/paidClientModel';
import { hasVerifiedPlusAccess, PLUS_VERIFICATION_MAX_AGE_MS } from '../lib/plusEntitlements';
import { isFreeOnlyPlusStatus } from '../lib/plusReleasePolicy';

/** No persisted paid boolean or offline authorization. Offline maps and saves
 * remain available; only new online recognition work is gated. */
export function usePlus() {
  const { user } = useAuth(); const userId = user && !user.is_anonymous ? user.id : null;
  const generation = useRef(0); const [status, setStatus] = useState<PlusStatus | null>(null);
  const [statusOwner,setStatusOwner] = useState<string|null>(null);
  const [offer, setOffer] = useState<PlusOffer | null>(null); const [loading, setLoading] = useState(false);
  const [tokenOffers,setTokenOffers] = useState<TokenOffer[]>([]); const [purchasePending,setPurchasePending] = useState(false);
  const refresh = useCallback(async () => {
    const attempt = ++generation.current; setOffer(null); setTokenOffers([]);
    if (!userId) { setStatus(null); setLoading(false); setPurchasePending(false); return; }
    setLoading(true);
    try {
      const pending = await pendingPurchase(userId).then(Boolean).catch(() => true);
      if (generation.current === attempt) setPurchasePending(pending);
      const next = await fetchPlusStatus(userId); const catalog = await loadPaidCatalog(userId, next).catch(() => ({subscription:null,tokens:[]}));
      if (generation.current === attempt) { setStatusOwner(userId); setStatus(next); setOffer(catalog.subscription); setTokenOffers(catalog.tokens); }
    } catch { if (generation.current === attempt) { setStatus(null); setOffer(null); } }
    finally { if (generation.current === attempt) setLoading(false); }
  }, [userId]);
  useEffect(() => {
    setStatus(null); setPurchasePending(false); void refresh();
    const subscription = AppState.addEventListener('change', next => { if (next === 'active') void refresh(); });
    return () => { generation.current++; subscription.remove(); };
  }, [refresh]);
  const safeStatus = statusOwner === userId ? status : null;
  // Expiring verification also expires the presentation while the screen stays open.
  useEffect(() => {
    if (!safeStatus?.entitlement || !hasVerifiedPlusAccess(safeStatus.entitlement)) return;
    const at = Math.min(Date.parse(safeStatus.entitlement.accessUntil!),Date.parse(safeStatus.entitlement.verifiedAt)+PLUS_VERIFICATION_MAX_AGE_MS);
    const timer = setTimeout(() => void refresh(),Math.max(1,at-Date.now()+1));
    return () => clearTimeout(timer);
  },[safeStatus,refresh]);
  const freeOnly = isFreeOnlyPlusStatus(safeStatus);
  const paidMode = safeStatus?.releaseMode !== 'free_only';
  const usage = paidUsage(safeStatus?.usage);
  return { userId, status:safeStatus, offer:safeStatus ? offer : null, tokenOffers:safeStatus ? tokenOffers : [], purchasePending, usage, loading, refresh, freeOnly,
    canOffer: paidMode && !!safeStatus && !!offer && safeStatus.salesEnabled === true && !purchasePending,
    hasPlus: paidMode && usage?.unlimited === true && hasVerifiedPlusAccess(safeStatus?.entitlement ?? null),
    canManage: paidMode && safeStatus?.restoreAvailable === true };
}
