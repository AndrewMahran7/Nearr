import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TokenSymbol } from '@/components/TokenSymbol';
import { usePlaceFindBalance } from '@/hooks/usePlaceFindBalance';
import { trackEvent } from '@/lib/analytics';
import { placeFindBalanceLabel, tokenPackPresentation } from '@/lib/placeFindConfig';
import {
  purchaseDevMockPack,
  resumePendingPlaceFindJob,
  type PlaceFindProduct,
} from '@/lib/monetizationClient';
import {
  clearPendingPremiumRequestJobId,
  getPendingPremiumRequestJobId,
} from '@/lib/pendingPremiumRequest';
import { premiumRequestsEnabled } from '@/lib/premiumRequests';

const CREAM = '#F4F2EF';
const CHARCOAL = '#0F1014';
const RAISED = '#18191F';
const MUTED = '#A9A7A3';
const ORANGE = '#FF6A1A';

type PurchaseState =
  | { kind: 'idle' }
  | { kind: 'purchasing'; productId: string }
  | { kind: 'success'; grantedUses: number; available: number; resumed: boolean }
  | { kind: 'error'; message: string };

function friendlyPurchaseError(message: string): string {
  if (message.includes('dev_test_user_required') || message.includes('dev_mock_not_authorized')) {
    return 'This Nearr-Dev account is not enabled for preview checkout yet.';
  }
  if (message.includes('network') || message.includes('fetch')) {
    return 'You appear to be offline. Your balance was not changed.';
  }
  return 'The purchase could not be completed. Your balance was not changed.';
}

function recommendedProduct(products: PlaceFindProduct[]): PlaceFindProduct | null {
  return products.find((product) => tokenPackPresentation(product.uses).recommended)
    ?? products[0]
    ?? null;
}

