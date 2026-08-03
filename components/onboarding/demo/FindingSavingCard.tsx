import { useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
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
  /** Called when the user taps the (accessible) Save action on the result card. */
  onSave?: () => void;
  style?: ViewStyle;
};

const FIND_DURATION = 1600;
const REVEAL_DURATION = 380;

/**
 * Screen 4 — deterministic, native "finding and saving" demonstration.
 *
 * The scan → progress → found → result sequence runs automatically on appear.
 * It does NOT call the extraction backend, make any network request, or save
 * anything real. Once the result is revealed the user must tap the real Save
 * action to proceed. Respects Reduce Motion by jumping to the resolved state.
 */
export function FindingSavingCard({ playKey = 0, onSave, style }: Props) {
  const progress = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const saveScale = useRef(new Animated.Value(1)).current;
  const [found, setFound] = useState(false);
  const [saved, setSaved] = useState(false);
  const savedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    progress.setValue(0);
    reveal.setValue(0);
    saveScale.setValue(1);
    savedRef.current = false;
    setFound(false);
    setSaved(false);

    void AccessibilityInfo.isReduceMotionEnabled().then((reduceMotion) => {
      if (cancelled) return;
      if (reduceMotion) {
        progress.setValue(1);
        reveal.setValue(1);
        setFound(true);
        return;
      }
      Animated.timing(progress, {
        toValue: 1,
        duration: FIND_DURATION,
        delay: 350,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: false,
      }).start(({ finished }) => {
        if (finished && !cancelled) setFound(true);
      });
    });

    return () => {
      cancelled = true;
    };
  }, [playKey, progress, reveal, saveScale]);

  useEffect(() => {
    if (!found) return;
    Animated.timing(reveal, {
      toValue: 1,
      duration: REVEAL_DURATION,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [found, reveal]);

  const handleSave = () => {
    if (savedRef.current) return;
    savedRef.current = true;
    setSaved(true);
    Animated.sequence([
      Animated.timing(saveScale, { toValue: 0.9, duration: 90, useNativeDriver: true }),
      Animated.spring(saveScale, { toValue: 1, friction: 4, tension: 120, useNativeDriver: true }),
    ]).start();
    onSave?.();
  };

  const barWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['6%', '100%'],
  });
  const revealTranslate = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 0],
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

      {/* Finding progress */}
      <View style={styles.findingRow}>
        <Feather name="star" size={18} color={OnboardingColors.orange} />
        <Text style={styles.findingText}>
          {found ? 'Scanned the post' : 'Finding the place...'}
        </Text>
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { width: barWidth }]} />
      </View>

      {/* Result reveal */}
      {found ? (
        <Animated.View
          style={[
            styles.foundWrap,
            { opacity: reveal, transform: [{ translateY: revealTranslate }] },
          ]}
        >
          <View style={styles.foundHeader}>
            <View style={styles.check}>
              <Feather name="check" size={13} color={OnboardingColors.orange} />
            </View>
            <Text style={styles.foundTitle}>Found it</Text>
          </View>

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
                Coffee shop · Tokyo
              </Text>
            </View>

            <Animated.View style={{ transform: [{ scale: saveScale }] }}>
              <Pressable
                onPress={handleSave}
                disabled={saved}
                style={[styles.saveButton, saved && styles.saveButtonDone]}
                accessibilityRole="button"
                accessibilityLabel={saved ? 'Saved Allpress Espresso' : 'Save Allpress Espresso'}
                accessibilityState={{ disabled: saved }}
                accessibilityHint="Saves this place and advances the tutorial"
              >
                <Feather
                  name={saved ? 'check' : 'bookmark'}
                  size={15}
                  color={OnboardingColors.onOrange}
                />
                <Text style={styles.saveText}>{saved ? 'Saved' : 'Save'}</Text>
              </Pressable>
            </Animated.View>
          </View>
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
  foundHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 12,
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
  foundTitle: {
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '700',
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
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: OnboardingColors.orange,
  },
  saveButtonDone: {
    backgroundColor: '#2E7D32',
  },
  saveText: {
    color: OnboardingColors.onOrange,
    fontSize: 14,
    fontWeight: '800',
  },
});
