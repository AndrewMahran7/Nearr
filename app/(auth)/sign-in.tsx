import { useState } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Screen, Input, Button } from '@/components';
import { Colors, Spacing, Typography } from '@/constants';
import { sendMagicLink, signInWithPassword } from '@/services/auth';

// Dev-only password sign-in. This email triggers the password input and
// the "Sign in as developer" button instead of the magic-link flow — but
// only when ``__DEV__`` is true. In production builds, this email behaves
// like any other (magic link). The matching Supabase Auth user must be
// created manually in the dashboard; the client never creates users.
const DEV_EMAIL = 'dev@nearr.test';

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sending, setSending] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  const [sent, setSent] = useState(false);

  const isDevEmail =
    __DEV__ && email.trim().toLowerCase() === DEV_EMAIL;

  async function send() {
    if (!email.includes('@')) return Alert.alert('Enter a valid email');
    setSending(true);
    const { error } = await sendMagicLink(email);
    setSending(false);
    if (error) {
      console.warn('[auth] magic link error', error);
      return Alert.alert('Could not send link', error.message);
    }
    setSent(true);
  }

  async function devSignIn() {
    if (!__DEV__) return;
    if (!password) {
      return Alert.alert('Password required', 'Enter the dev password.');
    }
    setSigningIn(true);
    const { error } = await signInWithPassword(email, password);
    setSigningIn(false);
    if (error) {
      console.warn('[auth] dev password sign-in error', error);
      return Alert.alert('Sign in failed', error.message);
    }
    // The auth state listener in useAuth will pick up the new session and
    // AuthGate will route into the tabs. No manual navigation needed.
    console.log('[auth] dev password sign-in OK');
  }

  return (
    <Screen>
      <View style={styles.inner}>
        <Text style={[Typography.display, styles.brand]}>Nearr</Text>
        <Text style={[Typography.heading, styles.tagline]}>
          Save places once. Nearr reminds you when you&apos;re nearby.
        </Text>

        <View style={styles.bullets}>
          <Bullet text="Save spots from TikTok, Instagram, or anywhere." />
          <Bullet text="Set how close is &ldquo;nearby&rdquo; — in miles or minutes." />
          <Bullet text="Get a quiet ping when you&apos;re in range." />
        </View>

        {sent ? (
          <Text style={[Typography.body, styles.sent]}>
            Check your email for a magic link. Open it on this device to sign in.
          </Text>
        ) : (
          <>
            <Input
              placeholder="you@example.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              style={{ marginBottom: Spacing.md }}
            />
            {isDevEmail ? (
              <>
                <Input
                  placeholder="Dev password"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="off"
                  secureTextEntry
                  value={password}
                  onChangeText={setPassword}
                  style={{ marginBottom: Spacing.md }}
                />
                <Button
                  title="Sign in as developer"
                  onPress={devSignIn}
                  loading={signingIn}
                />
                <Text style={[Typography.caption, styles.fineprint]}>
                  Dev-only password sign-in for the {DEV_EMAIL} test user.
                </Text>
              </>
            ) : (
              <>
                <Button
                  title="Send magic link"
                  onPress={send}
                  loading={sending}
                />
                <Text style={[Typography.caption, styles.fineprint]}>
                  No password. We&apos;ll email you a one-tap link to sign in.
                </Text>
              </>
            )}
          </>
        )}

        {__DEV__ ? (
          <View style={styles.devBlock}>
            <View style={styles.devDivider} />
            <Text style={[Typography.caption, styles.devLabel]}>
              Development
            </Text>
            <Text style={[Typography.caption, styles.devNote]}>
              For development, sign in with your test email above to exercise
              real Supabase data (profiles, saved_places, settings).
            </Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

function Bullet({ text }: { text: string }) {
  return (
    <View style={styles.bulletRow}>
      <View style={styles.bulletDot} />
      <Text style={[Typography.body, styles.bulletText]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  inner: { flex: 1, justifyContent: 'center' },
  brand: { marginBottom: Spacing.sm },
  tagline: { color: Colors.text, marginBottom: Spacing.xl, lineHeight: 26 },
  bullets: { marginBottom: Spacing.xxl, gap: Spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm },
  bulletDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: Colors.accent,
    marginTop: 9,
  },
  bulletText: { flex: 1, color: Colors.textMuted, lineHeight: 22 },
  sent: { color: Colors.text, lineHeight: 22 },
  fineprint: {
    color: Colors.textMuted,
    marginTop: Spacing.md,
    textAlign: 'center',
  },
  devBlock: { marginTop: Spacing.xxl },
  devDivider: {
    height: 1,
    backgroundColor: Colors.border,
    marginBottom: Spacing.lg,
  },
  devLabel: {
    color: Colors.textMuted,
    textAlign: 'center',
    marginBottom: Spacing.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  devNote: {
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});