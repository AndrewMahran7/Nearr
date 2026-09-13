import { Feather } from '@expo/vector-icons';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type AccessibilityActionEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import {
  carouselIndexForSelection,
  carouselIndexFromOffset,
} from '@/lib/placeBrowseCarousel';
import {
  PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH,
  placeBrowseWheelCardSideInset,
  placeBrowseWheelCardWidth,
} from '@/lib/placeBrowseWheel';
import { useTheme } from '@/lib/theme';

const CARD_GAP = 12;

export type PlaceBrowseWheelItem = {
  id: string;
  name: string;
  primaryMeta: string;
  secondaryMeta?: string | null;
  googlePlaceId?: string | null;
  sourceUri?: string | null;
  fallbackSourceUri?: string | null;
  preferPlacePhoto?: boolean;
  allowGoogleLookup?: boolean;
  stateLabel: string;
  stateTone?: 'accent' | 'muted';
  contextLabel?: string | null;
  contextIcon?: React.ComponentProps<typeof Feather>['name'];
};

type Props = {
  items: readonly PlaceBrowseWheelItem[];
  selectedId: string;
  title: string;
  subtitle?: string;
  accessibilityLabel: string;
  closeAccessibilityLabel: string;
  savingItemId?: string | null;
  positioned?: boolean;
  bottomInset?: number;
  testID?: string;
  onSelect: (item: PlaceBrowseWheelItem, interaction: 'tap' | 'swipe') => void;
  onOpenDetails: (item: PlaceBrowseWheelItem) => void;
  onDirections: (item: PlaceBrowseWheelItem) => void;
  onSave?: (item: PlaceBrowseWheelItem) => void;
  onClose: () => void;
  onHeightChange?: (height: number) => void;
};

