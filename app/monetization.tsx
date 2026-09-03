import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { placeFindBalanceLabel } from '@/lib/placeFindConfig';
import { purchaseDevMockPack, resumePendingPlaceFindJob } from '@/lib/monetizationClient';
import { trackEvent } from '@/lib/analytics';
import { usePlaceFindBalance } from '@/hooks/usePlaceFindBalance';

const CREAM = '#F4F2EF';
const CHARCOAL = '#0F1014';
const ORANGE = '#FF6A1A';

type PurchaseState =
  | { kind: 'idle' }
  | { kind: 'purchasing'; productId: string }
  | { kind: 'success'; grantedUses: number; available: number; resumed: boolean }
  | { kind: 'error'; message: string };

function friendlyPurchaseError(message: string): string {
  if (message.includes('dev_test_user_required') || message.includes('dev_mock_not_authorized')) {
    return 'This Nearr-Dev account is not on the mock-purchase allowlist yet.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'You appear to be offline. Your balance was not changed.';
  }
  return 'The purchase could not be completed. Your balance was not changed.';
}

export default function MonetizationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ jobId?: string; entry?: string }>();
  const jobId = typeof params.jobId === 'string' ? params.jobId : null;
  const entry = typeof params.entry === 'string' ? params.entry : 'unknown';
  const { snapshot, loading, error, refresh, setSnapshot } = usePlaceFindBalance();
  const [purchase, setPurchase] = useState<PurchaseState>({ kind: 'idle' });
  const trackedRef = useRef(false);

  useEffect(() => {
    if (trackedRef.current) return;
    trackedRef.current = true;
    void trackEvent('paywall_shown', { entry_point: entry, pending_share: !!jobId });
  }, [entry, jobId]);

  useEffect(() => {
    if (!snapshot) return;
    for (const pack of snapshot.products) {
      void trackEvent('pack_viewed', {
        entry_point: entry,
        uses: pack.uses,
        price_source: pack.priceSource,
      });
    }
  }, [entry, snapshot]);

  const unavailableCopy = useMemo(() => {
    if (!snapshot) return null;
    if (snapshot.mode === 'storekit_unavailable') {
      return 'StoreKit is not included in this binary. A new Nearr-Dev build is required for Apple sandbox purchases.';
    }
    if (!snapshot.mockPurchaseAuthorized) {
      return 'Pricing preview is available. Mock checkout is locked to server-approved Nearr-Dev test accounts.';
    }
    return null;
  }, [snapshot]);

  async function buy(productId: string, uses: number) {
    if (purchase.kind === 'purchasing') return;
    setPurchase({ kind: 'purchasing', productId });
    void trackEvent('purchase_started', { uses, mode: 'dev_mock', pending_share: !!jobId });
    try {
      const result = await purchaseDevMockPack({ productId, jobId });
      setSnapshot((current) =>
        current
          ? { ...current, available: result.available, reserved: jobId && result.resumed ? current.reserved + 1 : current.reserved }
          : current,
      );
      setPurchase({
        kind: 'success',
        grantedUses: result.grantedUses,
        available: result.available,
        resumed: result.resumed,
      });
      void trackEvent('purchase_succeeded', {
        uses: result.grantedUses,
        mode: 'dev_mock',
        replayed: result.replayed,
        pending_share_resumed: result.resumed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'purchase_failed';
      setPurchase({ kind: 'error', message: friendlyPurchaseError(message) });
      void trackEvent('purchase_failed', { mode: 'dev_mock', reason: message.slice(0, 60) });
    }
  }

  async function continuePendingPost() {
    if (!jobId || purchase.kind === 'purchasing') return;
    setPurchase({ kind: 'purchasing', productId: '__resume__' });
    try {
      const result = await resumePendingPlaceFindJob(jobId);
      if (!result.resumed) throw new Error('resume_failed');
      setPurchase({ kind: 'success', grantedUses: 0, available: result.available, resumed: true });
    } catch (err) {
      setPurchase({ kind: 'error', message: friendlyPurchaseError(err instanceof Error ? err.message : 'resume_failed') });
    }
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/map');
  }

  if (purchase.kind === 'success') {
    return (
      <View style={[styles.screen, { paddingTop: Math.max(insets.top, 18), paddingBottom: Math.max(insets.bottom, 18) }]}>
        <View style={styles.successWrap} accessibilityLiveRegion="polite">
          <View style={styles.successIcon}><Feather name="check" size={30} color={CREAM} /></View>
          <Text style={styles.eyebrow}>NEARR</Text>
          <Text style={styles.title}>You&apos;re ready to keep finding</Text>
          <Text style={styles.body}>
            {purchase.resumed
              ? `Your shared post is back in the queue. ${placeFindBalanceLabel(purchase.available)}.`
              : `${purchase.grantedUses} place finds were added. ${placeFindBalanceLabel(purchase.available)}.`}
          </Text>
          <Pressable
            style={styles.primary}
            onPress={() => router.replace(purchase.resumed ? '/share-jobs' : '/(tabs)/map')}
            accessibilityRole="button"
            accessibilityLabel={purchase.resumed ? 'View resumed share queue' : 'Done'}
          >
            <Text style={styles.primaryText}>{purchase.resumed ? 'View queue' : 'Done'}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 12) }]}>
      <Pressable
        onPress={close}
        style={styles.close}
        accessibilityRole="button"
        accessibilityLabel="Close place find packs"
      >
        <Feather name="x" size={24} color={CHARCOAL} />
      </Pressable>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>NEARR PLACE FINDS</Text>
        <Text style={styles.title}>{jobId ? "You're out of place finds" : 'Keep finding places you love'}</Text>
        <Text style={styles.body}>
          {jobId
            ? 'Your shared post is safe. Choose a pack and Nearr will continue automatically.'
            : 'One find covers one shared video, even when Nearr discovers several destinations.'}
        </Text>

        <View style={styles.balance} accessibilityLiveRegion="polite">
          {loading ? (
            <ActivityIndicator color={ORANGE} />
          ) : (
            <Text style={styles.balanceText}>
              {snapshot ? placeFindBalanceLabel(snapshot.available) : 'Balance unavailable'}
            </Text>
          )}
        </View>

        {error ? (
          <View style={styles.message} accessibilityRole="alert">
            <Text style={styles.messageText}>Couldn&apos;t load packs. Check your connection and try again.</Text>
            <Pressable style={styles.textButton} onPress={() => void refresh()} accessibilityRole="button">
              <Text style={styles.textButtonLabel}>Try again</Text>
            </Pressable>
          </View>
        ) : null}

        {snapshot?.mode === 'dev_mock' ? (
          <View style={styles.mockBadge} accessible accessibilityLabel="Nearr Dev mock pricing">
            <Text style={styles.mockBadgeText}>NEARR-DEV MOCK PRICING</Text>
          </View>
        ) : null}

        {jobId && (snapshot?.available ?? 0) > 0 ? (
          <Pressable
            style={styles.primary}
            onPress={() => void continuePendingPost()}
            disabled={purchase.kind === 'purchasing'}
            accessibilityRole="button"
            accessibilityLabel="Use one place find and continue this post"
          >
            {purchase.kind === 'purchasing' && purchase.productId === '__resume__'
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.primaryText}>Continue this post</Text>}
          </Pressable>
        ) : null}

        <View style={styles.packList}>
          {snapshot?.products.map((pack) => {
            const busy = purchase.kind === 'purchasing' && purchase.productId === pack.productId;
            const disabled = purchase.kind === 'purchasing' || !snapshot.mockPurchaseAuthorized;
            return (
              <Pressable
                key={pack.productId}
                onPress={() => void buy(pack.productId, pack.uses)}
                disabled={disabled}
                accessibilityRole="button"
                accessibilityLabel={`${pack.uses} place finds, ${pack.displayPrice}${pack.priceSource === 'dev_mock_config' ? ', mock price' : ''}`}
                accessibilityState={{ disabled, busy }}
                style={({ pressed }) => [styles.pack, disabled && styles.disabled, pressed && !disabled && styles.pressed]}
              >
                <View>
                  <Text style={styles.packUses}>{pack.uses} place finds</Text>
                  <Text style={styles.packNote}>One shared video = one find</Text>
                </View>
                {busy ? <ActivityIndicator color={ORANGE} /> : <Text style={styles.packPrice}>{pack.displayPrice}</Text>}
              </Pressable>
            );
          })}
        </View>

        {unavailableCopy ? <Text style={styles.unavailable}>{unavailableCopy}</Text> : null}
        {purchase.kind === 'error' ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{purchase.message}</Text>
          </View>
        ) : null}

        <Pressable
          style={styles.sync}
          onPress={() => void refresh()}
          disabled={loading || purchase.kind === 'purchasing'}
          accessibilityRole="button"
          accessibilityLabel="Sync purchase status and balance"
        >
          <Text style={styles.syncText}>Sync purchase status</Text>
        </Pressable>
        <Text style={styles.finePrint}>
          Consumable packs do not restore after they are used. Sync checks the server ledger and any unfinished verified purchases; it never grants from this device alone.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CREAM },
  close: { position: 'absolute', right: 14, top: 14, zIndex: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 24, paddingTop: 68, alignItems: 'stretch' },
  eyebrow: { color: ORANGE, fontSize: 12, lineHeight: 16, fontWeight: '800', letterSpacing: 1.7, textAlign: 'center' },
  title: { marginTop: 10, color: CHARCOAL, fontSize: 32, lineHeight: 38, fontWeight: '800', textAlign: 'center' },
  body: { marginTop: 12, color: '#4F5055', fontSize: 16, lineHeight: 23, textAlign: 'center' },
  balance: { minHeight: 48, marginTop: 24, alignItems: 'center', justifyContent: 'center' },
  balanceText: { color: CHARCOAL, fontSize: 15, fontWeight: '700' },
  mockBadge: { alignSelf: 'center', borderRadius: 999, backgroundColor: '#FFE1D0', paddingHorizontal: 12, paddingVertical: 6 },
  mockBadgeText: { color: '#A83E08', fontSize: 11, fontWeight: '800', letterSpacing: 0.7 },
  packList: { marginTop: 14, gap: 12 },
  pack: { minHeight: 76, borderRadius: 18, borderWidth: 1, borderColor: '#D4D0CA', backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingVertical: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  pressed: { transform: [{ scale: 0.99 }], borderColor: ORANGE },
  disabled: { opacity: 0.52 },
  packUses: { color: CHARCOAL, fontSize: 17, fontWeight: '800' },
  packNote: { color: '#6A6B70', fontSize: 12, marginTop: 4 },
  packPrice: { color: ORANGE, fontSize: 18, fontWeight: '800' },
  unavailable: { marginTop: 16, color: '#65666B', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  message: { marginTop: 16, alignItems: 'center' },
  messageText: { color: CHARCOAL, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  textButtonLabel: { color: ORANGE, fontWeight: '800' },
  errorBox: { marginTop: 16, backgroundColor: '#FDE5E3', borderRadius: 12, padding: 14 },
  errorText: { color: '#8F211B', textAlign: 'center', lineHeight: 19 },
  sync: { minHeight: 44, marginTop: 20, alignItems: 'center', justifyContent: 'center' },
  syncText: { color: CHARCOAL, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  finePrint: { color: '#76777C', fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 8 },
  successWrap: { flex: 1, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  successIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  primary: { minHeight: 56, marginTop: 28, alignSelf: 'stretch', borderRadius: 16, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
