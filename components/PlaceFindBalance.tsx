import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { placeFindBalanceLabel } from '@/lib/placeFindConfig';
import { useTheme } from '@/lib/theme';
import { TokenSymbol } from '@/components/TokenSymbol';

export function PlaceFindBalance({
  available,
  loading = false,
}: {
  available: number | null;
  loading?: boolean;
}) {
  const { colors } = useTheme();
  const count = Math.max(0, Math.floor(available ?? 0));
  return (
    <View
      style={styles.balance}
      accessible
      accessibilityLabel={placeFindBalanceLabel(count)}
      accessibilityLiveRegion="polite"
    >
      {loading ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <>
          <Text style={[styles.number, { color: colors.text }]}>{count}</Text>
          <TokenSymbol size={16} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  balance: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 7,
  },
  number: { fontSize: 24, lineHeight: 29, fontWeight: '800', fontVariant: ['tabular-nums'] },
});

