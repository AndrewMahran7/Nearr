import { useState } from 'react';
import { Modal, Platform, Pressable, Text, View, useWindowDimensions } from 'react-native';
import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { Feather } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { useLocale } from '@/hooks/useLocale';
import { t } from '@/lib/i18n';
import { localCalendarDate, birthdayAge, type Birthday } from '@/lib/birthdayEligibility';

export function BirthdayPicker({ value, onChange, disabled }: { value: Birthday | null; onChange: (value: Birthday) => void; disabled: boolean }) {
  const { colors, resolvedTheme } = useTheme();
  const { locale } = useLocale();
  const { fontScale } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Date | null>(null);
  const asDate = (birthday: Birthday) => new Date(birthday.year, birthday.month - 1, birthday.day, 12);
  function select() {
    const now = new Date();
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({ value: value ? asDate(value) : now, mode: 'date', display: 'spinner', minimumDate: new Date(1900, 0, 1), maximumDate: now,
        positiveButton: { label: t('Done') }, negativeButton: { label: t('Cancel') },
        // Android requires a seed date. A blank control must not silently turn
        // that seed into a birthday when Done is tapped without choosing one.
        onChange: (event, date) => {
          if (event.type !== 'set' || !date) return;
          const picked = localCalendarDate(date);
          if (!value && JSON.stringify(picked) === JSON.stringify(localCalendarDate(now))) return;
          if (birthdayAge(picked) !== null) onChange(picked);
        },
      });
    } else { setDraft(value ? asDate(value) : null); setOpen(true); }
  }
  return <>
    <Pressable testID="birthday-picker" accessibilityRole="button" accessibilityLabel={value ? `${t('Birthday')}: ${new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(asDate(value))}` : t('Select your birthday')} disabled={disabled} onPress={select}
      style={{ minHeight: 104, borderRadius: 24, padding: 22, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, justifyContent: 'center', gap: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Feather name="calendar" size={20} color={colors.accent} /><Text style={{ color: colors.textSecondary, fontSize: 14 }}>{t('Birthday')}</Text></View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><Text style={{ fontSize: fontScale > 1.3 ? 18 : 22, lineHeight: fontScale > 1.3 ? 26 : 30, fontWeight: '600', color: value ? colors.text : colors.textSecondary, flex: 1 }}>{value ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(asDate(value)) : t('Select your birthday')}</Text><Feather name="chevron-down" size={22} color={colors.textSecondary} /></View>
    </Pressable>
    {Platform.OS === 'ios' && <Modal visible={open} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setOpen(false)}>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg, padding: 24, gap: 24 }}>
        <Text accessibilityRole="header" style={{ color: colors.text, fontSize: 24, fontWeight: '700' }}>{t('Select your birthday')}</Text>
        <DateTimePicker value={draft ?? new Date()} mode="date" display="spinner" locale={locale} themeVariant={resolvedTheme} textColor={colors.text} maximumDate={new Date()} minimumDate={new Date(1900, 0, 1)} onChange={(_event, date) => { if (date) setDraft(date); }} />
        <Pressable accessibilityRole="button" disabled={!draft} onPress={() => { if (draft && birthdayAge(localCalendarDate(draft)) !== null) { onChange(localCalendarDate(draft)); setOpen(false); } }} style={{ minHeight: 52, padding: 16, opacity: draft ? 1 : 0.4 }}><Text style={{ color: colors.accent, fontSize: 18 }}>{t('Done')}</Text></Pressable>
        <Pressable accessibilityRole="button" onPress={() => setOpen(false)} style={{ minHeight: 52, padding: 16 }}><Text style={{ color: colors.text, fontSize: 18 }}>{t('Cancel')}</Text></Pressable>
      </SafeAreaView>
    </Modal>}
  </>;
}
