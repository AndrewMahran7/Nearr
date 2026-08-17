/**
 * ReminderToggle — a compact on/off switch for the Place Detail action row.
 *
 * Why not `<Switch>`: the iOS system switch is a fixed ~51×31pt and refuses to
 * shrink. In a row that also has to carry Directions, Watch post, Share, a
 * divider and a distance readout, those 51pt are the difference between
 * "Watch post" fitting and rendering as "Watch p…" — which is exactly what
 * shipped. This is 40×24, pure JS/RN (no native dependency), and behaves like
 * a switch to assistive tech: `accessibilityRole="switch"` with a real
 * `checked` state, and a 44pt effective target via hitSlop.
 *
 * The knob is driven by `Animated` on the native thread, so toggling stays
 * smooth while the sheet is scrolling.
 */

import { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, View } from 'react-native';

import { useTheme } from '@/lib/theme';

const TRACK_WIDTH = 40;
const TRACK_HEIGHT = 24;
const KNOB = 18;
const TRAVEL = TRACK_WIDTH - KNOB - 6;

export function ReminderToggle({
  value,
  onValueChange,
  accessibilityLabel,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  accessibilityLabel: string;
}) {
  const { colors } = useTheme();
  const progress = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: value ? 1 : 0,
      duration: 160,
      useNativeDriver: true,
    }).start();
  }, [progress, value]);

  return (
    <Pressable
      onPress={() => onValueChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      accessibilityLabel={accessibilityLabel}
      hitSlop={10}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
    >
      <View
        style={[
          styles.track,
          {
            backgroundColor: value ? colors.accent : colors.border,
            borderColor: value ? colors.accent : colors.border,
          },
        ]}
      >
        <Animated.View
          style={[
            styles.knob,
            {
              backgroundColor: colors.textInverse,
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, TRAVEL],
                  }),
                },
              ],
            },
          ]}
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center' },
  pressed: { opacity: 0.75 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    borderWidth: StyleSheet.hairlineWidth,
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  knob: {
    width: KNOB,
    height: KNOB,
    borderRadius: KNOB / 2,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
