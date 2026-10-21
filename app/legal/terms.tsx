import { useMemo, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button, Card, Screen } from '@/components';
import {
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  Spacing,
  TERMS_PUBLIC_URL,
  TERMS_SECTIONS,
} from '@/constants';
import { useTheme, type ThemeColors } from '@/lib/theme';

export default function TermsScreen() {
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [opening, setOpening] = useState(false);
  const [linkFailed, setLinkFailed] = useState(false);
  const openingRef = useRef(false);

  async function openWebsite() {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setLinkFailed(false);
    try {
      await Linking.openURL(TERMS_PUBLIC_URL);
    } catch {
      setLinkFailed(true);
    } finally {
      setOpening(false);
      openingRef.current = false;
    }
  }

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text accessibilityRole="header" style={typography.heading}>Terms of Service</Text>
        <Button
          title="Open Terms website"
          accessibilityLabel="Open Terms of Service website in your browser"
          variant="secondary"
          loading={opening}
          onPress={openWebsite}
        />
        <Text selectable style={[typography.caption, styles.meta]}>{TERMS_PUBLIC_URL}</Text>
        {linkFailed ? (
          <Text accessibilityRole="alert" style={[typography.body, styles.paragraph]}>
            The website could not be opened. You can read the saved Terms below or try again.
          </Text>
        ) : null}
        <Text style={[typography.caption, styles.meta]}>
          Effective date: {LEGAL_EFFECTIVE_DATE}
        </Text>

        {TERMS_SECTIONS.map((section) => (
          <Card key={section.heading} style={styles.card}>
            <Text accessibilityRole="header" style={typography.bodyStrong}>{section.heading}</Text>
            <View style={styles.paragraphs}>
              {section.paragraphs.map((paragraph) => (
                <Text key={paragraph} selectable style={[typography.body, styles.paragraph]}>
                  {paragraph}
                </Text>
              ))}
            </View>
          </Card>
        ))}

        <Text selectable style={[typography.caption, styles.footer]}>
          Contact: {LEGAL_CONTACT_EMAIL}
        </Text>
      </ScrollView>
    </Screen>
  );
}

function createStyles(colors: ThemeColors) {
  return StyleSheet.create({
    scroll: {
      padding: Spacing.lg,
      paddingBottom: Spacing.xxl,
      gap: Spacing.md,
    },
    meta: {
      color: colors.textSecondary,
      marginTop: Spacing.xs,
    },
    card: {
      marginTop: Spacing.md,
    },
    paragraphs: {
      marginTop: Spacing.sm,
      gap: Spacing.sm,
    },
    paragraph: {
      color: colors.textSecondary,
      lineHeight: 22,
    },
    footer: {
      color: colors.textSecondary,
      marginTop: Spacing.lg,
    },
  });
}
