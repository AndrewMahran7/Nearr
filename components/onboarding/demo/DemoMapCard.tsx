import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { OnboardingColors, OnboardingRadius } from '../theme';

type Props = {
  name?: string;
  detail?: string;
  /** Fired once when the pin animates in (for analytics). */
  onPinShown?: () => void;
  style?: ViewStyle;
};

/**
 * Screen 5 illustration — a stylized dark map with a selected orange pin that
 * drops/scales into place on appear, plus a saved-place result panel. Drawn
 * entirely with native views.
 *
 * This is deliberately NOT the real map: no Google Maps SDK, no location, no
 * permission. The "Remind me when nearby" row is illustrative only.
 */
export function DemoMapCard({
  name = 'Allpress Espresso',
  detail = 'Saved · 0.3 mi away',
  onPinShown,
  style,
}: Props) {
  const drop = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const shownRef = useRef(false);

  useEffect(() => {
    if (!shownRef.current) {
      shownRef.current = true;
      onPinShown?.();
    }

    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        drop.setValue(1);
        glow.setValue(1);
        return;
      }
      Animated.parallel([
        Animated.spring(drop, {
          toValue: 1,
          friction: 5,
          tension: 90,
          delay: 120,
          useNativeDriver: true,
        }),
        Animated.timing(glow, {
          toValue: 1,
          duration: 600,
          delay: 220,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]).start();
    });
    return () => {
      cancelled = true;
    };
  }, [drop, glow, onPinShown]);

  const pinTranslate = drop.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] });
  const pinScale = drop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.4, 1.1, 1] });

  return (
    <View style={[styles.card, style]}>
      {/* Map area */}
      <View style={styles.map}>
        <View style={[styles.road, styles.roadA]} />
        <View style={[styles.road, styles.roadB]} />
        <View style={[styles.road, styles.roadC]} />
        <View style={[styles.roadThin, styles.roadD]} />

        <Animated.View style={[styles.glowOuter, { opacity: glow }]} />
        <Animated.View style={[styles.glowInner, { opacity: glow }]} />
        <Animated.View
          style={[styles.pin, { transform: [{ translateY: pinTranslate }, { scale: pinScale }] }]}
        >
          <Feather name="map-pin" size={40} color={OnboardingColors.orange} />
        </Animated.View>
      </View>

      {/* Result panel */}
      <View style={styles.panel}>
        <View style={styles.grabber} />

        <View style={styles.placeRow}>
          <View style={styles.bookmarkCircle}>
            <Feather name="bookmark" size={18} color={OnboardingColors.orange} />
          </View>
          <View style={styles.placeText}>
            <Text style={styles.placeName} numberOfLines={1}>
              {name}
            </Text>
            <View style={styles.savedRow}>
              <Feather name="bookmark" size={12} color={OnboardingColors.orange} />
              <Text style={styles.placeDetail} numberOfLines={1}>
                {detail}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.reminderRow}>
          <Feather name="bell" size={16} color={OnboardingColors.orange} />
          <Text style={styles.reminderText}>Remind me when nearby</Text>
          <Feather name="chevron-right" size={18} color={OnboardingColors.textMuted} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
    overflow: 'hidden',
  },
  map: {
    height: 260,
    backgroundColor: '#0E0E11',
    alignItems: 'center',
    justifyContent: 'center',
  },
  road: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    height: 10,
    width: '160%',
    borderRadius: 2,
  },
  roadThin: {
    position: 'absolute',
    backgroundColor: 'rgba(255, 255, 255, 0.04)',
    height: 6,
    width: '160%',
    borderRadius: 2,
  },
  roadA: { transform: [{ rotate: '24deg' }, { translateY: -46 }] },
  roadB: { transform: [{ rotate: '-18deg' }, { translateY: 40 }] },
  roadC: { transform: [{ rotate: '68deg' }] },
  roadD: { transform: [{ rotate: '-64deg' }, { translateX: 40 }] },
  glowOuter: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: 'rgba(255, 107, 0, 0.08)',
  },
  glowInner: {
    position: 'absolute',
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: 'rgba(255, 107, 0, 0.16)',
  },
  pin: {
    marginBottom: 6,
  },
  panel: {
    backgroundColor: OnboardingColors.cardElevated,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: OnboardingColors.border,
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 5,
    borderRadius: 999,
    backgroundColor: OnboardingColors.border,
    marginBottom: 12,
  },
  placeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  bookmarkCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeText: {
    flex: 1,
  },
  placeName: {
    color: OnboardingColors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginTop: 3,
  },
  placeDetail: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
  },
  reminderText: {
    flex: 1,
    color: OnboardingColors.text,
    fontSize: 14,
    fontWeight: '600',
  },
});
