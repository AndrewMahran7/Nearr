import { useMemo } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AppState, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { Phase1Colors, Phase1Frame, Phase1PrimaryButton, usePhase1Colors } from '@/components/onboarding/v2/Phase1Visuals';
import { useOnboardingTutorialJobs } from '@/hooks/useOnboardingTutorialJobs';
import {
  continueOnboardingV2PracticeInBackground,
  deferOnboardingV2Practice,
  markOnboardingV2PracticeWaitingForShare,
  openOnboardingV2Starter,
  reconcileOnboardingV2PracticeJob,
  recordOnboardingV2ReturnedWithoutShare,
} from '@/lib/onboardingV2';
import { planOnboardingPracticeRecovery, type OnboardingV2State } from '@/lib/onboardingV2Core';
import { onboardingPhase2PracticeFromFixtureId } from '@/lib/onboardingPhase2Practice';
import { recordOnboardingV2DevelopmentDiagnostic } from '@/lib/onboardingV2RouteDiagnostics';
import { offlineOnboardingAsset } from '@/onboarding/assets/offlineOnboardingAssets';
import { openOnboardingPracticePost } from '@/services/onboardingPracticeLauncher';

/** One route-owned surface for the real Phase 2 share, return, processing, and review states. */
export function OnboardingV2RealPractice({ state }: { state: OnboardingV2State }) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const router = useRouter();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [returnedWithoutShare, setReturnedWithoutShare] = useState(false);
  const backgroundedAtRef = useRef<string | null>(null);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const practiceSession = state.realPracticeSession;
  const practiceSource = onboardingPhase2PracticeFromFixtureId(practiceSession?.fixtureId);
  const { jobs, error: jobsError } = useOnboardingTutorialJobs(
    practiceSession?.startedAt ?? null,
    !!practiceSession && !practiceSession.completionReason,
  );

  useEffect(() => {
    if (!practiceSession || practiceSession.completionReason) return;
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
          setReturnedWithoutShare(false);
          recordOnboardingV2DevelopmentDiagnostic('practice_share_matched', {
            jobId: job.id,
            result: next.realPracticeSession.status,
          });
        }
      });
    }
  }, [jobs, practiceSession?.completionReason, practiceSession?.shareJobId, practiceSession?.startedAt]);

  useEffect(() => {
    const clearRecoveryTimer = () => {
      if (recoveryTimerRef.current) clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    };
    const evaluateReturn = (returnedAt: string) => {
      clearRecoveryTimer();
      const plan = planOnboardingPracticeRecovery({
        pendingShare: state.pendingShare,
        backgroundedAt: backgroundedAtRef.current,
        returnedAt,
        now: new Date().toISOString(),
      });
      if (plan.status === 'wait') {
        recoveryTimerRef.current = setTimeout(() => evaluateReturn(returnedAt), plan.delayMs);
      } else if (plan.status === 'offer' && state.pendingShare) {
        setReturnedWithoutShare(true);
        void recordOnboardingV2ReturnedWithoutShare({
          attemptId: state.pendingShare.attemptId,
          returnedAt: plan.returnedAt,
          helpEligibleAt: plan.helpEligibleAt,
        });
      }
    };
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') evaluateReturn(new Date().toISOString());
      else backgroundedAtRef.current = new Date().toISOString();
    });
    return () => {
      clearRecoveryTimer();
      subscription.remove();
    };
  }, [state.pendingShare]);

  if (!practiceSession || !practiceSource) return null;

  const openPracticeVideo = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    setReturnedWithoutShare(false);
    try {
      const fixture = state.practiceFixture;
      if (!fixture) throw new Error('practice_fixture_missing');
      await openOnboardingV2Starter({ contentId: fixture.contentId, sourceUrl: fixture.canonicalUrl });
      await openOnboardingPracticePost(fixture);
      await markOnboardingV2PracticeWaitingForShare();
    } catch {
      setError('The practice post could not open. Check your connection and try again.');
    } finally {
      setOpening(false);
    }
  };

  const status = practiceSession.status;
  const received = status === 'SHARE_RECEIVED' || status === 'PROCESSING';
  const needsReview = status === 'NEEDS_REVIEW';
  const failed = status === 'FAILED';
  const waiting = status === 'POST_OPENED' || status === 'WAITING_FOR_SHARE';
  const title = needsReview
    ? 'Nearr found a possible place.'
    : received
      ? 'Got it - Nearr is finding the place.'
      : failed
        ? 'Nearr could not finish this share.'
        : waiting
          ? 'Share the post to Nearr.'
          : 'Save one real place.';
  const body = needsReview
    ? 'Open Quick Check to confirm or correct the real place. Nothing is saved until you approve it.'
    : received
      ? 'Your share is safely in Queue. Stay here, or continue while the real job finishes.'
      : failed
        ? 'The real job stopped. You can retry the same practice post or continue without it.'
        : returnedWithoutShare
          ? 'No Nearr share arrived. Reopen the post and choose Nearr from the Share sheet, or continue without it.'
          : 'Open the post, tap Share, then choose Nearr. You will return to this same screen while it processes.';

  const primaryTitle = opening
    ? 'Opening...'
    : needsReview
      ? 'Review the place'
      : received
        ? 'Continue while Nearr works'
        : waiting || returnedWithoutShare
          ? 'Open the post again'
          : failed
            ? 'Retry practice post'
            : 'Open practice post';
  const primaryAction = () => {
    if (needsReview && practiceSession.shareJobId) {
      router.push(`/share-jobs/${practiceSession.shareJobId}`);
    } else if (received) {
      void continueOnboardingV2PracticeInBackground();
    } else {
      void openPracticeVideo();
    }
  };

  return (
    <Phase1Frame
      progress={0.75}
      progressLabel="Onboarding progress"
      footer={<View style={styles.actions}>
        <Phase1PrimaryButton
          title={primaryTitle}
          disabled={opening || (needsReview && !practiceSession.shareJobId)}
          onPress={primaryAction}
        />
        <Pressable
          style={styles.secondary}
          disabled={opening}
          onPress={() => void deferOnboardingV2Practice()}
          accessibilityRole="button"
          accessibilityLabel="I'll try this later"
        >
          <Text style={styles.secondaryText}>I'll try this later</Text>
        </Pressable>
      </View>}
    >
      <Text style={styles.eyebrow}>REAL SAVE - OPTIONAL</Text>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      <View style={styles.previewCard}>
        <Image
          source={offlineOnboardingAsset(practiceSource.localPreviewAssetKey)}
          style={styles.preview}
          resizeMode="cover"
          accessibilityLabel={`${practiceSource.category} practice source preview`}
        />
        <View style={styles.previewShade} />
        <View style={styles.sourceBadge}><Feather name="share-2" size={14} color="#FFFFFF" /><Text style={styles.sourceBadgeText}>PRACTICE POST</Text></View>
        <View style={styles.previewCopy}>
          <Text style={styles.placeName}>{practiceSource.expectedPlaceName}</Text>
          <Text style={styles.category}>{practiceSource.category}</Text>
        </View>
      </View>
      <View style={styles.statusCard}>
        <View style={[styles.statusIcon, (received || needsReview) && styles.statusIconActive]}>
          <Feather name={needsReview ? 'edit-3' : received ? 'check' : waiting ? 'share' : failed ? 'alert-circle' : 'map-pin'} size={19} color={Phase1Colors.onOrange} />
        </View>
        <View style={styles.statusCopy}>
          <Text style={styles.statusLabel}>{status.replaceAll('_', ' ')}</Text>
          <Text style={styles.statusText}>{received ? 'Submission received - this button will not launch the post again.' : needsReview ? 'Quick Check owns the next decision.' : 'Onboarding stays on this screen across the app switch.'}</Text>
        </View>
      </View>
      {jobsError ? <Text style={styles.error} accessibilityRole="alert">Nearr could not refresh Queue yet. Your share is still safe; try again shortly.</Text> : null}
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </Phase1Frame>
  );
}

