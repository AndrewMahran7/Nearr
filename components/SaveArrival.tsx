import { useEffect, useRef } from 'react';
import { Animated, AppState, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { useReduceMotion } from '@/lib/useReduceMotion';

/** A local arrival cue for an already-persisted place. It never moves the camera. */
export function SaveArrival({ identity, bottom = 162 }: { identity: string | null; bottom?: number }) {
  const { colors } = useTheme();
  const reduced = useReduceMotion();
  const progress = useRef(new Animated.Value(0)).current;
  const previous = useRef<string | null>(null);
  useEffect(() => {
    if (!identity) { previous.current = null; progress.setValue(1); return; }
    if (previous.current === identity || AppState.currentState !== 'active') { progress.setValue(1); return; }
    previous.current = identity;
    progress.setValue(0);
    const animation = Animated.timing(progress, { toValue: 1, duration: reduced ? 220 : 780, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [identity, progress, reduced]);
  if (!identity) return null;
  const opacity = progress.interpolate({ inputRange: [0, 0.15, 0.78, 1], outputRange: [0, 1, 1, 0] });
  return <Animated.View pointerEvents="none" accessible={false} importantForAccessibility="no-hide-descendants" style={[styles.wrap, { bottom, opacity }]}>
    <Animated.View style={[styles.ring, { borderColor: colors.brand, transform: [{ scale: reduced ? 1 : progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0.8, 1, 1.3] }) }] }]} />
    <Animated.View style={[styles.pin, { backgroundColor: colors.surface, transform: [{ translateY: reduced ? 0 : progress.interpolate({ inputRange: [0, 0.55, 0.75, 1], outputRange: [-24, 0, -3, 0] }) }, { scale: reduced ? 1 : progress.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.72, 1, 1] }) }] }]}><Feather name="map-pin" size={26} color={colors.primary} /></Animated.View>
    <View style={styles.spark}><Text style={{ color: colors.brand, fontSize: 20 }}>✦</Text></View>
  </Animated.View>;
}
const styles = StyleSheet.create({
  wrap: { position: 'absolute', alignSelf: 'center', width: 64, height: 64, alignItems: 'center', justifyContent: 'center', zIndex: 31 },
  ring: { position: 'absolute', width: 48, height: 48, borderRadius: 24, borderWidth: 2 },
  pin: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  spark: { position: 'absolute', right: 0, top: 0 },
});
