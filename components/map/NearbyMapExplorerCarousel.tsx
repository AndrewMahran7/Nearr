import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import { formatNearbyDistance } from '@/lib/alsoNearby';
import { CATEGORY_LABELS } from '@/lib/placeCategory';
import {
  nearbyExplorerCardSideInset,
  nearbyExplorerCardWidth,
  type NearbyMapExplorerItem,
} from '@/lib/nearbyMapExplorer';
import { useTheme } from '@/lib/theme';

const CARD_GAP = 12;

type Props = {
  items: readonly NearbyMapExplorerItem[];
  selectedId: string;
  savingItemId: string | null;
  onSelect: (item: NearbyMapExplorerItem, source: 'card') => void;
  onOpenDetails: (item: NearbyMapExplorerItem) => void;
  onSave: (item: NearbyMapExplorerItem) => void;
  onDirections: (item: NearbyMapExplorerItem) => void;
  onClose: () => void;
  onHeightChange?: (height: number) => void;
};

function locality(item: NearbyMapExplorerItem): string | null {
  return item.shortFormattedAddress ?? item.address;
}

export function NearbyMapExplorerCarousel({
  items,
  selectedId,
  savingItemId,
  onSelect,
  onOpenDetails,
  onSave,
  onDirections,
  onClose,
  onHeightChange,
}: Props) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, typography } = useTheme();
  const listRef = useRef<FlatList<NearbyMapExplorerItem> | null>(null);
  const cardWidth = nearbyExplorerCardWidth(width);
  const sideInset = nearbyExplorerCardSideInset(width);
  const snapInterval = cardWidth + CARD_GAP;
  const selectedIndex = Math.max(0, items.findIndex((item) => item.id === selectedId));
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    if (items.length === 0) return;
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
  }, [items.length, selectedIndex]);

  const getItemLayout = useCallback(
    (_: ArrayLike<NearbyMapExplorerItem> | null | undefined, index: number) => ({
      index,
      length: snapInterval,
      offset: snapInterval * index,
    }),
    [snapInterval],
  );

  const selectSettledCard = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (items.length === 0) return;
      const nextIndex = Math.max(
        0,
        Math.min(items.length - 1, Math.round(event.nativeEvent.contentOffset.x / snapInterval)),
      );
      const item = items[nextIndex];
      if (item && item.id !== selectedId) onSelect(item, 'card');
    },
    [items, onSelect, selectedId, snapInterval],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: NearbyMapExplorerItem; index: number }) => {
      const selected = item.id === selectedId;
      const saved = item.savedState === 'saved';
      const distance = item.distanceMeters == null || item.sourceType === 'anchor'
        ? null
        : formatNearbyDistance(item.distanceMeters);
      const stateLabel = saved ? 'Saved' : 'Not saved';
      const accessibilityLabel = [
        item.name,
        CATEGORY_LABELS[item.category],
        distance ? `${distance} away` : null,
        stateLabel,
        item.sourceType === 'anchor' ? 'starting place' : null,
      ].filter(Boolean).join(', ');

      return (
        <Pressable
          onPress={() => onSelect(item, 'card')}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          accessibilityHint="Selects this place on the map"
          accessibilityState={{ selected }}
          style={({ pressed }) => [
            styles.card,
            { width: cardWidth },
            selected && styles.cardSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.media}>
            <PlaceImage
              googlePlaceId={item.providerPlaceId}
              sourceUri={item.photoUrl}
              size={cardWidth}
              borderRadius={0}
              style={[styles.imageFrame, { width: cardWidth }]}
              imageStyle={{ width: cardWidth, height: cardWidth }}
            />
            <View style={styles.mediaShade} pointerEvents="none" />
            {item.sourceType === 'anchor' ? (
              <View style={styles.anchorBadge} pointerEvents="none">
                <Feather name="navigation" size={12} color="#FFF7ED" />
                <Text style={styles.anchorBadgeText}>Starting place</Text>
              </View>
            ) : null}
            <View style={styles.stateBadge} pointerEvents="none">
              <Feather
                name="bookmark"
                size={12}
                color={saved ? colors.accent : colors.textSecondary}
              />
              <Text style={[styles.stateBadgeText, { color: saved ? colors.accent : colors.textSecondary }]}>
                {stateLabel}
              </Text>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={[typography.bodyStrong, styles.name, { color: colors.text }]} numberOfLines={1}>
                {item.name}
              </Text>
              <View style={styles.positionPill}>
                <Text style={[styles.positionText, { color: colors.textMuted }]}>
                  {index + 1}/{items.length}
                </Text>
              </View>
            </View>
            <View style={styles.metaRow}>
              <Text style={[typography.caption, styles.metaText, { color: colors.textSecondary }]} numberOfLines={1}>
                {[CATEGORY_LABELS[item.category], distance].filter(Boolean).join(' · ')}
              </Text>
              {locality(item) ? (
                <Text style={[typography.caption, styles.locality, { color: colors.textMuted }]} numberOfLines={1}>
                  {locality(item)}
                </Text>
              ) : null}
            </View>

            <View style={styles.actions}>
              <Pressable
                onPress={() => onOpenDetails(item)}
                accessibilityRole="button"
                accessibilityLabel={`Open details for ${item.name}`}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Feather name="info" size={16} color={colors.text} />
                <Text style={[styles.actionText, { color: colors.text }]}>Details</Text>
              </Pressable>
              <Pressable
                onPress={() => onDirections(item)}
                accessibilityRole="button"
                accessibilityLabel={`Get directions to ${item.name}`}
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Feather name="navigation" size={16} color={colors.text} />
                <Text style={[styles.actionText, { color: colors.text }]}>Directions</Text>
              </Pressable>
              {!saved ? (
                <Pressable
                  onPress={() => onSave(item)}
                  disabled={savingItemId === item.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Save ${item.name}`}
                  accessibilityState={{ disabled: savingItemId === item.id }}
                  style={({ pressed }) => [styles.action, styles.saveAction, pressed && styles.pressed]}
                >
                  <Feather name="bookmark" size={16} color="#FFF7ED" />
                  <Text style={[styles.actionText, styles.saveActionText]}>
                    {savingItemId === item.id ? 'Saving…' : 'Save'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [cardWidth, colors, items.length, onDirections, onOpenDetails, onSave, onSelect, savingItemId, selectedId, styles, typography],
  );

  return (
    <View
      style={[styles.wrap, { paddingBottom: Math.max(insets.bottom, Spacing.sm) }]}
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      accessibilityLabel="Nearby map place cards"
    >
      <View style={styles.header}>
        <View>
          <Text accessibilityRole="header" style={[typography.bodyStrong, styles.heading, { color: colors.text }]}>Explore nearby</Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>Swipe cards or tap a pin</Text>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Back to place details"
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Feather name="x" size={22} color={colors.text} />
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        horizontal
        data={items as NearbyMapExplorerItem[]}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        getItemLayout={getItemLayout}
        contentContainerStyle={{ paddingHorizontal: sideInset, gap: CARD_GAP }}
        snapToInterval={snapInterval}
        snapToAlignment="start"
        decelerationRate="fast"
        disableIntervalMomentum
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={selectSettledCard}
        onScrollToIndexFailed={({ index }) => {
          listRef.current?.scrollToOffset({ offset: snapInterval * index, animated: true });
        }}
        initialNumToRender={3}
        maxToRenderPerBatch={3}
        windowSize={5}
        removeClippedSubviews
        accessibilityLabel={`${items.length} nearby places`}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    wrap: { position: 'absolute', left: 0, right: 0, bottom: 0, gap: Spacing.sm },
    header: {
      marginHorizontal: Spacing.lg,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingLeft: Spacing.md,
      paddingRight: Spacing.xs,
      minHeight: 48,
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.18,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 4,
    },
    heading: { fontSize: 15 },
    close: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
    card: {
      overflow: 'hidden',
      borderRadius: Radius.lg,
      backgroundColor: colors.surfaceElevated,
      borderWidth: 1,
      borderColor: colors.border,
      shadowColor: '#000',
      shadowOpacity: 0.22,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    cardSelected: { borderColor: colors.accent, borderWidth: 2 },
    media: { height: 108, overflow: 'hidden', backgroundColor: colors.surface },
    imageFrame: { height: 108, borderRadius: 0 },
    mediaShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.06)' },
    anchorBadge: {
      position: 'absolute', left: Spacing.sm, top: Spacing.sm,
      minHeight: 26, paddingHorizontal: 9, borderRadius: Radius.pill,
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: 'rgba(40,36,33,0.82)',
    },
    anchorBadgeText: { color: '#FFF7ED', fontSize: 11, fontWeight: '700' },
    stateBadge: {
      position: 'absolute', right: Spacing.sm, top: Spacing.sm,
      minHeight: 26, paddingHorizontal: 9, borderRadius: Radius.pill,
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: 'rgba(255,247,237,0.94)',
    },
    stateBadgeText: { fontSize: 11, fontWeight: '800' },
    body: { padding: Spacing.md, gap: Spacing.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    name: { flex: 1, fontSize: 17 },
    positionPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.pill, backgroundColor: colors.surface },
    positionText: { fontSize: 10, fontWeight: '700' },
    metaRow: { gap: 2 },
    metaText: { fontWeight: '700' },
    locality: { maxWidth: '100%' },
    actions: { flexDirection: 'row', gap: Spacing.xs, paddingTop: 2 },
    action: {
      minHeight: 38, flex: 1, borderRadius: Radius.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    saveAction: { backgroundColor: colors.primary, borderColor: colors.primary },
    actionText: { fontSize: 11, fontWeight: '700' },
    saveActionText: { color: '#FFF7ED' },
    pressed: { opacity: 0.7 },
  });
}