function createStyles(Phase1Colors: ReturnType<typeof usePhase1Colors>) { return StyleSheet.create({
  actions: { gap: 3 },
  secondary: { minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: Phase1Colors.text, fontSize: 14, fontWeight: '600' },
  eyebrow: { color: Phase1Colors.orange, fontSize: 11, fontWeight: '600', letterSpacing: 1.7, marginBottom: 10 },
  title: { color: Phase1Colors.text, fontSize: 35, lineHeight: 39, fontWeight: '600', letterSpacing: -1.1 },
  body: { color: Phase1Colors.textMuted, fontSize: 16, lineHeight: 23, marginTop: 12 },
  previewCard: { height: 270, marginTop: 24, borderRadius: 28, overflow: 'hidden', backgroundColor: '#2D2925', borderWidth: 4, borderColor: Phase1Colors.surface },
  preview: { width: '100%', height: '100%' },
  previewShade: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.24)' },
  sourceBadge: { position: 'absolute', top: 14, left: 14, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 10, backgroundColor: 'rgba(16,14,12,0.78)' },
  sourceBadgeText: { color: '#FFFFFF', fontSize: 9, letterSpacing: 1.1, fontWeight: '600' },
  previewCopy: { position: 'absolute', left: 18, right: 18, bottom: 17 },
  placeName: { color: '#FFFFFF', fontSize: 24, lineHeight: 28, fontWeight: '600', textShadowColor: '#000000', textShadowRadius: 8 },
  category: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 3, textShadowColor: '#000000', textShadowRadius: 8 },
  statusCard: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 13, borderRadius: 18, backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border },
  statusIcon: { width: 42, height: 42, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: Phase1Colors.orange },
  statusIconActive: { backgroundColor: Phase1Colors.success },
  statusCopy: { flex: 1 },
  statusLabel: { color: Phase1Colors.text, fontSize: 12, fontWeight: '600' },
  statusText: { color: Phase1Colors.textMuted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  error: { color: Phase1Colors.danger, fontSize: 12, lineHeight: 17, fontWeight: '700', marginTop: 12 },
}); }
