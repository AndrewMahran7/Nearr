import { useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as WebBrowser from 'expo-web-browser';

import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { deferOnboardingV2Practice, openOnboardingV2Starter } from '@/lib/onboardingV2';
import { ONBOARDING_PHASE2_PRACTICE } from '@/lib/onboardingPhase2Practice';

async function openOnboardingPhase2PracticePost(): Promise<void> {
  try {
    // The exact HTTPS post is an Instagram universal/app link when Instagram
    // is installed and the exact web destination everywhere else.
    await Linking.openURL(ONBOARDING_PHASE2_PRACTICE.canonicalUrl);
  } catch {
    // If the OS link handler rejects it, retain the same post in an in-app
    // browser. Neither branch can fall back to Instagram home.
    await WebBrowser.openBrowserAsync(ONBOARDING_PHASE2_PRACTICE.canonicalUrl);
  }
}

/**
 * Phase 2 is the explicit real-world boundary. It uses the installed share
 * extension and normal Development recognition/save pipeline.
 */
export function OnboardingV2MapCoachmark({ topOffset }: { topOffset: number }) {
  const { state } = useOnboardingV2();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!state || !['practice_ready', 'first_independent_external_video_opened'].includes(state.stage)) return null;

  const openPracticeVideo = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      await openOnboardingV2Starter({
        contentId: ONBOARDING_PHASE2_PRACTICE.contentId,
        sourceUrl: ONBOARDING_PHASE2_PRACTICE.canonicalUrl,
      });
      await openOnboardingPhase2PracticePost();
    } catch {
      setError('The practice video could not open. Check your connection or try this later.');
    } finally {
      setOpening(false);
    }
  };

  return <View style={[styles.dock, { top: topOffset }]}>
    <View style={styles.header}>
      <View style={styles.icon}><Feather name="share-2" size={16} color="#FFFFFF" /></View>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>REAL SAVE · OPTIONAL</Text>
        <Text style={styles.title}>Add one from Instagram.</Text>
      </View>
    </View>
    <Text style={styles.body}>Open the practice post, tap Share, then choose Nearr. Your saved tutorial place stays on the map.</Text>
    {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    <View style={styles.actions}>
      <Pressable style={[styles.primary, opening && styles.disabled]} disabled={opening} onPress={() => void openPracticeVideo()} accessibilityRole="button" accessibilityLabel="Open practice video">
        <Text style={styles.primaryText}>{opening ? 'Opening…' : 'Open practice video'}</Text>
      </Pressable>
      <Pressable style={styles.secondary} disabled={opening} onPress={() => void deferOnboardingV2Practice()} accessibilityRole="button" accessibilityLabel="I'll try this later"><Text style={styles.secondaryText}>I’ll try this later</Text></Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12, padding: 12, borderRadius: 18, backgroundColor: 'rgba(17,17,17,0.96)', borderWidth: 1, borderColor: '#303030', shadowColor: '#000000', shadowOpacity: 0.24, shadowRadius: 10, shadowOffset: { width: 0, height: 5 } },
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
