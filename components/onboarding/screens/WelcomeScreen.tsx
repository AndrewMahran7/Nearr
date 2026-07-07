import { StyleSheet, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { OnboardingColors } from '../theme';
import { ScreenHeading } from './ScreenHeading';

/**
 * Screen 1 — Welcome.
 *
 * Visual is a native "glowing orange orb" (layered translucent circles) with
 * a map pin at the center and small social/place icons floating around it.
 * No image asset — pure shapes + Feather icons.
 */
export function WelcomeScreen() {
  return (
    <View style={styles.container}>
      <View style={styles.visual}>
        <View style={styles.glowOuter} />
        <View style={styles.glowInner} />
        <View style={styles.orb}>
          <Feather name="map-pin" size={44} color={OnboardingColors.onOrange} />
        </View>

        {/* Floating source/place icons around the orb. */}
        <FloatingIcon icon="instagram" style={styles.iconTopLeft} />
        <FloatingIcon icon="video" style={styles.iconTopRight} />
        <FloatingIcon icon="coffee" style={styles.iconBottomLeft} />
        <FloatingIcon icon="map" style={styles.iconBottomRight} />
      </View>

      <ScreenHeading
        headline="Save places from social media"
        subtext="Turn restaurants, hikes, hotels, coffee shops, and spots you see online into saved places on your map."
      />
    </View>
  );
}

function FloatingIcon({
  icon,
  style,
}: {
  icon: keyof typeof Feather.glyphMap;
  style: object;
}) {
  return (
    <View style={[styles.floatingIcon, style]}>
      <Feather name={icon} size={18} color={OnboardingColors.orange} />
    </View>
  );
}

const ORB = 120;
const GLOW_INNER = 180;
const GLOW_OUTER = 240;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  visual: {
    height: 280,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.xl,
  },
  glowOuter: {
    position: 'absolute',
    width: GLOW_OUTER,
    height: GLOW_OUTER,
    borderRadius: GLOW_OUTER / 2,
    backgroundColor: 'rgba(255, 107, 0, 0.06)',
  },
  glowInner: {
    position: 'absolute',
    width: GLOW_INNER,
    height: GLOW_INNER,
    borderRadius: GLOW_INNER / 2,
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
  },
  orb: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: OnboardingColors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: OnboardingColors.orange,
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 0 },
    elevation: 12,
  },
  floatingIcon: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: OnboardingColors.cardElevated,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconTopLeft: { top: 30, left: 40 },
  iconTopRight: { top: 20, right: 44 },
  iconBottomLeft: { bottom: 30, left: 30 },
  iconBottomRight: { bottom: 24, right: 36 },
});
