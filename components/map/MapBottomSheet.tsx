import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useReduceMotion } from '@/lib/useReduceMotion';
import { useTheme } from '@/lib/theme';
import type { NearbyLocationState, NearbyPlace } from '@/hooks/useNearbyPlaces';
import type { SavedPlaceWithPlace } from '@/types';
import { MemoizedSavedPlacesLibrary } from './SavedPlacesLibrary';
import { ShareQueueButton } from './ShareQueueButton';

export type MapSheetMode = 'nearby' | 'recent' | 'saved';
export type SheetSnap = 'minimized' | 'partial' | 'full';
type Props = {
  mode: MapSheetMode; loading: boolean; nearbyPlaces: NearbyPlace[];
  locationState: NearbyLocationState; recentPlaces: SavedPlaceWithPlace[];
  savedPlaces: SavedPlaceWithPlace[]; partialHeight: number; availableHeight: number;
  topInset: number; bottomInset?: number; openSignal?: number; minimizeSignal?: number;
  onSnapChange?: (snap: SheetSnap, visibleHeight: number) => void;
  onRequestSavedMode: () => void; onSelectPlace: (place: SavedPlaceWithPlace) => void;
  onGetDirections: (place: SavedPlaceWithPlace) => void;
  onSaveFromLink: () => void; onSearchManually: () => void;
  requestLocationPermission: () => Promise<boolean>; offline?: boolean;
};
export function getSheetPartialHeight(areaHeight: number, fontScale = 1, compactWidth = false): number {
  const base = compactWidth ? 160 : 144;
  return Math.min(Math.round(areaHeight * 0.4), Math.round(base * Math.max(1, fontScale)));
}
const MINIMIZED_VISIBLE = 58;
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

