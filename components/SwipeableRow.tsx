/** Native-feeling horizontal actions for queue rows. */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
} from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
  type AccessibilityActionEvent,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import Swipeable from 'react-native-gesture-handler/Swipeable';
import { useReducedMotion } from 'react-native-reanimated';

import { Spacing } from '@/constants';
import { hapticSelection } from '@/lib/haptics';
import type { QueueSwipeCoordinator } from '@/lib/queueSwipeCoordinator';
import {
  QUEUE_ACTION_WIDTH,
  QUEUE_SWIPE_OPEN_THRESHOLD,
  type QueueSwipeAction,
  type QueueSwipeAvailability,
} from '@/lib/queueInbox';
import { useTheme } from '@/lib/theme';

type Props = {
  rowId: string;
  children: React.ReactNode;
  availability: QueueSwipeAvailability;
  onAction: (action: QueueSwipeAction) => void;
  actions: { name: QueueSwipeAction; label: string }[];
  coordinator: QueueSwipeCoordinator;
  accessibilityLabel?: string;
  disabled?: boolean;
};

type AccessibleChildProps = {
  accessibilityLabel?: string;
  accessibilityActions?: { name: string; label?: string }[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
};

export function SwipeableRow({
  rowId,
  children,
  availability,
  onAction,
  actions,
  coordinator,
  accessibilityLabel,
  disabled = false,
}: Props) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const swipeableRef = useRef<Swipeable | null>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => () => coordinator.unregister(rowId), [coordinator, rowId]);

  function closeRow() {
    if (reduceMotion) swipeableRef.current?.reset();
    else swipeableRef.current?.close();
  }

  function runAction(action: QueueSwipeAction) {
    coordinator.closed(rowId);
    closeRow();
    onAction(action);
  }

  function handleAccessibilityAction(event: AccessibilityActionEvent) {
    const name = event.nativeEvent.actionName as QueueSwipeAction;
    if (actions.some((action) => action.name === name)) runAction(name);
  }

  function renderAction(
    action: QueueSwipeAction,
    progress: Animated.AnimatedInterpolation<number>,
  ) {
    const isSave = action === 'save';
    const opacity = progress.interpolate({
      inputRange: [0, 0.45, 1],
      outputRange: [0, 0.7, 1],
      extrapolate: 'clamp',
    });
    const scale = progress.interpolate({
      inputRange: [0, 1],
      outputRange: [0.86, 1],
      extrapolate: 'clamp',
    });
    return (
      <Pressable
        onPress={() => runAction(action)}
        style={[
          styles.action,
          isSave ? styles.saveAction : styles.removeAction,
        ]}
        accessibilityRole="button"
        accessibilityLabel={isSave ? 'Save to my map' : 'Remove from queue'}
      >
        <Animated.View style={[styles.actionContent, { opacity, transform: [{ scale }] }]}>
          <Feather
            name={isSave ? 'bookmark' : 'trash-2'}
            size={19}
            color={colors.textInverse}
          />
          <Text style={styles.actionText}>{isSave ? 'Save' : 'Remove'}</Text>
        </Animated.View>
      </Pressable>
    );
  }

  const accessibilityProps: AccessibleChildProps = {
    accessibilityLabel,
    accessibilityActions: actions.map((action) => ({
      name: action.name,
      label: action.label,
    })),
    onAccessibilityAction: handleAccessibilityAction,
  };
  const accessibleChild = isValidElement(children)
    ? cloneElement(children as ReactElement<AccessibleChildProps>, accessibilityProps)
    : children;

  return (
    <Swipeable
      ref={swipeableRef}
      enabled={!disabled}
      friction={1.65}
      leftThreshold={QUEUE_SWIPE_OPEN_THRESHOLD}
      rightThreshold={QUEUE_SWIPE_OPEN_THRESHOLD}
      dragOffsetFromLeftEdge={18}
      dragOffsetFromRightEdge={18}
      overshootLeft={false}
      overshootRight={false}
      useNativeAnimations
      containerStyle={styles.container}
      childrenContainerStyle={styles.rowSurface}
      renderLeftActions={availability.save ? (progress) => renderAction('save', progress) : undefined}
      renderRightActions={availability.dismiss ? (progress) => renderAction('dismiss', progress) : undefined}
      onSwipeableWillOpen={() => {
        coordinator.open(rowId, closeRow);
        hapticSelection();
      }}
      onSwipeableClose={() => coordinator.closed(rowId)}
    >
      {accessibleChild}
    </Swipeable>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: { overflow: 'hidden' },
    rowSurface: { backgroundColor: colors.surface },
    action: {
      width: QUEUE_ACTION_WIDTH,
      alignItems: 'center',
      justifyContent: 'center',
    },
    saveAction: { backgroundColor: colors.primary },
    removeAction: { backgroundColor: colors.danger },
    actionContent: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: Spacing.xs,
      minWidth: 64,
      minHeight: 64,
    },
    actionText: { color: colors.textInverse, fontWeight: '700', fontSize: 12 },
  });
}
