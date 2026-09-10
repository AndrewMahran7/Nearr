import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Image, StyleSheet, Text, View } from 'react-native';
import { Feather, Ionicons } from '@expo/vector-icons';

import { Phase1Colors } from './Phase1Visuals';
import type { OnboardingInterest, OnboardingPlatform } from '@/lib/onboardingV2Core';

export function useOnboardingReduceMotion(): boolean {
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (mounted) setReduceMotion(value); });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => { mounted = false; subscription.remove(); };
  }, []);
  return reduceMotion;
}

export function platformIcon(platform: OnboardingPlatform | null): keyof typeof Ionicons.glyphMap {
  if (platform === 'instagram') return 'logo-instagram';
  if (platform === 'tiktok') return 'logo-tiktok';
  if (platform === 'facebook') return 'logo-facebook';
  if (platform === 'youtube') return 'logo-youtube';
  return 'compass-outline';
}

export function NearrSparkleMark({ size = 76 }: { size?: number }) {
  return (
    <View style={[styles.sparkleWrap, { width: size + 34, height: size + 28 }]} accessible accessibilityLabel="Nearr sparkle pin">
      <View style={[styles.sparkleHalo, { width: size + 18, height: size + 18, borderRadius: (size + 18) / 2 }]} />
      <Image source={require('../../../assets/icon.png')} style={{ width: size, height: size, borderRadius: size * 0.27 }} />
      <Feather name="star" size={18} color={Phase1Colors.orange} style={styles.sparkleOne} />
      <Feather name="star" size={12} color="#FF9D65" style={styles.sparkleTwo} />
    </View>
  );
}

