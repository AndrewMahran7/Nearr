/**
 * SetupChecklist
 *
 * Two setup nudge items for beta onboarding:
 *   1. Always Location  — prompts users to upgrade to "Always" location access
 *      so background proximity notifications work correctly.
 *   2. Share Sheet Favorites — educates users on how to pin Nearr in the iOS
 *      Share Sheet so saving from Instagram/TikTok takes two taps.
 *
 * Persistence:
 *   - "shareFavDone"  — AsyncStorage flag; user manually marks complete.
 *   - Location item derives its completed state from the live permission status
 *     (no stored flag needed; re-checks on every mount/focus).
 *
 * Both items always appear in Settings so users can re-visit them.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { Colors, Radius, Spacing, Typography } from '@/constants';

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const SHARE_FAV_DONE_KEY = 'nearr:setupShareFavDone';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getLocationStatus(): Promise<'always' | 'whenInUse' | 'denied' | 'undetermined'> {
  try {
    const fg = await Location.getForegroundPermissionsAsync();
    if (fg.status !== 'granted') {
      return fg.status === 'denied' ? 'denied' : 'undetermined';
    }
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status === 'granted') return 'always';
    return 'whenInUse';
  } catch {
    return 'undetermined';
  }
}

// ---------------------------------------------------------------------------
// SetupChecklist
// ---------------------------------------------------------------------------

export function SetupChecklist() {
  const [locationStatus, setLocationStatus] = useState<
    'always' | 'whenInUse' | 'denied' | 'undetermined' | null
  >(null);
  const [shareFavDone, setShareFavDone] = useState(false);
  const [stepsVisible, setStepsVisible] = useState(false);

  const refresh = useCallback(async () => {
    const [status, stored] = await Promise.all([
      getLocationStatus(),
      AsyncStorage.getItem(SHARE_FAV_DONE_KEY),
    ]);
    setLocationStatus(status);
    setShareFavDone(stored === 'true');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleMarkShareFavDone() {
    await AsyncStorage.setItem(SHARE_FAV_DONE_KEY, 'true');
    setShareFavDone(true);
    setStepsVisible(false);
  }

  async function handleUnmarkShareFav() {
    await AsyncStorage.removeItem(SHARE_FAV_DONE_KEY);
    setShareFavDone(false);
  }

  const locationDone = locationStatus === 'always';

  return (
    <>
      {/* ---- Location item -------------------------------------------- */}
      <ChecklistItem
        done={locationDone}
        title="Turn on Always Location"
        body={
          locationDone
            ? 'Location is set to Always. Background notifications are active.'
            : 'Nearr can only notify you when you\u2019re near saved places if location access is set to Always.'
        }
        primaryLabel={locationDone ? undefined : 'Open Location Settings'}
        onPrimary={
          locationDone
            ? undefined
            : () => {
                Linking.openSettings().catch(() => {
                  Alert.alert(
                    'Cannot open settings',
                    'Go to Settings \u203a Privacy \u203a Location Services \u203a Nearr and set to Always.',
                  );
                });
              }
        }
      />

      <View style={{ height: Spacing.sm }} />

      {/* ---- Share favorites item -------------------------------------- */}
      <ChecklistItem
        done={shareFavDone}
        title="Add Nearr to Share Favorites"
        body={
          shareFavDone
            ? 'Nearr is in your Share Sheet favorites.'
            : 'Put Nearr at the front of your iPhone Share Sheet so saving places takes two taps.'
        }
        primaryLabel={shareFavDone ? undefined : 'Show Steps'}
        onPrimary={shareFavDone ? undefined : () => setStepsVisible(true)}
        secondaryLabel={shareFavDone ? 'Undo' : undefined}
        onSecondary={shareFavDone ? handleUnmarkShareFav : undefined}
      />

      {/* ---- Share steps modal ---------------------------------------- */}
      <ShareStepsModal
        visible={stepsVisible}
        onDone={handleMarkShareFavDone}
        onDismiss={() => setStepsVisible(false)}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// ChecklistItem
