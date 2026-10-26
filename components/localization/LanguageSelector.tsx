import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useLocale } from '../../hooks/useLocale';
import { t } from '../../lib/i18n';
import { LOCALE_NAMES, SUPPORTED_LOCALES, type LocalePreference } from '../../lib/i18nCore';
import { useTheme } from '../../lib/theme';

export function LanguageSelector() {
  const { preference, setLocale } = useLocale();
  const { colors, typography } = useTheme();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  async function select(value: LocalePreference) {
    setSaving(true);
    try { await setLocale(value); setOpen(false); }
    catch { Alert.alert(t('Could not save language'), t('Please try again.')); }
    finally { setSaving(false); }
  }
  const current = preference === 'system' ? t('Device language') : LOCALE_NAMES[preference];
  return <>
    <Pressable accessibilityRole="button" accessibilityLabel={t('Language: {{language}}', { language: current })} onPress={() => setOpen(true)} style={{ minHeight: 48, paddingVertical: 12, flexDirection: 'row', justifyContent: 'space-between', gap: 16 }}>
      <Text style={typography.label}>{t('Language')}</Text><Text style={typography.compact}>{current}</Text>
    </Pressable>
    <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: colors.bg, paddingTop: 28, paddingHorizontal: 24 }}>
        <Text accessibilityRole="header" style={typography.largeTitle}>{t('Language')}</Text>
        <Text style={[typography.compact, { marginVertical: 16 }]}>{t('Changes the interface language. Place names, your notes, and video content stay in their original language.')}</Text>
        <ScrollView>{(['system', ...SUPPORTED_LOCALES] as LocalePreference[]).map(value => <Pressable key={value} disabled={saving} accessibilityRole="radio" accessibilityState={{ selected: value === preference, disabled: saving }} onPress={() => void select(value)} style={{ minHeight: 52, paddingVertical: 16, flexDirection: 'row', gap: 12 }}>
          <Text style={[typography.body, { flex: 1 }]}>{value === 'system' ? t('Device language') : LOCALE_NAMES[value]}</Text>{value === preference && <Text style={typography.body}>✓</Text>}
        </Pressable>)}</ScrollView>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ minHeight: 52, paddingVertical: 16, marginBottom: 28 }}><Text style={typography.label}>{t('Done')}</Text></Pressable>
      </View>
    </Modal>
  </>;
}
