import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Screen } from '@/components';
import { useTheme } from '@/lib/theme';
import { usePlus } from '@/hooks/usePlus';
import { useLocale } from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { PLUS_MANAGE_URL, purchasePlus, recordPlusEvent, restorePlus } from '@/lib/plusClient';
import { hasVerifiedPlusAccess } from '@/lib/plusEntitlements';

export default function PlusScreen() {
  useLocale();
  const router = useRouter(); const { colors, typography } = useTheme(); const plus = usePlus();
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  useEffect(() => { if (plus.canOffer) { void recordPlusEvent('offering_seen'); void recordPlusEvent('product_displayed'); } }, [plus.canOffer]);
  async function buy() {
    if (!plus.userId || !plus.offer || busy) return; setBusy(true);
    const result = await purchasePlus(plus.userId, plus.offer);
    setMessage(result.outcome === 'verified' ? 'Your subscription is verified.'
      : result.outcome === 'pending' ? 'Your purchase is pending confirmation. You can keep using your saved places.'
      : result.outcome === 'cancelled' ? 'Purchase cancelled. Nothing has changed.'
      : 'We could not confirm your purchase. Try Restore Purchases before purchasing again.');
    await plus.refresh(); setBusy(false);
  }
  async function restore() {
    if (!plus.userId || busy) return; setBusy(true);
    try { const status = await restorePlus(plus.userId); setMessage(hasVerifiedPlusAccess(status.entitlement) ? 'Your subscription is verified.' : 'No active subscription was found for this account.'); }
    catch { setMessage('We could not restore purchases. Check your connection and try again.'); }
    await plus.refresh(); setBusy(false);
  }
  return <Screen><ScrollView contentContainerStyle={{ gap: 20, paddingBottom: 36 }}>
    <Button title={t('Back')} variant="ghost" onPress={() => router.back()} />
    <Text style={[typography.largeTitle, { color: colors.text }]}>{t('Nearr Plus')}</Text>
    <Text style={[typography.body, { color: colors.text }]}>{t('Your saved places stay yours, with or without a subscription.')}</Text>
    {plus.loading && <ActivityIndicator color={colors.primary} accessibilityLabel={t('Loading subscription')} />}
    {!plus.loading && !plus.status && <Text style={typography.body}>{t('Purchases are unavailable right now. Your saved places are still available.')}</Text>}
    {plus.status && <>
      <Card><View style={{ gap: 12 }}>
        <Text style={typography.bodyStrong}>{plus.hasPlus ? t('Nearr Plus is active') : t('Free')}</Text>
        <Text style={typography.body}>{t('Free includes {{count}} successful video finds each calendar month.', { count: plus.status.freeFinds })}</Text>
        <Text style={typography.body}>{t('Plus includes {{count}} successful video finds per billing month, including your free allowance.', { count: plus.status.plusFinds })}</Text>
        <Text style={typography.body}>{t('One video counts once, even when it contains several places. Failed searches do not use your allowance.')}</Text>
        <Text style={typography.body}>{t('Quick Check keeps one find reserved until you save a result or the reservation expires after 7 days. Unused finds do not roll over.')}</Text>
      </View></Card>
      {plus.hasPlus && <Text style={typography.body}>{t('{{count}} finds remaining in this period.', { count: plus.status.usage.remaining })}</Text>}
      {plus.status.entitlement?.state === 'cancelled' && <Text style={typography.body}>{t('Renewal is cancelled. Plus remains available until the paid period ends.')}</Text>}
      {plus.status.entitlement?.state === 'grace' && <Text style={typography.body}>{t('Apple is resolving a billing issue. Check Manage Subscription for details.')}</Text>}
      {plus.canOffer && plus.offer && <>
        <Text style={typography.body}>{t('A monthly subscription. Apple charges your account and renews automatically unless you cancel in your subscription settings. No annual commitment.')}</Text>
        <Button title={t('Subscribe for {{price}} / month', { price: plus.offer.price })} onPress={() => void buy()} loading={busy} disabled={busy || plus.loading} />
      </>}
      {!plus.hasPlus && !plus.canOffer && !plus.loading && <Text style={typography.body}>{t('Plus is not available for purchase on this account right now.')}</Text>}
      <Button title={t('Restore Purchases')} variant="secondary" onPress={() => void restore()} disabled={busy || !plus.canManage} />
    </>}
    {!!message && <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={typography.body}>{t(message)}</Text>}
    <Button title={t('Manage Subscription')} variant="ghost" onPress={() => void Linking.openURL(PLUS_MANAGE_URL).catch(() => setMessage('Open your Apple account settings to manage subscriptions.'))} />
    <Button title={t('Terms of Service')} variant="ghost" onPress={() => router.push('/legal/terms')} />
    <Button title={t('Privacy Policy')} variant="ghost" onPress={() => router.push('/legal/privacy')} />
  </ScrollView></Screen>;
}