export function PlaceBrowseWheel({
  items,
  selectedId,
  title,
  subtitle = 'Swipe cards or tap a pin',
  accessibilityLabel,
  closeAccessibilityLabel,
  savingItemId = null,
  positioned = false,
  bottomInset = 0,
  testID = 'place-browse-wheel',
  onSelect,
  onOpenDetails,
  onDirections,
  onSave,
  onClose,
  onHeightChange,
}: Props) {
  const { width } = useWindowDimensions();
  const { colors, typography } = useTheme();
  const listRef = useRef<FlatList<PlaceBrowseWheelItem> | null>(null);
  const cardWidth = placeBrowseWheelCardWidth(width);
  const sideInset = placeBrowseWheelCardSideInset(width);
  const snapInterval = cardWidth + CARD_GAP;
  const selectedIndex = carouselIndexForSelection(items, selectedId);
  const styles = useMemo(() => createStyles(colors), [colors]);

  useEffect(() => {
    if (selectedIndex < 0) return;
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: true });
  }, [items.length, selectedIndex]);

  const getItemLayout = useCallback(
    (_: ArrayLike<PlaceBrowseWheelItem> | null | undefined, index: number) => ({
      index,
      length: snapInterval,
      offset: snapInterval * index,
    }),
    [snapInterval],
  );

  const selectSettledCard = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const nextIndex = carouselIndexFromOffset(
        event.nativeEvent.contentOffset.x,
        snapInterval,
        items.length,
      );
      const item = nextIndex >= 0 ? items[nextIndex] : null;
      if (item && item.id !== selectedId) onSelect(item, 'swipe');
    },
    [items, onSelect, selectedId, snapInterval],
  );

  const selectAccessibleNeighbor = useCallback(
    (event: AccessibilityActionEvent) => {
      if (selectedIndex < 0) return;
      const delta = event.nativeEvent.actionName === 'increment'
        ? 1
        : event.nativeEvent.actionName === 'decrement'
          ? -1
          : 0;
      const next = items[Math.max(0, Math.min(items.length - 1, selectedIndex + delta))];
      if (delta && next && next.id !== selectedId) onSelect(next, 'swipe');
    },
    [items, onSelect, selectedId, selectedIndex],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: PlaceBrowseWheelItem; index: number }) => {
      const selected = item.id === selectedId;
      const stateColor = item.stateTone === 'muted' ? colors.textSecondary : colors.accent;
      const accessibilityPosition = `${index + 1} of ${items.length}`;
      const cardAccessibilityLabel = [
        item.name,
        item.primaryMeta,
        item.secondaryMeta,
        item.stateLabel,
        item.contextLabel,
        accessibilityPosition,
        selected ? 'selected' : null,
      ].filter(Boolean).join(', ');

      return (
        <Pressable
          onPress={() => onSelect(item, 'tap')}
          accessibilityRole="button"
          accessibilityLabel={cardAccessibilityLabel}
          accessibilityHint="Selects this place on the map"
          accessibilityState={{ selected }}
          accessibilityActions={[
            { name: 'increment', label: 'Next place' },
            { name: 'decrement', label: 'Previous place' },
          ]}
          onAccessibilityAction={selectAccessibleNeighbor}
          testID={`${testID}-card-${item.id}`}
          style={({ pressed }) => [
            styles.card,
            { width: cardWidth },
            selected && styles.cardSelected,
            pressed && styles.pressed,
          ]}
        >
          <View style={styles.media}>
            <PlaceImage
              googlePlaceId={item.googlePlaceId}
              sourceUri={item.sourceUri}
              fallbackSourceUri={item.fallbackSourceUri}
              preferPlacePhoto={item.preferPlacePhoto}
              allowGoogleLookup={item.allowGoogleLookup}
              size={cardWidth}
              borderRadius={0}
              style={[styles.imageFrame, { width: cardWidth }]}
              imageStyle={{ width: cardWidth, height: cardWidth }}
              accessibilityLabel={`Photo of ${item.name}`}
            />
            <View style={styles.mediaShade} pointerEvents="none" />
            {item.contextLabel ? (
              <View style={styles.contextBadge} pointerEvents="none">
                <Feather name={item.contextIcon ?? 'navigation'} size={12} color="#FFF7ED" />
                <Text style={styles.contextBadgeText}>{item.contextLabel}</Text>
              </View>
            ) : null}
            <View style={styles.stateBadge} pointerEvents="none">
              <Feather name="bookmark" size={12} color={stateColor} />
              <Text style={[styles.stateBadgeText, { color: stateColor }]}>{item.stateLabel}</Text>
            </View>
          </View>

          <View style={styles.body}>
            <View style={styles.titleRow}>
              <Text style={[typography.bodyStrong, styles.name, { color: colors.text }]} numberOfLines={2}>
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
                {item.primaryMeta}
              </Text>
              {item.secondaryMeta ? (
                <Text style={[typography.caption, styles.locality, { color: colors.textMuted }]} numberOfLines={2}>
                  {item.secondaryMeta}
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
              {onSave && item.stateTone === 'muted' ? (
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
    [cardWidth, colors, items.length, onDirections, onOpenDetails, onSave, onSelect, savingItemId, selectAccessibleNeighbor, selectedId, styles, testID, typography],
  );

  return (
    <View
      testID={testID}
      style={[
        styles.wrap,
        positioned && styles.positioned,
        { paddingBottom: Math.max(bottomInset, Spacing.sm) },
      ]}
      onLayout={(event) => onHeightChange?.(event.nativeEvent.layout.height)}
      accessibilityLabel={accessibilityLabel}
    >
      <View style={styles.header}>
        <View style={styles.headerCopy}>
          <Text accessibilityRole="header" style={[typography.bodyStrong, styles.heading, { color: colors.text }]}>
            {title}
          </Text>
          <Text style={[typography.caption, { color: colors.textMuted }]}>{subtitle}</Text>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={closeAccessibilityLabel}
          style={({ pressed }) => [styles.close, pressed && styles.pressed]}
        >
          <Feather name="x" size={22} color={colors.text} />
        </Pressable>
      </View>
      <FlatList
        ref={listRef}
        horizontal
        data={items as PlaceBrowseWheelItem[]}
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
        initialNumToRender={PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH}
        maxToRenderPerBatch={PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH}
        windowSize={5}
        removeClippedSubviews
        accessibilityLabel={`${items.length} place cards`}
      />
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    wrap: { gap: Spacing.sm },
    positioned: { position: 'absolute', left: 0, right: 0, bottom: 0 },
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
    headerCopy: { flex: 1, paddingRight: Spacing.sm },
    heading: { fontSize: 15 },
    close: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
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
    contextBadge: {
      position: 'absolute', left: Spacing.sm, top: Spacing.sm,
      minHeight: 26, paddingHorizontal: 9, borderRadius: Radius.pill,
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: 'rgba(40,36,33,0.82)',
    },
    contextBadgeText: { color: '#FFF7ED', fontSize: 11, fontWeight: '700' },
    stateBadge: {
      position: 'absolute', right: Spacing.sm, top: Spacing.sm,
      minHeight: 26, paddingHorizontal: 9, borderRadius: Radius.pill,
      flexDirection: 'row', alignItems: 'center', gap: 5,
      backgroundColor: 'rgba(255,247,237,0.94)',
    },
    stateBadgeText: { fontSize: 11, fontWeight: '800' },
    body: { padding: Spacing.md, gap: Spacing.sm },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
    name: { flex: 1, fontSize: 17, minHeight: 22 },
    positionPill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: Radius.pill, backgroundColor: colors.surface },
    positionText: { fontSize: 10, fontWeight: '700' },
    metaRow: { gap: 2, minHeight: 35 },
    metaText: { fontWeight: '700' },
    locality: { maxWidth: '100%' },
    actions: { flexDirection: 'row', gap: Spacing.xs, paddingTop: 2 },
    action: {
      minHeight: 44, flex: 1, borderRadius: Radius.md,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5,
      backgroundColor: colors.surface, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
    },
    saveAction: { backgroundColor: colors.primary, borderColor: colors.primary },
    actionText: { fontSize: 11, fontWeight: '700' },
    saveActionText: { color: '#FFF7ED' },
    pressed: { opacity: 0.7 },
  });
}
