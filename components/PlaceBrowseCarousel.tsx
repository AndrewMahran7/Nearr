import { useEffect, useMemo, useRef } from 'react';
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

import { PlaceImage } from '@/components/PlaceImage';
import { Radius, Spacing } from '@/constants';
import {
  carouselIndexForSelection,
  carouselIndexFromOffset,
  PLACE_BROWSE_MAX_RENDER_BATCH,
} from '@/lib/placeBrowseCarousel';
import { useTheme } from '@/lib/theme';

export type PlaceBrowseCarouselItem = {
  id: string;
  name: string;
  subtitle?: string | null;
  googlePlaceId?: string | null;
  sourceUri?: string | null;
  fallbackSourceUri?: string | null;
  disabled?: boolean;
};

type Props = {
  items: readonly PlaceBrowseCarouselItem[];
  selectedId?: string | null;
  onSelect: (item: PlaceBrowseCarouselItem, interaction: 'tap' | 'swipe') => void;
  presentation?: 'compact' | 'expanded';
  testID?: string;
};

const COMPACT_GAP = 10;
const EXPANDED_GAP = 12;

export function PlaceBrowseCarousel({
  items,
  selectedId,
  onSelect,
  presentation = 'compact',
  testID = 'place-browse-carousel',
}: Props) {
  const { width } = useWindowDimensions();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const expanded = presentation === 'expanded';
  const gap = expanded ? EXPANDED_GAP : COMPACT_GAP;
  const cardWidth = expanded
    ? Math.min(304, Math.max(236, width - 72))
    : Math.min(236, Math.max(204, width - 124));
  const snapInterval = cardWidth + gap;
  const listRef = useRef<FlatList<PlaceBrowseCarouselItem> | null>(null);
  const lastSyncedIndexRef = useRef(-1);
  const selectedIndex = carouselIndexForSelection(items, selectedId);

  useEffect(() => {
    if (selectedIndex < 0 || lastSyncedIndexRef.current === selectedIndex) return;
    lastSyncedIndexRef.current = selectedIndex;
    listRef.current?.scrollToIndex({ index: selectedIndex, animated: true, viewPosition: 0.08 });
  }, [selectedIndex]);

  function selectFromMomentum(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const index = carouselIndexFromOffset(
      event.nativeEvent.contentOffset.x,
      snapInterval,
      items.length,
    );
    const item = index >= 0 ? items[index] : null;
    // Programmatic synchronization lands here too. The selected-id equality is
    // the feedback-loop guard between map selection and scrolling.
    if (!item || item.disabled || item.id === selectedId) return;
    lastSyncedIndexRef.current = index;
    onSelect(item, 'swipe');
  }

  return (
    <FlatList
      ref={listRef}
      testID={testID}
      data={items as PlaceBrowseCarouselItem[]}
      horizontal
      keyExtractor={(item) => item.id}
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.list}
      ItemSeparatorComponent={() => <View style={{ width: gap }} />}
      snapToInterval={snapInterval}
      snapToAlignment="start"
      decelerationRate="fast"
      disableIntervalMomentum
      onMomentumScrollEnd={selectFromMomentum}
      initialNumToRender={PLACE_BROWSE_MAX_RENDER_BATCH}
      maxToRenderPerBatch={PLACE_BROWSE_MAX_RENDER_BATCH}
      windowSize={5}
      removeClippedSubviews
      getItemLayout={(_data, index) => ({ length: snapInterval, offset: snapInterval * index, index })}
      onScrollToIndexFailed={({ index }) => {
        requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: snapInterval * index, animated: false }));
      }}
      renderItem={({ item, index }) => {
        const selected = item.id === selectedId;
        return (
          <Pressable
            onPress={() => {
              if (!item.disabled) onSelect(item, 'tap');
            }}
            disabled={item.disabled}
            accessibilityRole="button"
            accessibilityState={{ selected, disabled: item.disabled }}
            accessibilityLabel={`${item.name}, ${index + 1} of ${items.length}${selected ? ', selected' : ''}`}
            style={({ pressed }) => [
              styles.card,
              expanded && styles.cardExpanded,
              { width: cardWidth },
              selected && styles.cardSelected,
              pressed && !item.disabled && styles.cardPressed,
              item.disabled && styles.cardDisabled,
            ]}
          >
            <PlaceImage
              googlePlaceId={item.googlePlaceId}
              sourceUri={item.sourceUri}
              fallbackSourceUri={item.fallbackSourceUri}
              preferPlacePhoto
              size={expanded ? 64 : 48}
              borderRadius={expanded ? 12 : 9}
              accessibilityLabel={`Photo of ${item.name}`}
            />
            <View style={styles.copy}>
              <Text style={styles.name} numberOfLines={expanded ? 2 : 1}>{item.name}</Text>
              {item.subtitle ? (
                <Text style={styles.subtitle} numberOfLines={expanded ? 2 : 1}>{item.subtitle}</Text>
              ) : null}
            </View>
            {selected ? <View style={styles.selectedDot} /> : null}
          </Pressable>
        );
      }}
    />
  );
}

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    list: { paddingHorizontal: Spacing.md, paddingVertical: Spacing.xs },
    card: {
      minHeight: 66,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.sm,
      padding: Spacing.sm,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    cardExpanded: { minHeight: 88, padding: Spacing.md },
    cardSelected: { borderColor: colors.accent, backgroundColor: colors.surfaceElevated },
    cardPressed: { opacity: 0.76 },
    cardDisabled: { opacity: 0.52 },
    copy: { flex: 1, minWidth: 0 },
    name: { ...typography.label, color: colors.text },
    subtitle: { ...typography.caption, color: colors.textSecondary, marginTop: 3 },
    selectedDot: {
      width: 9,
      height: 9,
      borderRadius: Radius.pill,
      backgroundColor: colors.accent,
    },
  });
}
