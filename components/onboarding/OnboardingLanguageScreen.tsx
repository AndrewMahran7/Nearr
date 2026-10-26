import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useLocale } from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type AppLocale } from '@/lib/i18nCore';
import { useTheme } from '@/lib/theme';
import { EligibilityContinue, EligibilityFrame } from './EligibilityFrame';

export function OnboardingLanguageScreen({ onContinue }: { onContinue: () => void }) {
  const { locale, setLocale } = useLocale();
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  async function save(value: AppLocale, advance = false) {
    if (busy) return;
    setBusy(true); setError(false);
    try { await setLocale(value); if (advance) onContinue(); }
    catch { setError(true); }
    finally { setBusy(false); }
  }
  return <EligibilityFrame title={t('Choose your language')} subtitle={t('You can change this anytime in Settings.')}
    footer={<EligibilityContinue busy={busy} onPress={() => void save(locale as AppLocale, true)} />}>
    <View style={{ gap: 4 }}>
      {SUPPORTED_LOCALES.map(value => <Pressable key={value} testID={`onboarding-language-${value}`} accessibilityRole="radio" accessibilityState={{ selected: locale === value, disabled: busy }} disabled={busy}
        onPress={() => void save(value)} style={({ pressed }) => ({ minHeight: 60, paddingVertical: 16, paddingHorizontal: 16, borderRadius: 16, flexDirection: 'row', alignItems: 'center', gap: 16, backgroundColor: locale === value ? colors.surface : pressed ? colors.surfaceElevated : 'transparent', borderWidth: 1, borderColor: locale === value ? colors.accent : 'transparent' })}>
        <Text style={{ color: colors.text, fontSize: 17, lineHeight: 25, flex: 1, fontWeight: locale === value ? '600' : '400' }}>{LOCALE_NAMES[value]}</Text>
        <Feather name={locale === value ? 'check-circle' : 'circle'} size={22} color={locale === value ? colors.accent : colors.border} />
      </Pressable>)}
    </View>
    {error && <Text accessibilityRole="alert" style={{ color: colors.danger, fontSize: 15 }}>{t('Could not save language')} {t('Please try again.')}</Text>}
  </EligibilityFrame>;
}
