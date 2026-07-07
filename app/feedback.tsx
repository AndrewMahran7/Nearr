/**
 * Send feedback — in-app, founder-led feedback form.
 *
 * Reached from Settings → "Send feedback". Presented as a modal (registered
 * in app/_layout.tsx). Requires auth (Settings is behind auth). Uses the
 * themed shared components so it matches the rest of the app; the accent is
 * Nearr orange (`colors.primary`).
 */
import { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';

import { Button, Input, Screen } from '@/components';
import { Radius, Spacing } from '@/constants';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/lib/theme';
import { submitFeedback, type FeedbackCategory } from '@/services/feedbackService';

const CATEGORIES: { key: FeedbackCategory; label: string }[] = [
  { key: 'bug', label: 'Bug' },
  { key: 'confusing', label: 'Confusing' },
  { key: 'save_extraction', label: 'Save/extraction issue' },
  { key: 'feature_idea', label: 'Feature idea' },
  { key: 'other', label: 'Other' },
];

export default function FeedbackScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const { colors, typography } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [category, setCategory] = useState<FeedbackCategory>('bug');
  const [message, setMessage] = useState('');
  const [email, setEmail] = useState(user?.email ?? '');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = message.trim().length > 0 && !sending;

  async function handleSubmit() {
    if (!message.trim()) {
      setError('Please enter a message.');
      return;
    }
    setSending(true);
    setError(null);
    const result = await submitFeedback({
      category,
      message,
      email,
      route: typeof from === 'string' ? from : null,
    });
    setSending(false);
    if (result.ok) {
      setSent(true);
    } else {
      setError(result.error);
    }
  }

  if (sent) {
    return (
      <Screen>
        <View style={styles.successWrap}>
          <Text style={[typography.heading, styles.successTitle]}>
            Thanks &mdash; I&apos;ll take a look.
          </Text>
          <Text style={[typography.body, styles.successBody]}>
            Every message comes straight to me. Thanks for helping make Nearr
            better.
          </Text>
          <View style={{ height: Spacing.lg }} />
          <Button title="Done" onPress={() => router.back()} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Text style={[typography.body, styles.subtitle]}>
            Something broken, confusing, or missing? Send it here. I read every
            message.
          </Text>

          <Text style={[typography.label, styles.fieldLabel]}>
            What&apos;s this about?
          </Text>
          <View style={styles.chips}>
            {CATEGORIES.map((c) => {
              const active = c.key === category;
              return (
                <Pressable
                  key={c.key}
                  onPress={() => setCategory(c.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
                >
                  <Text
                    style={[
                      typography.label,
                      active ? styles.chipTextActive : styles.chipTextInactive,
                    ]}
                  >
                    {c.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <Text style={[typography.label, styles.fieldLabel]}>Message</Text>
          <Input
            placeholder="Tell me what happened, or what you would love to see..."
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            textAlignVertical="top"
            style={styles.messageInput}
          />

          <Text style={[typography.label, styles.fieldLabel]}>
            Contact email (optional)
          </Text>
          <Input
            placeholder="you@example.com"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
          />
          <Text style={[typography.caption, styles.hint]}>
            Only used if I need to follow up.
          </Text>

          {error ? (
            <Text style={[typography.body, styles.error]}>{error}</Text>
          ) : null}

          <View style={{ height: Spacing.lg }} />
          <Button
            title="Send feedback"
            onPress={handleSubmit}
            loading={sending}
            disabled={!canSubmit}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    flex: { flex: 1 },
    content: {
      padding: Spacing.lg,
      paddingBottom: Spacing.xxl,
    },
    subtitle: {
      color: colors.textSecondary,
      lineHeight: 22,
      marginBottom: Spacing.xl,
    },
    fieldLabel: {
      color: colors.text,
      marginBottom: Spacing.sm,
      marginTop: Spacing.lg,
    },
    chips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Spacing.sm,
    },
    chip: {
      paddingVertical: Spacing.sm,
      paddingHorizontal: Spacing.md,
      borderRadius: Radius.pill,
      borderWidth: 1,
    },
    chipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    chipInactive: {
      backgroundColor: colors.surfaceElevated,
      borderColor: colors.border,
    },
    chipTextActive: { color: colors.textInverse },
    chipTextInactive: { color: colors.textSecondary },
    messageInput: {
      minHeight: 120,
      paddingTop: Spacing.md,
    },
    hint: {
      color: colors.textMuted,
      marginTop: Spacing.sm,
    },
    error: {
      color: colors.danger,
      marginTop: Spacing.lg,
    },
    successWrap: {
      flex: 1,
      justifyContent: 'center',
    },
    successTitle: {
      color: colors.text,
      marginBottom: Spacing.md,
    },
    successBody: {
      color: colors.textSecondary,
      lineHeight: 22,
    },
  });
}
