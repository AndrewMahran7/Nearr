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
import { VayrinPresentationHeader } from '@/components/VayrinPresentationHeader';
import { Spacing } from '@/constants';
import { isVayrinProductUiEnabled } from '@/lib/featureFlags';
import { useTheme } from '@/lib/theme';
import { buildVayrinPresentation } from '@/lib/vayrinPresentation';
import { trackEvent } from '@/lib/analytics';
import { resolveSubmissionId } from '@/lib/shareSubmission';
import { hostShareSubmitter } from '@/lib/hostShareSubmit';
import { logDebug } from '@/lib/logger';
import { recordDiagnostic } from '@/lib/deviceDiagnostics';
import { sharedAuth } from '@/lib/sharedAuth';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { observeOnboardingV2ShareReceived } from '@/lib/onboardingV2';
import { isExpectedOnboardingSource } from '@/lib/onboardingV2Core';

type UiState =
  | { kind: 'submitting' }
  | { kind: 'accepted'; duplicate: boolean }
  | { kind: 'out_of_finds'; jobId: string }
  | { kind: 'signed_out' }
  | { kind: 'error' };

export function ShareJobHandoff({ url, submissionId }: { url: string; submissionId?: string }) {
  const router = useRouter();
  const { colors, typography } = useTheme();
  const vayrinEnabled = isVayrinProductUiEnabled();
  const [ui, setUi] = useState<UiState>({ kind: 'submitting' });
  const { state: onboardingV2 } = useOnboardingV2();
  const onboardingShare = isExpectedOnboardingSource(onboardingV2?.pendingShare ?? null, url);
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
  const submitAttemptRef = useRef(0);

  const submit = async () => {
    try {
      submitAttemptRef.current += 1;
      sharedAuth.recordShareTrace(
        submissionIdRef.current,
        'share_handoff_submit_started',
        submitAttemptRef.current === 1 ? 'initial' : 'retry',
      );
      setUi({ kind: 'submitting' });
      if (vayrinEnabled) void trackEvent('vayrin_started', { source: 'async_handoff' });
      await observeOnboardingV2ShareReceived(url);
      const result = await hostShareSubmitter.submit({
        url,
        submissionId: submissionIdRef.current,
      });
      if (result.ok) {
        console.log(`[share-job] job_accepted=true duplicate=${!!result.duplicate}`);
        if (result.requiresPurchase && result.jobId) {
          void trackEvent('balance_exhausted', { entry_point: 'share_handoff' });
          setUi({ kind: 'out_of_finds', jobId: result.jobId });
          return;
        }
        setUi({ kind: 'accepted', duplicate: !!result.duplicate });
        closeTimerRef.current = setTimeout(() => router.replace('/(tabs)/map'), 1600);
      } else if (result.reason === 'unauthorized' || result.reason === 'missing_auth') {
        setUi({ kind: 'signed_out' });
      } else {
        console.log(`[share-job] job_accepted=false reason=${result.reason}`);
        void recordDiagnostic({
          errorCode: `share_handoff_${result.reason}`,
          route: '/share',
          error: `share handoff failed: ${result.reason}`,
          jobId: submissionIdRef.current,
          httpStatus: result.httpStatus,
          responseErrorCode: result.responseErrorCode ?? result.reason,
          requestId: result.requestId,
        });
        setUi({ kind: 'error' });
      }
    } catch (err) {
      // A duplicate-share / transient exception must degrade to a recoverable
      // error state — never bubble to the global "Something went wrong" boundary.
      logDebug('share-job', 'handoff submit threw', (err as Error)?.message ?? String(err));
      void recordDiagnostic({
        errorCode: 'share_handoff_exception',
        route: '/share',
        error: err,
        jobId: submissionIdRef.current,
      });
      setUi({ kind: 'error' });
    }
  };

  useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;
    sharedAuth.recordShareTrace(
      submissionIdRef.current,
      'share_handoff_component_mounted',
    );
    void submit();
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const styles = createStyles(colors);

  if (ui.kind === 'out_of_finds') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={[typography.heading, styles.title]}>Your shared post is safe</Text>
          <Text style={[typography.body, styles.subtle]}>
            {'You\u2019re out of tokens. Choose a pack and Nearr will continue this video automatically.'}
          </Text>
          <View style={{ height: Spacing.lg }} />
          <Button
            title="View token packs"
            onPress={() => router.replace({
              pathname: '/monetization',
              params: { jobId: ui.jobId, entry: 'share_handoff' },
            })}
          />
          <Button
            title="Not now"
            variant="ghost"
            onPress={() => router.replace('/share-jobs')}
            style={{ marginTop: Spacing.sm }}
          />
        </View>
      </Screen>
    );
  }

  if (ui.kind === 'accepted') {
    return (
      <Screen>
        <View style={styles.centered}>
          <Text style={styles.check}>✓</Text>
          {vayrinEnabled ? (
            <VayrinPresentationHeader
              compact
              presentation={{
                ...buildVayrinPresentation({ kind: 'looking', source: 'async' }),
                headline: 'Sent to Nearr',
                body: onboardingShare
                  ? 'Checking the post. Nearr will let you know when the result is ready.'
                  : 'Finding the place. You can close this.',
              }}
            />
          ) : (
            <>
              <Text style={[typography.heading, styles.title]}>Added to your queue</Text>
              <Text style={[typography.body, styles.subtle]}>
                {"We'll notify you when it's ready. You can keep browsing."}
              </Text>
            </>
          )}
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
          <Button title="Sign in" onPress={() => router.replace('/(onboarding)/account')} />
        </View>
      </Screen>
    );
  }

  if (ui.kind === 'error') {
    return (
      <Screen>
        <View style={styles.centered}>
          {vayrinEnabled ? (
            <VayrinPresentationHeader
              compact
              presentation={buildVayrinPresentation({ kind: 'technical_failure', source: 'async' })}
            />
          ) : (
            <>
              <Text style={[typography.heading, styles.title]}>{"Couldn't add to queue"}</Text>
              <Text style={[typography.body, styles.subtle]}>
                {'Check your connection and try again.'}
              </Text>
            </>
          )}
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
        {vayrinEnabled ? (
          <VayrinPresentationHeader
            compact
            presentation={{
              ...buildVayrinPresentation({ kind: 'looking', source: 'async' }),
              headline: onboardingShare ? 'Finding the place…' : 'Sending to Nearr',
              body: onboardingShare
                ? 'Nearr received the post.'
                : 'The search will start as soon as it arrives.',
            }}
          />
        ) : (
          <>
            <ActivityIndicator color={colors.primary} />
            <Text style={[typography.heading, styles.title, { marginTop: Spacing.md }]}>
              Saving to Nearr
            </Text>
            <Text style={[typography.body, styles.subtle]}>
              {'Finding the place from this post…'}
            </Text>
          </>
        )}
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