// ---------------------------------------------------------------------------

function ChecklistItem({
  done,
  title,
  body,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}: {
  done: boolean;
  title: string;
  body: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
}) {
  return (
    <View style={[styles.item, done && styles.itemDone]}>
      <View style={styles.itemHeader}>
        <View style={[styles.dot, done && styles.dotDone]} />
        <Text style={[Typography.label, styles.itemTitle]}>{title}</Text>
      </View>
      <Text style={[Typography.caption, styles.itemBody]}>{body}</Text>
      {(!done && primaryLabel) ? (
        <View style={styles.itemActions}>
          <Pressable style={styles.btnPrimary} onPress={onPrimary}>
            <Text style={[Typography.label, { color: Colors.textInverse }]}>
              {primaryLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {(done && secondaryLabel) ? (
        <View style={styles.itemActions}>
          <Pressable onPress={onSecondary}>
            <Text style={[Typography.caption, { color: Colors.textMuted }]}>
              {secondaryLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------
// ShareStepsModal
// ---------------------------------------------------------------------------

const SHARE_STEPS = [
  'Open Instagram or TikTok.',
  'Find a post with a place you want to save.',
  'Tap the Share button.',
  'Scroll the app row and tap \u2022\u2022\u2022 More.',
  'Tap Edit.',
  'Find Nearr and tap \u2795 to add it to Favorites.',
];

function ShareStepsModal({
  visible,
  onDone,
  onDismiss,
}: {
  visible: boolean;
  onDone: () => void;
  onDismiss: () => void;
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={Typography.heading}>Add Nearr to Share Favorites</Text>
          <Pressable onPress={onDismiss} style={styles.modalClose} hitSlop={12}>
            <Text style={[Typography.bodyStrong, { color: Colors.textMuted }]}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
          <Text style={[Typography.body, styles.modalIntro]}>
            Follow these steps once on your iPhone so saving places from Instagram or
            TikTok takes just two taps.
          </Text>

          {SHARE_STEPS.map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={[Typography.label, { color: Colors.textInverse }]}>
                  {i + 1}
                </Text>
              </View>
              <Text style={[Typography.body, styles.stepText]}>{step}</Text>
            </View>
          ))}

          <View style={{ height: Spacing.xl }} />

          <Pressable style={styles.btnPrimary} onPress={onDone}>
            <Text style={[Typography.label, { color: Colors.textInverse }]}>
              Done — I added Nearr
            </Text>
          </Pressable>

          <View style={{ height: Spacing.md }} />

          <Pressable onPress={onDismiss} style={styles.btnGhost}>
            <Text style={[Typography.caption, { color: Colors.textMuted }]}>
              Not now
            </Text>
          </Pressable>

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  // checklist item
  item: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  itemDone: {
    borderColor: Colors.success,
    backgroundColor: '#F0FDF4', // very light green, inline — no token needed
  },
  itemHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.sm,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.border,
    marginRight: Spacing.sm,
  },
  dotDone: {
    backgroundColor: Colors.success,
  },
  itemTitle: {
    color: Colors.text,
    flex: 1,
  },
  itemBody: {
    color: Colors.textMuted,
    lineHeight: 18,
  },
  itemActions: {
    marginTop: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  // buttons
  btnPrimary: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    paddingHorizontal: Spacing.lg,
    alignItems: 'center',
  },
  btnGhost: {
    alignItems: 'center',
    paddingVertical: Spacing.sm,
  },
  // modal
  modalContainer: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing.lg,
    paddingTop: Spacing.xl,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalClose: {
    padding: Spacing.sm,
  },
  modalScroll: {
    flex: 1,
  },
  modalContent: {
    padding: Spacing.lg,
  },
  modalIntro: {
    color: Colors.textMuted,
    marginBottom: Spacing.xl,
    lineHeight: 22,
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: Spacing.lg,
  },
  stepNum: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
    marginTop: 1,
    flexShrink: 0,
  },
  stepText: {
    flex: 1,
    color: Colors.text,
    lineHeight: 22,
  },
});
