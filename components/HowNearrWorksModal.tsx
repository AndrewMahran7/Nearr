import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Button } from './Button';
import { Card } from './Card';
import { ShareStepsModal } from './SetupChecklist';
import { Colors, Radius, Spacing, Typography } from '@/constants';

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
  const [shareStepsVisible, setShareStepsVisible] = useState(false);

  return (
    <>
      <Modal
        visible={visible}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={onSecondary}
      >
        <View style={styles.container}>
          <View style={styles.header}>
            <Text style={Typography.heading}>How Nearr Works</Text>
            <Pressable onPress={onSecondary} style={styles.closeButton} hitSlop={12}>
              <Text style={[Typography.bodyStrong, styles.closeText]}>X</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
          >
            <Text style={[Typography.body, styles.intro]}>
              Nearr helps you go from seeing a place online to actually going there.
            </Text>

            {STEPS.map((step, index) => (
              <Card key={step.title} style={styles.card}>
                <Text style={[Typography.caption, styles.stepNumber]}>Step {index + 1}</Text>
                <Text style={[Typography.bodyStrong, styles.cardTitle]}>{step.title}</Text>
                <Text style={[Typography.body, styles.cardBody]}>{step.body}</Text>
              </Card>
            ))}

            <Card style={styles.tipCard}>
              <Text style={[Typography.bodyStrong, styles.cardTitle]}>
                Add Nearr to Share Favorites
              </Text>
              <Text style={[Typography.body, styles.cardBody]}>
                Tip: Add Nearr to your iPhone Share Favorites so it shows up faster.
              </Text>
              <View style={{ height: Spacing.md }} />
              <Button
                title="See Share Favorites steps"
                variant="secondary"
                onPress={() => setShareStepsVisible(true)}
              />
            </Card>

            <Text style={[Typography.caption, styles.footerNote]}>
              You can come back to this anytime in Settings.
            </Text>

            <View style={styles.actions}>
              <Button title={primaryLabel} onPress={onPrimary} />
              <View style={{ height: Spacing.sm }} />
              <Button title={secondaryLabel} variant="ghost" onPress={onSecondary} />
            </View>
          </ScrollView>
        </View>
      </Modal>

      <ShareStepsModal
        visible={shareStepsVisible}
        onDone={() => setShareStepsVisible(false)}
        onDismiss={() => setShareStepsVisible(false)}
        doneLabel="Close"
      />
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  closeButton: {
    width: 32,
    height: 32,
    borderRadius: Radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: Colors.textMuted,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  intro: {
    color: Colors.text,
    lineHeight: 23,
    marginBottom: Spacing.lg,
  },
  card: {
    marginBottom: Spacing.md,
  },
  stepNumber: {
    color: Colors.accent,
    marginBottom: Spacing.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardTitle: {
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  cardBody: {
    color: Colors.textMuted,
    lineHeight: 22,
  },
  tipCard: {
    marginTop: Spacing.xs,
  },
  footerNote: {
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  actions: {
    marginTop: Spacing.sm,
  },
});