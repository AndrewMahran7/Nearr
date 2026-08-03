import { useRef } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';

import { Spacing } from '@/constants';
import { ShareSheetMock } from '../demo';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Called after the Nearr tile is tapped (and the sheet begins dismissing). */
  onNearrTap: () => void;
};

/**
 * Screen 3 of 5 — Choose Nearr (interactive).
 *
 * Privacy-safe: fictional recipients only (Alex / Sam / Jordan / Taylor); the
 * Nearr tile uses the real app icon. Tapping the Nearr tile slides the sheet
 * down and advances the flow; nothing else is tappable.
 */
export function ChooseNearrScreen({ onNearrTap }: Props) {
  const { width } = useWindowDimensions();
  const sheetWidth = width - Spacing.xl * 2;

  const slide = useRef(new Animated.Value(0)).current;
  const firedRef = useRef(false);

  const handleNearr = () => {
    if (firedRef.current) return;
    firedRef.current = true;

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (!reduceMotion) {
        Animated.timing(slide, {
          toValue: 1,
          duration: 300,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }).start();
      }
    });

    onNearrTap();
  };

  const translateY = slide.interpolate({ inputRange: [0, 1], outputRange: [0, 420] });
  const opacity = slide.interpolate({ inputRange: [0, 1], outputRange: [1, 0] });

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Choose Nearr from the Share Sheet"
        subtext="Now tap Nearr in the iOS Share Sheet."
      />

      <Animated.View style={[styles.demo, { transform: [{ translateY }], opacity }]}>
        <ShareSheetMock width={sheetWidth} onNearrPress={handleNearr} />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    overflow: 'hidden',
  },
  demo: {
    marginTop: 4,
  },
});