export function SocialToMapIllustration({
  platform = null,
  interest = null,
}: {
  platform?: OnboardingPlatform | null;
  interest?: OnboardingInterest | null;
}) {
  const reduceMotion = useOnboardingReduceMotion();
  const float = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { float.setValue(0); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(float, { toValue: 1, duration: 1450, useNativeDriver: true }),
      Animated.timing(float, { toValue: 0, duration: 1450, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [float, reduceMotion]);
  const lift = float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  const label = interestLabel(interest);
  return (
    <View style={styles.storyVisual} accessible accessibilityLabel={`${label} posts becoming saved places on a personal map`}>
      <Animated.View style={[styles.postCard, styles.postCardBack, { transform: [{ translateY: lift }, { rotate: '-7deg' }] }]}>
        <View style={styles.postSky} /><View style={styles.postLand} />
        <View style={styles.postMeta}><Feather name="play" size={12} color="#FFFFFF" /><Text style={styles.postMetaText}>A place in your feed</Text></View>
      </Animated.View>
      <Animated.View style={[styles.postCard, styles.postCardFront, { transform: [{ translateY: lift }, { rotate: '4deg' }] }]}>
        <View style={styles.postSun} /><View style={styles.postWater} />
        <View style={styles.platformChip}><Ionicons name={platformIcon(platform)} size={15} color="#FFFFFF" /><Text style={styles.platformChipText}>{platform ? platformLabel(platform) : 'YOUR FEED'}</Text></View>
      </Animated.View>
      <View style={styles.travelPath}><View style={styles.pathDot} /><View style={styles.pathDot} /><View style={styles.pathDot} /></View>
      <View style={styles.centerPin}><Image source={require('../../../assets/icon.png')} style={styles.centerPinImage} /><Feather name="star" size={13} color={Phase1Colors.orange} style={styles.centerStar} /></View>
      <View style={styles.mapCard}>
        <View style={styles.mapRoadOne} /><View style={styles.mapRoadTwo} />
        <View style={styles.mapPin}><Feather name="map-pin" size={18} color="#FFFFFF" /></View>
        <Text style={styles.mapCaption}>Saved on your map</Text>
      </View>
    </View>
  );
}

export function MagicScanner({ thumbnailUrl, platform }: { thumbnailUrl: string | null; platform: OnboardingPlatform | null }) {
  const reduceMotion = useOnboardingReduceMotion();
  const scan = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduceMotion) { scan.setValue(0.48); return; }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(scan, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.timing(scan, { toValue: 0, duration: 900, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, scan]);
  const translateY = scan.interpolate({ inputRange: [0, 1], outputRange: [-104, 104] });
  return (
    <View style={styles.scanner} accessible accessibilityLabel="Nearr is looking at the post and matching it to a place">
      {thumbnailUrl ? <Image source={{ uri: thumbnailUrl }} style={styles.scannerImage} /> : <View style={styles.scannerFallback}><Ionicons name={platformIcon(platform)} size={58} color="#FFFFFF" /></View>}
      <View style={styles.scannerShade} />
      <Animated.View style={[styles.scanLine, { transform: [{ translateY }] }]} />
      <View style={styles.scanCorners}><View style={[styles.corner, styles.cornerTL]} /><View style={[styles.corner, styles.cornerTR]} /><View style={[styles.corner, styles.cornerBL]} /><View style={[styles.corner, styles.cornerBR]} /></View>
      <View style={styles.scannerPin}><Feather name="map-pin" size={22} color="#FFFFFF" /></View>
    </View>
  );
}

export function MapFormationIllustration({
  placeName,
  platform,
  interest,
}: {
  placeName: string;
  platform: OnboardingPlatform | null;
  interest: OnboardingInterest | null;
}) {
  return (
    <View style={styles.formation} accessible accessibilityLabel={`Your map with ${placeName} saved`}>
      <View style={styles.formationRoadOne} /><View style={styles.formationRoadTwo} /><View style={styles.formationRoadThree} />
      <View style={styles.realPlacePin}><Feather name="map-pin" size={21} color="#FFFFFF" /><Text style={styles.realPlaceText} numberOfLines={1}>{placeName}</Text></View>
      <View style={[styles.futurePin, styles.futureOne]}><Feather name="map-pin" size={14} color="#A39B90" /></View>
      <View style={[styles.futurePin, styles.futureTwo]}><Feather name="map-pin" size={14} color="#A39B90" /></View>
      <View style={styles.readyBadge}><Ionicons name={platformIcon(platform)} size={17} color={Phase1Colors.text} /><Text style={styles.readyBadgeText}>{interestLabel(interest)} ready</Text></View>
    </View>
  );
}

function platformLabel(platform: OnboardingPlatform): string {
  return platform === 'tiktok' ? 'TIKTOK' : platform === 'youtube' ? 'YOUTUBE' : platform === 'facebook' ? 'FACEBOOK' : platform === 'instagram' ? 'INSTAGRAM' : 'YOUR FEED';
}

function interestLabel(interest: OnboardingInterest | null): string {
  if (interest === 'outdoors' || interest === 'beaches') return 'Outdoor places';
  if (interest === 'food') return 'Food spots';
  if (interest === 'cafes') return 'Cafes';
  if (interest === 'travel') return 'Travel places';
  if (interest === 'things_to_do') return 'Things to do';
  if (interest === 'shopping') return 'Shops';
  return 'Places you love';
}

const styles = StyleSheet.create({
  sparkleWrap: { alignItems: 'center', justifyContent: 'center' },
  sparkleHalo: { position: 'absolute', backgroundColor: '#FFE7D7' },
  sparkleOne: { position: 'absolute', right: 1, top: 2 },
  sparkleTwo: { position: 'absolute', left: 2, bottom: 4 },
  storyVisual: { height: 300, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  postCard: { position: 'absolute', width: 132, height: 180, borderRadius: 24, overflow: 'hidden', backgroundColor: '#202A28', borderWidth: 5, borderColor: '#FFFFFF', shadowColor: '#49392E', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 10 }, elevation: 5 },
  postCardBack: { left: 2, top: 42 }, postCardFront: { left: 52, top: 9 },
  postSky: { height: 90, backgroundColor: '#B9D8E2' }, postLand: { flex: 1, backgroundColor: '#567A64' },
  postSun: { position: 'absolute', width: 42, height: 42, borderRadius: 21, right: 17, top: 24, backgroundColor: '#FFBF6D' },
  postWater: { flex: 1, backgroundColor: '#2D7F89' },
  postMeta: { position: 'absolute', left: 10, right: 10, bottom: 10, flexDirection: 'row', gap: 6, alignItems: 'center' },
  postMetaText: { flex: 1, color: '#FFFFFF', fontSize: 9, fontWeight: '800' },
  platformChip: { position: 'absolute', left: 9, top: 9, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, height: 28, borderRadius: 14, backgroundColor: 'rgba(20,20,20,0.76)' },
  platformChipText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  travelPath: { position: 'absolute', left: 187, top: 137, flexDirection: 'row', gap: 7 }, pathDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: '#C7BDB0' },
  centerPin: { position: 'absolute', left: 192, top: 80, width: 70, height: 70, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF', shadowColor: '#49392E', shadowOpacity: 0.16, shadowRadius: 15, elevation: 4 },
  centerPinImage: { width: 52, height: 52, borderRadius: 15 }, centerStar: { position: 'absolute', right: 2, top: 1 },
  mapCard: { position: 'absolute', right: 0, bottom: 15, width: 144, height: 148, borderRadius: 26, overflow: 'hidden', backgroundColor: '#E6EFE7', borderWidth: 5, borderColor: '#FFFFFF', shadowColor: '#49392E', shadowOpacity: 0.16, shadowRadius: 18, elevation: 4 },
  mapRoadOne: { position: 'absolute', width: 190, borderTopWidth: 2, borderColor: '#B7CABB', top: 62, left: -22, transform: [{ rotate: '-18deg' }] },
  mapRoadTwo: { position: 'absolute', height: 170, borderLeftWidth: 2, borderColor: '#C6D5C8', left: 78, top: -12, transform: [{ rotate: '28deg' }] },
  mapPin: { position: 'absolute', left: 55, top: 43, width: 34, height: 34, borderRadius: 17, backgroundColor: Phase1Colors.orange, alignItems: 'center', justifyContent: 'center' },
  mapCaption: { position: 'absolute', left: 13, right: 13, bottom: 12, color: Phase1Colors.text, fontSize: 10, fontWeight: '900', textAlign: 'center' },
  scanner: { height: 330, marginTop: 26, borderRadius: 34, overflow: 'hidden', backgroundColor: '#23322F', borderWidth: 6, borderColor: '#FFFFFF', shadowColor: '#513B2C', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 7 },
  scannerImage: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' }, scannerFallback: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#294840' }, scannerShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(12,15,14,0.22)' },
  scanLine: { position: 'absolute', left: 20, right: 20, top: '50%', height: 3, borderRadius: 2, backgroundColor: '#FF8252', shadowColor: '#FF5B24', shadowOpacity: 0.95, shadowRadius: 12 },
  scanCorners: { ...StyleSheet.absoluteFillObject }, corner: { position: 'absolute', width: 34, height: 34, borderColor: '#FFFFFF' }, cornerTL: { top: 23, left: 23, borderTopWidth: 3, borderLeftWidth: 3 }, cornerTR: { top: 23, right: 23, borderTopWidth: 3, borderRightWidth: 3 }, cornerBL: { bottom: 23, left: 23, borderBottomWidth: 3, borderLeftWidth: 3 }, cornerBR: { bottom: 23, right: 23, borderBottomWidth: 3, borderRightWidth: 3 },
  scannerPin: { position: 'absolute', right: 24, bottom: 24, width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange },
  formation: { height: 250, marginTop: 20, borderRadius: 32, overflow: 'hidden', backgroundColor: '#E5EEE6', borderWidth: 5, borderColor: '#FFFFFF', shadowColor: '#49392E', shadowOpacity: 0.12, shadowRadius: 20, elevation: 4 },
  formationRoadOne: { position: 'absolute', width: 430, borderTopWidth: 3, borderColor: '#BDCEBF', left: -50, top: 102, transform: [{ rotate: '-15deg' }] }, formationRoadTwo: { position: 'absolute', height: 330, borderLeftWidth: 2, borderColor: '#C8D7CA', left: 170, top: -50, transform: [{ rotate: '33deg' }] }, formationRoadThree: { position: 'absolute', width: 300, borderTopWidth: 1, borderColor: '#BACABB', left: 10, top: 190, transform: [{ rotate: '21deg' }] },
  realPlacePin: { position: 'absolute', left: 24, top: 126, maxWidth: 220, minHeight: 48, paddingHorizontal: 12, borderRadius: 17, backgroundColor: Phase1Colors.orange, flexDirection: 'row', alignItems: 'center', gap: 7 }, realPlaceText: { flexShrink: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  futurePin: { position: 'absolute', width: 35, height: 35, borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: '#A9A196', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.7)' }, futureOne: { right: 38, top: 48 }, futureTwo: { right: 72, bottom: 28 },
  readyBadge: { position: 'absolute', left: 18, top: 18, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 11, borderRadius: 14, backgroundColor: '#FFFFFF' }, readyBadgeText: { color: Phase1Colors.text, fontSize: 11, fontWeight: '900' },
});
