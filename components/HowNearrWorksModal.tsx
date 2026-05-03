import { useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Button } from './Button';
import { Card } from './Card';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

const HOW_NEARR_WORKS_STORAGE_KEY = 'nearr:hasSeenHowItWorks';

const STEPS = [
  {
    title: 'See a place online',
    body: 'See a restaurant or spot on Instagram, TikTok, or the web.',
  },
  {
    title: 'Share it to Nearr',
    body: 'Tap Share, choose Nearr, and save the place for later.',
  },
  {
    title: 'See it on your map',
    body: 'Your saved places show up on the map so you can find them again.',
  },
  {
    title: 'Get reminded nearby',
    body: 'With notifications and Always Location on, Nearr can remind you when you\'re close to a saved place.',
  },
  {
    title: 'Go try it',
    body: 'Open the map, get directions, and go to the place you wanted to try.',
  },
] as const;

const SHARE_FAVORITES_STEPS = [
  'Open the iPhone Share Sheet from Instagram, TikTok, Safari, or Maps.',
  'Scroll the app row all the way to the right.',
  'Tap More.',
  'Tap Edit.',
  'Add Nearr to Favorites.',
  'Drag Nearr higher if you want it easier to reach.',
] as const;

export function getHowNearrWorksStorageKey(userId?: string | null) {
  return userId ? `${HOW_NEARR_WORKS_STORAGE_KEY}:${userId}` : HOW_NEARR_WORKS_STORAGE_KEY;
}

export async function hasSeenHowNearrWorks(userId?: string | null) {
  const keys = userId
    ? [getHowNearrWorksStorageKey(userId), HOW_NEARR_WORKS_STORAGE_KEY]
    : [HOW_NEARR_WORKS_STORAGE_KEY];
  const values = await AsyncStorage.multiGet(keys);
  return values.some(([, value]) => value === 'true');
}

export async function markHowNearrWorksSeen(userId?: string | null) {
  await AsyncStorage.setItem(getHowNearrWorksStorageKey(userId), 'true');
}

type Props = {
  visible: boolean;
  onPrimary: () => void;
  onSecondary: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
};

export function HowNearrWorksModal({
  visible,
  onPrimary,
  onSecondary,
  primaryLabel = 'Got it',
  secondaryLabel = 'Skip for now',
}: Props) {
  const { colors, typography, resolvedTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [shareStepsVisible, setShareStepsVisible] = useState(false);

  useEffect(() => {
    if (!visible) {
      setShareStepsVisible(false);
    }
  }, [visible]);

  function handleOpenShareSteps() {
    setShareStepsVisible((current) => {
      if (!current) {
        console.log('[how-it-works] share_steps_opened');
      }
      return !current;
    });
  }

  function handlePrimary() {
    console.log('[how-it-works] dismissed');
    setShareStepsVisible(false);
    onPrimary();
  }

  function handleSecondary() {
    console.log('[how-it-works] dismissed');
    setShareStepsVisible(false);
    onSecondary();
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleSecondary}
      statusBarTranslucent={resolvedTheme === 'dark'}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={typography.heading}>How Nearr Works</Text>
          <Pressable onPress={handleSecondary} style={styles.closeButton} hitSlop={12}>
            <Text style={[typography.bodyStrong, styles.closeText]}>X</Text>
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={[typography.body, styles.intro]}>
            Nearr helps you go from seeing a place online to actually going there.
          </Text>

          {STEPS.map((step, index) => (
            <Card key={step.title} style={styles.card}>
              <Text style={[typography.caption, styles.stepNumber]}>Step {index + 1}</Text>
              <Text style={[typography.bodyStrong, styles.cardTitle]}>{step.title}</Text>
              <Text style={[typography.body, styles.cardBody]}>{step.body}</Text>
            </Card>
          ))}

          <Card style={styles.tipCard}>
            <Text style={[typography.bodyStrong, styles.cardTitle]}>
              Add Nearr to Share Favorites
            </Text>
            <Text style={[typography.body, styles.cardBody]}>
              {Platform.OS === 'ios'
                ? 'Tip: Add Nearr to your iPhone Share Favorites so it shows up faster.'
                : 'On iPhone, you can add Nearr to Share Favorites so it shows up faster.'}
            </Text>
            <View style={{ height: Spacing.md }} />
            <Button
              title={shareStepsVisible ? 'Hide Share Favorites steps' : 'See Share Favorites steps'}
              variant="secondary"
              onPress={handleOpenShareSteps}
            />

            {shareStepsVisible ? (
              <View style={styles.shareStepsSection}>
                <Text style={[typography.caption, styles.shareStepsIntro]}>
                  {Platform.OS === 'ios'
                    ? 'Follow these steps once on your iPhone:'
                    : 'These steps are for iPhone:'}
                </Text>
                {SHARE_FAVORITES_STEPS.map((step, index) => (
                  <View key={step} style={styles.shareStepRow}>
                    <View style={styles.shareStepNumberBubble}>
                      <Text style={[typography.label, styles.shareStepNumberText]}>
                        {index + 1}
                      </Text>
                    </View>
                    <Text style={[typography.body, styles.shareStepText]}>{step}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>

          <Text style={[typography.caption, styles.footerNote]}>
            You can come back to this anytime in Settings.
          </Text>

          <View style={styles.actions}>
            <Button title={primaryLabel} onPress={handlePrimary} />
            <View style={{ height: Spacing.sm }} />
            <Button title={secondaryLabel} variant="ghost" onPress={handleSecondary} />
          </View>
        </ScrollView>
      </View>
    </Modal>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Spacing.lg,
      paddingTop: Spacing.lg,
      paddingBottom: Spacing.sm,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    closeButton: {
      width: 32,
      height: 32,
      borderRadius: Radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    closeText: {
      color: colors.textMuted,
    },
    scroll: {
      flex: 1,
    },
    content: {
      padding: Spacing.lg,
      paddingBottom: Spacing.xxl,
    },
    intro: {
      color: colors.text,
      lineHeight: 23,
      marginBottom: Spacing.lg,
    },
    card: {
      marginBottom: Spacing.md,
    },
    stepNumber: {
      color: colors.accent,
      marginBottom: Spacing.xs,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    cardTitle: {
      color: colors.text,
      marginBottom: Spacing.xs,
    },
    cardBody: {
      color: colors.textMuted,
      lineHeight: 22,
    },
    tipCard: {
      marginTop: Spacing.xs,
    },
    shareStepsSection: {
      marginTop: Spacing.md,
      paddingTop: Spacing.md,
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    shareStepsIntro: {
      color: colors.textMuted,
      marginBottom: Spacing.md,
    },
    shareStepRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      marginBottom: Spacing.md,
    },
    shareStepNumberBubble: {
      width: 24,
      height: 24,
      borderRadius: Radius.pill,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginRight: Spacing.sm,
      marginTop: 1,
    },
    shareStepNumberText: {
      color: colors.textInverse,
    },
    shareStepText: {
      flex: 1,
      color: colors.text,
      lineHeight: 22,
    },
    footerNote: {
      color: colors.textMuted,
      textAlign: 'center',
      marginTop: Spacing.lg,
      marginBottom: Spacing.lg,
    },
    actions: {
      marginTop: Spacing.sm,
    },
  });
}