import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useOnboardingTutorialJobs } from '@/hooks/useOnboardingTutorialJobs';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import {
  continueOnboardingV2PracticeInBackground,
  deferOnboardingV2Practice,
  markOnboardingV2PracticeWaitingForShare,
  openOnboardingV2Starter,
  reconcileOnboardingV2PracticeJob,
} from '@/lib/onboardingV2';
import { onboardingPhase2PracticeFromFixtureId } from '@/lib/onboardingPhase2Practice';
import { recordOnboardingV2DevelopmentDiagnostic } from '@/lib/onboardingV2RouteDiagnostics';
import { offlineOnboardingAsset } from '@/onboarding/assets/offlineOnboardingAssets';
import { openOnboardingPracticePost } from '@/services/onboardingPracticeLauncher';

/** Real Phase 2 share UI, backed by the durable queue rather than a local guess. */
export function OnboardingV2MapCoachmark({ topOffset }: { topOffset: number }) {
  const router = useRouter();
  const { state } = useOnboardingV2();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const practiceSession = state?.realPracticeSession ?? null;
  const practiceSource = onboardingPhase2PracticeFromFixtureId(practiceSession?.fixtureId);
  const { jobs, error: jobsError } = useOnboardingTutorialJobs(
    practiceSession?.startedAt ?? null,
    !!practiceSession && !practiceSession.completionReason,
  );

  useEffect(() => {
    if (!practiceSession || practiceSession.completionReason) return;
    // Newest-first. Source identity binds the first match; durable job id and
    // the extension-generated request id own every subsequent observation.
    for (const job of jobs) {
      void reconcileOnboardingV2PracticeJob({
        jobId: job.id,
        clientRequestId: job.idempotency_key ?? null,
        sourceUrl: job.canonical_url ?? job.source_url,
        status: job.status,
        savedPlaceId: job.saved_place_id,
        failureReason: job.failure_reason,
        observedAt: job.updated_at,
      }).then((next) => {
        if (next.realPracticeSession?.shareJobId === job.id) {
          recordOnboardingV2DevelopmentDiagnostic('practice_share_matched', {
            jobId: job.id,
            result: next.realPracticeSession.status,
          });
        }
      });
    }
  }, [jobs, practiceSession?.completionReason, practiceSession?.shareJobId, practiceSession?.startedAt]);

  if (!state || !practiceSession || practiceSession.completionReason) return null;

  const openPracticeVideo = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      const fixture = state.practiceFixture;
      if (!fixture) throw new Error('practice_fixture_missing');
      await openOnboardingV2Starter({ contentId: fixture.contentId, sourceUrl: fixture.canonicalUrl });
      await openOnboardingPracticePost(fixture);
      await markOnboardingV2PracticeWaitingForShare();
    } catch {
      setError('The practice video could not open. Check your connection or try this later.');
    } finally {
      setOpening(false);
    }
  };

  const status = practiceSession.status;
  const received = status === 'SHARE_RECEIVED' || status === 'PROCESSING';
  const needsReview = status === 'NEEDS_REVIEW';
  const failed = status === 'FAILED';
  const title = needsReview
    ? 'Nearr found a possible place.'
    : received
      ? 'Got it — Nearr is finding the place.'
      : failed
        ? 'Nearr could not finish this share.'
        : 'Add one from Instagram.';
  const body = needsReview
    ? 'Open the real Quick Check to confirm or correct the place. Nearr will not save it without your input.'
    : received
      ? 'Your guided share is safely in Queue. You can wait here or continue while it finishes in the background.'
      : failed
        ? 'The real job failed. Retry the post, or intentionally continue and come back later.'
        : 'Open the practice post, tap Share, then choose Nearr. Your saved tutorial place stays on the map.';

  const primaryAction = () => {
    if (needsReview && practiceSession.shareJobId) {
      router.push(`/share-jobs/${practiceSession.shareJobId}`);
    } else if (received) {
      void continueOnboardingV2PracticeInBackground();
    } else {
      void openPracticeVideo();
    }
  };

  return <View style={[styles.dock, { top: topOffset }]}>
    {practiceSource ? <Image source={offlineOnboardingAsset(practiceSource.localPreviewAssetKey)} style={styles.preview} resizeMode="cover" accessibilityLabel={`${practiceSource.category} practice source preview`} /> : null}
    <View style={styles.header}>
      <View style={styles.icon}><Feather name="share-2" size={16} color="#FFFFFF" /></View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>REAL SAVE · OPTIONAL</Text>
        <Text style={styles.title}>{title}</Text>
      </View>
    </View>
    <Text style={styles.body}>{body}</Text>
    {jobsError ? <Text style={styles.error} accessibilityRole="alert">Nearr could not refresh Queue yet. Your share is still safe; try again shortly.</Text> : null}
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    <View style={styles.actions}>
      <Pressable
        style={[styles.primary, opening && styles.disabled]}
        disabled={opening || (needsReview && !practiceSession.shareJobId)}
        onPress={primaryAction}
        accessibilityRole="button"
        accessibilityLabel={needsReview ? 'Review the place' : received ? 'Continue while Nearr works' : 'Open practice video'}
      >
        <Text style={styles.primaryText}>{opening ? 'Opening…' : needsReview ? 'Review the place' : received ? 'Continue while Nearr works' : failed ? 'Retry practice video' : 'Open practice video'}</Text>
      </Pressable>
      <Pressable style={styles.secondary} disabled={opening} onPress={() => void deferOnboardingV2Practice()} accessibilityRole="button" accessibilityLabel="I'll try this later"><Text style={styles.secondaryText}>I’ll try this later</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12, padding: 12, borderRadius: 18, backgroundColor: 'rgba(17,17,17,0.96)', borderWidth: 1, borderColor: '#303030', shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
  preview: { width: '100%', height: 72, borderRadius: 12, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E' },
  copy: { flex: 1 },
  eyebrow: { color: '#FF8A38', fontSize: 9, fontWeight: '900', letterSpacing: 1.1 },
  title: { color: '#FFFFFF', fontSize: 16, lineHeight: 20, fontWeight: '900', marginTop: 2 },
  body: { color: '#C4C4C4', fontSize: 12, lineHeight: 17, marginTop: 8 },
  error: { color: '#FFB49B', fontSize: 11, lineHeight: 15, marginTop: 7, fontWeight: '700' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10 },
  primary: { flex: 1.35, minHeight: 42, borderRadius: 13, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10 },
  primaryText: { color: '#111111', fontSize: 13, fontWeight: '900' },
  secondary: { flex: 1, minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  secondaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  disabled: { opacity: 0.65 },
});
