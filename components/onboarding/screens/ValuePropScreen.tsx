import { StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { InstagramReelMock } from '../demo';
import { OnboardingColors, OnboardingRadius } from '../theme';
import { ScreenHeading } from './ScreenHeading';

// Center orb + arrow footprint reserved between the two side nodes.
const ORB = 62;
const ARROW = 20;

/**
 * Screen 1 of 5 — Value proposition.
 *
 * Shows the core transformation: a social post → Nearr → a saved map pin. The
 * three nodes are sized from the viewport width so the row scales up on larger
 * iPhones but never clips on small ones.
 */
export function ValuePropScreen() {
  const { width } = useWindowDimensions();

  const available = width - Spacing.xl * 2;
  const nodeWidth = Math.max(
    82,
    Math.min(140, Math.floor((available - (ORB + ARROW * 2) - 8) / 2)),
  );
  const mapTileHeight = Math.round(nodeWidth * 0.8);

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Turn places you see online into pins on your map"
        subtext="Share a restaurant, hike, hotel, or coffee shop from Instagram or TikTok. Nearr finds the place and saves it for later."
      />

      <View style={styles.hero}>
        <InstagramReelMock width={nodeWidth} compact />

        <View style={styles.arrow}>
          <Feather name="chevrons-right" size={18} color={OnboardingColors.orange} />
        </View>

        <NearrOrb />

        <View style={styles.arrow}>
          <Feather name="chevrons-right" size={18} color={OnboardingColors.orange} />
        </View>

        <MapPinCard width={nodeWidth} tileHeight={mapTileHeight} />
      </View>
    </View>
  );
}

/** Brand mark node: an orange orb with the Nearr pin. */
function NearrOrb() {
  return (
    <View style={styles.orbOuter}>
      <View style={styles.orbInner}>
        <Feather name="map-pin" size={24} color={OnboardingColors.onOrange} />
      </View>
    </View>
  );
}

/** Right node: a compact saved-place card with a mini map + pin. */
function MapPinCard({ width, tileHeight }: { width: number; tileHeight: number }) {
  return (
    <View style={[styles.mapCard, { width }]}>
      <View style={[styles.mapTile, { height: tileHeight }]}>
        <View style={styles.mapRoadA} />
        <View style={styles.mapRoadB} />
        <Feather name="map-pin" size={22} color={OnboardingColors.orange} />
      </View>
      <View style={styles.mapInfo}>
        <Text style={styles.mapName} numberOfLines={1}>
          Allpress Espresso
        </Text>
        <Text style={styles.mapMeta} numberOfLines={1}>
          Coffee shop · 0.3 mi
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
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
  },
  arrow: {
    width: ARROW,
    alignItems: 'center',
  },
  orbOuter: {
    width: ORB,
    height: ORB,
    borderRadius: ORB / 2,
    backgroundColor: 'rgba(255, 107, 0, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  orbInner: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: OnboardingColors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapCard: {
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
    overflow: 'hidden',
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
