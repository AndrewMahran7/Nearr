/**
 * MapBottomSheet — the partially-expanded sheet that sits above the map and
 * surfaces Nearr's place-intent content (nearby now / recently saved / saved
 * preview).
 *
 * Phase 2 implementation notes:
 *   - No new dependencies. Drag is implemented with `Animated` + `PanResponder`
 *     attached ONLY to the header/handle region, while the body is a normal
 *     `ScrollView`. This deliberately avoids the sheet-drag-vs-list-scroll
 *     gesture-arbitration problem that `@gorhom/bottom-sheet` solves — we defer
 *     that to a later phase.
 *   - Two snap points: `partial` (default) and `expanded`.
 *   - The sheet is anchored to the bottom and translated DOWN to collapse, so
 *     the map stays fully pannable in the area above the sheet.
 *   - Markers and map state live entirely in the parent; nothing here touches
 *     the marker OOM path.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button } from '@/components';
import { Radius, Spacing } from '@/constants';
import { metersToMiles } from '@/lib/geo';
import { useTheme } from '@/lib/theme';
import type { NearbyLocationState, NearbyPlace } from '@/hooks/useNearbyPlaces';
import type { SavedPlaceWithPlace } from '@/types';

import { CompactPlaceRow } from './CompactPlaceRow';
import { MemoizedSavedPlacesLibrary } from './SavedPlacesLibrary';
import { NearbyNowCard } from './NearbyNowCard';

export type MapSheetMode = 'nearby' | 'recent' | 'saved';

type Props = {
  mode: MapSheetMode;
  loading: boolean;
  nearbyPlaces: NearbyPlace[];
  locationState: NearbyLocationState;
  recentPlaces: SavedPlaceWithPlace[];
  savedPlaces: SavedPlaceWithPlace[];
  /** Visible height of the sheet in its collapsed/partial snap. */
  partialHeight: number;
  /** Total height of the map area (excludes header + tab bar). */
  availableHeight: number;
  /** Space to leave above the sheet when expanded (clears the top chrome). */
  topInset: number;
  /**
   * Bumped by the parent (e.g. when a top chip is tapped) to request the sheet
   * re-open to at least the partial snap if it was minimized.
   */
  openSignal?: number;
  /**
   * Bumped by the parent (e.g. map-level "View All") to minimize the sheet so
   * the map markers are fully visible.
   */
  minimizeSignal?: number;
  /**
   * Reports the current snap and the sheet's visible height whenever it
   * settles, so the parent can keep the floating actions attached to the
   * sheet's top edge.
   */
  onSnapChange?: (snap: SheetSnap, visibleHeight: number) => void;
  /** Called when the user opens the full saved list — parent switches to Saved mode. */
  onRequestSavedMode: () => void;
  onSelectPlace: (place: SavedPlaceWithPlace) => void;
  onGetDirections: (place: SavedPlaceWithPlace) => void;
  onSaveFromLink: () => void;
  onSearchManually: () => void;
  requestLocationPermission: () => Promise<boolean>;
};

