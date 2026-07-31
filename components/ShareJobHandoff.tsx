/**
 * components/ShareJobHandoff.tsx
 *
 * Host-app async submit panel. Used by app/share.tsx when the async
 * share-jobs flag is on and a URL arrives (Android share intent, iOS
 * signed-out/network handoff, or in-app paste-link). It creates a durable
 * job via `create-share-job` and confirms — it does NOT run extraction
 * inline. Mirrors the share-extension behavior for parity.
 *
 * Preserves source-URL metadata: the job stores source_url, and when the job
 * completes/needs-help the saved place carries source_type/source_url.
 */
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Screen } from '@/components';
import { Spacing } from '@/constants';
import { useTheme } from '@/lib/theme';
import { supabase } from '@/lib/supabase';
import { resolveCreateShareJobUrl } from '@/lib/featureFlags';
import { createShareJob } from '@/lib/shareJobClient';
import { logDebug } from '@/lib/logger';

type UiState =
  | { kind: 'submitting' }
  | { kind: 'accepted'; duplicate: boolean }
  | { kind: 'signed_out' }
  | { kind: 'error' };

export function ShareJobHandoff({ url }: { url: string }) {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const [ui, setUi] = useState<UiState>({ kind: 'submitting' });
  const handledRef = useRef(false);
  const requestIdRef = useRef(
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = async () => {
    const endpoint = resolveCreateShareJobUrl();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token ?? '';
    if (!token) {
      setUi({ kind: 'signed_out' });
      return;
    }
    if (!endpoint) {
      logDebug('share-job', 'handoff no endpoint');
      setUi({ kind: 'error' });
      return;
    }
    setUi({ kind: 'submitting' });
    const result = await createShareJob({
      endpoint,
      url,
      accessToken: token,
      clientRequestId: requestIdRef.current,
    });
    if (result.ok) {
      console.log(`[share-extension] job_accepted=true duplicate=${result.duplicate}`);
      setUi({ kind: 'accepted', duplicate: result.duplicate });
      closeTimerRef.current = setTimeout(() => router.replace('/(tabs)/map'), 1600);
    } else if (result.reason === 'unauthorized' || result.reason === 'missing_auth') {
      setUi({ kind: 'signed_out' });
    } else {
      console.log(`[share-extension] job_accepted=false reason=${result.reason}`);
      setUi({ kind: 'error' });
    }
  };

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    void submit();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styles = createStyles(colors);

  if (ui.kind === 'accepted') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={styles.check}>✓</Text>
          <Text style={[typography.heading, styles.title]}>Added to your queue</Text>
          <Text style={[typography.body, styles.subtle]}>
            {"We'll notify you when it's ready. You can keep browsing."}
          </Text>
          <View style={{ height: Spacing.lg }} />
          <Button title="View queue" onPress={() => router.replace('/share-jobs')} />
          <Button
            title="Done"
            variant="ghost"
            onPress={() => router.replace('/(tabs)/map')}
            style={{ marginTop: Spacing.sm }}
          />
        </View>
      </Screen>
    );
  }

  if (ui.kind === 'signed_out') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[typography.heading, styles.title]}>Sign in to save</Text>
          <Text style={[typography.body, styles.subtle]}>
            {'Sign in so Nearr can find and save places you share.'}
          </Text>
          <View style={{ height: Spacing.lg }} />
          <Button title="Sign in" onPress={() => router.replace('/(auth)/sign-in')} />
        </View>
      </Screen>
    );
  }

  if (ui.kind === 'error') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[typography.heading, styles.title]}>{"Couldn't add to queue"}</Text>
          <Text style={[typography.body, styles.subtle]}>
            {'Check your connection and try again.'}
          </Text>
          <View style={{ height: Spacing.lg }} />
          <Button title="Retry" onPress={() => void submit()} />
          <Button
            title="Cancel"
            variant="ghost"
            onPress={() => router.replace('/(tabs)/map')}
            style={{ marginTop: Spacing.sm }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.centered}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[typography.heading, styles.title, { marginTop: Spacing.md }]}>
          Saving to Nearr
        </Text>
        <Text style={[typography.body, styles.subtle]}>
          {'Finding the place from this post…'}
        </Text>
      </View>
    </Screen>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.xl },
    check: { fontSize: 44, color: colors.success, marginBottom: Spacing.sm },
    title: { color: colors.text, textAlign: 'center' },
    subtle: { color: colors.textSecondary, textAlign: 'center', marginTop: Spacing.xs },
  });
}
