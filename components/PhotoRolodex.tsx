import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type ImageResizeMode,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Spacing } from '@/constants';
import { createOnceLatch, type OnceLatch } from '@/lib/onceLatch';
import {
  adjacentPrefetchTargets,
  galleryBackdropOpacity,
  galleryDragOffset,
  pageIndexFromOffset,
  shouldDismissGalleryOnRelease,
  GALLERY_DISMISS_ACTIVATE_DY,
  GALLERY_DISMISS_FAIL_DX,
  GALLERY_DISMISS_FAIL_DY,
} from '@/lib/photoCarousel';

const CARD_GAP = 18;
const INACTIVE_OPACITY = 0.45;
const INACTIVE_SCALE = 0.92;
const DISMISS_EXIT_MS = 180;
const DISMISS_SPRING = { damping: 22, stiffness: 240 } as const;

export type PhotoRolodexItem = {
  key: string;
  uri: string;
  accessibilityLabel: string;
  footerLabel?: string | null;
};

type Props = {
  visible: boolean;
  items: readonly PhotoRolodexItem[];
  initialIndex?: number;
  onClose: () => void;
  resizeMode?: ImageResizeMode;
};

/**
 * The production Place Detail photo rolodex, shared by Place Detail, Quick
 * Check candidate photos, and source evidence. Native gesture arbitration
 * keeps horizontal paging independent from swipe-down dismissal.
 */
