import { View, StyleSheet, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors, Spacing } from '@/constants';

export function Screen({ children, style, padded = true }: { children: React.ReactNode; style?: ViewStyle; padded?: boolean }) {
  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      {/* `flex: 1` ALWAYS applied. Previously this was tied to `padded`,
          which silently collapsed the body to height 0 when callers passed
          `padded={false}` (e.g. screens that wrap their own ScrollView). */}
      <View style={[styles.fill, padded && styles.padded, style]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.bg },
  fill: { flex: 1 },
  padded: { padding: Spacing.lg },
});
