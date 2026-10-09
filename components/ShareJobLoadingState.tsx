import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';

/** Initial data retrieval, not a simulated recognition result or progress percentage. */
export function ShareJobLoadingState() {
  const { colors, typography } = useTheme();
  const reduced = useReduceMotion();
  return <View style={styles.intro} testID="share-job-loading-intro">
    <Text style={[typography.eyebrow, { color: colors.textSecondary }]}>FROM YOUR POST</Text>
    <Text accessibilityRole="header" style={[typography.title, { color: colors.text }]}>Opening your find</Text>
    <Text style={[typography.body, { color: colors.textSecondary }]}>Your post and place details will appear here.</Text>
    <View style={styles.status} accessibilityRole="progressbar" accessibilityLabel="Loading this find">
      {reduced ? <Feather name="clock" size={18} color={colors.textSecondary} /> : <ActivityIndicator size="small" color={colors.primary} />}
      <Text style={[typography.metadata, { color: colors.textSecondary }]}>Loading details</Text>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  intro: { alignSelf: 'stretch', paddingHorizontal: Spacing.lg, paddingTop: Spacing.sm, paddingBottom: Spacing.lg, gap: Spacing.sm },
  status: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, marginTop: Spacing.xs },
});
