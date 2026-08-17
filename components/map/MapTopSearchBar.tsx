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
  /**
   * True when Nearr cannot reach its server. Place search is a Google Places
   * lookup with no offline equivalent, so the entry point is disabled rather
   * than opened into a dropdown that could only ever fail. Disabling HERE is
   * what guarantees no remote search request is attempted offline.
   */
  offline?: boolean;
};

/** Copy shown in place of the normal prompt while offline. */
export const OFFLINE_SEARCH_PLACEHOLDER = 'Search unavailable offline';

export function MapTopSearchBar({
  onPress,
  placeholder = 'Search for a place',
  offline = false,
}: Props) {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const label = offline ? OFFLINE_SEARCH_PLACEHOLDER : placeholder;

  return (
    <Pressable
      onPress={offline ? undefined : onPress}
      disabled={offline}
      accessibilityRole="search"
      accessibilityLabel={label}
      accessibilityState={{ disabled: offline }}
      style={({ pressed }) => [
        styles.bar,
        pressed && !offline && styles.barPressed,
        offline && styles.barOffline,
      ]}
    >
      <Feather
        name={offline ? 'wifi-off' : 'search'}
        size={18}
        color={colors.textSecondary}
      />
      <Text style={styles.placeholder} numberOfLines={1}>
        {label}
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
    barOffline: {
      opacity: 0.6,
    },
    placeholder: {
      ...typography.body,
      flex: 1,
      color: colors.textSecondary,
    },
  });
}
