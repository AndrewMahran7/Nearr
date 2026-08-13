import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { trackEvent } from '@/lib/analytics';
import { RECOVERY_LINK_EXPIRED_MESSAGE, toUserFacingAuthError } from '@/lib/authErrors';
import { validateNewPassword } from '@/lib/authScreenState';
import {
  beginPostAuthRouting,
  endPostAuthRouting,
  resolvePostAuthRoute,
} from '@/lib/postAuthRouting';
import { updateRecoveredPassword } from '@/services/auth';
import { useAuth } from '@/hooks/useAuth';
import {
  OnboardingColors,
  OnboardingPasswordField,
  OnboardingPrimaryButton,
  OnboardingScreenShell,
  OnboardingSecondaryButton,
} from '@/components/onboarding';

/**
 * Reset password.
 *
 * Reached ONLY from a Supabase `type=recovery` deep link, which the shared
 * callback pipeline routes here instead of running the normal save-aware
 * post-auth routing (see `decideAuthCallbackNavigation`). The recovery link
 * has already established a session, so `updateUser({ password })` is all that
 * remains; once it succeeds the user joins the same post-auth resolver as
 * every other sign-in method.
 */
export default function ResetPasswordScreen() {
  const router = useRouter();
  const { session, loading } = useAuth();

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const submitRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // An expired or malformed recovery link never establishes a session, so
  // there is nothing to update — say so plainly instead of failing on submit.
  const linkUnusable = !loading && !session;

  async function handleUpdatePassword() {
    if (submitRef.current) return;
    const validation = validateNewPassword({ password, confirmPassword });
    if (!validation.ok) return setErrorMessage(validation.message);
    if (!session) return setErrorMessage(RECOVERY_LINK_EXPIRED_MESSAGE);

    submitRef.current = true;
    setSaving(true);
    setErrorMessage(null);
    try {
      const { error } = await updateRecoveredPassword(password);
      if (error) {
        if (mountedRef.current) {
          setErrorMessage(toUserFacingAuthError(error, 'password_update'));
        }
        return;
      }

      void trackEvent('onboarding_password_reset_completed', {});
      if (mountedRef.current) setSaved(true);

      beginPostAuthRouting();
      try {
        const route = await resolvePostAuthRoute(session.user.id);
        router.replace(route);
      } catch {
        router.replace('/(tabs)/map');
      } finally {
        endPostAuthRouting();
      }
    } finally {
      submitRef.current = false;
      if (mountedRef.current) setSaving(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <OnboardingScreenShell>
        <Text style={styles.headline}>Reset password</Text>
        <Text style={styles.subtext}>
          Choose a new password for your Nearr account.
        </Text>

        {linkUnusable ? (
          <View style={styles.card}>
            <View style={styles.icon}>
              <Feather name="alert-circle" size={20} color={OnboardingColors.orange} />
            </View>
            <Text style={styles.cardTitle}>Link expired</Text>
            <Text style={styles.cardBody}>{RECOVERY_LINK_EXPIRED_MESSAGE}</Text>
            <OnboardingSecondaryButton
              title="Back to sign in"
              onPress={() => router.replace('/(onboarding)/account')}
            />
          </View>
        ) : (
          <View style={styles.form}>
            <OnboardingPasswordField
              value={password}
              onChangeText={(value) => {
                setPassword(value);
                setErrorMessage(null);
              }}
              placeholder="New password"
              autoComplete="new-password"
              textContentType="newPassword"
              returnKeyType="next"
              editable={!saving && !saved}
              visible={visible}
              onToggleVisible={() => setVisible((v) => !v)}
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
              onSubmitEditing={() => void handleUpdatePassword()}
              editable={!saving && !saved}
              visible={visible}
              onToggleVisible={() => setVisible((v) => !v)}
              accessibilityLabel="Confirm new password"
            />

            {errorMessage ? (
              <View style={styles.errorRow}>
                <Feather name="alert-circle" size={15} color={OnboardingColors.error} />
                <Text style={styles.errorText} accessibilityRole="alert">
                  {errorMessage}
                </Text>
              </View>
            ) : null}

            {saved ? (
              <Text style={styles.successText} accessibilityRole="alert">
                Password updated. Taking you back to Nearr…
              </Text>
            ) : null}

            <OnboardingPrimaryButton
              title="Update password"
              onPress={() => void handleUpdatePassword()}
              loading={saving}
              disabled={saved}
            />
          </View>
        )}
      </OnboardingScreenShell>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: OnboardingColors.background,
  },
  headline: {
    color: OnboardingColors.text,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: -0.5,
    lineHeight: 34,
    marginTop: 24,
  },
  subtext: {
    color: OnboardingColors.textMuted,
    fontSize: 16,
    lineHeight: 22,
    marginTop: 10,
  },
  form: {
    marginTop: 28,
    gap: 12,
  },
  card: {
    marginTop: 28,
    alignItems: 'center',
    gap: 10,
    backgroundColor: OnboardingColors.card,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
  },
  cardTitle: {
    color: OnboardingColors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  cardBody: {
    color: OnboardingColors.textMuted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
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
  successText: {
    color: OnboardingColors.text,
    fontSize: 13,
    lineHeight: 18,
  },
});
