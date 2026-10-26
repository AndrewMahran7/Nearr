import { t } from '@/lib/i18n';
import { useLocale } from '@/hooks/useLocale';
import { Text, View } from 'react-native';
import drafts from '../constants/globalLegalDrafts.json';
import { useTheme } from '../lib/theme';

/** Developer review only. Never an effective notice or an acceptance record. */
export function GlobalLegalDraft({ kind }: { kind: 'terms' | 'privacy' }) {
  useLocale();
  const { colors, typography } = useTheme();
  if (!__DEV__) return null;
  return <View style={{ gap: 18 }}>
    <Text accessibilityRole="header" style={typography.bodyStrong}>{t("English review draft · Unapproved · Not effective")}</Text>
    {drafts[kind].map((section, index) => <View key={index} style={{ gap: 10 }}>
      <Text accessibilityRole="header" style={typography.bodyStrong}>{section.heading}</Text>
      {section.paragraphs.map((text, i) => <Text key={i} selectable style={[typography.body, { color: colors.textSecondary }]}>{text}</Text>)}
    </View>)}
  </View>;
}
