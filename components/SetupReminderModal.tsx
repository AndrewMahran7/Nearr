import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { Colors, Radius, Spacing, Typography } from '@/constants';

export type SetupReminderNeeds = {
  notifications: boolean;
  location: boolean;
};

type Props = {
  visible: boolean;
  needs: SetupReminderNeeds;
  onEnableNotifications?: () => void;
  onOpenLocationSettings?: () => void;
  onDismiss: () => void;
};

function titleForNeeds(needs: SetupReminderNeeds): string {
  if (needs.notifications && needs.location) return 'Finish setting up Nearr';
  if (needs.notifications) return 'Turn on Notifications';
  return 'Turn on Always Location';
}

function bodyForNeeds(needs: SetupReminderNeeds): string {
  if (needs.notifications && needs.location) {
    return 'Notifications and Always Location help Nearr remind you when you’re near places you saved.';
  }
  if (needs.notifications) {
    return 'Notifications help Nearr remind you when you’re near places you saved.';
  }
  return 'Always Location helps Nearr keep nearby reminders working in the background.';
}

export function SetupReminderModal({
  visible,
  needs,
  onEnableNotifications,
  onOpenLocationSettings,
  onDismiss,
}: Props) {
  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <View style={styles.header}>
            <Text style={Typography.heading}>{titleForNeeds(needs)}</Text>
            <Pressable onPress={onDismiss} hitSlop={12} style={styles.closeButton}>
              <Text style={[Typography.bodyStrong, styles.closeText]}>X</Text>
            </Pressable>
          </View>

          <Text style={[Typography.body, styles.body]}>{bodyForNeeds(needs)}</Text>

          <View style={styles.rows}>
            {needs.notifications ? (
              <View style={styles.row}>
                <Text style={Typography.bodyStrong}>Notifications</Text>
                <Text style={[Typography.caption, styles.rowBody]}>
                  Lets Nearr send nearby reminders.
                </Text>
              </View>
            ) : null}

            {needs.location ? (
              <View style={styles.row}>
                <Text style={Typography.bodyStrong}>Always Location</Text>
                <Text style={[Typography.caption, styles.rowBody]}>
                  Helps Nearr notice when you&apos;re near a place you saved.
                </Text>
              </View>
            ) : null}
          </View>

          <View style={styles.actions}>
            {needs.notifications ? (
              <Button title="Enable Notifications" onPress={onEnableNotifications} />
            ) : null}

            {needs.location ? (
              <View style={needs.notifications ? styles.spacedAction : undefined}>
                <Button
                  title="Open Location Settings"
                  variant={needs.notifications ? 'secondary' : 'primary'}
                  onPress={onOpenLocationSettings}
                />
              </View>
            ) : null}

            <View style={styles.spacedAction}>
              <Button title="Not now" variant="ghost" onPress={onDismiss} />
            </View>
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 440,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
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
  body: {
    color: Colors.textMuted,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  rows: {
    marginTop: Spacing.lg,
    gap: Spacing.sm,
  },
  row: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    backgroundColor: Colors.bg,
  },
  rowBody: {
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    lineHeight: 18,
  },
  actions: {
    marginTop: Spacing.lg,
  },
  spacedAction: {
    marginTop: Spacing.sm,
  },
});