import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from './Button';
import { Card } from './Card';
import { Radius, Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';

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
  const { colors, typography, resolvedTheme } = useTheme();
  const styles = useMemo(() => createStyles(colors, typography), [colors, typography]);
  const [agreed, setAgreed] = useState(false);

  useEffect(() => {
    if (!visible) setAgreed(false);
  }, [visible]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {}}
      statusBarTranslucent={resolvedTheme === 'dark'}
    >
      <View style={styles.backdrop}>
        <Card style={styles.card}>
          <Text style={typography.heading}>Before you continue</Text>
          <Text style={[typography.body, styles.body]}>
            Please review and accept Nearr&apos;s Terms of Service and Privacy Policy to continue.
          </Text>

          <ScrollView style={styles.links} contentContainerStyle={styles.linksContent}>
            <Pressable style={styles.linkRow} onPress={onViewTerms}>
              <Text style={typography.bodyStrong}>View Terms</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            <Pressable style={styles.linkRow} onPress={onViewPrivacy}>
              <Text style={typography.bodyStrong}>View Privacy Policy</Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </ScrollView>

          <Pressable style={styles.checkboxRow} onPress={() => setAgreed((v) => !v)}>
            <View style={[styles.checkbox, agreed && styles.checkboxActive]}>
              {agreed ? <Text style={styles.checkboxTick}>✓</Text> : null}
            </View>
            <Text style={[typography.body, styles.checkboxText]}>
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

function createStyles(
  colors: ReturnType<typeof useTheme>['colors'],
  typography: ReturnType<typeof useTheme>['typography'],
) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: colors.modalBackdrop,
      alignItems: 'center',
      justifyContent: 'center',
      padding: Spacing.lg,
    },
    card: {
      width: '100%',
      maxWidth: 460,
    },
    body: {
      color: colors.textMuted,
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
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Spacing.md,
      backgroundColor: colors.bg,
    },
    chevron: {
      ...typography.bodyStrong,
      color: colors.textMuted,
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
      borderColor: colors.border,
      backgroundColor: colors.bg,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    checkboxActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    checkboxTick: {
      color: colors.textInverse,
      fontWeight: '700',
    },
    checkboxText: {
      flex: 1,
      color: colors.text,
      lineHeight: 22,
    },
    actions: {
      marginTop: Spacing.lg,
    },
  });
}