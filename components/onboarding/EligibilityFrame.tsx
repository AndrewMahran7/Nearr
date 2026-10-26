import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useTheme } from '@/lib/theme';
import { t } from '@/lib/i18n';

export function EligibilityFrame({ title, subtitle, children, footer, onBack }: {
  title: string; subtitle: string; children?: ReactNode; footer?: ReactNode; onBack?: () => void;
}) {
  const { colors, resolvedTheme } = useTheme();
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['top', 'bottom', 'left', 'right']}>
    <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
    <View style={styles.brand}>
      {onBack ? <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel={t('Go back')} style={styles.back}><Feather name="arrow-left" size={24} color={colors.text} /></Pressable>
        : <Text style={[styles.wordmark, { color: colors.accent }]}>nearr</Text>}
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.heading}>
        <Text accessibilityRole="header" style={[styles.title, { color: colors.text }]}>{title}</Text>
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{subtitle}</Text>
      </View>
      {children}
    </ScrollView>
    {footer && <View style={[styles.footer, { borderTopColor: colors.border, backgroundColor: colors.bg }]}>{footer}</View>}
  </SafeAreaView>;
}
export function EligibilityContinue({ onPress, disabled = false, busy = false }: { onPress: () => void; disabled?: boolean; busy?: boolean }) {
  const { colors } = useTheme();
  return <Pressable testID="eligibility-continue" accessibilityRole="button" accessibilityState={{ disabled: disabled || busy, busy }} disabled={disabled || busy} onPress={onPress}
    style={({ pressed }) => [styles.continue, { backgroundColor: colors.primary, opacity: disabled || busy ? 0.4 : pressed ? 0.8 : 1 }]}>
    <Text style={[styles.continueText, { color: colors.textInverse }]}>{busy ? t('Saving…') : t('Continue')}</Text>
  </Pressable>;
}
const styles = StyleSheet.create({
  brand: { minHeight: 64, paddingHorizontal: 28, justifyContent: 'center', alignItems: 'flex-start' },
  wordmark: { fontSize: 24, fontWeight: '800', letterSpacing: -1 },
  back: { minHeight: 48, minWidth: 48, justifyContent: 'center' },
  content: { flexGrow: 1, paddingHorizontal: 28, paddingTop: 22, paddingBottom: 28, gap: 28 },
  heading: { gap: 14 },
  title: { fontSize: 36, lineHeight: 42, fontWeight: '700', letterSpacing: -1.2 },
  subtitle: { fontSize: 17, lineHeight: 25 },
  footer: { paddingHorizontal: 24, paddingTop: 14, paddingBottom: 12, borderTopWidth: StyleSheet.hairlineWidth, gap: 8 },
  continue: { minHeight: 56, borderRadius: 18, padding: 16, alignItems: 'center', justifyContent: 'center' },
  continueText: { fontSize: 17, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
});
