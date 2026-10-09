import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import type { VayrinPresentation } from '@/lib/vayrinPresentation';

/** Text-first place-identification status. The legacy component name remains
 * internal so this copy-only change does not churn imports. */
export function VayrinPresentationHeader({
  presentation,
  compact = false,
}: {
  presentation: VayrinPresentation;
  compact?: boolean;
}) {
  const { colors, typography } = useTheme();
  const styles = createStyles(colors);
  const looking = presentation.kind === 'looking';
  const accessibilityLabel = `${presentation.headline} ${presentation.body}`;

  return (
    <View
      accessible
      accessibilityRole="summary"
      accessibilityLabel={accessibilityLabel}
      accessibilityLiveRegion={looking ? 'polite' : 'none'}
      style={[styles.container, compact && styles.compact]}
    >
      <View style={styles.eyebrowRow} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">

        <Text style={styles.eyebrow}>{looking ? 'FINDING A PLACE' : 'FROM YOUR POST'}</Text>
        {looking ? <ActivityIndicator size="small" color={colors.primary} /> : null}
      </View>
      <Text style={[compact ? typography.heading : typography.title, styles.headline]}>
        {presentation.headline}
      </Text>
      <Text style={[typography.body, styles.body]}>{presentation.body}</Text>
    </View>
  );
}
function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: {
      alignSelf: 'stretch',
      paddingVertical: Spacing.md,
      marginBottom: Spacing.lg,
    },
    compact: { paddingVertical: Spacing.sm, marginBottom: Spacing.md },
    eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, minHeight: 24 },
    eyebrow: { color: colors.textSecondary, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, flex: 1 },
    headline: { color: colors.text, marginTop: Spacing.sm },
    body: { color: colors.textSecondary, marginTop: Spacing.xs, lineHeight: 22 },
  });
}
