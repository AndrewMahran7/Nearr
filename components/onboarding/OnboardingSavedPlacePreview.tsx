import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingColors, OnboardingRadius } from './theme';

type Props = {
  /** Sample place name, e.g. "Blue Bottle Coffee". */
  name?: string;
  /** Category / distance line, e.g. "Coffee shop · 0.3 mi away". */
  detail?: string;
  style?: ViewStyle;
};

/**
 * Sample saved-place preview used to show new users what a saved place looks
 * like. Purely illustrative — built from native shapes and a Feather pin, no
 * image asset or real data required. A small "mini-map" tile with a pin sits
 * on the left; name, detail, and a "Saved" badge on the right.
 */
export function OnboardingSavedPlacePreview({
  name = 'Blue Bottle Coffee',
  detail = 'Coffee shop · 0.3 mi away',
  style,
}: Props) {
  return (
    <View style={[styles.card, style]}>
      <View style={styles.mapTile}>
        {/* Simple faux-map: crossing "roads" behind a center pin. */}
        <View style={styles.roadH} />
        <View style={styles.roadV} />
        <View style={styles.pin}>
          <Feather name="map-pin" size={18} color={OnboardingColors.orange} />
        </View>
      </View>

      <View style={styles.info}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <Text style={styles.detail} numberOfLines={1}>
          {detail}
        </Text>

        <View style={styles.badge}>
          <Feather name="bookmark" size={12} color={OnboardingColors.orange} />
          <Text style={styles.badgeText}>Saved</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: OnboardingColors.cardElevated,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    padding: Spacing.md,
  },
  mapTile: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: OnboardingColors.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  roadH: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '58%',
    height: 3,
    backgroundColor: OnboardingColors.border,
  },
  roadV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: '38%',
    width: 3,
    backgroundColor: OnboardingColors.border,
  },
  pin: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  info: {
    flex: 1,
  },
  name: {
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  detail: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    paddingVertical: 3,
    paddingHorizontal: 8,
    borderRadius: OnboardingRadius.pill,
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
  },
  badgeText: {
    color: OnboardingColors.orange,
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
});