/** Compute the collapsed/partial visible height for a given area height. */
export function getSheetPartialHeight(areaHeight: number): number {
  return Math.min(420, Math.max(300, Math.round(areaHeight * 0.44)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function distanceLabel(meters: number): string {
  const miles = metersToMiles(meters);
  if (miles < 0.1) return 'Nearby now';
  const rounded = miles >= 10 ? Math.round(miles) : Math.round(miles * 10) / 10;
  return `${rounded} mi away`;
}

// Visible height left peeking when the sheet is minimized — enough to show the
// drag handle + title row so the user can grab/tap it to restore.
const MINIMIZED_VISIBLE = 58;

// User-facing snap model: minimized (peek) / partial (default) / full.
export type SheetSnap = 'minimized' | 'partial' | 'full';

function modeTitle(mode: MapSheetMode): string {
  switch (mode) {
    case 'recent':
      return 'Recently saved';
    case 'saved':
      return 'Saved places';
    default:
      return 'Nearby now';
  }
}

export function MapBottomSheet({
  mode,
  loading,
  nearbyPlaces,
  locationState,
  recentPlaces,
  savedPlaces,
  partialHeight,
  availableHeight,
  topInset,
  openSignal,
  minimizeSignal,
  onSnapChange,
  onRequestSavedMode,
  onSelectPlace,
  onGetDirections,
  onSaveFromLink,
  onSearchManually,
  requestLocationPermission,
}: Props) {
  const { colors, typography } = useTheme();
  const insets = useSafeAreaInsets();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);

  // Expanded visible height: fill the map area but stop below the top chrome
  // (search bar + chips) so the sheet never slides under it. Never smaller
  // than the partial snap.
  const expandedHeight = useMemo(
    () => Math.max(partialHeight, Math.round(availableHeight - topInset)),
    [availableHeight, topInset, partialHeight],
  );
  // How far the sheet is translated DOWN at each snap (anchored to bottom).
  const collapsedOffset = Math.max(0, expandedHeight - partialHeight);
  // Minimized: only the handle + title peek above the bottom edge.
  const hiddenOffset = Math.max(collapsedOffset, expandedHeight - MINIMIZED_VISIBLE);

  const snapOffset = useCallback(
    (snap: SheetSnap) =>
      snap === 'full' ? 0 : snap === 'minimized' ? hiddenOffset : collapsedOffset,
    [collapsedOffset, hiddenOffset],
  );

  // Visible height of the sheet at a given snap (for the parent's floating
  // actions to follow the sheet's top edge).
  const snapVisibleHeight = useCallback(
    (snap: SheetSnap) =>
      snap === 'full' ? expandedHeight : snap === 'minimized' ? MINIMIZED_VISIBLE : partialHeight,
    [expandedHeight, partialHeight],
  );

  const translateY = useRef(new Animated.Value(collapsedOffset)).current;
  const snapRef = useRef<SheetSnap>('partial');
  const dragStartRef = useRef(collapsedOffset);
  // Reactive mirror of the snap so the body can switch between the partial
  // recommendation surface and the full "lightweight Places" surface.
  const [expanded, setExpanded] = useState(false);

  // Keep the resting position correct if the window (and thus offsets) change.
  useEffect(() => {
    translateY.setValue(snapOffset(snapRef.current));
  }, [snapOffset, translateY]);

  // Report the initial snap height to the parent on mount + when geometry
  // changes, so floating actions start attached to the partial sheet.
  useEffect(() => {
    onSnapChange?.(snapRef.current, snapVisibleHeight(snapRef.current));
  }, [onSnapChange, snapVisibleHeight]);

  const snapTo = useCallback(
    (snap: SheetSnap) => {
      snapRef.current = snap;
      setExpanded(snap === 'full');
      onSnapChange?.(snap, snapVisibleHeight(snap));
      Animated.spring(translateY, {
        toValue: snapOffset(snap),
        useNativeDriver: true,
        bounciness: 4,
      }).start();
    },
    [onSnapChange, snapOffset, snapVisibleHeight, translateY],
  );

  // When the parent signals (e.g. a top chip tap), restore a minimized sheet
  // back to partial so the new content is visible. No-op if already open.
  useEffect(() => {
    if (openSignal === undefined) return;
    if (mode === 'saved') snapTo('full');
    else if (snapRef.current === 'minimized') snapTo('partial');
    // Only react to openSignal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openSignal]);

  // Parent-driven minimize (e.g. map-level "View All").
  useEffect(() => {
    if (minimizeSignal === undefined) return;
    snapTo('minimized');
    // Only react to minimizeSignal changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minimizeSignal]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) =>
          Math.abs(g.dy) > 4 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderGrant: () => {
          translateY.stopAnimation((value: number) => {
            dragStartRef.current = value;
          });
        },
        onPanResponderMove: (_, g) => {
          const next = clamp(dragStartRef.current + g.dy, 0, hiddenOffset);
          translateY.setValue(next);
        },
        onPanResponderRelease: (_, g) => {
          // Project the release point with a little velocity lookahead, then
          // snap to the nearest of the three rest positions.
          const projected = clamp(
            dragStartRef.current + g.dy + g.vy * 120,
            0,
            hiddenOffset,
          );
          const candidates: SheetSnap[] = ['full', 'partial', 'minimized'];
          let best: SheetSnap = 'partial';
          let bestDist = Infinity;
          for (const snap of candidates) {
            const dist = Math.abs(projected - snapOffset(snap));
            if (dist < bestDist) {
              bestDist = dist;
              best = snap;
            }
          }
          snapTo(best);
        },
        onPanResponderTerminate: () => {
          snapTo(snapRef.current);
        },
      }),
    [hiddenOffset, snapOffset, snapTo, translateY],
  );

  // Tap the handle/title region (not a drag) to restore a minimized sheet.
  const handleDragRegionPress = useCallback(() => {
    if (snapRef.current === 'minimized') snapTo('partial');
  }, [snapTo]);

  const hasPlaces = savedPlaces.length > 0;

  // ----- expanded Saved Places library -------------------------------------
  const handleOpenList = useCallback(() => {
    onRequestSavedMode();
    snapTo('full');
  }, [onRequestSavedMode, snapTo]);

  // ----- content selection -------------------------------------------------
  // Dedupe across sections so a small library (esp. 1 saved place) never shows
  // the same place twice.
  const content = useMemo(() => {
    if (!hasPlaces) return null;

    if (mode === 'saved') {
      return {
        featured: null as null,
        featuredMeta: null as string | null,
        primaryRows: savedPlaces.map((p) => ({
          place: p,
          status: p.notifications_enabled ? 'Reminder on' : 'Saved',
        })),
        secondaryTitle: null as string | null,
        secondaryRows: [] as { place: SavedPlaceWithPlace; status: string }[],
        hint: null as string | null,
      };
    }

    if (mode === 'recent') {
      const shown = new Set<string>();
      const primaryRows = recentPlaces.map((p) => {
        shown.add(p.id);
        return { place: p, status: 'Saved recently' };
      });
      return {
        featured: null,
        featuredMeta: null,
        primaryRows,
        secondaryTitle: null,
        secondaryRows: [],
        hint: primaryRows.length === 0 ? 'Nothing saved recently.' : null,
      };
    }

    // mode === 'nearby'
    const compactNearby = nearbyPlaces.slice(0, 5);
    const featured = compactNearby[0] ?? null;
    const restNearby = compactNearby.slice(1);
    const shown = new Set<string>(compactNearby.map((p) => p.id));
    const recent = recentPlaces.filter((p) => !shown.has(p.id));
    return {
      featured,
      featuredMeta: featured ? distanceLabel(featured.distanceMeters) : null,
      primaryRows: restNearby.map((p) => ({
        place: p as SavedPlaceWithPlace,
        status: distanceLabel(p.distanceMeters),
      })),
      secondaryTitle: recent.length > 0 ? 'Recently saved' : null,
      secondaryRows: recent.map((p) => ({ place: p, status: 'Saved recently' })),
      hint:
        !featured && restNearby.length === 0
          ? 'No saved places nearby right now.'
          : null,
    };
  }, [hasPlaces, mode, nearbyPlaces, recentPlaces, savedPlaces]);

  return (
    <Animated.View
      style={[
        styles.sheet,
        { height: expandedHeight, transform: [{ translateY }] },
      ]}
    >
      {/* Drag region — handle + header. PanResponder lives here so the body
          ScrollView keeps full control of vertical scrolling. A tap on the
          handle (no drag) restores a minimized sheet. */}
      <View {...panResponder.panHandlers} style={styles.dragRegion}>
        <Pressable
          onPress={handleDragRegionPress}
          accessibilityRole="button"
          accessibilityLabel="Expand sheet"
          style={styles.handleWrap}
        >
          <View style={styles.handle} />
        </Pressable>
        <View style={styles.headerRow}>
          <View>
            <Text accessibilityRole="header" style={typography.heading}>
              {expanded ? 'Saved Places' : modeTitle(mode)}
            </Text>
            {expanded ? (
              <Text style={[typography.caption, styles.savedCount]}>
                {savedPlaces.length} {savedPlaces.length === 1 ? 'place' : 'places'}
              </Text>
            ) : null}
          </View>
          {hasPlaces && !expanded ? (
            <Pressable
              onPress={handleOpenList}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Open saved list"
            >
              <Text style={styles.viewAll}>Open list</Text>
            </Pressable>
          ) : null}
        </View>
      </View>

      {expanded ? (
        <MemoizedSavedPlacesLibrary
          savedPlaces={savedPlaces}
          nearbyPlaces={nearbyPlaces}
          locationState={locationState}
          loading={loading}
          requestLocationPermission={requestLocationPermission}
          onSelectPlace={onSelectPlace}
          onSaveFromLink={onSaveFromLink}
          onSearchManually={onSearchManually}
        />
      ) : (
        <ScrollView
          style={styles.body}
          contentContainerStyle={[
            styles.bodyContent,
            { paddingBottom: insets.bottom + Spacing.xl },
          ]}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
        {!hasPlaces ? (
          loading ? (
            <View style={styles.empty}>
              <Text style={[typography.body, styles.emptyBody]}>
                Loading your saved places…
              </Text>
            </View>
          ) : (
            <View style={styles.empty}>
              <Text style={typography.heading}>Start building your map</Text>
              <Text style={[typography.body, styles.emptyBody]}>
                Save places from links or search manually.
              </Text>
              <Button title="Save from link" onPress={onSaveFromLink} style={styles.emptyPrimary} />
              <Button
                title="Search manually"
                variant="secondary"
                onPress={onSearchManually}
                style={styles.emptySecondary}
              />
            </View>
          )
        ) : content ? (
          <>
            {content.featured ? (
              <NearbyNowCard
                place={content.featured}
                metaLabel={content.featuredMeta}
                onPress={() => onSelectPlace(content.featured as SavedPlaceWithPlace)}
                onGetDirections={() =>
                  onGetDirections(content.featured as SavedPlaceWithPlace)
                }
              />
            ) : null}

            {content.hint ? (
              <Text style={[typography.caption, styles.hint]}>{content.hint}</Text>
            ) : null}

            {content.primaryRows.length > 0 ? (
              <View style={styles.rows}>
                {content.primaryRows.map(({ place, status }) => (
                  <CompactPlaceRow
                    key={place.id}
                    place={place}
                    status={status}
                    onPress={() => onSelectPlace(place)}
                  />
                ))}
              </View>
            ) : null}

            {content.secondaryTitle ? (
              <Text style={[typography.label, styles.sectionTitle]}>
                {content.secondaryTitle}
              </Text>
            ) : null}
            {content.secondaryRows.length > 0 ? (
              <View style={styles.rows}>
                {content.secondaryRows.map(({ place, status }) => (
                  <CompactPlaceRow
                    key={place.id}
                    place={place}
                    status={status}
                    onPress={() => onSelectPlace(place)}
                  />
                ))}
              </View>
            ) : null}
          </>
        ) : null}
        </ScrollView>
      )}
    </Animated.View>
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    sheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: colors.surface,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.34,
      shadowRadius: 24,
      shadowOffset: { width: 0, height: -8 },
      elevation: 16,
    },
    dragRegion: {
      paddingHorizontal: Spacing.lg,
    },
    handleWrap: {
      alignItems: 'center',
      paddingTop: Spacing.sm,
      paddingBottom: Spacing.xs,
    },
    handle: {
      width: 42,
      height: 5,
      borderRadius: Radius.pill,
      backgroundColor: colors.border,
    },
    headerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingTop: Spacing.xs,
      paddingBottom: Spacing.sm,
    },
    viewAll: {
      ...typography.label,
      color: colors.primary,
      fontWeight: '600',
    },
    savedCount: {
      color: colors.textMuted,
      marginTop: 2,
    },
    body: {
      flex: 1,
    },
    bodyContent: {
      paddingHorizontal: Spacing.lg,
    },
    rows: {
      marginTop: Spacing.xs,
    },
    sectionTitle: {
      color: colors.textSecondary,
      marginTop: Spacing.lg,
      marginBottom: Spacing.xs,
    },
    hint: {
      color: colors.textMuted,
      marginTop: Spacing.md,
      marginBottom: Spacing.xs,
    },
    empty: {
      paddingTop: Spacing.md,
    },
    emptyBody: {
      color: colors.textSecondary,
      marginTop: Spacing.xs,
      marginBottom: Spacing.lg,
      lineHeight: 22,
    },
    emptyPrimary: {
      width: '100%',
    },
    emptySecondary: {
      width: '100%',
      marginTop: Spacing.sm,
    },
  });
}
