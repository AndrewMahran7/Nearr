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
import { resolveSubmissionId } from '@/lib/shareSubmission';
import { hostShareSubmitter } from '@/lib/hostShareSubmit';
import { logDebug } from '@/lib/logger';

type UiState =
  | { kind: 'submitting' }
  | { kind: 'accepted'; duplicate: boolean }
  | { kind: 'signed_out' }
  | { kind: 'error' };

export function ShareJobHandoff({ url, submissionId }: { url: string; submissionId?: string }) {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const [ui, setUi] = useState<UiState>({ kind: 'submitting' });
  const handledRef = useRef(false);
  // ONE stable submission id for this share action. Prefer an id propagated from
  // the extension/deep link (?sid=), else derive a deterministic (remount- and
  // cold/warm-stable) id from the URL. This is what makes a single share create
  // at most one job even when the handoff remounts or both deep-link listeners
  // process the same URL.
  const submissionIdRef = useRef(
    resolveSubmissionId({ url, fromDeepLink: submissionId ?? null }),
  );
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const submit = async () => {
    try {
      setUi({ kind: 'submitting' });
      const result = await hostShareSubmitter.submit({
        url,
        submissionId: submissionIdRef.current,
      });
      if (result.ok) {
        console.log(`[share-job] job_accepted=true duplicate=${!!result.duplicate}`);
        setUi({ kind: 'accepted', duplicate: !!result.duplicate });
        closeTimerRef.current = setTimeout(() => router.replace('/(tabs)/map'), 1600);
      } else if (result.reason === 'unauthorized' || result.reason === 'missing_auth') {
        setUi({ kind: 'signed_out' });
      } else {
        console.log(`[share-job] job_accepted=false reason=${result.reason}`);
        setUi({ kind: 'error' });
      }
    } catch (err) {
      // A duplicate-share / transient exception must degrade to a recoverable
      // error state — never bubble to the global "Something went wrong" boundary.
      logDebug('share-job', 'handoff submit threw', (err as Error)?.message ?? String(err));
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
