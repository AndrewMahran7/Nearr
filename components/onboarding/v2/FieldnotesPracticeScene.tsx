import { useEffect, useRef } from 'react';
import { Animated, Image, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { offlineOnboardingAsset, offlineOnboardingMedia } from '@/onboarding/assets/offlineOnboardingAssets';
import { offlineFixtureById } from '@/onboarding/fixtures/offlineOnboardingFixtures';

/** A bundled practice film: no provider, auth, map tiles or recognition request. */
export function FieldnotesPracticeScene({ fixtureId, stage, onClose }: { fixtureId: string; stage: 'receipt' | 'place'; onClose?: () => void }) {
  const { colors, typography, resolvedTheme } = useTheme();
  const reduceMotion = useReduceMotion();
  const { fontScale } = useWindowDimensions();
  const progress = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const fixture = offlineFixtureById(fixtureId);
  useEffect(() => {
    progress.setValue(reduceMotion ? 1 : 0);
    if (reduceMotion) return;
    const animation = Animated.timing(progress, { toValue: 1, duration: stage === 'place' ? 900 : 220, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [progress, reduceMotion, stage]);
  if (!fixture) return null;
  const media = offlineOnboardingMedia(fixture.assetKey);
  const destination = media.placePhotoAssets[1] ?? media.placePhotoAssets[0];
  const large = fontScale >= 1.5;
  const land = resolvedTheme === 'dark' ? '#303A31' : '#EEEBDF';
  const water = resolvedTheme === 'dark' ? '#203B42' : '#B8D5D9';
  return <View testID={`fieldnotes-practice-${stage}`} style={[styles.root, { backgroundColor: colors.surface }]}>
    <View style={[styles.map, { backgroundColor: land }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.water, { backgroundColor: water }]} />
      <View style={[styles.road, { borderColor: colors.surface }]} /><View style={[styles.road, styles.crossRoad, { borderColor: colors.surface }]} />
      <Animated.View style={[styles.pin, { backgroundColor: colors.brand, opacity: stage === 'place' ? (reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 0.55, 0.75, 1], outputRange: [0, 0, 1, 1] })) : 0, transform: [{ scale: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 0.8, 1], outputRange: [0.9, 1.06, 1] }) }] }]}><Feather name="map-pin" size={22} color={colors.onGradient} /></Animated.View>
      {stage === 'place' && !reduceMotion ? <Animated.View style={[styles.flyingSource, { opacity: progress.interpolate({ inputRange: [0, 0.6, 0.8, 1], outputRange: [1, 1, 0, 0] }), transform: [{ translateX: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-110, -70, 0] }) }, { translateY: progress.interpolate({ inputRange: [0, 0.5, 1], outputRange: [-22, -10, 72] }) }, { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [1, 0.45] }) }] }]}><Image source={offlineOnboardingAsset(fixture.assetKey)} style={styles.flyingImage} /></Animated.View> : null}
      <View style={[styles.practiceBadge, { backgroundColor: colors.surface }]}><Text style={[typography.caption, { color: colors.textSecondary }]}>Practice map</Text></View>
    </View>
    {stage === 'receipt' ? <Animated.View style={[styles.receipt, { backgroundColor: colors.surface, opacity: progress }]}>
      <Image source={require('../../../assets/icon.png')} style={styles.icon} />
      <Text accessibilityRole="header" style={typography.title}>Sent to Nearr</Text>
      <Text style={[typography.metadata, { color: colors.textSecondary }]}>A practice save, inside the app.</Text>
      <View style={[styles.sourceRow, { borderTopColor: colors.border }]}>
        <Image source={offlineOnboardingAsset(fixture.assetKey)} style={styles.sourceImage} />
        <View style={styles.sourceCopy}><Text style={typography.eyebrow}>YOUR ORIGINAL POST</Text><Text style={typography.body}>{fixture.caption}</Text></View>
      </View>
    </Animated.View> : <Animated.View style={[styles.destination, { opacity: reduceMotion ? 1 : progress.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0, 0, 1] }), backgroundColor: colors.surface, transform: [{ translateY: reduceMotion ? 0 : progress.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }] }]}>
      <Image source={destination} style={[styles.destinationPhoto, large && { height: 120 }]} resizeMode="cover" accessibilityLabel={`${fixture.place.name}, bundled destination photo`} />
      {onClose ? <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close saved place card" style={[styles.close, { backgroundColor: colors.surface }]}><Feather name="x" size={20} color={colors.text} /></Pressable> : null}
      <View style={styles.destinationCopy}>
        <Text style={typography.eyebrow}>THE PLACE, NOT JUST THE POST</Text>
        <Text accessibilityRole="header" style={typography.title}>{fixture.place.name}</Text>
        <Text style={typography.metadata}>{fixture.place.address}</Text>
        <Text style={typography.body}>{fixture.place.aiNote}</Text>
        <View style={styles.saved}><Feather name="check" size={16} color={colors.success} /><Text style={[typography.metadata, { color: colors.success }]}>Saved for this walkthrough</Text></View>
        {onClose ? <Text style={[typography.caption, { color: colors.textSecondary }]}>Close this card to keep going</Text> : null}
      </View>
    </Animated.View>}
  </View>;
}
const styles = StyleSheet.create({
  close: { position: 'absolute', right: 10, top: 10, width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  flyingSource: { position: 'absolute', left: '46%', top: 28, width: 48, height: 68, borderRadius: 8, overflow: 'hidden' }, flyingImage: { width: '100%', height: '100%' },
  root: { marginTop: 24, borderRadius: 18, overflow: 'hidden' },
  map: { height: 168, overflow: 'hidden' },
  water: { position: 'absolute', right: -90, top: -100, width: 270, height: 230, borderRadius: 90, transform: [{ rotate: '-24deg' }] },
  road: { position: 'absolute', top: 90, left: -20, width: 450, borderTopWidth: 4, transform: [{ rotate: '-22deg' }] },
  crossRoad: { top: 95, left: -60, transform: [{ rotate: '65deg' }] },
  pin: { position: 'absolute', top: 94, left: '47%', width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  practiceBadge: { position: 'absolute', top: 12, left: 12, borderRadius: 8, paddingVertical: 4, paddingHorizontal: 8 },
  receipt: { padding: 24, gap: 8, alignItems: 'center' }, icon: { width: 52, height: 52, borderRadius: 12, marginBottom: 8 },
  sourceRow: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 16, paddingTop: 16, flexDirection: 'row', gap: 12, alignItems: 'center' },
  sourceImage: { width: 48, height: 68, borderRadius: 8 }, sourceCopy: { flex: 1, gap: 4 },
  destination: { marginHorizontal: 12, marginBottom: 12, borderRadius: 12, overflow: 'hidden' },
  destinationPhoto: { width: '100%', height: 168 }, destinationCopy: { gap: 8, padding: 16 },
  saved: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
});