export function PhotoRolodexModal({
  visible,
  items,
  initialIndex = 0,
  onClose,
  resizeMode = 'cover',
}: Props) {
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [activeIndex, setActiveIndex] = useState(0);
  const [openSeed, setOpenSeed] = useState(0);
  const listRef = useRef<FlatList<PhotoRolodexItem> | null>(null);
  const visibleRef = useRef(false);
  const dismissLatchRef = useRef<OnceLatch | null>(null);
  const prefetchedUrisRef = useRef<Set<string>>(new Set());
  const dragY = useSharedValue(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const activeIndexRef = useRef(activeIndex);
  activeIndexRef.current = activeIndex;

  const safeInitialIndex = items.length === 0
    ? 0
    : Math.max(0, Math.min(initialIndex, items.length - 1));
  const safeActiveIndex = items.length === 0
    ? 0
    : Math.max(0, Math.min(activeIndex, items.length - 1));
  const cardWidth = Math.max(220, Math.round(viewportWidth * 0.76));
  const cardHeight = Math.max(220, Math.round(viewportHeight * 0.54));
  const sideSpacing = Math.max(0, Math.round((viewportWidth - cardWidth) / 2));
  const snapInterval = cardWidth + CARD_GAP;
  const listKey = `photo-rolodex-${openSeed}-${items.length}`;
  const listItems = useMemo(() => [...items], [items]);

  useEffect(() => {
    if (!visible) {
      visibleRef.current = false;
      return;
    }
    if (visibleRef.current || items.length === 0) return;
    visibleRef.current = true;
    setActiveIndex(safeInitialIndex);
    scrollX.setValue(safeInitialIndex * snapInterval);
    dragY.value = 0;
    dismissLatchRef.current = createOnceLatch();
    prefetchedUrisRef.current.clear();
    setOpenSeed((seed) => seed + 1);
  }, [visible, safeInitialIndex, items.length, snapInterval, scrollX, dragY]);

  const close = useCallback(() => {
    if (dismissLatchRef.current && !dismissLatchRef.current.acquire()) return;
    onClose();
  }, [onClose]);

  useEffect(() => {
    if (!visible || items.length === 0) return;
    const frameId = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({
        offset: activeIndexRef.current * snapInterval,
        animated: false,
      });
    });
    return () => cancelAnimationFrame(frameId);
  }, [visible, openSeed, items.length, snapInterval]);

  useEffect(() => {
    if (!visible) return;
    const urls = items.map((item) => item.uri);
    for (const uri of adjacentPrefetchTargets(urls, activeIndex)) {
      if (prefetchedUrisRef.current.has(uri)) continue;
      prefetchedUrisRef.current.add(uri);
      void Image.prefetch(uri).catch(() => undefined);
    }
  }, [activeIndex, items, visible]);

  const handleScroll = useMemo(
    () => Animated.event(
      [{ nativeEvent: { contentOffset: { x: scrollX } } }],
      {
        useNativeDriver: true,
        listener: (event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const next = pageIndexFromOffset(
            event.nativeEvent.contentOffset.x,
            snapInterval,
            items.length,
          );
          setActiveIndex((current) => {
            if (current === next) return current;
            return next;
          });
        },
      },
    ),
    [items.length, scrollX, snapInterval],
  );

  const scrollGesture = useMemo(() => Gesture.Native(), []);
  const dismissGesture = useMemo(
    () => Gesture.Pan()
      .activeOffsetY(GALLERY_DISMISS_ACTIVATE_DY)
      .failOffsetX([-GALLERY_DISMISS_FAIL_DX, GALLERY_DISMISS_FAIL_DX])
      .failOffsetY(-GALLERY_DISMISS_FAIL_DY)
      .blocksExternalGesture(scrollGesture)
      .onUpdate((event) => { dragY.value = galleryDragOffset(event.translationY); })
      .onEnd((event, success) => {
        const dismissing = success && shouldDismissGalleryOnRelease({
          dy: event.translationY,
          vy: event.velocityY,
        });
        if (dismissing) {
          dragY.value = withTiming(viewportHeight, { duration: DISMISS_EXIT_MS }, (finished) => {
            if (finished) runOnJS(close)();
          });
        } else {
          dragY.value = withSpring(0, DISMISS_SPRING);
        }
      })
      .onFinalize((_event, success) => {
        if (!success) dragY.value = withSpring(0, DISMISS_SPRING);
      }),
    [close, dragY, scrollGesture, viewportHeight],
  );
  const contentStyle = useAnimatedStyle(() => ({ transform: [{ translateY: dragY.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: galleryBackdropOpacity(dragY.value, viewportHeight),
  }));

  if (items.length === 0) return null;
  const activeItem = items[safeActiveIndex] ?? null;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={close}
      statusBarTranslucent
    >
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={dismissGesture}>
          <View style={styles.root} accessibilityViewIsModal>
            <Reanimated.View pointerEvents="none" style={[styles.backdrop, backdropStyle]} />
            <Reanimated.View style={[styles.content, contentStyle]}>
              <View
                style={[styles.counterWrap, { top: insets.top + Spacing.md }]}
                accessible
                accessibilityLabel={`Photo ${safeActiveIndex + 1} of ${items.length}`}
                accessibilityValue={{ text: `${safeActiveIndex + 1} of ${items.length}` }}
              >
                <View style={styles.counterPill}>
                  <Text style={styles.counterText}>{safeActiveIndex + 1} / {items.length}</Text>
                </View>
              </View>
              <Pressable
                style={[styles.closeButton, { top: insets.top + Spacing.sm }]}
                onPress={close}
                accessibilityRole="button"
                accessibilityLabel="Close photo gallery"
                hitSlop={4}
                testID="photo-rolodex-close"
              >
                <Feather name="x" size={22} color="#FFFFFF" />
              </Pressable>
              <View style={styles.carouselArea}>
                <GestureDetector gesture={scrollGesture}>
                  <Animated.FlatList
                    ref={listRef}
                    key={listKey}
                    data={listItems}
                    horizontal
                    snapToInterval={snapInterval}
                    snapToAlignment="start"
                    decelerationRate="fast"
                    directionalLockEnabled
                    nestedScrollEnabled
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ paddingHorizontal: sideSpacing }}
                    initialScrollIndex={safeInitialIndex}
                    scrollEventThrottle={16}
                    onScroll={handleScroll}
                    getItemLayout={(_data, index) => ({
                      length: snapInterval,
                      offset: snapInterval * index,
                      index,
                    })}
                    onScrollToIndexFailed={(info) => {
                      const next = Math.max(0, Math.min(info.index, items.length - 1));
                      setActiveIndex(next);
                      requestAnimationFrame(() => {
                        listRef.current?.scrollToOffset({ offset: next * snapInterval, animated: false });
                      });
                    }}
                    keyExtractor={(item) => item.key}
                    renderItem={({ item, index }) => {
                      const inputRange = [
                        (index - 1) * snapInterval,
                        index * snapInterval,
                        (index + 1) * snapInterval,
                      ];
                      const opacity = scrollX.interpolate({
                        inputRange,
                        outputRange: [INACTIVE_OPACITY, 1, INACTIVE_OPACITY],
                        extrapolate: 'clamp',
                      });
                      const scale = scrollX.interpolate({
                        inputRange,
                        outputRange: [INACTIVE_SCALE, 1, INACTIVE_SCALE],
                        extrapolate: 'clamp',
                      });
                      return (
                        <Animated.View style={[
                          styles.item,
                          {
                            opacity,
                            transform: [{ scale }],
                            width: cardWidth,
                            marginRight: index === items.length - 1 ? 0 : CARD_GAP,
                          },
                        ]}>
                          <View style={[styles.photoShell, { width: cardWidth, height: cardHeight }]}>
                            <Image
                              source={{ uri: item.uri }}
                              style={styles.image}
                              resizeMode={resizeMode}
                              accessible
                              accessibilityLabel={item.accessibilityLabel}
                            />
                          </View>
                        </Animated.View>
                      );
                    }}
                  />
                </GestureDetector>
              </View>
              <View style={styles.dots} accessible accessibilityLabel={`Photo ${safeActiveIndex + 1} of ${items.length}`}>
                {items.map((item, index) => (
                  <View key={`dot-${item.key}`} style={[styles.dot, index === safeActiveIndex && styles.dotActive]} />
                ))}
              </View>
              <Text style={styles.hint}>{activeItem?.footerLabel || '↓ Swipe down to close'}</Text>
            </Reanimated.View>
          </View>
        </GestureDetector>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.96)' },
  content: { flex: 1 },
  closeButton: {
    position: 'absolute', right: 22, width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)', zIndex: 6,
  },
  counterWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  counterPill: {
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.65)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
  },
  counterText: { color: '#FFFFFF', fontSize: 13, lineHeight: 18, fontWeight: '700' },
  carouselArea: { flex: 1, justifyContent: 'center', zIndex: 2, paddingTop: 64, paddingBottom: 118 },
  item: { alignItems: 'center', justifyContent: 'center', paddingVertical: Spacing.md },
  photoShell: { borderRadius: 18, overflow: 'hidden', backgroundColor: 'transparent' },
  image: {
    width: '100%', height: '100%', borderRadius: 18, shadowColor: '#000000',
    shadowOpacity: 0.26, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 6,
  },
  dots: {
    position: 'absolute', bottom: 82, left: 0, right: 0, flexDirection: 'row',
    justifyContent: 'center', alignItems: 'center', gap: 8, zIndex: 4,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotActive: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: '#FFFFFF' },
  hint: {
    position: 'absolute', bottom: 48, left: 0, right: 0, zIndex: 4,
    textAlign: 'center', color: 'rgba(255,255,255,0.65)', fontSize: 13, lineHeight: 18,
  },
});
