import { useMemo } from 'react';
import { View, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export function Screen({ children, style, padded = true }: { children: React.ReactNode; style?: ViewStyle; padded?: boolean }) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* `flex: 1` ALWAYS applied. Previously this was tied to `padded`,
          which silently collapsed the body to height 0 when callers passed
          `padded={false}` (e.g. screens that wrap their own ScrollView). */}
      <View style={[styles.fill, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    fill: { flex: 1 },
    padded: { padding: Spacing.lg },
  });
}
