import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { Card } from './Card';
import { Colors, Radius, Spacing, Typography } from '@/constants';

type Props = {
  visible: boolean;
  onViewTerms: () => void;
  onViewPrivacy: () => void;
  onAgree: () => void;
  agreeing?: boolean;
};

export function LegalAgreementModal({
  visible,
  onViewTerms,
  onViewPrivacy,
  onAgree,
  agreeing = false,
}: Props) {
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!visible) setAgreed(false);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <Text style={Typography.heading}>Before you continue</Text>
          <Text style={[Typography.body, styles.body]}>
            Please review and accept Nearr&apos;s Terms of Service and Privacy Policy to continue.
          </Text>

          <ScrollView style={styles.links} contentContainerStyle={styles.linksContent}>
            <Pressable style={styles.linkRow} onPress={onViewTerms}>
              <Text style={Typography.bodyStrong}>View Terms</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable style={styles.linkRow} onPress={onViewPrivacy}>
              <Text style={Typography.bodyStrong}>View Privacy Policy</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </ScrollView>

          <Pressable style={styles.checkboxRow} onPress={() => setAgreed((v) => !v)}>
            <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
              {agreed ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={[Typography.body, styles.checkboxText]}>
              I agree to the Terms of Service and Privacy Policy.
            </Text>
          </Pressable>

          <View style={styles.actions}>
            <Button
              title="Agree and continue"
              onPress={onAgree}
              disabled={!agreed || agreeing}
              loading={agreeing}
            />
          </View>
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,17,17,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  card: {
    width: '100%',
    maxWidth: 460,
  },
  body: {
    color: Colors.textMuted,
    marginTop: Spacing.sm,
    lineHeight: 22,
  },
  links: {
    maxHeight: 160,
    marginTop: Spacing.lg,
  },
  linksContent: {
    gap: Spacing.sm,
  },
  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    backgroundColor: Colors.bg,
  },
  chevron: {
    ...Typography.bodyStrong,
    color: Colors.textMuted,
  },
  checkboxRow: {
    marginTop: Spacing.lg,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  checkboxActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkboxTick: {
    color: Colors.textInverse,
    fontWeight: '700',
  },
  checkboxText: {
    flex: 1,
    color: Colors.text,
    lineHeight: 22,
  },
  actions: {
    marginTop: Spacing.lg,
  },
});