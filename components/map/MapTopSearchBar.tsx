/** Compact search entry; local saved search remains available offline. */

import { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

type Props = {
  onPress: () => void;
  placeholder?: string;
  /** Offline mode keeps local memories searchable and disables discovery requests. */
  offline?: boolean;
};

/** Copy shown in place of the normal prompt while offline. */
export const OFFLINE_SEARCH_PLACEHOLDER = 'Search your saved places offline';

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
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.bar,
        pressed && !offline && styles.barPressed,
      ]}
    >
      <Feather
        name="search"
        size={22}
        color={colors.text}
      />
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
      height: 44,
      width: 44,
      justifyContent: 'center',
      borderRadius: Radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 2 },
      elevation: 2,
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
