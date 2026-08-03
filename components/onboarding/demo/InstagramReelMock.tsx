import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { OnboardingColors, OnboardingRadius } from '../theme';

type Props = {
  /** Card width in px. Height is derived from a reel-ish aspect ratio. */
  width?: number;
  /** Compact mode trims chrome/paddings for the small hero on Screen 1. */
  compact?: boolean;
  /**
   * Ring + "Tap Share" callout around the share (send) icon. Used on the
   * Screen 2 "See somewhere you want to go?" demonstration.
   */
  highlightShare?: boolean;
  /**
   * Called when the highlighted Share target is tapped. When provided (with
   * `highlightShare`), the Share icon becomes an actual accessible tap target
   * with a pulsing ring; nothing else in the reel is tappable.
   */
  onSharePress?: () => void;
  /**
   * Optional bundled media (image now, or a future MP4 poster). When omitted,
   * a fully native faux-storefront scene is rendered so the demo needs no
   * network and no bundled photo.
   */
  media?: ImageSourcePropType;
  style?: ViewStyle;
};

/**
 * Controlled, offline Instagram-style reel used across the onboarding
 * demonstration. Everything is drawn with native views — it never touches
 * Instagram, a website, or the network. Caption/handle/metrics are fictional
 * demo copy, not real accounts.
 */
export function InstagramReelMock({
  width = 300,
  compact = false,
  highlightShare = false,
  onSharePress,
  media,
  style,
}: Props) {
  const mediaHeight = Math.round(width * (compact ? 0.82 : 1.02));
  const interactive = highlightShare && !!onSharePress;

  return (
    <View style={[styles.card, { width }, style]} accessibilityRole="image">
      {/* Header: avatar + handle + location */}
      <View style={[styles.header, compact && styles.headerCompact]}>
        <View style={[styles.avatar, compact && styles.avatarCompact]} />
        <View style={styles.headerText}>
          <Text style={[styles.handle, compact && styles.handleCompact]} numberOfLines={1}>
            kaitpark
          </Text>
          {!compact ? <Text style={styles.location}>Tokyo, Japan</Text> : null}
        </View>
        <Feather name="more-horizontal" size={compact ? 14 : 18} color={OnboardingColors.text} />
      </View>

      {/* Media area — bundled image or native faux storefront */}
      <View style={[styles.media, { height: mediaHeight }]}>
        {media ? (
          <Image source={media} style={styles.mediaImage} resizeMode="cover" />
        ) : (
          <FauxStorefront />
        )}

        {/* Right action rail */}
        <View style={styles.rail}>
          <RailAction icon="heart" label="14.8K" compact={compact} />
          <RailAction icon="message-circle" label="58" compact={compact} />
          <ShareAction
            compact={compact}
            highlighted={highlightShare}
            interactive={interactive}
            onPress={onSharePress}
          />
        </View>
      </View>

      {!compact ? (
        <View style={styles.caption}>
          <Text style={styles.captionText} numberOfLines={2}>
            <Text style={styles.captionHandle}>kaitpark </Text>
            Perfect flat white and the best oat latte in Tokyo
          </Text>
          <Text style={styles.comments}>View all 58 comments</Text>
        </View>
      ) : null}
    </View>
  );
}

/** Native, tasteful cafe-storefront scene (no gradient lib, no photo asset). */
function FauxStorefront() {
  return (
    <View style={styles.scene}>
      <View style={styles.windowRow}>
        <View style={styles.window} />
        <View style={styles.window} />
        <View style={styles.window} />
      </View>
      <View style={styles.sign}>
        <Feather name="coffee" size={14} color="#F4D9B8" />
        <Text style={styles.signText}>ESPRESSO BAR</Text>
      </View>
      <View style={styles.planterRow}>
        <View style={styles.planter} />
        <View style={[styles.planter, styles.planterWide]} />
        <View style={styles.planter} />
      </View>
      <View style={styles.vignette} pointerEvents="none" />
    </View>
  );
}

function RailAction({
  icon,
  label,
  compact,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  compact?: boolean;
}) {
  return (
    <View style={styles.railAction}>
      <Feather name={icon} size={compact ? 18 : 24} color={OnboardingColors.text} />
      {!compact ? <Text style={styles.railLabel}>{label}</Text> : null}
    </View>
  );
}

/**
 * The Share (send) icon. When interactive it is a real ≥44×44 accessible tap
 * target with a pulsing orange ring (shape-based affordance, not colour alone)
 * and a "Tap Share" callout, plus a brief scale-bounce on press.
 */
