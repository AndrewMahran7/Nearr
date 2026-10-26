import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
import { ELIGIBILITY_POLICY, type EligibilityDeclaration } from '@/lib/globalEligibility';
import { birthdayDeclaration, type Birthday } from '@/lib/birthdayEligibility';
import type { AgeEligibilityState } from '@/hooks/useAgeEligibility';
import { BirthdayPicker } from './onboarding/BirthdayPicker';
import { EligibilityContinue, EligibilityFrame } from './onboarding/EligibilityFrame';
import { OnboardingLanguageScreen } from './onboarding/OnboardingLanguageScreen';

type Props = { status: AgeEligibilityState; submitting: boolean; onDeclare: (answer: EligibilityDeclaration) => Promise<boolean>; onRetry: () => void; onSignOut?: () => Promise<void>; onViewSavedData?: () => void };
export function AgeEligibilityGate({ status, submitting, onDeclare, onRetry, onSignOut, onViewSavedData }: Props) {
  const { ready, confirmed } = useLocale();
  const { colors } = useTheme();
  const [step, setStep] = useState<'language' | 'birthday' | null>(null);
  // No persisted DOB, analytics, route params, or RPC arguments. Discard on success/unmount.
  const [birthday, setBirthday] = useState<Birthday | null>(null);
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [countriesOpen, setCountriesOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const restricted = status === 'under_minimum' || status === 'region_unavailable' || status === 'revoked';
  useEffect(() => { if (ready && step === null) setStep(confirmed ? 'birthday' : 'language'); }, [ready, confirmed, step]);
  useEffect(() => { if (restricted) { setBirthday(null); setCountriesOpen(false); } }, [restricted]);
  useEffect(() => {
    if (step !== 'birthday' || status !== 'pending') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { if (!submitting) setStep('language'); return true; });
    return () => subscription.remove();
  }, [step, status, submitting]);
  async function answer() {
    const declaration = birthdayDeclaration(birthday, countryCode);
    if (!declaration || submitting) return;
    setSubmitError(false);
    try { if (await onDeclare(declaration)) setBirthday(null); else setSubmitError(true); }
    catch { setSubmitError(true); }
  }
  const text = { color: colors.textSecondary, fontSize: 14, lineHeight: 21 };
  const link = { color: colors.text, fontSize: 14, lineHeight: 21, textDecorationLine: 'underline' as const };
  const action = { minHeight: 48, justifyContent: 'center' as const, paddingVertical: 12 };
  const support = <>
    {onViewSavedData && <Pressable accessibilityRole="button" onPress={onViewSavedData} style={action}><Text style={link}>{t('View my saved data')}</Text></Pressable>}
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('mailto:andrew.mahran@icloud.com?subject=Nearr%20account%20or%20data%20request')} style={action}><Text style={link}>{t('Contact support or request your data')}</Text></Pressable>
    <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('https://andrewmahran7.github.io/nearr-legal/privacy')} style={action}><Text style={link}>{t('Privacy Policy')}</Text></Pressable>
    {onSignOut && <Pressable accessibilityRole="button" onPress={() => void onSignOut()} style={action}><Text style={link}>{t('Sign out')}</Text></Pressable>}
  </>;
  if (!ready || step === null || status === 'loading') return <EligibilityFrame title={t('Getting things ready')} subtitle={t('Checking your eligibility…')}><ActivityIndicator color={colors.accent} /></EligibilityFrame>;
  if (restricted) return <EligibilityFrame title={t('Nearr isn’t available just yet')} subtitle={status === 'under_minimum' ? t('You don’t meet the minimum age for Nearr in your country yet.') : t('Nearr isn’t available for this account or country at the moment.')}>
    <Text style={text}>{t('Your saved data has not been deleted. Contact support if you need help with your account or data.')}</Text>{support}
  </EligibilityFrame>;
  if (status === 'error') return <EligibilityFrame title={t('Let’s try that again')} subtitle={t('We couldn’t reach the eligibility service. Your entries are still here. Connect and try again.')} footer={<EligibilityContinue onPress={onRetry} />}>
    {support}
  </EligibilityFrame>;
  if (status === 'eligible') return null;
  if (step === 'language') return <OnboardingLanguageScreen onContinue={() => setStep('birthday')} />;
  const countryName = countryCode === 'ZZ' ? t('Another country') : countryCode ? t(ELIGIBILITY_POLICY.regions[countryCode as keyof typeof ELIGIBILITY_POLICY.regions].name) : t('Select country');
  return <EligibilityFrame title={t('When’s your birthday?')} subtitle={t('We’ll use this to make sure Nearr is right for your age.')}
    onBack={submitting ? undefined : () => setStep('language')}
    footer={<EligibilityContinue disabled={!birthdayDeclaration(birthday, countryCode)} busy={submitting} onPress={() => void answer()} />}>
    <View style={{ gap: 24 }}>
      <BirthdayPicker value={birthday} onChange={setBirthday} disabled={submitting} />
      <Text style={text}>{t('Your birthday stays on this screen. We save only your age range and country.')}</Text>
      <View style={{ gap: 8 }}>
        <Text style={{ color: colors.text, fontSize: 15, fontWeight: '600' }}>{t('Country of residence')}</Text>
        <Pressable testID="residence-picker" disabled={submitting} accessibilityRole="button" accessibilityLabel={`${t('Country of residence')}: ${countryName}`} onPress={() => setCountriesOpen(true)}
          style={{ minHeight: 58, padding: 16, borderRadius: 16, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={{ flex: 1, color: colors.text, fontSize: 16, lineHeight: 24 }}>{countryName}</Text><Feather name="chevron-down" size={18} color={colors.textSecondary} /></Pressable>
        <Text style={text}>{t('Some countries have a higher minimum age.')}</Text>
      </View>
      {submitError && <Text accessibilityRole="alert" style={[text, { color: colors.danger }]}>{t('We couldn’t save your answer. Your entries are still here. Please try again or contact support.')}</Text>}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: detailsOpen }} onPress={() => setDetailsOpen(!detailsOpen)} style={action}><Text style={link}>{t('About this check')}</Text></Pressable>
      {detailsOpen && <View><Text style={text}>{t('This is your declaration, not independent age verification. If you need to correct a saved answer, contact support.')}</Text>{support}</View>}
    </View>
    <Modal visible={countriesOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setCountriesOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, paddingHorizontal: 24 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 28, lineHeight: 36, fontWeight: '700', paddingVertical: 20 }}>{t('Country of residence')}</Text>
        <ScrollView>{[...Object.entries(ELIGIBILITY_POLICY.regions).map(([code, region]) => ({ code, name: t(region.name) })), { code: 'ZZ', name: t('Another country') }].map(item => <Pressable key={item.code} accessibilityRole="radio" accessibilityState={{ selected: countryCode === item.code }} onPress={() => { setCountryCode(item.code); setCountriesOpen(false); }} style={{ minHeight: 60, paddingVertical: 18, flexDirection: 'row', gap: 16, alignItems: 'center' }}>
          <Text style={{ color: colors.text, flex: 1, fontSize: 17, lineHeight: 25 }}>{item.name}</Text>{countryCode === item.code && <Feather name="check" size={22} color={colors.accent} />}
        </Pressable>)}</ScrollView>
        <Pressable accessibilityRole="button" onPress={() => setCountriesOpen(false)} style={action}><Text style={link}>{t('Cancel')}</Text></Pressable>
      </SafeAreaView>
    </Modal>
  </EligibilityFrame>;
}
