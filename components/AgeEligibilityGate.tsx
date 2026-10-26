import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
import { LanguageSelector } from '@/components/localization/LanguageSelector';
import { AGE_BANDS, ELIGIBILITY_POLICY, type AgeBand, type EligibilityDeclaration } from '@/lib/globalEligibility';
import type { AgeEligibilityState } from '@/hooks/useAgeEligibility';

type Props = { status: AgeEligibilityState; submitting: boolean; onDeclare: (answer: EligibilityDeclaration) => Promise<boolean>; onRetry: () => void; onSignOut?: () => Promise<void>; onViewSavedData?: () => void };

export function AgeEligibilityGate({ status, submitting, onDeclare, onRetry, onSignOut, onViewSavedData }: Props) {
  useLocale();
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [ageBand, setAgeBand] = useState<AgeBand | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState(false);
  const restricted = status === 'under_minimum' || status === 'region_unavailable' || status === 'revoked';
  const ageLabels: Record<AgeBand, string> = { under_13: t('Under 13'), '13': '13', '14': '14', '15': '15', '16_17': '16–17', '18_plus': t('18 or older') };
  async function answer() {
    if (!ageBand || !countryCode) return;
    setSubmitError(false);
    if (!(await onDeclare({ ageBand, countryCode }))) setSubmitError(true);
  }
  return <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <LanguageSelector />
      <Text accessibilityRole="header" style={styles.title}>{t('A little about you')}</Text>
      <Text style={styles.body}>{restricted ? t('Nearr is not available for this age or region yet. Existing saved data has not been deleted.') : t('Nearr is for ages 13 and older. Some countries require a higher age. Choose your age range and country of residence. We do not need your birthday.')}</Text>
      {status === 'loading' && <ActivityIndicator accessibilityLabel={t('Checking account eligibility')} color={colors.primary} />}
      {status === 'error' && <><Text style={styles.body}>{t('We could not check eligibility. Your saved data remains available. Connect and try again before using live recognition.')}</Text><Pressable accessibilityRole="button" onPress={onRetry} style={styles.primary}><Text style={styles.primaryText}>{t('Try again')}</Text></Pressable></>}
      {status === 'pending' && <>
        <Text style={styles.label}>{t('Age range')}</Text>
        <View style={styles.options}>{AGE_BANDS.map(value => <Pressable key={value} disabled={submitting} accessibilityRole="radio" accessibilityState={{ selected: ageBand === value }} onPress={() => setAgeBand(value)} style={[styles.option, ageBand === value && { borderColor: colors.primary, borderWidth: 2 }]}><Text style={styles.optionText}>{ageLabels[value]}</Text></Pressable>)}</View>
        <Text style={styles.label}>{t('Country of residence')}</Text>
        <View style={styles.options}>{Object.entries(ELIGIBILITY_POLICY.regions).map(([code, region]) => <Pressable key={code} disabled={submitting} accessibilityRole="radio" accessibilityState={{ selected: countryCode === code }} onPress={() => setCountryCode(code)} style={[styles.option, countryCode === code && { borderColor: colors.primary, borderWidth: 2 }]}><Text style={styles.optionText}>{t(region.name)}</Text></Pressable>)}
          <Pressable disabled={submitting} accessibilityRole="radio" accessibilityState={{ selected: countryCode === 'ZZ' }} onPress={() => setCountryCode('ZZ')} style={styles.option}><Text style={styles.optionText}>{t('Another country')}</Text></Pressable>
        </View>
        <Pressable accessibilityRole="button" disabled={submitting || !ageBand || !countryCode} onPress={() => void answer()} style={[styles.primary, (!ageBand || !countryCode || submitting) && { opacity: 0.5 }]}><Text style={styles.primaryText}>{submitting ? t('Saving…') : t('Continue')}</Text></Pressable>
        <Text style={styles.note}>{t('Please answer accurately. This is a declaration, not independent age verification. Contact support to correct a mistake.')}</Text>
      </>}
      {submitError && <Text style={styles.error}>{t('We could not save your answer. Check your connection or contact support.')}</Text>}
      {onViewSavedData && <Pressable accessibilityRole="button" onPress={onViewSavedData} style={styles.secondary}><Text style={styles.secondaryText}>{t('View saved places and account options')}</Text></Pressable>}
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('mailto:andrew.mahran@icloud.com?subject=Nearr%20account%20or%20data%20request')} style={styles.secondary}><Text style={styles.secondaryText}>{t('Contact support about your account or data')}</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://andrewmahran7.github.io/nearr-legal/privacy')} style={styles.secondary}><Text style={styles.secondaryText}>{t('Privacy Policy')}</Text></Pressable>
      {onSignOut && <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void onSignOut()} style={styles.secondary}><Text style={styles.secondaryText}>{t('Sign out')}</Text></Pressable>}
    </ScrollView>
  </SafeAreaView>;
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({ safe: { flex: 1, backgroundColor: colors.bg }, content: { flexGrow: 1, paddingHorizontal: 24, paddingVertical: 28, gap: 16 }, title: { color: colors.text, fontSize: 28, fontWeight: '800' }, body: { color: colors.textSecondary, fontSize: 16, lineHeight: 24 }, label: { color: colors.text, fontSize: 16, fontWeight: '700' }, options: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, option: { padding: 12, minHeight: 48, borderRadius: 12, borderWidth: 1, borderColor: colors.border, justifyContent: 'center' }, optionText: { color: colors.text, fontSize: 15 }, primary: { minHeight: 52, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', padding: 14 }, primaryText: { color: colors.textInverse, fontSize: 16, fontWeight: '800' }, secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 }, secondaryText: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' }, note: { color: colors.textMuted, fontSize: 13, lineHeight: 19 }, error: { color: colors.danger, fontSize: 14, lineHeight: 21 } });
}
