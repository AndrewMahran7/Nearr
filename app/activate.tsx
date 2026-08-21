import { useRef } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Feather } from '@expo/vector-icons';

import { trackEvent } from '@/lib/analytics';
import { hapticSelection } from '@/lib/haptics';
import {
  OnboardingActionCard,
  OnboardingColors,
  OnboardingRadius,
  OnboardingScreenShell,
  OnboardingSecondaryButton,
} from '@/components/onboarding';
import { ScreenHeading } from '@/components/onboarding/screens';
import { OnboardingV2Activation } from '@/components/onboarding/v2';
import { useAuth } from '@/hooks/useAuth';
import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { isOnboardingV2Enabled } from '@/lib/featureFlags';

type FirstSaveSource = 'instagram' | 'tiktok' | 'paste_link';

/**
 * Post-account activation — "Save your first place" (Step 1 of 2).
 *
 * Shown right after authentication for users who have not yet saved a place.
 * The three source rows launch the real save paths (existing deep links + the
 * paste-link `/share` route). Opening Instagram/TikTok is NOT a save — the
 * actual first_save_completed event fires later from the save flow when a
 * place is confirmed and saved. No location/notification permission here.
 */
export default function ActivateRoute() {
  const { session, loading: authLoading } = useAuth();
  const { state, loading } = useOnboardingV2();
  if (isOnboardingV2Enabled() && (loading || authLoading)) return null;
  const resumesV2 =
    isOnboardingV2Enabled() &&
    state?.cohort === 'new_user_v2' &&
    state.boundUserId === session?.user.id &&
    !state.behavioralCompletedAt;
  if (resumesV2) return <OnboardingV2Activation />;
  return <LegacyActivateScreen />;
}

function LegacyActivateScreen() {
  const router = useRouter();

  // Guard so a fast double-tap can't fire two launches / navigations.
  const busyRef = useRef(false);

  function selectSource(source: FirstSaveSource) {
    if (busyRef.current) return;
    busyRef.current = true;
    hapticSelection();
    void trackEvent('first_save_source_selected', { source });
    void trackEvent('first_save_started', { source });

    if (source === 'paste_link') {
      router.push('/share');
    } else if (source === 'instagram') {
      void openExternalApp('instagram://app', 'https://www.instagram.com/reel/DcK_jXtxc7_/');
    } else {
      void openExternalApp('tiktok://', 'https://www.tiktok.com/@kate.liz.harley/video/7620099722161769741');
    }

    setTimeout(() => {
      busyRef.current = false;
    }, 600);
  }

  function deferForNow() {
    void trackEvent('activation_deferred', { reason: 'skipped' });
    router.replace('/(tabs)/map');
  }

  return (
    <OnboardingScreenShell
      footer={
        <OnboardingSecondaryButton
          title="I'll save my first place later"
          onPress={deferForNow}
        />
      }
    >
      <View style={styles.stepBlock}>
        <Text style={styles.stepLabel}>Step 1 of 2</Text>
        <View style={styles.progress}>
          <View style={[styles.segment, styles.segmentActive]} />
          <View style={[styles.segment, styles.segmentInactive]} />
        </View>
      </View>

      <ScreenHeading
        headline="Save your first place"
        subtext="Choose where to start. Instagram works best."
      />

      <View style={styles.actions}>
        <OnboardingActionCard
          icon="instagram"
          title="Open Instagram"
          emphasized
          onPress={() => selectSource('instagram')}
        />
        {/* Feather has no TikTok glyph — "music" stands in for the platform. */}
        <OnboardingActionCard
          icon="music"
          title="Open TikTok"
          onPress={() => selectSource('tiktok')}
        />
        <OnboardingActionCard
          icon="link"
          title="Paste a link"
          onPress={() => selectSource('paste_link')}
        />
      </View>

      <View style={styles.tip}>
        <View style={styles.tipIcon}>
          <Feather name="star" size={16} color={OnboardingColors.orange} />
        </View>
        <Text style={styles.tipText}>
          <Text style={styles.tipLead}>Tip: </Text>
          Don't see Nearr? Swipe through the apps or tap More. After your first save, add Nearr
          to your share favorites for one-tap saving.
        </Text>
      </View>
    </OnboardingScreenShell>
  );
}

/**
 * Best-effort external app launcher. Tries the native scheme first, then falls
 * back to the web URL. Never throws.
 */
async function openExternalApp(appUrl: string, webUrl: string): Promise<void> {
  try {
    if (await Linking.canOpenURL(appUrl)) {
      await Linking.openURL(appUrl);
      return;
    }
  } catch {
    // fall through to the web URL
  }
  try {
    await Linking.openURL(webUrl);
  } catch {
    // swallow — nothing more we can do, and we must not throw
  }
}

const styles = StyleSheet.create({
  stepBlock: {
    marginBottom: 20,
    gap: 10,
  },
  stepLabel: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  progress: {
    flexDirection: 'row',
    gap: 6,
  },
  segment: {
    flex: 1,
    height: 4,
    borderRadius: OnboardingRadius.pill,
  },
  segmentActive: {
    backgroundColor: OnboardingColors.orange,
  },
  segmentInactive: {
    backgroundColor: OnboardingColors.progressInactive,
  },
  actions: {
    gap: 12,
  },
  tip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginTop: 24,
    padding: 16,
    borderRadius: OnboardingRadius.card,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    backgroundColor: OnboardingColors.card,
  },
  tipIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255, 107, 0, 0.12)',
  },
  tipText: {
    flex: 1,
    color: OnboardingColors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  tipLead: {
    color: OnboardingColors.orange,
    fontWeight: '700',
  },
});
