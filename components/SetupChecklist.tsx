/**
 * SetupChecklist
 *
 * Three setup nudge items for beta onboarding:
 *   1. Notifications    — prompts users to enable notification permission.
 *   2. Always Location  — prompts users to upgrade to "Always" location access
 *      so background proximity reminders can run correctly.
 *   3. Share Sheet Favorites — educates users on how to pin Nearr in the iOS
 *      Share Sheet so saving from Instagram/TikTok takes two taps.
 *
 * Persistence:
 *   - "shareFavDone"  — AsyncStorage flag; user manually marks complete.
 *   - Location item derives its completed state from the live permission status
 *     (no stored flag needed; re-checks on every mount/focus).
 *
 * Both items always appear in Settings so users can re-visit them.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  AppState,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import {
  ensureNotificationPermission,
  getNotificationPermissionState,
  syncProximityWatch,
} from '@/services/notifications';

import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

// ---------------------------------------------------------------------------
// Storage key
// ---------------------------------------------------------------------------

const SHARE_FAV_DONE_KEY = 'nearr:setupShareFavDone';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export async function getLocationStatus(): Promise<
  'always' | 'whenInUse' | 'denied' | 'undetermined'
> {
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
  const { colors, typography, resolvedTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const [notificationStatus, setNotificationStatus] = useState<
    'granted' | 'denied' | 'undetermined' | null
  >(null);
  const [locationStatus, setLocationStatus] = useState<
    'always' | 'whenInUse' | 'denied' | 'undetermined' | null
  >(null);
  const [shareFavDone, setShareFavDone] = useState(false);
  const [stepsVisible, setStepsVisible] = useState(false);

  const refresh = useCallback(async () => {
    const [notification, status, stored] = await Promise.all([
      getNotificationPermissionState(),
      getLocationStatus(),
      AsyncStorage.getItem(SHARE_FAV_DONE_KEY),
    ]);
    setNotificationStatus(notification);
    setLocationStatus(status);
    setShareFavDone(stored === 'true');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  async function handleNotificationPrimary() {
    if (notificationStatus === 'denied') {
      Linking.openSettings().catch(() => {
        Alert.alert(
          'Cannot open settings',
          'Open iPhone Settings, then enable notifications for Nearr.',
        );
      });
      return;
    }

    const granted = await ensureNotificationPermission();
    if (!granted) {
      await refresh();
      return;
    }

    await syncProximityWatch();
    await refresh();
  }

  async function handleMarkShareFavDone() {
    await AsyncStorage.setItem(SHARE_FAV_DONE_KEY, 'true');
    setShareFavDone(true);
    setStepsVisible(false);
  }

  async function handleUnmarkShareFav() {
    await AsyncStorage.removeItem(SHARE_FAV_DONE_KEY);
    setShareFavDone(false);
  }

  const notificationsDone = notificationStatus === 'granted';
  const locationDone = locationStatus === 'always';

  return (
    <>
      {/* ---- Notifications item -------------------------------------- */}
      <ChecklistItem
        done={notificationsDone}
        title="Turn on Notifications"
        body={
          notificationsDone
            ? 'Notifications are on. Nearr can remind you when a saved place is nearby.'
            : 'Turn this on so Nearr can remind you when you\'re near places you saved.'
        }
        primaryLabel={
          notificationsDone
            ? undefined
            : notificationStatus === 'denied'
              ? 'Open Settings'
              : 'Enable Notifications'
        }
        onPrimary={notificationsDone ? undefined : handleNotificationPrimary}
        styles={styles}
        typography={typography}
      />

      <View style={{ height: Spacing.sm }} />

      {/* ---- Location item -------------------------------------------- */}
      <ChecklistItem
        done={locationDone}
        title="Turn on Always Location"
        body={
          locationDone
            ? 'Always Location is on. Nearby reminders can keep working when you are not in the app.'
            : 'Turn on Always Location so Nearr can keep nearby reminders working in the background.'
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
        styles={styles}
        typography={typography}
      />

      <View style={{ height: Spacing.sm }} />

      {/* ---- Share favorites item -------------------------------------- */}
      <ChecklistItem
        done={shareFavDone}
        title="Add Nearr to Share Favorites"
        body={
          shareFavDone
            ? 'Nearr is in your Share Sheet favorites.'
            : Platform.OS === 'ios'
              ? 'Put Nearr at the front of your iPhone Share Sheet so saving places takes two taps.'
              : 'On iPhone, put Nearr at the front of the Share Sheet so saving places takes two taps.'
        }
        primaryLabel={shareFavDone ? undefined : 'Show Steps'}
        onPrimary={shareFavDone ? undefined : () => setStepsVisible(true)}
        secondaryLabel={shareFavDone ? 'Undo' : undefined}
        onSecondary={shareFavDone ? handleUnmarkShareFav : undefined}
        styles={styles}
        typography={typography}
      />

      {/* ---- Share steps modal ---------------------------------------- */}
      <ShareStepsModal
        visible={stepsVisible}
        onDone={handleMarkShareFavDone}
        onDismiss={() => setStepsVisible(false)}
        styles={styles}
        typography={typography}
        resolvedTheme={resolvedTheme}
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
  styles,
  typography,
}: {
  done: boolean;
  title: string;
  body: string;
  primaryLabel?: string;
  onPrimary?: () => void;
  secondaryLabel?: string;
  onSecondary?: () => void;
  styles: ReturnType<typeof createStyles>;
  typography: ReturnType<typeof useTheme>['typography'];
}) {
  return (
    <View style={[styles.item, done && styles.itemDone]}>
      <View style={styles.itemHeader}>
        <View style={[styles.dot, done && styles.dotDone]} />
        <Text style={[typography.label, styles.itemTitle]}>{title}</Text>
      </View>
      <Text style={[typography.caption, styles.itemBody]}>{body}</Text>
      {(!done && primaryLabel) ? (
        <View style={styles.itemActions}>
          <Pressable style={styles.btnPrimary} onPress={onPrimary}>
            <Text style={[typography.label, styles.primaryButtonText]}>
              {primaryLabel}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {(done && secondaryLabel) ? (
        <View style={styles.itemActions}>
          <Pressable onPress={onSecondary}>
            <Text style={[typography.caption, styles.secondaryActionText]}>
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
  doneLabel = 'Done — I added Nearr',
  styles,
  typography,
  resolvedTheme,
}: {
  visible: boolean;
  onDone: () => void;
  onDismiss: () => void;
  doneLabel?: string;
  styles: ReturnType<typeof createStyles>;
  typography: ReturnType<typeof useTheme>['typography'];
  resolvedTheme: ReturnType<typeof useTheme>['resolvedTheme'];
}) {
  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onDismiss}
      statusBarTranslucent={resolvedTheme === 'dark'}
    >
      <View style={styles.modalContainer}>
        <View style={styles.modalHeader}>
          <Text style={typography.heading}>Add Nearr to Share Favorites</Text>
          <Pressable onPress={onDismiss} style={styles.modalClose} hitSlop={12}>
            <Text style={[typography.bodyStrong, styles.modalCloseText]}>✕</Text>
          </Pressable>
        </View>

        <ScrollView style={styles.modalScroll} contentContainerStyle={styles.modalContent}>
          <Text style={[typography.body, styles.modalIntro]}>
            {Platform.OS === 'ios'
              ? 'Follow these steps once on your iPhone so saving places from Instagram or TikTok takes just two taps.'
              : 'These are the iPhone steps for adding Nearr to Share Favorites.'}
          </Text>

          {SHARE_STEPS.map((step, i) => (
            <View key={i} style={styles.step}>
              <View style={styles.stepNum}>
                <Text style={styles.stepNumText}>
                  {i + 1}
                </Text>
              </View>
              <Text style={[typography.body, styles.stepText]}>{step}</Text>
            </View>
          ))}

          <View style={{ height: Spacing.xl }} />

          <Pressable style={styles.btnPrimary} onPress={onDone}>
            <Text style={[typography.label, styles.primaryButtonText]}>
              {doneLabel}
            </Text>
          </Pressable>

          <View style={{ height: Spacing.md }} />

          <Pressable onPress={onDismiss} style={styles.btnGhost}>
            <Text style={[typography.caption, styles.secondaryActionText]}>
              Not now
            </Text>
          </Pressable>

          <View style={{ height: Spacing.xxl }} />
        </ScrollView>
      </View>
    </Modal>
  );
}

export { ShareStepsModal };

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    item: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      padding: Spacing.lg,
      borderWidth: 1,
      borderColor: colors.border,
    },
    itemDone: {
      borderColor: colors.success,
      backgroundColor: colors.surface,
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
      backgroundColor: colors.border,
      marginRight: Spacing.sm,
    },
    dotDone: {
      backgroundColor: colors.success,
    },
    itemTitle: {
      color: colors.text,
      flex: 1,
    },
    itemBody: {
      color: colors.textMuted,
      lineHeight: 18,
    },
    itemActions: {
      marginTop: Spacing.md,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Spacing.md,
    },
    btnPrimary: {
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: Spacing.md,
      paddingHorizontal: Spacing.lg,
      alignItems: 'center',
    },
    btnGhost: {
      alignItems: 'center',
      paddingVertical: Spacing.sm,
    },
    primaryButtonText: {
      color: colors.textInverse,
    },
    secondaryActionText: {
      color: colors.textMuted,
    },
    modalContainer: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: Spacing.lg,
      paddingTop: Spacing.xl,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    modalClose: {
      padding: Spacing.sm,
    },
    modalCloseText: {
      color: colors.textMuted,
    },
    modalScroll: {
      flex: 1,
    },
    modalContent: {
      padding: Spacing.lg,
    },
    modalIntro: {
      color: colors.textMuted,
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
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Spacing.md,
      marginTop: 1,
      flexShrink: 0,
    },
    stepNumText: {
      ...typography.label,
      color: colors.textInverse,
    },
    stepText: {
      flex: 1,
      color: colors.text,
      lineHeight: 22,
    },
  });
}
