import { Text, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { i18n, t } from '@/lib/i18n';
import { localizedUtcDate, paidUsage } from '@/lib/paidClientModel';
import type { PlusStatus } from '@/lib/plusClient';
import { hasVerifiedPlusAccess } from '@/lib/plusEntitlements';

export function PaidFindsBalance({ status }: { status: PlusStatus }) {
  const { colors,typography } = useTheme(); const usage = paidUsage(status.usage);
  if (!usage) return <Text style={typography.body}>{t('Balance is unavailable. Check your connection and refresh.')}</Text>;
  const active = usage.unlimited && hasVerifiedPlusAccess(status.entitlement);
  const reset = localizedUtcDate(usage.free.resetAt,i18n.language);
  const until = localizedUtcDate(status.entitlement?.accessUntil,i18n.language);
  return <View style={{gap:12}}>
    <Text style={[typography.bodyStrong,{color:colors.text}]}>{active ? t('Nearr Plus is active') : t('Your finds')}</Text>
    {active && <Text style={typography.title}>{t('Unlimited finds')}</Text>}
    {active && until && <Text style={typography.caption}>{t('Verified Plus access through {{date}} (UTC).',{date:until})}</Text>}
    {!active && <View style={{gap:4}}>
      <Text style={typography.body}>{t('Monthly free finds')}</Text>
      <Text style={typography.title}>{t('{{remaining}} of {{total}} available',{remaining:usage.free.remaining,total:3})}</Text>
      {!!usage.free.reserved && <Text style={typography.caption}>{t('Reserved for pending results: {{count}}',{count:usage.free.reserved})}</Text>}
      {reset && <Text style={typography.caption}>{t('Free resets {{date}} (UTC).',{date:reset})}</Text>}
    </View>}
    <Text style={typography.bodyStrong}>{t('Purchased tokens: {{count}}',{count:usage.tokens.available})}</Text>
    {!!usage.tokens.reserved && <Text style={typography.caption}>{t('Reserved for pending results: {{count}}',{count:usage.tokens.reserved})}</Text>}
    <Text style={typography.caption}>{t('Purchased tokens never expire. Plus leaves them untouched.')}</Text>
    {usage.verificationRequired && <Text accessibilityRole="alert" style={typography.caption}>{t('Checking purchase access. Your saved places remain available.')}</Text>}
  </View>;
}
