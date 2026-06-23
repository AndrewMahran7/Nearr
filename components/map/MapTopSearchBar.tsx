/**
 * MapTopSearchBar — floating, pill-shaped entry point at the top of the
 * map-first screen.
 *
 * Phase 1: this is intentionally NOT a real text input. It looks like a
 * search field but behaves as a single Pressable that opens an existing flow
 * (save-from-link / search-manually). The real in-map search experience lands
 * in a later phase. Keeping it a button avoids wiring a keyboard/search system
 * before the bottom sheet exists.
 */

import { useMemo } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  onPress: () => void;
  placeholder?: string;
};

export function MapTopSearchBar({
  onPress,
  placeholder = 'Search for a place',
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="search"
      accessibilityLabel={placeholder}
      style={({ pressed }) => [styles.bar, pressed && styles.barPressed]}
    >
      <Feather name="search" size={18} color={colors.textSecondary} />
      <Text style={styles.placeholder} numberOfLines={1}>
        {placeholder}
      </Text>
    </Pressable>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      height: 50,
      paddingLeft: Spacing.md,
      paddingRight: Spacing.xs,
      borderRadius: Radius.pill,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 5,
    },
    barPressed: {
      borderColor: colors.primary,
    },
    placeholder: {
      ...typography.body,
      flex: 1,
      color: colors.textSecondary,
    },
  });
}
