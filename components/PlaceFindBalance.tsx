import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { placeFindBalanceLabel } from '@/lib/placeFindConfig';
import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

export function PlaceFindBalance({
  available,
  loading = false,
  onPress,
}: {
  available: number | null;
  loading?: boolean;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  const content = (
    <View style={[styles.pill, { borderColor: colors.accentBorder, backgroundColor: colors.accentSoft }]}>
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Text style={[styles.text, { color: colors.text }]}>
          {placeFindBalanceLabel(available ?? 0)}
        </Text>
      )}
    </View>
  );
  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${placeFindBalanceLabel(available ?? 0)}. View place find packs`}
      style={({ pressed }) => [{ opacity: pressed ? 0.72 : 1 }]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: Spacing.md,
  },
  text: { fontSize: 14, fontWeight: '700' },
});

