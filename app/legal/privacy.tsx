import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Card, Screen } from '@/components';
import {
  Colors,
  LEGAL_CONTACT_EMAIL,
  LEGAL_EFFECTIVE_DATE,
  PRIVACY_SECTIONS,
  Spacing,
  Typography,
} from '@/constants';

export default function PrivacyScreen() {
  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={Typography.heading}>Privacy Policy</Text>
        <Text style={[Typography.caption, styles.meta]}>
          Draft for internal production readiness. Lawyer review required before public launch.
        </Text>
        <Text style={[Typography.caption, styles.meta]}>
          Effective date: {LEGAL_EFFECTIVE_DATE}
        </Text>

        {PRIVACY_SECTIONS.map((section) => (
          <Card key={section.heading} style={styles.card}>
            <Text style={Typography.bodyStrong}>{section.heading}</Text>
            <View style={styles.paragraphs}>
              {section.paragraphs.map((paragraph) => (
                <Text key={paragraph} style={[Typography.body, styles.paragraph]}>
                  {paragraph}
                </Text>
              ))}
            </View>
          </Card>
        ))}

        <Text style={[Typography.caption, styles.footer]}>
          Contact: {LEGAL_CONTACT_EMAIL}
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: {
    padding: Spacing.lg,
    paddingBottom: Spacing.xxl,
    gap: Spacing.md,
  },
  meta: {
    color: Colors.textMuted,
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
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  footer: {
    color: Colors.textMuted,
    marginTop: Spacing.lg,
  },
});