export default function MonetizationScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ jobId?: string; premiumJobId?: string; entry?: string }>();
  const jobId = typeof params.jobId === 'string' ? params.jobId : null;
  const routePremiumJobId = typeof params.premiumJobId === 'string' ? params.premiumJobId : null;
  const entry = typeof params.entry === 'string' ? params.entry : 'unknown';
  const premiumRequestsAvailable = premiumRequestsEnabled();
  const { snapshot, loading, error, refresh, setSnapshot } = usePlaceFindBalance();
  const [purchase, setPurchase] = useState<PurchaseState>({ kind: 'idle' });
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [supportExpanded, setSupportExpanded] = useState(false);
  const [pendingPremiumRequestJobId, setPendingPremiumRequestJobId] = useState<string | null>(routePremiumJobId);
  const trackedRef = useRef(false);

  useEffect(() => {
    if (!premiumRequestsAvailable) return;
    if (routePremiumJobId) {
      setPendingPremiumRequestJobId(routePremiumJobId);
      return;
    }
    void getPendingPremiumRequestJobId().then(setPendingPremiumRequestJobId);
  }, [premiumRequestsAvailable, routePremiumJobId]);

  useEffect(() => {
    if (!premiumRequestsAvailable) return;
    if (trackedRef.current) return;
    trackedRef.current = true;
    void trackEvent('paywall_shown', { entry_point: entry, pending_premium_request: !!pendingPremiumRequestJobId });
    if (pendingPremiumRequestJobId) {
      void trackEvent('token_store_opened_from_premium_request', { job_id: pendingPremiumRequestJobId });
    }
  }, [entry, pendingPremiumRequestJobId, premiumRequestsAvailable]);

  useEffect(() => {
    if (!premiumRequestsAvailable) return;
    if (!snapshot) return;
    for (const pack of snapshot.products) {
      void trackEvent('pack_viewed', {
        entry_point: entry,
        uses: pack.uses,
        price_source: pack.priceSource,
      });
    }
    setSelectedProductId((current) => (
      current && snapshot.products.some((product) => product.productId === current)
        ? current
        : recommendedProduct(snapshot.products)?.productId ?? null
    ));
  }, [entry, premiumRequestsAvailable, snapshot]);

  const selectedPack = useMemo(
    () => snapshot?.products.find((product) => product.productId === selectedProductId)
      ?? recommendedProduct(snapshot?.products ?? []),
    [selectedProductId, snapshot],
  );

  const unavailableCopy = useMemo(() => {
    if (!snapshot) return null;
    if (snapshot.mode === 'storekit_unavailable') {
      return 'Apple purchases are not available in this build yet.';
    }
    if (!snapshot.mockPurchaseAuthorized) {
      return 'Pricing preview is available. Checkout is limited to approved Nearr-Dev accounts.';
    }
    return null;
  }, [snapshot]);

  async function buy(productId: string, uses: number) {
    if (!premiumRequestsAvailable) return;
    if (purchase.kind === 'purchasing') return;
    setPurchase({ kind: 'purchasing', productId });
    void trackEvent('purchase_started', { uses, mode: 'dev_mock', pending_premium_request: !!pendingPremiumRequestJobId });
    try {
      const result = await purchaseDevMockPack({ productId, jobId, premiumJobId: pendingPremiumRequestJobId });
      setSnapshot((current) => current ? {
        ...current,
        available: result.available,
        reserved: (jobId || pendingPremiumRequestJobId) && result.resumed ? current.reserved + 1 : current.reserved,
      } : current);
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
        pending_premium_request_resumed: !!pendingPremiumRequestJobId && result.resumed,
      });
      void trackEvent('token_purchase_completed', {
        uses: result.grantedUses,
        pending_premium_request: !!pendingPremiumRequestJobId,
      });
      if (pendingPremiumRequestJobId && result.resumed) {
        await clearPendingPremiumRequestJobId(pendingPremiumRequestJobId);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'purchase_failed';
      setPurchase({ kind: 'error', message: friendlyPurchaseError(message) });
      void trackEvent('purchase_failed', { mode: 'dev_mock', reason: message.slice(0, 60) });
    }
  }

  useEffect(() => {
    if (purchase.kind !== 'success' || !purchase.resumed || !pendingPremiumRequestJobId) return;
    const timer = setTimeout(() => {
      router.replace(`/share-jobs/${pendingPremiumRequestJobId}`);
    }, 900);
    return () => clearTimeout(timer);
  }, [pendingPremiumRequestJobId, purchase, router]);

  async function continuePendingVideo() {
    if (!premiumRequestsAvailable) return;
    if (!jobId || purchase.kind === 'purchasing') return;
    setPurchase({ kind: 'purchasing', productId: '__resume__' });
    try {
      const result = await resumePendingPlaceFindJob(jobId);
      if (!result.resumed) throw new Error('resume_failed');
      setPurchase({ kind: 'success', grantedUses: 0, available: result.available, resumed: true });
    } catch (err) {
      setPurchase({
        kind: 'error',
        message: friendlyPurchaseError(err instanceof Error ? err.message : 'resume_failed'),
      });
    }
  }

  function close() {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/map');
  }

  if (!premiumRequestsAvailable) {
    return (
      <View style={[styles.screen, styles.successScreen, {
        paddingTop: Math.max(insets.top, 18),
        paddingBottom: Math.max(insets.bottom, 18),
      }]}
      >
        <View style={styles.successWrap} testID="premium-requests-suspended">
          <Text style={styles.title} accessibilityRole="header">
            Premium Requests are temporarily unavailable.
          </Text>
          <Pressable
            style={styles.primary}
            onPress={close}
            accessibilityRole="button"
            accessibilityLabel="Done"
          >
            <Text style={styles.primaryText}>Done</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (purchase.kind === 'success') {
    const tokensAdded = purchase.grantedUses > 0;
    const actionLabel = purchase.resumed ? 'View Premium Request' : 'Continue';
    return (
      <View style={[styles.screen, styles.successScreen, {
        paddingTop: Math.max(insets.top, 18),
        paddingBottom: Math.max(insets.bottom, 18),
      }]}
      >
        <View style={styles.successWrap} accessibilityLiveRegion="polite">
          <View style={styles.successIcon}><Feather name="check" size={30} color={CREAM} /></View>
          <Text style={styles.eyebrow}>NEARR TOKENS</Text>
          <Text style={styles.title} accessibilityRole="header">
            {tokensAdded ? `${purchase.grantedUses} tokens added` : 'Premium Request started'}
          </Text>
          <View
            style={styles.successBalance}
            accessible
            accessibilityLabel={`${placeFindBalanceLabel(purchase.available)}. Your new balance`}
          >
            <Text style={styles.successBalanceNumber}>{purchase.available}</Text>
            <TokenSymbol size={26} />
          </View>
          <Text style={styles.balanceCaption}>Your new balance</Text>
          {purchase.resumed ? (
            <Text style={styles.successBody}>Your Premium Request resumed automatically on the original post.</Text>
          ) : null}
          <Pressable
            style={styles.primary}
            onPress={() => router.replace(
              purchase.resumed && pendingPremiumRequestJobId
                ? `/share-jobs/${pendingPremiumRequestJobId}`
                : purchase.resumed ? '/share-jobs' : '/(tabs)/settings',
            )}
            accessibilityRole="button"
            accessibilityLabel={actionLabel}
          >
            <Text style={styles.primaryText}>{actionLabel}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const currentBalance = snapshot?.available ?? 0;
  const pendingNeedsTokens = !!pendingPremiumRequestJobId && currentBalance === 0;
  const purchasingSelected = purchase.kind === 'purchasing'
    && purchase.productId === selectedPack?.productId;
  const checkoutAvailable = snapshot?.mode === 'dev_mock'
    && snapshot.mockPurchaseAuthorized === true;

  return (
    <View style={[styles.screen, { paddingTop: Math.max(insets.top, 12) }]}>
      <Pressable
        onPress={close}
        style={[styles.close, { top: Math.max(insets.top, 12) }]}
        accessibilityRole="button"
        accessibilityLabel="Close token store"
      >
        <Feather name="x" size={24} color={CREAM} />
      </Pressable>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, 24) }]}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.eyebrow}>PREMIUM REQUESTS</Text>
        <Text style={styles.title} accessibilityRole="header">Nearr Tokens</Text>
        <Text style={styles.body}>
          {pendingNeedsTokens
            ? 'Your original post is safe. Choose a pack and Nearr will resume this Premium Request automatically.'
            : 'Normal recognition is free. Tokens are used only for explicit Premium Requests that return a useful result.'}
        </Text>

        <View
          style={styles.currentBalance}
          accessible
          accessibilityLabel={loading ? 'Token balance loading' : placeFindBalanceLabel(currentBalance)}
          accessibilityLiveRegion="polite"
        >
          <Text style={styles.currentBalanceLabel}>Balance</Text>
          {loading ? <ActivityIndicator size="small" color={ORANGE} /> : (
            <View style={styles.balanceValue} importantForAccessibility="no-hide-descendants">
              <Text style={styles.currentBalanceNumber}>{currentBalance}</Text>
              <TokenSymbol size={15} />
            </View>
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
          <View style={styles.mockBadge} accessible accessibilityLabel="Dev pricing preview">
            <Text style={styles.mockBadgeText}>Dev pricing preview</Text>
          </View>
        ) : null}

        {jobId && currentBalance > 0 ? (
          <Pressable
            style={styles.resumeButton}
            onPress={() => void continuePendingVideo()}
            disabled={purchase.kind === 'purchasing'}
            accessibilityRole="button"
            accessibilityLabel="Use one token and continue this shared video"
          >
            {purchase.kind === 'purchasing' && purchase.productId === '__resume__'
              ? <ActivityIndicator color={ORANGE} />
              : <Text style={styles.resumeButtonText}>Continue finding the place</Text>}
          </Pressable>
        ) : null}

        <View style={styles.packList} accessibilityRole="radiogroup">
          {snapshot?.products.map((pack) => {
            const presentation = tokenPackPresentation(pack.uses);
            const selected = pack.productId === selectedPack?.productId;
            const disabled = purchase.kind === 'purchasing';
            const accessibilityLabel = [
              presentation.name,
              `${pack.uses} tokens`,
              pack.displayPrice,
              presentation.recommended ? 'best value' : null,
            ].filter(Boolean).join(', ');
            return (
              <Pressable
                key={pack.productId}
                onPress={() => {
                  setSelectedProductId(pack.productId);
                  void trackEvent('token_pack_selected', { uses: pack.uses, price_source: pack.priceSource });
                }}
                disabled={disabled}
                accessibilityRole="radio"
                accessibilityLabel={accessibilityLabel}
                accessibilityState={{ disabled, selected }}
                style={({ pressed }) => [
                  styles.pack,
                  selected && styles.packSelected,
                  pressed && !disabled && styles.pressed,
                ]}
              >
                <View style={[styles.packIcon, selected && styles.packIconSelected]}>
                  <Feather name={presentation.icon} size={19} color={selected ? ORANGE : MUTED} />
                </View>
                <View style={styles.packCopy}>
                  <View style={styles.packTitleRow}>
                    <Text style={styles.packName} numberOfLines={1}>{presentation.name}</Text>
                    {presentation.recommended ? (
                      <View style={styles.bestValueBadge}>
                        <Text style={styles.bestValueText}>BEST VALUE</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.packUses, selected && styles.packUsesSelected]}>{pack.uses} tokens</Text>
                  <Text style={styles.packNote} numberOfLines={2}>{presentation.description}</Text>
                </View>
                <Text style={[styles.packPrice, selected && styles.packPriceSelected]}>{pack.displayPrice}</Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.reassurance}>1 token unlocks one Premium Request.</Text>

        {selectedPack ? (
          <Pressable
            style={[styles.primary, !checkoutAvailable && styles.primaryDisabled]}
            onPress={() => void buy(selectedPack.productId, selectedPack.uses)}
            disabled={!checkoutAvailable || purchase.kind === 'purchasing'}
            accessibilityRole="button"
            accessibilityLabel={`Get ${selectedPack.uses} tokens`}
            accessibilityState={{ disabled: !checkoutAvailable || purchase.kind === 'purchasing' }}
          >
            {purchasingSelected
              ? <ActivityIndicator color="#FFFFFF" />
              : <Text style={styles.primaryText}>Get {selectedPack.uses} tokens</Text>}
          </Pressable>
        ) : null}

        {unavailableCopy ? <Text style={styles.unavailable}>{unavailableCopy}</Text> : null}
        {purchase.kind === 'error' ? (
          <View style={styles.errorBox} accessibilityRole="alert">
            <Text style={styles.errorText}>{purchase.message}</Text>
          </View>
        ) : null}

        <View style={styles.supportRow}>
          <Pressable
            style={styles.supportButton}
            onPress={() => setSupportExpanded((expanded) => !expanded)}
            accessibilityRole="button"
            accessibilityState={{ expanded: supportExpanded }}
          >
            <Text style={styles.supportText}>Purchase issue?</Text>
          </Pressable>
          <View style={styles.supportDot} />
          <Pressable
            style={styles.supportButton}
            onPress={() => void refresh()}
            disabled={loading || purchase.kind === 'purchasing'}
            accessibilityRole="button"
            accessibilityLabel="Sync purchases and token balance"
          >
            <Text style={styles.supportText}>Sync purchases</Text>
          </Pressable>
        </View>
        {supportExpanded ? (
          <Text style={styles.supportHelp}>
            Dev preview purchases update your server balance. Apple purchases are not available in this build.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CHARCOAL },
  successScreen: { justifyContent: 'center' },
  close: { position: 'absolute', right: 12, zIndex: 2, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingTop: 54, alignItems: 'stretch' },
  eyebrow: { color: ORANGE, fontSize: 11, lineHeight: 15, fontWeight: '800', letterSpacing: 1.7, textAlign: 'center' },
  title: { marginTop: 7, color: CREAM, fontSize: 29, lineHeight: 34, fontWeight: '800', textAlign: 'center' },
  body: { marginTop: 8, color: MUTED, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  currentBalance: { minHeight: 36, marginTop: 14, paddingHorizontal: 12, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, backgroundColor: RAISED, borderWidth: 1, borderColor: '#2C2D34' },
  currentBalanceLabel: { color: MUTED, fontSize: 12, fontWeight: '700' },
  balanceValue: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  currentBalanceNumber: { color: CREAM, fontSize: 17, fontWeight: '800', fontVariant: ['tabular-nums'] },
  mockBadge: { alignSelf: 'center', marginTop: 10, borderRadius: 999, borderWidth: 1, borderColor: '#5E321E', paddingHorizontal: 9, paddingVertical: 4 },
  mockBadgeText: { color: '#E9A27C', fontSize: 10, fontWeight: '700', letterSpacing: 0.25 },
  packList: { marginTop: 12, gap: 9 },
  pack: { minHeight: 90, borderRadius: 16, borderWidth: 1, borderColor: '#303138', backgroundColor: RAISED, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', alignItems: 'center' },
  packSelected: { borderColor: ORANGE, backgroundColor: '#211A17' },
  pressed: { transform: [{ scale: 0.992 }], opacity: 0.88 },
  packIcon: { width: 38, height: 38, marginRight: 10, borderRadius: 12, borderWidth: 1, borderColor: '#34353D', backgroundColor: '#202127', alignItems: 'center', justifyContent: 'center' },
  packIconSelected: { borderColor: '#7A3A1B', backgroundColor: '#2E1D15' },
  packCopy: { flex: 1, minWidth: 0, paddingRight: 8 },
  packTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  packName: { color: CREAM, fontSize: 15, lineHeight: 19, fontWeight: '800', flexShrink: 1 },
  bestValueBadge: { borderRadius: 999, backgroundColor: ORANGE, paddingHorizontal: 6, paddingVertical: 2 },
  bestValueText: { color: '#FFFFFF', fontSize: 8, lineHeight: 10, fontWeight: '900', letterSpacing: 0.45 },
  packUses: { color: '#D0CECA', fontSize: 13, lineHeight: 17, fontWeight: '700', marginTop: 2 },
  packUsesSelected: { color: '#FFAD80' },
  packNote: { color: MUTED, fontSize: 11, lineHeight: 15, marginTop: 2 },
  packPrice: { color: CREAM, fontSize: 16, fontWeight: '800', fontVariant: ['tabular-nums'] },
  packPriceSelected: { color: ORANGE },
  reassurance: { marginTop: 10, color: MUTED, fontSize: 11, lineHeight: 15, textAlign: 'center' },
  primary: { minHeight: 54, marginTop: 14, alignSelf: 'stretch', borderRadius: 15, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primaryDisabled: { opacity: 0.45 },
  primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
  resumeButton: { minHeight: 44, marginTop: 12, borderRadius: 12, borderWidth: 1, borderColor: ORANGE, alignItems: 'center', justifyContent: 'center' },
  resumeButtonText: { color: ORANGE, fontSize: 14, fontWeight: '800' },
  unavailable: { marginTop: 9, color: MUTED, fontSize: 11, lineHeight: 16, textAlign: 'center' },
  message: { marginTop: 14, alignItems: 'center' },
  messageText: { color: CREAM, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  textButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16 },
  textButtonLabel: { color: ORANGE, fontWeight: '800' },
  errorBox: { marginTop: 10, backgroundColor: '#351918', borderRadius: 12, padding: 12 },
  errorText: { color: '#FFB4AE', textAlign: 'center', lineHeight: 18 },
  supportRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  supportButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 10 },
  supportText: { color: '#D0CECA', fontSize: 12, fontWeight: '700' },
  supportDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: '#56575D' },
  supportHelp: { color: MUTED, fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 12 },
  successWrap: { paddingHorizontal: 28, alignItems: 'center' },
  successIcon: { width: 62, height: 62, borderRadius: 31, backgroundColor: ORANGE, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  successBalance: { marginTop: 24, flexDirection: 'row', alignItems: 'center', gap: 10 },
  successBalanceNumber: { color: CREAM, fontSize: 48, lineHeight: 54, fontWeight: '800', fontVariant: ['tabular-nums'] },
  balanceCaption: { marginTop: 2, color: MUTED, fontSize: 13, fontWeight: '700' },
  successBody: { marginTop: 18, color: MUTED, fontSize: 14, lineHeight: 20, textAlign: 'center' },
});
