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
  const actionPulse = useRef(new Animated.Value(0)).current;
  const reduceMotionRef = useRef(false);
  const shareToFiredRef = useRef(false);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      reduceMotionRef.current = enabled;
    });
  }, []);

  useEffect(() => {
    if (!panelOpen) return;
    let cancelled = false;
    let loop: Animated.CompositeAnimation | null = null;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled || reduceMotion) return;
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(actionPulse, {
            toValue: 1,
            duration: 850,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
          Animated.timing(actionPulse, {
            toValue: 0,
            duration: 850,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
    });
    return () => {
      cancelled = true;
      loop?.stop();
    };
  }, [actionPulse, panelOpen]);

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
  const actionScale = actionPulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.05] });
  const actionGlow = actionPulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

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
            <View style={styles.searchRow}>
              <Feather name="search" size={17} color={stylesTokens.panelMuted} />
              <Text style={styles.searchText}>Search</Text>
              <View style={styles.peopleButton}>
                <Feather name="user-plus" size={16} color={stylesTokens.panelText} />
              </View>
            </View>

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

            <View style={styles.panelDivider} />
            <View style={styles.actionsRow}>
              <ActionItem icon="plus-circle" label="Add to story" />
              <Animated.View
                style={{ opacity: actionGlow, transform: [{ scale: actionScale }] }}
              >
                <Pressable
                  onPress={handleShareTo}
                  style={({ pressed }) => [styles.shareToTarget, pressed && styles.shareToPressed]}
                  accessibilityRole="button"
                  accessibilityLabel="Share to…"
                  accessibilityHint="Opens the simulated iOS Share Sheet and advances the tutorial"
                >
                  <View style={[styles.actionIcon, styles.shareToIcon]}>
                    <Feather name="share" size={21} color={stylesTokens.panelText} />
                  </View>
                  <Text style={styles.shareToText} numberOfLines={1}>Share to…</Text>
                </Pressable>
              </Animated.View>
              <ActionItem icon="link" label="Copy link" />
            </View>
          </Animated.View>
        ) : null}
      </View>
    </View>
  );
}

function ActionItem({
  icon,
  label,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.actionItem} accessibilityElementsHidden>
      <View style={styles.actionIcon}>
        <Feather name={icon} size={21} color={stylesTokens.panelText} />
      </View>
      <Text style={styles.actionLabel} numberOfLines={1}>{label}</Text>
    </View>
  );
}

const stylesTokens = {
  panel: '#171C1F',
  panelRaised: '#252C31',
  panelText: '#F7F7F8',
  panelMuted: '#A8ADB2',
} as const;

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
    minHeight: 270,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 12,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    borderBottomWidth: 0,
    borderColor: '#343B40',
    backgroundColor: stylesTokens.panel,
    zIndex: 5,
    elevation: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 36,
    height: 4,
    borderRadius: 999,
    backgroundColor: '#8E959B',
    marginBottom: 12,
  },
  searchRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 12,
    borderRadius: 14,
    backgroundColor: stylesTokens.panelRaised,
  },
  searchText: {
    flex: 1,
    color: stylesTokens.panelMuted,
    fontSize: 15,
  },
  peopleButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: 1,
    borderLeftColor: '#343B40',
  },
  recipients: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginTop: 12,
    marginBottom: 12,
  },
  recipient: {
    alignItems: 'center',
    width: 58,
  },
  avatar: {
    width: 46,
    height: 46,
    borderRadius: 23,
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
    color: stylesTokens.panelText,
    fontSize: 11,
    marginTop: 5,
  },
  panelDivider: {
    height: 1,
    backgroundColor: '#343B40',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: 10,
  },
  actionItem: {
    width: 76,
    minHeight: 72,
    alignItems: 'center',
  },
  actionIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: stylesTokens.panelRaised,
  },
  actionLabel: {
    color: stylesTokens.panelText,
    fontSize: 11,
    marginTop: 5,
    flexShrink: 0,
  },
  shareToTarget: {
    width: 76,
    minHeight: 72,
    alignItems: 'center',
  },
  shareToPressed: {
    opacity: 0.72,
  },
  shareToIcon: {
    borderWidth: 2.5,
    borderColor: OnboardingColors.orange,
    backgroundColor: '#2B241F',
  },
  shareToText: {
    color: OnboardingColors.orange,
    fontSize: 11,
    fontWeight: '800',
    marginTop: 5,
    flexShrink: 0,
  },
});
