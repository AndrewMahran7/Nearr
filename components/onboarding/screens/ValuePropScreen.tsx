import { useEffect, useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { InstagramReelMock, NearrAppIcon } from '../demo';
import { OnboardingColors, OnboardingRadius } from '../theme';
import { ScreenHeading } from './ScreenHeading';

const ORB = 70;

/**
 * Screen 1 of 5 — Value proposition.
 *
 * Shows the core transformation: a social post → Nearr → a saved map pin. The
 * three nodes are sized from the viewport width so the row scales up on larger
 * iPhones but never clips on small ones.
 */
export function ValuePropScreen() {
  const { width } = useWindowDimensions();
  const reelEntrance = useRef(new Animated.Value(0)).current;
  const transformPulse = useRef(new Animated.Value(0)).current;
  const pinEntrance = useRef(new Animated.Value(0)).current;

  const compositionWidth = Math.min(300, width - Spacing.lg * 2);
  const reelWidth = Math.round(compositionWidth * 0.58);
  const mapWidth = Math.round(compositionWidth * 0.62);
  const mapTileHeight = Math.round(mapWidth * 0.47);

  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        reelEntrance.setValue(1);
        transformPulse.setValue(1);
        pinEntrance.setValue(1);
        return;
      }

      Animated.sequence([
        Animated.timing(reelEntrance, {
          toValue: 1,
          duration: 280,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.sequence([
          Animated.timing(transformPulse, {
            toValue: 1,
            duration: 300,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(transformPulse, {
            toValue: 0.82,
            duration: 140,
            useNativeDriver: true,
          }),
          Animated.spring(transformPulse, {
            toValue: 1,
            friction: 5,
            tension: 90,
            useNativeDriver: true,
          }),
        ]),
        Animated.spring(pinEntrance, {
          toValue: 1,
          friction: 6,
          tension: 90,
          useNativeDriver: true,
        }),
      ]).start();
    });

    return () => {
      cancelled = true;
    };
  }, [pinEntrance, reelEntrance, transformPulse]);

  const reelTranslate = reelEntrance.interpolate({ inputRange: [0, 1], outputRange: [-10, 0] });
  const pulseScale = transformPulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] });
  const pinTranslate = pinEntrance.interpolate({ inputRange: [0, 1], outputRange: [-14, 0] });
  const pinScale = pinEntrance.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.3, 1.15, 1] });

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Turn places you see online into pins on your map"
        subtext="Share a restaurant, hike, hotel, or coffee shop from Instagram or TikTok. Nearr finds the place and saves it for later."
      />

      <View style={[styles.hero, { width: compositionWidth }]}>
        <Animated.View
          style={[
            styles.reelNode,
            { opacity: reelEntrance, transform: [{ translateY: reelTranslate }] },
          ]}
        >
          <InstagramReelMock width={reelWidth} compact />
        </Animated.View>

        <Animated.View
          style={[
            styles.path,
            { opacity: transformPulse, transform: [{ rotate: '-8deg' }, { scale: pulseScale }] },
          ]}
        />

        <Animated.View
          style={[styles.orbOuter, { opacity: transformPulse, transform: [{ scale: pulseScale }] }]}
        >
          <NearrAppIcon size={54} />
        </Animated.View>

        <MapPinCard
          width={mapWidth}
          tileHeight={mapTileHeight}
          pinOpacity={pinEntrance}
          pinTranslate={pinTranslate}
          pinScale={pinScale}
        />
      </View>
    </View>
  );
}

/** Right node: a compact saved-place card with a mini map + pin. */
function MapPinCard({
  width,
  tileHeight,
  pinOpacity,
  pinTranslate,
  pinScale,
}: {
  width: number;
  tileHeight: number;
  pinOpacity: Animated.Value;
  pinTranslate: Animated.AnimatedInterpolation<string | number>;
  pinScale: Animated.AnimatedInterpolation<string | number>;
}) {
  return (
    <View style={[styles.mapCard, { width }]}>
      <View style={[styles.mapTile, { height: tileHeight }]}>
        <View style={styles.mapRoadA} />
        <View style={styles.mapRoadB} />
        <Animated.View
          style={{ opacity: pinOpacity, transform: [{ translateY: pinTranslate }, { scale: pinScale }] }}
        >
          <Feather name="map-pin" size={28} color={OnboardingColors.orange} />
        </Animated.View>
      </View>
      <View style={styles.mapInfo}>
        <Text style={styles.mapName} numberOfLines={1}>
          Allpress Espresso
        </Text>
        {/* City, never a distance — onboarding does not know where the user is. */}
        <Text style={styles.mapMeta} numberOfLines={1}>
          Coffee shop · Tokyo
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  hero: {
    position: 'relative',
    alignSelf: 'center',
    height: 282,
    marginTop: 8,
  },
  reelNode: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 1,
  },
  path: {
    position: 'absolute',
    left: '34%',
    top: 104,
    width: '50%',
    height: 102,
    borderRightWidth: 2,
    borderBottomWidth: 2,
    borderColor: 'rgba(255, 107, 0, 0.58)',
    borderRadius: 72,
  },
  orbOuter: {
    position: 'absolute',
    left: '38%',
    top: 112,
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: 'rgba(255, 107, 0, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  mapCard: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
    overflow: 'hidden',
    zIndex: 2,
  },
  mapTile: {
    backgroundColor: '#0E0E11',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  mapRoadA: {
    position: 'absolute',
    width: '170%',
    height: 7,
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ rotate: '26deg' }],
  },
  mapRoadB: {
    position: 'absolute',
    width: '170%',
    height: 7,
    backgroundColor: 'rgba(255,255,255,0.05)',
    transform: [{ rotate: '-42deg' }],
  },
  mapInfo: {
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  mapName: {
    color: OnboardingColors.text,
    fontSize: 12,
    fontWeight: '700',
  },
  mapMeta: {
    color: OnboardingColors.textMuted,
    fontSize: 11,
    marginTop: 2,
  },
});
