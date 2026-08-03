import { useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { NearrFavoritesHelp, ShareSheetMock } from '../demo';
import { OnboardingColors } from '../theme';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Called after the Nearr tile is tapped (and the sheet begins dismissing). */
  onNearrTap: () => void;
  onHelpOpened: () => void;
  onHelpStepViewed: (step: number) => void;
  onHelpClosed: () => void;
};

/**
 * Screen 3 of 5 — Choose Nearr (interactive).
 *
 * Privacy-safe: fictional recipients only (Alex / Sam / Jordan / Taylor); the
 * Nearr tile uses the real app icon. Tapping the Nearr tile slides the sheet
 * down and advances the flow; nothing else is tappable.
 */
export function ChooseNearrScreen({
  onNearrTap,
  onHelpOpened,
  onHelpStepViewed,
  onHelpClosed,
}: Props) {
  const { width } = useWindowDimensions();
  const sheetWidth = width - Spacing.xl * 2;

  const slide = useRef(new Animated.Value(0)).current;
  const firedRef = useRef(false);
  const [helpVisible, setHelpVisible] = useState(false);

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

  const openHelp = () => {
    setHelpVisible(true);
    onHelpOpened();
  };

  const closeHelp = () => {
    setHelpVisible(false);
    onHelpClosed();
  };

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="Choose Nearr from the Share Sheet"
        subtext="Now tap Nearr in the iOS Share Sheet."
      />

      <Animated.View style={[styles.demo, { transform: [{ translateY }], opacity }]}>
        <ShareSheetMock width={sheetWidth} onNearrPress={handleNearr} />
      </Animated.View>

      {Platform.OS === 'ios' ? (
        <Pressable
          onPress={openHelp}
          style={({ pressed }) => [styles.helpButton, pressed && styles.helpButtonPressed]}
          accessibilityRole="button"
          accessibilityLabel="Don't see Nearr?"
          accessibilityHint="Opens iPhone Share Sheet instructions for adding Nearr to Favorites"
        >
          <Feather name="help-circle" size={17} color={OnboardingColors.orange} />
          <Text style={styles.helpButtonText}>Don&apos;t see Nearr?</Text>
        </Pressable>
      ) : null}

      <NearrFavoritesHelp
        visible={helpVisible}
        onClose={closeHelp}
        onStepViewed={onHelpStepViewed}
      />
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
  helpButton: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingHorizontal: 14,
  },
  helpButtonPressed: {
    opacity: 0.68,
  },
  helpButtonText: {
    color: OnboardingColors.textMuted,
    fontSize: 14,
    fontWeight: '700',
  },
});
