import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { trackEvent } from '@/lib/analytics';
import { isSupabaseConfigured } from '@/lib/supabase';
import { sendMagicLink } from '@/services/auth';
import { useAuth } from '@/hooks/useAuth';
import {
  OnboardingColors,
  OnboardingPrimaryButton,
  OnboardingRadius,
  OnboardingScreenShell,
  OnboardingSecondaryButton,
} from '@/components/onboarding';
import { NearrAppIcon } from '@/components/onboarding/demo';

/**
 * Single email authentication screen for onboarding.
 *
 * Nearr uses passwordless magic-link email, so sign-up and sign-in are the
 * SAME flow — there is intentionally no separate "Create account" vs "Sign in"
 * route or button. New and returning users use this exact screen. Apple /
 * Google are not configured in this project, so no social buttons are shown.
 *
 * No profile fields (username, display name, photo, age, interests, referral)
 * are requested. No paywall.
 */
export default function EmailAuthScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const signedIn = !!session;

  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  // `onboarding_email_started` once when the email step appears (not for the
  // dev-preview signed-in shortcut).
  const startedRef = useRef(false);
  useEffect(() => {
    if (signedIn || startedRef.current) return;
    startedRef.current = true;
    void trackEvent('onboarding_email_started', {});
  }, [signedIn]);

  async function handleContinue() {
    const trimmed = email.trim();
    if (!trimmed.includes('@')) {
      return Alert.alert('Enter a valid email');
    }
    if (!isSupabaseConfigured) {
      console.error('[auth] Supabase config missing — cannot send magic link');
      return Alert.alert(
        'Configuration error',
        'App configuration is missing. Please reinstall the latest build.',
      );
    }
    void trackEvent('onboarding_email_submitted', {});
    setSending(true);
    const { error } = await sendMagicLink(trimmed);
    setSending(false);
    if (error) {
      console.warn('[auth] magic link error', error);
      return Alert.alert('Could not send link', error.message);
    }
    setSent(true);
  }

  // Dev/QA preview: a session already exists → skip auth to the activation step.
  function handleContinueSignedIn() {
    router.replace('/activate');
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <OnboardingScreenShell
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/(onboarding)')
        }
        footer={
          <Text style={styles.note}>
            New to Nearr? Your account will be created automatically.
          </Text>
        }
      >
        <View style={styles.brand}>
          <View style={styles.glow} />
          <NearrAppIcon size={64} />
          <Text style={styles.wordmark}>Nearr</Text>
        </View>

        <Text style={styles.headline}>Continue with email</Text>
        <Text style={styles.subtext}>
          Enter your email and we'll send you a secure sign-in link.
        </Text>

        {signedIn ? (
          <View style={styles.form}>
            <OnboardingPrimaryButton title="Continue" onPress={handleContinueSignedIn} />
          </View>
        ) : sent ? (
          <View style={styles.sentCard}>
            <View style={styles.sentIcon}>
              <Feather name="mail" size={20} color={OnboardingColors.orange} />
            </View>
            <Text style={styles.sentTitle}>Check your email</Text>
            <Text style={styles.sentBody}>
              We sent a one-tap sign-in link to {email.trim()}. Open it on this device to
              finish.
            </Text>
            <OnboardingSecondaryButton title="Use a different email" onPress={() => setSent(false)} />
          </View>
        ) : (
          <View style={styles.form}>
            <TextInput
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={OnboardingColors.textMuted}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              returnKeyType="go"
              onSubmitEditing={handleContinue}
              editable={!sending}
              style={styles.input}
              accessibilityLabel="Email address"
            />

            <OnboardingPrimaryButton
              title="Continue with email"
              onPress={handleContinue}
              loading={sending}
            />

            <View style={styles.passwordless}>
              <Feather name="shield" size={13} color={OnboardingColors.textMuted} />
              <Text style={styles.passwordlessText}>
                No password — we email you a secure one-tap link.
              </Text>
            </View>
          </View>
        )}
      </OnboardingScreenShell>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  brand: {
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 24,
  },
  glow: {
    position: 'absolute',
    top: -8,
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: 'rgba(255, 107, 0, 0.14)',
  },
  wordmark: {
    color: OnboardingColors.text,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.3,
    marginTop: 12,
  },
  headline: {
    color: OnboardingColors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
    textAlign: 'center',
  },
  subtext: {
    color: OnboardingColors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    textAlign: 'center',
    marginTop: 10,
  },
  form: {
    marginTop: 28,
    gap: 14,
  },
  input: {
    height: 56,
    borderRadius: OnboardingRadius.button,
    backgroundColor: OnboardingColors.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    paddingHorizontal: 18,
    color: OnboardingColors.text,
    fontSize: 16,
  },
  passwordless: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  passwordlessText: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
  },
  sentCard: {
    marginTop: 28,
    alignItems: 'center',
    gap: 10,
    backgroundColor: OnboardingColors.card,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  sentIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
  },
  sentTitle: {
    color: OnboardingColors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  sentBody: {
    color: OnboardingColors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  note: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    textAlign: 'center',
  },
});