/** A small memory peek opens into the existing full, virtualized Saved library. */
export function MapBottomSheet({ mode, loading, nearbyPlaces, locationState, savedPlaces,
  partialHeight, availableHeight, topInset, bottomInset = 0, openSignal, minimizeSignal,
  onSnapChange, onRequestSavedMode, onSelectPlace, onSaveFromLink, onSearchManually,
  requestLocationPermission, offline = false }: Props) {
  const { colors, typography } = useTheme();
  const router = useRouter();
  const reducedMotion = useReduceMotion();
  const expandedHeight = Math.max(partialHeight, availableHeight - topInset - bottomInset);
  const collapsedOffset = Math.max(0, expandedHeight - partialHeight);
  const hiddenOffset = Math.max(collapsedOffset, expandedHeight - MINIMIZED_VISIBLE);
  const snapOffset = useCallback((snap: SheetSnap) => snap === 'full' ? 0 : snap === 'minimized' ? hiddenOffset : collapsedOffset, [collapsedOffset, hiddenOffset]);
  const snapHeight = useCallback((snap: SheetSnap) => snap === 'full' ? expandedHeight : snap === 'minimized' ? MINIMIZED_VISIBLE : partialHeight, [expandedHeight, partialHeight]);
  const translateY = useRef(new Animated.Value(collapsedOffset)).current;
  const snapRef = useRef<SheetSnap>('partial');
  const dragStartRef = useRef(collapsedOffset);
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const snapTo = useCallback((snap: SheetSnap) => {
    snapRef.current = snap; setExpanded(snap === 'full'); setMinimized(snap === 'minimized'); onSnapChange?.(snap, snapHeight(snap));
    if (reducedMotion) translateY.setValue(snapOffset(snap));
    else Animated.spring(translateY, { toValue: snapOffset(snap), useNativeDriver: true, bounciness: 0, speed: 18 }).start();
  }, [onSnapChange, reducedMotion, snapHeight, snapOffset, translateY]);
  useEffect(() => { translateY.setValue(snapOffset(snapRef.current)); onSnapChange?.(snapRef.current, snapHeight(snapRef.current)); }, [onSnapChange, snapHeight, snapOffset, translateY]);
  useEffect(() => { if (openSignal === undefined) return; if (mode === 'saved') snapTo('full'); else if (snapRef.current === 'minimized') snapTo('partial'); }, [openSignal]);
  useEffect(() => { if (minimizeSignal !== undefined && minimizeSignal > 0) snapTo('minimized'); }, [minimizeSignal]);
  const openSaved = useCallback(() => { onRequestSavedMode(); snapTo('full'); }, [onRequestSavedMode, snapTo]);
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5 && Math.abs(g.dy) > Math.abs(g.dx),
    onPanResponderGrant: () => translateY.stopAnimation((value: number) => { dragStartRef.current = value; }),
    onPanResponderMove: (_, g) => translateY.setValue(clamp(dragStartRef.current + g.dy, 0, hiddenOffset)),
    onPanResponderRelease: (_, g) => {
      const projected = clamp(dragStartRef.current + g.dy + g.vy * 100, 0, hiddenOffset);
      const target = (['full', 'partial', 'minimized'] as SheetSnap[]).reduce((best, next) => Math.abs(projected - snapOffset(next)) < Math.abs(projected - snapOffset(best)) ? next : best, 'partial');
      if (target === 'full') onRequestSavedMode(); snapTo(target);
    }, onPanResponderTerminate: () => snapTo(snapRef.current),
  }), [hiddenOffset, onRequestSavedMode, snapOffset, snapTo, translateY]);
  return <View pointerEvents="box-none" style={[styles.clip, { bottom: bottomInset, height: expandedHeight }, expanded && styles.expanded]}><Animated.View style={[styles.sheet, { height: expandedHeight, backgroundColor: colors.surface, borderColor: colors.border, transform: [{ translateY }] }]}>
    <View {...pan.panHandlers}>
      <Pressable onPress={() => expanded ? snapTo('partial') : openSaved()} hitSlop={10} accessibilityRole="button" accessibilityLabel={expanded ? 'Return to map' : 'Open saved places'} style={styles.handleTarget}><View style={[styles.handle, { backgroundColor: colors.border }]} /></Pressable>
      {expanded ? <View style={styles.header}>
        <View style={styles.flex}><Text style={typography.title} accessibilityRole="header">Your places</Text><Text style={typography.caption}>{offline ? 'Offline · ' : ''}{savedPlaces.length} {savedPlaces.length === 1 ? 'place' : 'places'} to come back to</Text></View>
        <ShareQueueButton />
        <Pressable onPress={() => router.push('/(tabs)/settings')} accessibilityRole="button" accessibilityLabel="Account and Settings" style={[styles.icon, { backgroundColor: colors.surfaceElevated }]}><Feather name="user" size={22} color={colors.text} /></Pressable>
      </View> : null}
    </View>
    {expanded ? <MemoizedSavedPlacesLibrary savedPlaces={savedPlaces} nearbyPlaces={nearbyPlaces} locationState={locationState} loading={loading} requestLocationPermission={requestLocationPermission} onSelectPlace={onSelectPlace} onSaveFromLink={onSaveFromLink} onSearchManually={onSearchManually} /> :
      <Pressable onPress={openSaved} accessibilityRole="button" accessibilityLabel={`Open Saved, ${savedPlaces.length} places`} style={styles.peek}>
        {minimized ? <Text style={typography.label}>{savedPlaces.length} saved {savedPlaces.length === 1 ? 'place' : 'places'} · Open Saved</Text> : <>
        <Text style={[styles.eyebrow, { color: colors.accent }]}>{offline ? 'SAVED ON THIS PHONE' : 'SAVED FOR SOMEDAY'}</Text>
        <View style={styles.peekTitle}><Text style={[typography.heading, styles.flex]}>{savedPlaces.length ? `${savedPlaces.length} ${savedPlaces.length === 1 ? 'place. A new possibility.' : 'places. So many possibilities.'}` : loading ? 'Your world is coming into view' : 'Your next memory starts here.'}</Text><Feather name="arrow-up-right" size={22} color={colors.text} /></View>
        <Text style={[typography.caption, { marginTop: 4 }]}>{savedPlaces.length ? 'A little inspiration, everywhere.' : 'Share a post or find a place to save.'}</Text>
        </>}
      </Pressable>}
  </Animated.View></View>;
}
const styles = StyleSheet.create({
  clip: { position: 'absolute', left: 16, right: 16, borderRadius: 28, overflow: 'hidden' },
  sheet: { position: 'absolute', left: 0, right: 0, top: 0, borderRadius: 28, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  expanded: { left: 0, right: 0, borderBottomLeftRadius: 0, borderBottomRightRadius: 0 }, handleTarget: { height: 24, alignItems: 'center', justifyContent: 'center' }, handle: { width: 36, height: 4, borderRadius: 999 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 16 }, flex: { flex: 1 }, icon: { width: 44, height: 44, borderRadius: 999, alignItems: 'center', justifyContent: 'center' },
  peek: { paddingHorizontal: 20, paddingBottom: 16 }, eyebrow: { fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 1.2, marginBottom: 8 }, peekTitle: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
