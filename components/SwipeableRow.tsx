/**
 * SwipeableRow — horizontal swipe actions for queue rows.
 *
 * Implemented with the RN core `Animated` + `PanResponder` already used by
 * MapBottomSheet, so this adds no gesture dependency.
 *
 * Accessibility: swipe is NEVER the only way to act. Every enabled action is
 * also published as an `accessibilityAction`, so VoiceOver/TalkBack users get
 * the same operations from the rotor, and callers additionally render visible
 * buttons in the row body.
 */
import { useMemo, useRef } from 'react';
import {
  Animated,
  PanResponder,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import {
  QUEUE_SWIPE_THRESHOLD,
  swipeActionFor,
  type QueueSwipeAction,
  type QueueSwipeAvailability,
} from '@/lib/queueInbox';

type Props = {
  children: React.ReactNode;
  availability: QueueSwipeAvailability;
  onAction: (action: QueueSwipeAction) => void;
  /** Labels surfaced to assistive technology for each enabled action. */
  actions: { name: QueueSwipeAction; label: string }[];
  accessibilityLabel?: string;
  disabled?: boolean;
};

const MAX_TRAVEL = 132;

export function SwipeableRow({
  children,
  availability,
  onAction,
  actions,
  accessibilityLabel,
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const translateX = useRef(new Animated.Value(0)).current;
  const dxRef = useRef(0);

  const settle = (toValue: number) => {
    Animated.spring(translateX, {
      toValue,
      useNativeDriver: true,
      bounciness: 0,
      speed: 18,
    }).start();
  };

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_evt, g) => {
          if (disabled) return false;
          // Only claim clearly horizontal gestures so the list keeps scrolling.
          return Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.6;
        },
        onPanResponderMove: (_evt, g) => {
          const allowed =
            g.dx > 0 ? (availability.save ? g.dx : 0) : availability.dismiss ? g.dx : 0;
          const clamped = Math.max(-MAX_TRAVEL, Math.min(MAX_TRAVEL, allowed));
          dxRef.current = clamped;
          translateX.setValue(clamped);
        },
        onPanResponderRelease: () => {
          const action = swipeActionFor(dxRef.current, availability);
          dxRef.current = 0;
          settle(0);
          if (action) onAction(action);
        },
        onPanResponderTerminate: () => {
          dxRef.current = 0;
          settle(0);
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [availability.save, availability.dismiss, disabled, onAction],
  );

  const saveOpacity = translateX.interpolate({
    inputRange: [0, QUEUE_SWIPE_THRESHOLD],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });
  const dismissOpacity = translateX.interpolate({
    inputRange: [-QUEUE_SWIPE_THRESHOLD, 0],
    outputRange: [1, 0],
    extrapolate: 'clamp',
  });

  function handleAccessibilityAction(event: AccessibilityActionEvent) {
    const name = event.nativeEvent.actionName as QueueSwipeAction;
    if (actions.some((action) => action.name === name)) onAction(name);
  }

  return (
    <View
      style={styles.wrap}
      accessible={false}
      accessibilityLabel={accessibilityLabel}
      accessibilityActions={actions.map((action) => ({
        name: action.name,
        label: action.label,
      }))}
      onAccessibilityAction={handleAccessibilityAction}
    >
      {availability.save ? (
        <Animated.View style={[styles.behind, styles.behindLeft, { opacity: saveOpacity }]}>
          <Feather name="check" size={18} color={colors.textInverse} />
          <Text style={styles.behindText}>Save</Text>
        </Animated.View>
      ) : null}
      {availability.dismiss ? (
        <Animated.View style={[styles.behind, styles.behindRight, { opacity: dismissOpacity }]}>
          <Text style={styles.behindText}>Remove</Text>
          <Feather name="x" size={18} color={colors.textInverse} />
        </Animated.View>
      ) : null}
      <Animated.View style={{ transform: [{ translateX }] }} {...panResponder.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    wrap: { overflow: 'hidden' },
    behind: {
      ...StyleSheet.absoluteFillObject,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.xs,
      paddingHorizontal: Spacing.lg,
    },
    behindLeft: { justifyContent: 'flex-start', backgroundColor: colors.primary },
    behindRight: { justifyContent: 'flex-end', backgroundColor: colors.danger },
    behindText: { color: colors.textInverse, fontWeight: '700', fontSize: 13 },
  });
}
