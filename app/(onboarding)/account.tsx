import { useCallback, useEffect, useRef, useState } from 'react';
import {
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
import * as AppleAuthentication from 'expo-apple-authentication';

import { trackEvent } from '@/lib/analytics';
import { isSupabaseConfigured } from '@/lib/supabase';
import {
  beginPostAuthRouting,
  endPostAuthRouting,
  resolvePostAuthRoute,
} from '@/lib/postAuthRouting';
import { toUserFacingAuthError, type AuthErrorLike } from '@/lib/authErrors';
import {
  applyEmailModeTransition,
  canStartOperation,
  checkEmailCopy,
  initialEmailAuthState,
  shouldRenderAppleButton,
  validateEmailOnly,
  validatePasswordSignIn,
  validatePasswordSignUp,
  type ActiveAuthOperation,
  type EmailModeTransition,
} from '@/lib/authScreenState';
import {
  isAppleSignInAvailable,
  requestPasswordReset,
  sendMagicLink,
  signInWithApple,
  signInWithPassword,
  signUpWithPassword,
  startGoogleSignIn,
} from '@/services/auth';
import { useAuth } from '@/hooks/useAuth';
import {
  AuthDivider,
  GoogleSignInButton,
  OnboardingColors,
  OnboardingPasswordField,
  OnboardingPrimaryButton,
  OnboardingRadius,
  OnboardingScreenShell,
  OnboardingSecondaryButton,
  OnboardingSizes,
} from '@/components/onboarding';
import { NearrAppIcon } from '@/components/onboarding/demo';

/**
 * Gate for the DEBUGGING-ONLY developer login panel.
 *
 * This is deliberately independent of the production password mode below.
 * The two share no state and no visibility logic: one is a QA tool, the other
 * is a real authentication method that ships to users.
 */
const DEV_PASSWORD_LOGIN_ENABLED =
  __DEV__ && process.env.EXPO_PUBLIC_ENABLE_DEV_PASSWORD_LOGIN === 'true';

/**
 * The single Nearr account gateway.
 *
 * One screen, several email modes, and the native providers:
 *
 *   - iOS:     Continue with Apple · Continue with Google · email
 *   - Android: Continue with Google · email
 *
 * Email defaults to the existing magic link (which both signs in and creates
 * accounts, so there is intentionally no "Sign up" vs "Sign in" split), with
 * password sign-in / account creation / recovery available in the same screen.
 *
 * Every successful path — Apple, Google, magic link, password sign-in and
 * password signup with an immediate session — converges on
 * `resolvePostAuthRoute`, the one save-aware post-auth resolver.
 */
export default function AccountAuthScreen() {
  const router = useRouter();
  const { session } = useAuth();
  const signedIn = !!session;

  const [emailState, setEmailState] = useState(() => initialEmailAuthState());
  const { mode, checkEmailReason, email } = emailState;
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(null);

  // ONE in-flight auth request at a time. The ref is the authority (it updates
  // synchronously, so two taps in the same frame cannot both pass the guard);
  // the state copy exists purely to drive the loading UI.
  const [activeOperation, setActiveOperation] = useState<ActiveAuthOperation>(null);
  const activeOperationRef = useRef<ActiveAuthOperation>(null);

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Developer login panel — separate state, separate visibility, never merged
  // with the production password mode above.
  const [developerPanelOpen, setDeveloperPanelOpen] = useState(false);
  const [developerEmail, setDeveloperEmail] = useState('');
  const [developerPassword, setDeveloperPassword] = useState('');
  const [developerPasswordVisible, setDeveloperPasswordVisible] = useState(false);
  const [developerSigningIn, setDeveloperSigningIn] = useState(false);
  const [developerError, setDeveloperError] = useState<string | null>(null);
  const developerSubmitRef = useRef(false);

  // `onboarding_email_started` once when the email step appears (not for the
  // dev-preview signed-in shortcut).
  const startedRef = useRef(false);
  useEffect(() => {
    if (signedIn || startedRef.current) return;
    startedRef.current = true;
    void trackEvent('onboarding_email_started', {});
  }, [signedIn]);

  // Apple's button may only render once the platform reports availability.
  useEffect(() => {
    let cancelled = false;
    void isAppleSignInAvailable().then((available) => {
      if (!cancelled) setAppleAvailable(available);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setEmail = useCallback((value: string) => {
    setEmailState((prev) => ({ ...prev, email: value }));
    setErrorMessage(null);
  }, []);

  const transition = useCallback((next: EmailModeTransition) => {
    setErrorMessage(null);
    setEmailState((prev) => applyEmailModeTransition(prev, next));
  }, []);

  /**
   * Claim the single auth slot. Returns false when another request (or the
   * same one, tapped twice) is already running.
   */
  function beginOperation(next: Exclude<ActiveAuthOperation, null>): boolean {
    if (!canStartOperation(activeOperationRef.current, next)) return false;
    activeOperationRef.current = next;
    setActiveOperation(next);
    setErrorMessage(null);
    return true;
  }

  function endOperation() {
    activeOperationRef.current = null;
    if (mountedRef.current) setActiveOperation(null);
  }

  function requireSupabase(): boolean {
    if (isSupabaseConfigured) return true;
    setErrorMessage('App configuration is missing. Reinstall the latest build.');
    return false;
  }

  /**
   * THE shared success path. Apple, Google, magic-link callback, password
   * sign-in and immediate-session signup all end here, so no provider has its
   * own routing. Navigation intentionally runs even if the screen unmounted
   * (an OAuth sheet can outlive it) — only state writes are mount-guarded.
   */
  async function completeAuthentication(userId: string) {
    beginPostAuthRouting();
    try {
      const route = await resolvePostAuthRoute(userId);
      router.replace(route);
    } catch {
      router.replace('/(tabs)/map');
    } finally {
      endPostAuthRouting();
    }
  }

  // -------------------------------------------------------------------------
  // Email: magic link (default)
  // -------------------------------------------------------------------------

  async function handleSendMagicLink() {
    const validation = validateEmailOnly(email);
    if (!validation.ok) return setErrorMessage(validation.message);
    if (!requireSupabase()) return;
    if (!beginOperation('magic_link')) return;

    void trackEvent('onboarding_email_submitted', {});
    try {
      const { error } = await sendMagicLink(email);
      if (!mountedRef.current) return;
      if (error) {
        setErrorMessage(toUserFacingAuthError(error, 'magic_link'));
        return;
      }
      transition('magic_link_sent');
    } finally {
      endOperation();
    }
  }

  // -------------------------------------------------------------------------
  // Email: password sign-in / account creation / recovery
  // -------------------------------------------------------------------------

  function openPasswordMode() {
    void trackEvent('onboarding_password_mode_opened', {});
    transition('use_password');
  }

  async function handlePasswordSignIn() {
    const validation = validatePasswordSignIn({ email, password });
    if (!validation.ok) return setErrorMessage(validation.message);
    if (!requireSupabase()) return;
    if (!beginOperation('password_sign_in')) return;

    void trackEvent('onboarding_password_signin_started', {});
    try {
      const { data, error } = await signInWithPassword(email, password);
      const user = data.session?.user ?? data.user ?? null;
      if (error || !user) {
        void trackEvent('onboarding_password_signin_failed', {});
        if (mountedRef.current) {
          setErrorMessage(toUserFacingAuthError(error, 'password_sign_in'));
        }
        return;
      }
      void trackEvent('onboarding_password_signin_completed', {});
      await completeAuthentication(user.id);
    } catch {
      void trackEvent('onboarding_password_signin_failed', {});
      console.warn('[auth] password sign-in threw');
      if (mountedRef.current) {
        setErrorMessage(toUserFacingAuthError(null, 'password_sign_in'));
      }
    } finally {
      endOperation();
    }
  }

  async function handlePasswordSignUp() {
    const validation = validatePasswordSignUp({ email, password, confirmPassword });
    if (!validation.ok) return setErrorMessage(validation.message);
    if (!requireSupabase()) return;
    if (!beginOperation('password_sign_up')) return;

    void trackEvent('onboarding_password_signup_started', {});
    try {
      const result = await signUpWithPassword(email, password);

      if (result.outcome === 'session') {
        void trackEvent('onboarding_password_signup_completed', {});
        await completeAuthentication(result.user.id);
        return;
      }

      if (result.outcome === 'confirmation_required') {
        // No session yet — the user is NOT authenticated, so we must park here
        // rather than navigating into the app.
        void trackEvent('onboarding_password_signup_confirmation_required', {});
        if (mountedRef.current) transition('signup_confirmation_required');
        return;
      }

      void trackEvent('onboarding_password_signup_failed', {});
      if (!mountedRef.current) return;
      setErrorMessage(
        toUserFacingAuthError(
          result.outcome === 'error' ? (result.error as AuthErrorLike) : null,
          'password_sign_up',
        ),
      );
    } finally {
      endOperation();
    }
  }

  async function handleForgotPassword() {
    const validation = validateEmailOnly(email);
    if (!validation.ok) return setErrorMessage(validation.message);
    if (!requireSupabase()) return;
    if (!beginOperation('password_reset')) return;

    void trackEvent('onboarding_password_reset_requested', {});
    try {
      const { error } = await requestPasswordReset(email);
      if (!mountedRef.current) return;
      if (error) {
        setErrorMessage(toUserFacingAuthError(error, 'password_reset'));
        return;
      }
      // Same confirmation whether or not the address has an account.
      transition('reset_email_sent');
    } finally {
      endOperation();
    }
  }

  // -------------------------------------------------------------------------
  // Providers
  // -------------------------------------------------------------------------

  async function handleGoogle() {
    if (!requireSupabase()) return;
    if (!beginOperation('google')) return;

    void trackEvent('onboarding_google_started', {});
    try {
      const outcome = await startGoogleSignIn();
      if (outcome.status === 'signed_in') {
        void trackEvent('onboarding_google_completed', {});
        await completeAuthentication(outcome.user.id);
        return;
      }
      if (outcome.status === 'cancelled') {
        // Backing out of the browser is a normal action — no error UI.
        void trackEvent('onboarding_google_cancelled', {});
        return;
      }
      void trackEvent('onboarding_google_failed', { reason: outcome.code });
      if (mountedRef.current) setErrorMessage(toUserFacingAuthError(null, 'google'));
    } finally {
      endOperation();
    }
  }

  async function handleApple() {
    if (!requireSupabase()) return;
    if (!beginOperation('apple')) return;

    void trackEvent('onboarding_apple_started', {});
    try {
      const outcome = await signInWithApple();
      if (outcome.status === 'signed_in') {
        void trackEvent('onboarding_apple_completed', {});
        await completeAuthentication(outcome.user.id);
        return;
      }
      if (outcome.status === 'cancelled') {
        // Closing Apple's sheet is a normal action — never a red error.
        void trackEvent('onboarding_apple_cancelled', {});
        return;
      }
      void trackEvent('onboarding_apple_failed', { reason: outcome.code });
      if (mountedRef.current) setErrorMessage(toUserFacingAuthError(null, 'apple'));
    } finally {
      endOperation();
    }
  }

  // Dev/QA preview: a session already exists → skip auth to the activation step.
  function handleContinueSignedIn() {
    router.replace('/activate');
  }

  // -------------------------------------------------------------------------
  // Developer login panel (debugging tool — never part of production auth)
  // -------------------------------------------------------------------------

  function closeDeveloperPanel() {
    if (developerSigningIn) return;
    setDeveloperPanelOpen(false);
    setDeveloperPassword('');
    setDeveloperPasswordVisible(false);
    setDeveloperError(null);
  }

  async function handleDeveloperSignIn() {
    if (developerSubmitRef.current) return;

    const trimmedEmail = developerEmail.trim();
    if (!trimmedEmail.includes('@')) {
      setDeveloperError('Enter a valid developer account email.');
      return;
    }
    if (!developerPassword) {
      setDeveloperError('Enter the developer account password.');
      return;
    }
    if (!isSupabaseConfigured) {
      setDeveloperError('App configuration is missing. Reinstall the latest development build.');
      return;
    }

    developerSubmitRef.current = true;
    setDeveloperSigningIn(true);
    setDeveloperError(null);
    try {
      const { data, error } = await signInWithPassword(trimmedEmail, developerPassword);
      if (error) {
        console.warn('[auth] developer password sign-in error', error.message);
        setDeveloperError(error.message);
        return;
      }

      const authenticatedUser = data.session?.user ?? data.user;
      if (!authenticatedUser) {
        setDeveloperError('Sign-in completed without a user session. Try again.');
        return;
      }

      await completeAuthentication(authenticatedUser.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to sign in.';
      console.warn('[auth] developer password sign-in failed', message);
      setDeveloperError(message);
    } finally {
      developerSubmitRef.current = false;
      if (mountedRef.current) setDeveloperSigningIn(false);
    }
  }

  const busy = activeOperation !== null;
  const showApple = shouldRenderAppleButton({
    platform: Platform.OS,
    available: appleAvailable,
  });
  const emailInput = (
    <TextInput
      value={email}
      onChangeText={setEmail}
      placeholder="you@example.com"
      placeholderTextColor={OnboardingColors.textMuted}
      autoCapitalize="none"
      autoComplete="email"
      textContentType="emailAddress"
      autoCorrect={false}
      keyboardType="email-address"
      returnKeyType="next"
      editable={!busy}
      style={styles.input}
      accessibilityLabel="Email address"
    />
  );
  const errorBanner = errorMessage ? (
    <View style={styles.errorRow}>
      <Feather name="alert-circle" size={15} color={OnboardingColors.error} />
      <Text style={styles.errorText} accessibilityRole="alert">
        {errorMessage}
      </Text>
    </View>
  ) : null;

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

        {/*
          "Create your map" continues the promise made by the final onboarding
          CTA. The subtext covers returning users, since every email path here
          both signs in and creates an account.
        */}
        <Text style={styles.headline}>Create your map</Text>
        <Text style={styles.subtext}>
          Sign in or create an account to start saving the places you find online.
        </Text>

        {signedIn ? (
          <View style={styles.form}>
            <OnboardingPrimaryButton title="Continue" onPress={handleContinueSignedIn} />
          </View>
        ) : mode === 'check_email' ? (
          <View style={styles.sentCard}>
            <View style={styles.sentIcon}>
              <Feather name="mail" size={20} color={OnboardingColors.orange} />
            </View>
            <Text style={styles.sentTitle}>
              {checkEmailCopy(checkEmailReason ?? 'magic_link', email).title}
            </Text>
            <Text style={styles.sentBody}>
              {checkEmailCopy(checkEmailReason ?? 'magic_link', email).body}
            </Text>
            <OnboardingSecondaryButton
              title="Use a different email"
              onPress={() => transition('restart')}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <View style={styles.providers}>
              {showApple ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={
                    AppleAuthentication.AppleAuthenticationButtonType.CONTINUE
                  }
                  buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
                  cornerRadius={OnboardingRadius.button}
                  style={styles.appleButton}
                  onPress={() => void handleApple()}
                />
              ) : null}
              <GoogleSignInButton
                onPress={() => void handleGoogle()}
                loading={activeOperation === 'google'}
                disabled={busy && activeOperation !== 'google'}
              />
            </View>

            <AuthDivider />

            {mode === 'magic_link' ? (
              <View style={styles.emailBlock}>
                {emailInput}
                {errorBanner}
                <OnboardingPrimaryButton
                  title="Continue with email"
                  onPress={() => void handleSendMagicLink()}
                  loading={activeOperation === 'magic_link'}
                  disabled={busy && activeOperation !== 'magic_link'}
                />
                <Text style={styles.noteText}>
                  We&apos;ll email you a secure sign-in link. No password needed.
                </Text>
                <LinkButton
                  label="Use password instead"
                  onPress={openPasswordMode}
                  disabled={busy}
                />
              </View>
            ) : null}

            {mode === 'password_sign_in' ? (
              <View style={styles.emailBlock}>
                {emailInput}
                <OnboardingPasswordField
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setErrorMessage(null);
                  }}
                  placeholder="Password"
                  autoComplete="current-password"
                  textContentType="password"
                  returnKeyType="go"
                  onSubmitEditing={() => void handlePasswordSignIn()}
                  editable={!busy}
                  visible={passwordVisible}
                  onToggleVisible={() => setPasswordVisible((v) => !v)}
                  accessibilityLabel="Password"
                />
                {errorBanner}
                <OnboardingPrimaryButton
                  title="Sign in"
                  onPress={() => void handlePasswordSignIn()}
                  loading={activeOperation === 'password_sign_in'}
                  disabled={busy && activeOperation !== 'password_sign_in'}
                />
                <LinkButton
                  label="Forgot password?"
                  onPress={() => void handleForgotPassword()}
                  disabled={busy}
                  busy={activeOperation === 'password_reset'}
                />
                <LinkButton
                  label="New to Nearr? Create account"
                  onPress={() => transition('create_account')}
                  disabled={busy}
                />
                <LinkButton
                  label="Use magic link instead"
                  onPress={() => transition('use_magic_link')}
                  disabled={busy}
                />
              </View>
            ) : null}

            {mode === 'password_sign_up' ? (
              <View style={styles.emailBlock}>
                {emailInput}
                <OnboardingPasswordField
                  value={password}
                  onChangeText={(value) => {
                    setPassword(value);
                    setErrorMessage(null);
                  }}
                  placeholder="Password"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="next"
                  editable={!busy}
                  visible={passwordVisible}
                  onToggleVisible={() => setPasswordVisible((v) => !v)}
                  accessibilityLabel="New password"
                />
                <OnboardingPasswordField
                  value={confirmPassword}
                  onChangeText={(value) => {
                    setConfirmPassword(value);
                    setErrorMessage(null);
                  }}
                  placeholder="Confirm password"
                  autoComplete="new-password"
                  textContentType="newPassword"
                  returnKeyType="go"
                  onSubmitEditing={() => void handlePasswordSignUp()}
                  editable={!busy}
                  visible={passwordVisible}
                  onToggleVisible={() => setPasswordVisible((v) => !v)}
                  accessibilityLabel="Confirm password"
                />
                {errorBanner}
                <OnboardingPrimaryButton
                  title="Create account"
                  onPress={() => void handlePasswordSignUp()}
                  loading={activeOperation === 'password_sign_up'}
                  disabled={busy && activeOperation !== 'password_sign_up'}
                />
                <LinkButton
                  label="Already have an account? Sign in"
                  onPress={() => transition('have_account')}
                  disabled={busy}
                />
                <LinkButton
                  label="Use magic link instead"
                  onPress={() => transition('use_magic_link')}
                  disabled={busy}
                />
              </View>
            ) : null}

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
                        disabled={developerSigningIn}
                        hitSlop={8}
                        style={styles.closeButton}
                        accessibilityRole="button"
                        accessibilityLabel="Close developer login"
                      >
                        <Feather name="x" size={20} color={OnboardingColors.textMuted} />
                      </Pressable>
                    </View>

                    <TextInput
                      value={developerEmail}
                      onChangeText={(value) => {
                        setDeveloperEmail(value);
                        setDeveloperError(null);
                      }}
                      placeholder="Developer email"
                      placeholderTextColor={OnboardingColors.textMuted}
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      keyboardType="email-address"
                      editable={!developerSigningIn}
                      style={styles.input}
                      accessibilityLabel="Developer email address"
                    />

                    <OnboardingPasswordField
                      value={developerPassword}
                      onChangeText={(value) => {
                        setDeveloperPassword(value);
                        setDeveloperError(null);
                      }}
                      placeholder="Password"
                      autoComplete="password"
                      editable={!developerSigningIn}
                      returnKeyType="go"
                      onSubmitEditing={() => void handleDeveloperSignIn()}
                      visible={developerPasswordVisible}
                      onToggleVisible={() => setDeveloperPasswordVisible((v) => !v)}
                      accessibilityLabel="Developer account password"
                    />

                    {developerError ? (
                      <Text style={styles.errorText} accessibilityRole="alert">
                        {developerError}
                      </Text>
                    ) : null}

                    <OnboardingPrimaryButton
                      title="Sign in with password"
                      onPress={() => void handleDeveloperSignIn()}
                      loading={developerSigningIn}
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

/** Small text-only secondary action with a full 44pt tap target. */
function LinkButton({
  label,
  onPress,
  disabled,
  busy,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.linkButton,
        pressed && !disabled && styles.developerPressed,
        disabled && styles.linkDisabled,
      ]}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled, busy: !!busy }}
    >
      <Text style={styles.linkText}>{busy ? 'Sending…' : label}</Text>
    </Pressable>
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
  providers: {
    gap: 12,
  },
  appleButton: {
    height: OnboardingSizes.primaryButtonHeight,
    width: '100%',
  },
  emailBlock: {
    gap: 12,
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
  noteText: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
  linkButton: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  linkDisabled: {
    opacity: 0.45,
  },
  linkText: {
    color: OnboardingColors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 2,
  },
  errorText: {
    flex: 1,
    color: OnboardingColors.error,
    fontSize: 13,
    lineHeight: 18,
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
