import { StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingFeatureCard } from '..';
import { OnboardingColors, OnboardingRadius } from '../theme';
import { ScreenHeading } from './ScreenHeading';

const FEATURES: {
  icon: keyof typeof Feather.glyphMap;
  title: string;
  subtitle: string;
}[] = [
  {
    icon: 'bell',
    title: 'Nearby reminders',
    subtitle: 'Get a quiet ping when you\'re close to a saved place.',
  },
  {
    icon: 'clock',
    title: 'Remember old saves',
    subtitle: 'Places you saved months ago resurface at the right moment.',
  },
  {
    icon: 'navigation',
    title: 'Open directions fast',
    subtitle: 'Jump straight to directions when you decide to go.',
  },
];

/**
 * Screen 4 — Nearby Reminders.
 *
 * Native "dark map" card with glowing orange pins, a user-location dot, and a
 * notification bubble, followed by the three value-prop feature cards.
 */
export function NearbyRemindersScreen() {
  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Get reminded when you're nearby"
        subtext="Nearr can notify you when you're close to places you saved, so they don't get forgotten."
      />

      {/* Mock map card. */}
      <View style={styles.mapCard}>
        <View style={[styles.road, styles.roadH1]} />
        <View style={[styles.road, styles.roadH2]} />
        <View style={[styles.road, styles.roadV1]} />

        <Pin style={styles.pin1} />
        <Pin style={styles.pin2} />
        <Pin style={styles.pin3} />

        <View style={styles.userDot}>
          <View style={styles.userDotCore} />
        </View>

        <View style={styles.bubble}>
          <Feather name="bell" size={14} color={OnboardingColors.orange} />
          <Text style={styles.bubbleText}>You&apos;re near 3 saved spots</Text>
        </View>
      </View>

      <View style={styles.features}>
        {FEATURES.map((f) => (
          <OnboardingFeatureCard
            key={f.title}
            icon={f.icon}
            title={f.title}
            subtitle={f.subtitle}
          />
        ))}
      </View>
    </View>
  );
}

function Pin({ style }: { style: object }) {
  return (
    <View style={[styles.pin, style]}>
      <View style={styles.pinGlow} />
      <Feather name="map-pin" size={22} color={OnboardingColors.orange} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  mapCard: {
    height: 200,
    borderRadius: OnboardingRadius.card,
    backgroundColor: OnboardingColors.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  road: {
    position: 'absolute',
    backgroundColor: OnboardingColors.border,
    opacity: 0.7,
  },
  roadH1: { left: 0, right: 0, top: '32%', height: 3 },
  roadH2: { left: 0, right: 0, top: '70%', height: 3 },
  roadV1: { top: 0, bottom: 0, left: '55%', width: 3 },
  pin: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinGlow: {
    position: 'absolute',
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(255, 107, 0, 0.18)',
  },
  pin1: { top: '20%', left: '22%' },
  pin2: { top: '48%', left: '64%' },
  pin3: { top: '74%', left: '34%' },
  userDot: {
    position: 'absolute',
    top: '54%',
    left: '30%',
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(59, 130, 246, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userDotCore: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#3B82F6',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  bubble: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: Spacing.sm,
    paddingHorizontal: Spacing.md,
    borderRadius: OnboardingRadius.pill,
    backgroundColor: OnboardingColors.cardElevated,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
  },
  bubbleText: {
    color: OnboardingColors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  features: {
    gap: Spacing.md,
  },
});
