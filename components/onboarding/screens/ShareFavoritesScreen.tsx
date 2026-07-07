import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingCard, OnboardingStepRow } from '..';
import { OnboardingColors, OnboardingRadius } from '../theme';
import { ScreenHeading } from './ScreenHeading';

const STEPS = [
  'Open the share sheet',
  'Tap More',
  'Add Nearr to Favorites',
] as const;

// Neutral app tiles surrounding the highlighted Nearr tile in the mock.
const NEIGHBOR_APPS: { icon: keyof typeof Feather.glyphMap }[] = [
  { icon: 'message-square' },
  { icon: 'mail' },
  { icon: 'copy' },
];

/**
 * Screen 3 — Share Favorites.
 *
 * Native mock of an iOS share sheet's app row, with the Nearr tile circled
 * in orange and starred to show where it lives once favorited.
 */
export function ShareFavoritesScreen() {
  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Make Nearr one tap away"
        subtext="Add Nearr to your share favorites so saving a place is faster next time."
      />

      {/* Mock share sheet. */}
      <OnboardingCard elevated style={styles.sheet}>
        <View style={styles.grabber} />
        <View style={styles.appRow}>
          <View style={styles.nearrTileWrap}>
            <View style={styles.nearrTile}>
              <Feather name="map-pin" size={26} color={OnboardingColors.onOrange} />
            </View>
            <View style={styles.starBadge}>
              <Feather name="star" size={12} color={OnboardingColors.onOrange} />
            </View>
            <Text style={styles.nearrLabel}>Nearr</Text>
          </View>

          {NEIGHBOR_APPS.map((app, index) => (
            <View key={index} style={styles.neighborWrap}>
              <View style={styles.neighborTile}>
                <Feather name={app.icon} size={22} color={OnboardingColors.textMuted} />
              </View>
              <View style={styles.neighborLabel} />
            </View>
          ))}
        </View>
      </OnboardingCard>

      <OnboardingCard style={styles.steps}>
        {STEPS.map((step, index) => (
          <OnboardingStepRow key={step} number={index + 1} title={step} />
        ))}
      </OnboardingCard>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  sheet: {
    marginBottom: Spacing.lg,
    paddingTop: Spacing.md,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: OnboardingColors.border,
    marginBottom: Spacing.lg,
  },
  appRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: Spacing.xs,
  },
  nearrTileWrap: {
    alignItems: 'center',
    width: 64,
  },
  nearrTile: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: OnboardingColors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: OnboardingColors.orange,
    shadowColor: OnboardingColors.orange,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
  },
  starBadge: {
    position: 'absolute',
    top: -6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: OnboardingColors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: OnboardingColors.cardElevated,
  },
  nearrLabel: {
    color: OnboardingColors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  neighborWrap: {
    alignItems: 'center',
    width: 64,
  },
  neighborTile: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: OnboardingColors.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  neighborLabel: {
    width: 32,
    height: 8,
    borderRadius: 4,
    backgroundColor: OnboardingColors.border,
    marginTop: Spacing.sm,
  },
  steps: {
    gap: 2,
  },
});
