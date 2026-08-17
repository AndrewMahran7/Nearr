import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';

import { OnboardingColors, OnboardingRadius } from '../theme';

type Props = {
  /** Bump this key to replay the sequence (e.g. when the screen re-focuses). */
  playKey?: number;
  /** Fired once when the simulated auto-save reaches the saved state. */
  onSaved?: () => void;
  style?: ViewStyle;
};

/** Stage of the simulated sequence: finding → found → saved. */
type Stage = 'finding' | 'found' | 'saved';

const FIND_DURATION = 1400;
const REVEAL_DURATION = 380;
/** Gap between "Found it" and "Saved to your map" — comprehension, not realism. */
const SAVE_DELAY = 550;

/**
 * Screen 4 — deterministic, native "Nearr finds it and saves it" demonstration.
 *
 * The whole sequence runs by itself: finding → found → saved to your map. That
 * mirrors the real product, where a post with one clear place is saved without
 * the user tapping anything, so this card is deliberately NOT interactive — it
 * has no Save button.
 *
 * It does NOT call the extraction backend, make any network request, or save
 * anything real. Respects Reduce Motion by jumping straight to the saved state.
 */
export function FindingSavingCard({ playKey = 0, onSaved, style }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const savedReveal = useRef(new Animated.Value(0)).current;
  const [stage, setStage] = useState<Stage>('finding');

  // `onSaved` is analytics-only; it must never re-trigger the sequence.
  const onSavedRef = useRef(onSaved);
  useEffect(() => {
    onSavedRef.current = onSaved;
  }, [onSaved]);

  // The sequence. Re-runs from the start on mount and whenever `playKey`
  // changes, so a user who navigates back never finds it stuck at "saved".
  useEffect(() => {
    let cancelled = false;
    let saveTimer: ReturnType<typeof setTimeout> | null = null;
    progress.setValue(0);
    reveal.setValue(0);
    savedReveal.setValue(0);
    setStage('finding');

    const settleOnSaved = () => {
      if (cancelled) return;
      setStage('saved');
      onSavedRef.current?.();
      AccessibilityInfo.announceForAccessibility('Saved to your map');
    };

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        // No motion: show the finished, fully-explained state immediately.
        progress.setValue(1);
        reveal.setValue(1);
        savedReveal.setValue(1);
        settleOnSaved();
        return;
      }
      Animated.timing(progress, {
        toValue: 1,
        duration: FIND_DURATION,
        delay: 350,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (!finished || cancelled) return;
        setStage('found');
        AccessibilityInfo.announceForAccessibility('Found it');
        saveTimer = setTimeout(settleOnSaved, SAVE_DELAY);
      });
    });

    return () => {
      cancelled = true;
      if (saveTimer) clearTimeout(saveTimer);
    };
  }, [playKey, progress, reveal, savedReveal]);

  const found = stage !== 'finding';
  const saved = stage === 'saved';

  // Reveal the result card once found, then the saved row once saved.
  useEffect(() => {
    if (!found) return;
    Animated.timing(reveal, {
      toValue: 1,
      duration: REVEAL_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [found, reveal]);

  useEffect(() => {
    if (!saved) return;
    Animated.timing(savedReveal, {
      toValue: 1,
      duration: REVEAL_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [saved, savedReveal]);

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['6%', '100%'],
  });
  const revealTranslate = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
  });
  const savedTranslate = savedReveal.interpolate({
    inputRange: [0, 1],
    outputRange: [8, 0],
  });

  return (
    <View style={[styles.card, style]}>
      {/* Shared post preview */}
      <View style={styles.previewRow}>
        <View style={styles.previewThumb}>
          <View style={styles.thumbRoadA} />
          <View style={styles.thumbRoadB} />
          <Feather name="film" size={18} color={OnboardingColors.text} />
        </View>
        <View style={styles.previewText}>
          <Text style={styles.previewTitle}>Instagram reel</Text>
          <Text style={styles.previewSub}>@kaitpark</Text>
          <Text style={styles.previewSub}>Tokyo, Japan</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {/*
        Status. Every state is spelled out in text — never a bare colored
        check — so it reads the same with a screen reader or no color vision.
      */}
      <View style={styles.findingRow}>
        {found ? (
          <View style={styles.check}>
            <Feather name="check" size={13} color={OnboardingColors.orange} />
          </View>
        ) : (
          <Feather name="star" size={18} color={OnboardingColors.orange} />
        )}
        <Text style={styles.findingText}>{found ? 'Found it' : 'Finding the place...'}</Text>
      </View>
      <View
        style={styles.track}
        accessibilityRole="progressbar"
        accessibilityLabel={found ? 'Found it' : 'Finding the place'}
      >
        <Animated.View style={[styles.fill, { width: barWidth }]} />
      </View>

      {/* Result reveal — informational only; there is nothing to tap. */}
      {found ? (
        <Animated.View
          style={[
            styles.foundWrap,
            { opacity: reveal, transform: [{ translateY: revealTranslate }] },
          ]}
        >
          <View style={styles.placeCard}>
            <View style={styles.miniMap}>
              <View style={styles.miniRoadA} />
              <View style={styles.miniRoadB} />
              <Feather name="map-pin" size={20} color={OnboardingColors.orange} />
            </View>
            <View style={styles.placeInfo}>
              <Text style={styles.placeName} numberOfLines={1}>
                Allpress Espresso
              </Text>
              <Text style={styles.placeMeta} numberOfLines={1}>
                Coffee shop · Tokyo, Japan
              </Text>
            </View>
          </View>

          {saved ? (
            <Animated.View
              style={[
                styles.savedRow,
                { opacity: savedReveal, transform: [{ translateY: savedTranslate }] },
              ]}
              accessibilityLiveRegion="polite"
            >
              <View style={styles.check}>
                <Feather name="check" size={13} color={OnboardingColors.orange} />
              </View>
              <Text style={styles.savedText}>Saved to your map</Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
    padding: 18,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  previewThumb: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: '#15100C',
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbRoadA: {
    position: 'absolute',
    width: '160%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ rotate: '30deg' }],
  },
  thumbRoadB: {
    position: 'absolute',
    width: '160%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    transform: [{ rotate: '-40deg' }],
  },
  previewText: {
    flex: 1,
    gap: 2,
  },
  previewTitle: {
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  previewSub: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
  },
  divider: {
    height: 1,
    backgroundColor: OnboardingColors.border,
    marginVertical: 18,
  },
  findingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
  },
  findingText: {
    flex: 1,
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  track: {
    height: 8,
    borderRadius: 999,
    backgroundColor: '#2A2A2A',
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: OnboardingColors.orange,
  },
  foundWrap: {
    marginTop: 20,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: OnboardingColors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  placeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.cardElevated,
  },
  miniMap: {
    width: 52,
    height: 52,
    borderRadius: 12,
    backgroundColor: '#0E0E11',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  miniRoadA: {
    position: 'absolute',
    width: '170%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ rotate: '28deg' }],
  },
  miniRoadB: {
    position: 'absolute',
    width: '170%',
    height: 6,
    backgroundColor: 'rgba(255,255,255,0.05)',
    transform: [{ rotate: '-46deg' }],
  },
  placeInfo: {
    flex: 1,
  },
  placeName: {
    color: OnboardingColors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  placeMeta: {
    color: OnboardingColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
  },
  savedText: {
    flex: 1,
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
