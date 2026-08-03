import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { Spacing } from '@/constants';
import { InstagramReelMock } from '../demo';
import { OnboardingColors, OnboardingRadius } from '../theme';
import { ScreenHeading } from './ScreenHeading';

type Props = {
  /** Called when the highlighted Share target opens the local Instagram panel. */
  onShareTap: () => void;
  /** Called when the highlighted Share to action is tapped. */
  onShareToTap: () => void;
};

const RECIPIENTS = ['Mia', 'Leo', 'Noor'] as const;

/**
 * Screen 2 of 5 — Tap Share (interactive).
 *
 * The user taps Share, then Share to… in a controlled local Instagram mock.
 * Everything is drawn natively — no network or Instagram dependency.
 */
export function TapShareScreen({ onShareTap, onShareToTap }: Props) {
  const { width } = useWindowDimensions();
  const reelWidth = Math.min(300, width - Spacing.xl * 2);
  const panelSlide = useRef(new Animated.Value(1)).current;
  const reduceMotionRef = useRef(false);
  const shareToFiredRef = useRef(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
  }, []);

  const handleShare = () => {
    if (panelOpen) return;
    setPanelOpen(true);
    onShareTap();

    if (reduceMotionRef.current) {
      panelSlide.setValue(0);
      return;
    }
    Animated.timing(panelSlide, {
      toValue: 0,
      duration: 300,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const handleShareTo = () => {
    if (shareToFiredRef.current) return;
    shareToFiredRef.current = true;
    onShareToTap();

    if (reduceMotionRef.current) {
      panelSlide.setValue(1);
      return;
    }
    Animated.timing(panelSlide, {
      toValue: 1,
      duration: 280,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start();
  };

  const panelTranslateY = panelSlide.interpolate({ inputRange: [0, 1], outputRange: [0, 250] });

  return (
    <View style={styles.container}>
      <ScreenHeading
        headline="See somewhere you want to go?"
        subtext="When you find a place on Instagram, tap the Share button."
      />

      <View style={[styles.demo, { width: reelWidth }]}>
        <InstagramReelMock width={reelWidth} highlightShare onSharePress={handleShare} />

        {panelOpen ? (
          <Animated.View
            style={[styles.sharePanel, { transform: [{ translateY: panelTranslateY }] }]}
            accessibilityViewIsModal
            accessibilityLabel="Simulated Instagram sharing panel"
          >
            <View style={styles.grabber} />
            <Text style={styles.panelTitle}>Share</Text>

            <View style={styles.recipients} accessibilityLabel="Example recipients">
              {RECIPIENTS.map((name, index) => (
                <View key={name} style={styles.recipient}>
                  <View style={[styles.avatar, index === 1 && styles.avatarAlt]}>
                    <Text style={styles.avatarText}>{name[0]}</Text>
                  </View>
                  <Text style={styles.recipientName}>{name}</Text>
                </View>
              ))}
            </View>

            <View style={styles.shareToCallout} pointerEvents="none">
              <Text style={styles.shareToCalloutText}>Tap Share to…</Text>
            </View>
            <Pressable
              onPress={handleShareTo}
              style={({ pressed }) => [styles.shareToTarget, pressed && styles.shareToPressed]}
              accessibilityRole="button"
              accessibilityLabel="Share to…"
              accessibilityHint="Opens the simulated iOS Share Sheet and advances the tutorial"
            >
              <View style={styles.shareToIcon}>
                <Feather name="share" size={19} color={OnboardingColors.onOrange} />
              </View>
              <Text style={styles.shareToText}>Share to…</Text>
              <Feather name="chevron-right" size={20} color={OnboardingColors.text} />
            </Pressable>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  demo: {
    position: 'relative',
    alignItems: 'center',
    alignSelf: 'center',
    marginTop: 4,
    overflow: 'hidden',
    borderRadius: OnboardingRadius.card,
  },
  sharePanel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 226,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 14,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#D5D5D9',
    backgroundColor: '#F7F7F8',
    zIndex: 5,
    elevation: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#C4C4C7',
  },
  panelTitle: {
    color: '#161618',
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 7,
  },
  recipients: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 22,
    marginTop: 10,
    marginBottom: 10,
  },
  recipient: {
    alignItems: 'center',
    width: 44,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6F8FD8',
  },
  avatarAlt: {
    backgroundColor: '#C07A66',
  },
  avatarText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  recipientName: {
    color: '#3C3C43',
    fontSize: 10,
    marginTop: 3,
  },
  shareToCallout: {
    alignSelf: 'flex-end',
    width: 126,
    minHeight: 30,
    marginBottom: 4,
    paddingHorizontal: 9,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: OnboardingColors.orange,
    zIndex: 2,
  },
  shareToCalloutText: {
    color: OnboardingColors.onOrange,
    fontSize: 11,
    fontWeight: '800',
    flexShrink: 0,
  },
  shareToTarget: {
    minHeight: 52,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 2,
    borderColor: OnboardingColors.orange,
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
  },
  shareToPressed: {
    opacity: 0.72,
  },
  shareToIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: OnboardingColors.orange,
  },
  shareToText: {
    flex: 1,
    color: '#161618',
    fontSize: 15,
    fontWeight: '800',
    flexShrink: 0,
  },
});
