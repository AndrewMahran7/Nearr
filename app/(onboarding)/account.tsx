import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { trackEvent } from '@/lib/analytics';
import { routeAfterAuthenticatedUser } from '@/lib/authDeepLinkCore';
import { getOnboardingStatus } from '@/lib/onboarding';
import { isSupabaseConfigured } from '@/lib/supabase';
import { sendMagicLink, signInWithPassword } from '@/services/auth';
import { useAuth } from '@/hooks/useAuth';
import {
  OnboardingColors,
  OnboardingPrimaryButton,
  OnboardingRadius,
  OnboardingScreenShell,
  OnboardingSecondaryButton,
} from '@/components/onboarding';
import { NearrAppIcon } from '@/components/onboarding/demo';

const DEV_PASSWORD_LOGIN_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN === 'true';

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
  const [developerPanelOpen, setDeveloperPanelOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [passwordSigningIn, setPasswordSigningIn] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const passwordSubmitRef = useRef(false);

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

  function closeDeveloperPanel() {
    if (passwordSigningIn) return;
    setDeveloperPanelOpen(false);
    setPassword('');
    setPasswordVisible(false);
    setPasswordError(null);
  }

  async function handlePasswordSignIn() {
    if (passwordSubmitRef.current) return;

    const trimmedEmail = email.trim();
    if (!trimmedEmail.includes('@')) {
      setPasswordError('Enter a valid developer account email.');
      return;
    }
    if (!password) {
      setPasswordError('Enter the developer account password.');
      return;
    }
    if (!isSupabaseConfigured) {
      setPasswordError('App configuration is missing. Reinstall the latest development build.');
      return;
    }

    passwordSubmitRef.current = true;
    setPasswordSigningIn(true);
    setPasswordError(null);
    try {
      const { data, error } = await signInWithPassword(trimmedEmail, password);
      if (error) {
        console.warn('[auth] developer password sign-in error', error.message);
        setPasswordError(error.message);
        return;
      }

      const authenticatedUser = data.session?.user ?? data.user;
      if (!authenticatedUser) {
        setPasswordError('Sign-in completed without a user session. Try again.');
        return;
      }

      const onboardingStatus = await getOnboardingStatus(authenticatedUser.id);
      router.replace(routeAfterAuthenticatedUser(onboardingStatus));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      console.warn('[auth] developer password sign-in failed', message);
      setPasswordError(message);
    } finally {
      passwordSubmitRef.current = false;
      setPasswordSigningIn(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <OnboardingScreenShell
        onBack={() =>
          router.canGoBack() ? router.back() : router.replace('/(onboarding)')
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

            <View style={styles.notes}>
              <Text style={styles.noteText}>
                No password. We'll email you a secure sign-in link.
              </Text>
              <Text style={styles.noteText}>
                New to Nearr? Your account will be created automatically.
              </Text>
            </View>

            {DEV_PASSWORD_LOGIN_ENABLED ? (
              <View style={styles.developerArea}>
                {!developerPanelOpen ? (
                  <Pressable
                    onPress={() => setDeveloperPanelOpen(true)}
                    style={({ pressed }) => [
                      styles.developerTrigger,
                      pressed && styles.developerPressed,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel="Open developer login"
                    accessibilityHint="Expands password sign-in for development accounts"
                  >
                    <Feather name="tool" size={16} color={OnboardingColors.textMuted} />
                    <Text style={styles.developerTriggerText}>Developer login</Text>
                    <Feather name="chevron-down" size={16} color={OnboardingColors.textMuted} />
                  </Pressable>
                ) : (
                  <View style={styles.developerPanel}>
                    <View style={styles.developerHeader}>
                      <View>
                        <Text style={styles.developerTitle}>Developer login</Text>
                        <Text style={styles.developerSubtitle}>Real Supabase test account</Text>
                      </View>
                      <Pressable
                        onPress={closeDeveloperPanel}
                        disabled={passwordSigningIn}
                        hitSlop={8}
                        style={styles.closeButton}
                        accessibilityRole="button"
                        accessibilityLabel="Close developer login"
                      >
                        <Feather name="x" size={20} color={OnboardingColors.textMuted} />
                      </Pressable>
                    </View>

                    <TextInput
                      value={email}
                      onChangeText={(value) => {
                        setEmail(value);
                        setPasswordError(null);
                      }}
                      placeholder="Developer email"
                      placeholderTextColor={OnboardingColors.textMuted}
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      keyboardType="email-address"
                      editable={!passwordSigningIn}
                      style={styles.input}
                      accessibilityLabel="Developer email address"
                    />

                    <View style={styles.passwordField}>
                      <TextInput
                        value={password}
                        onChangeText={(value) => {
                          setPassword(value);
                          setPasswordError(null);
                        }}
                        placeholder="Password"
                        placeholderTextColor={OnboardingColors.textMuted}
                        autoCapitalize="none"
                        autoComplete="password"
                        autoCorrect={false}
                        secureTextEntry={!passwordVisible}
                        editable={!passwordSigningIn}
                        returnKeyType="go"
                        onSubmitEditing={handlePasswordSignIn}
                        style={styles.passwordInput}
                        accessibilityLabel="Developer account password"
                      />
                      <Pressable
                        onPress={() => setPasswordVisible((visible) => !visible)}
                        disabled={passwordSigningIn}
                        style={styles.passwordVisibility}
                        accessibilityRole="button"
                        accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                      >
                        <Feather
                          name={passwordVisible ? 'eye-off' : 'eye'}
                          size={19}
                          color={OnboardingColors.textMuted}
                        />
                      </Pressable>
                    </View>

                    {passwordError ? (
                      <Text style={styles.passwordError} accessibilityRole="alert">
                        {passwordError}
                      </Text>
                    ) : null}

                    <OnboardingPrimaryButton
                      title="Sign in with password"
                      onPress={handlePasswordSignIn}
                      loading={passwordSigningIn}
                    />
                  </View>
                )}
              </View>
            ) : null}
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
  notes: {
    gap: 6,
    marginTop: 2,
  },
  noteText: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  developerArea: {
    marginTop: 8,
  },
  developerTrigger: {
    minHeight: 44,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: OnboardingRadius.button,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
  },
  developerPressed: {
    opacity: 0.72,
  },
  developerTriggerText: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  developerPanel: {
    gap: 12,
    padding: 16,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
  },
  developerHeader: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  developerTitle: {
    color: OnboardingColors.text,
    fontSize: 16,
    fontWeight: '800',
  },
  developerSubtitle: {
    color: OnboardingColors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  closeButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordField: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: OnboardingRadius.button,
    backgroundColor: OnboardingColors.background,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
  },
  passwordInput: {
    flex: 1,
    height: 54,
    paddingLeft: 18,
    color: OnboardingColors.text,
    fontSize: 16,
  },
  passwordVisibility: {
    width: 48,
    height: 54,
    alignItems: 'center',
    justifyContent: 'center',
  },
  passwordError: {
    color: '#FF7A7A',
    fontSize: 13,
    lineHeight: 18,
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
});