function ShareAction({
  compact,
  highlighted,
  interactive,
  onPress,
}: {
  compact?: boolean;
  highlighted?: boolean;
  interactive?: boolean;
  onPress?: () => void;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  const scale = useRef(new Animated.Value(1)).current;
  const firedRef = useRef(false);

  useEffect(() => {
    if (!interactive) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [interactive, pulse]);

  const handlePress = () => {
    if (firedRef.current) return;
    firedRef.current = true;
    Animated.sequence([
      Animated.timing(scale, { toValue: 0.82, duration: 90, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onPress?.();
  };

  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.14] });
  const iconSize = compact ? 18 : 24;

  const content = (
    <Animated.View style={{ transform: [{ scale }] }}>
      {highlighted ? (
        <Animated.View
          style={[styles.shareRing, { transform: [{ scale: ringScale }] }]}
        >
          <Feather name="send" size={iconSize} color={OnboardingColors.text} />
        </Animated.View>
      ) : (
        <Feather name="send" size={iconSize} color={OnboardingColors.text} />
      )}
    </Animated.View>
  );

  return (
    <View style={styles.railAction}>
      {interactive ? (
        <View style={styles.shareTargetWrap}>
          {highlighted ? (
            <View style={styles.shareCallout}>
              <Text style={styles.shareCalloutText} numberOfLines={1}>
                Tap Share
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={handlePress}
            hitSlop={10}
            style={styles.shareTarget}
            accessibilityRole="button"
            accessibilityLabel="Share this post to Nearr"
            accessibilityHint="Opens a simulated Instagram sharing panel"
          >
            {content}
          </Pressable>
        </View>
      ) : (
        content
      )}
      {!compact ? <Text style={styles.railLabel}>1,404</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#101010',
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  headerCompact: {
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#3A2A22',
  },
  avatarCompact: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  headerText: {
    flex: 1,
  },
  handle: {
    color: OnboardingColors.text,
    fontSize: 14,
    fontWeight: '700',
  },
  handleCompact: {
    fontSize: 12,
  },
  location: {
    color: OnboardingColors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  media: {
    width: '100%',
    backgroundColor: '#15100C',
  },
  mediaImage: {
    width: '100%',
    height: '100%',
  },
  scene: {
    flex: 1,
    backgroundColor: '#15100C',
    paddingTop: 26,
    paddingHorizontal: 18,
  },
  windowRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  window: {
    flex: 1,
    height: 74,
    borderRadius: 6,
    backgroundColor: '#3B2A1C',
    borderWidth: 1,
    borderColor: 'rgba(244, 196, 140, 0.25)',
  },
  sign: {
    alignSelf: 'center',
    marginTop: 18,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#0C0906',
    borderWidth: 1,
    borderColor: 'rgba(244, 196, 140, 0.35)',
  },
  signText: {
    color: '#F4D9B8',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  planterRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginTop: 22,
  },
  planter: {
    width: 34,
    height: 22,
    borderRadius: 5,
    backgroundColor: '#241A12',
  },
  planterWide: {
    width: 58,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
  },
  rail: {
    position: 'absolute',
    right: 10,
    bottom: 12,
    alignItems: 'center',
    gap: 14,
  },
  railAction: {
    alignItems: 'center',
    gap: 3,
  },
  railLabel: {
    color: OnboardingColors.text,
    fontSize: 11,
    fontWeight: '700',
  },
  shareTargetWrap: {
    alignItems: 'center',
  },
  shareTarget: {
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shareRing: {
    padding: 7,
    borderRadius: 999,
    borderWidth: 2.5,
    borderColor: OnboardingColors.orange,
    backgroundColor: 'rgba(255, 107, 0, 0.14)',
  },
  shareCallout: {
    // Explicit width so the pill is NOT constrained by its narrow (44px) rail
    // parent. With only a `right` inset and no width, Yoga capped the pill's
    // width at (parentWidth - right) = 44 - 34 = ~10px, which truncated
    // "Tap Share" to "Ta..." on Android. A fixed width removes that cap while
    // keeping the pill above-left of the icon and inside the reel card.
    position: 'absolute',
    bottom: 46,
    right: 34,
    width: 100,
    alignItems: 'center',
    backgroundColor: OnboardingColors.orange,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  shareCalloutText: {
    color: OnboardingColors.onOrange,
    fontSize: 12,
    fontWeight: '800',
    flexShrink: 0,
  },
  caption: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 3,
  },
  captionText: {
    color: OnboardingColors.text,
    fontSize: 12.5,
    lineHeight: 17,
  },
  captionHandle: {
    fontWeight: '700',
  },
  comments: {
    color: OnboardingColors.textMuted,
    fontSize: 12,
  },
});
