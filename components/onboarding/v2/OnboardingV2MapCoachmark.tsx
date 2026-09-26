import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { deferOnboardingV2Practice } from '@/lib/onboardingV2';

/**
 * Phase 2 is the explicit real-world boundary. It uses the installed share
 * extension and normal Development recognition/save pipeline.
 */
export function OnboardingV2MapCoachmark({ topOffset }: { topOffset: number }) {
  const { state } = useOnboardingV2();
  if (state?.stage !== 'practice_ready') return null;

  const platform = state.preferredPlatform === 'other' || !state.preferredPlatform
    ? 'instagram'
    : state.preferredPlatform;
  const targets: Record<string, { app: string; web: string; label: string }> = {
    instagram: { app: 'instagram://app', web: 'https://www.instagram.com/', label: 'Instagram' },
    tiktok: { app: 'tiktok://', web: 'https://www.tiktok.com/', label: 'TikTok' },
    facebook: { app: 'fb://', web: 'https://www.facebook.com/', label: 'Facebook' },
    youtube: { app: 'youtube://', web: 'https://www.youtube.com/', label: 'YouTube' },
  };
  const target = targets[platform] ?? targets.instagram;
  const openSocialApp = async () => {
    const supported = await Linking.canOpenURL(target.app).catch(() => false);
    await Linking.openURL(supported ? target.app : target.web);
  };

  return <View style={[styles.dock, { top: topOffset }]}>
    <View style={styles.icon}><Feather name="share-2" size={18} color="#FFFFFF" /></View>
    <View style={styles.copy}>
      <Text style={styles.eyebrow}>TRY A REAL SAVE · OPTIONAL</Text>
      <Text style={styles.title}>Share any place video to Nearr.</Text>
      <Text style={styles.body}>Open {target.label}, choose a video, tap Share, then choose Nearr. The real Development pipeline will add the place here.</Text>
    </View>
    <Pressable style={styles.primary} onPress={() => void openSocialApp()} accessibilityRole="button" accessibilityLabel={`Open ${target.label}`}>
      <Text style={styles.primaryText}>Open {target.label}</Text>
    </Pressable>
    <Pressable style={styles.secondary} onPress={() => void deferOnboardingV2Practice()} accessibilityRole="button" accessibilityLabel="I'll try this later"><Text style={styles.secondaryText}>I’ll try this later</Text></Pressable>
  </View>;
}

const styles = StyleSheet.create({
  dock: { position: 'absolute', left: 16, right: 16, zIndex: 80, elevation: 12, padding: 16, borderRadius: 20, backgroundColor: '#111111', borderWidth: 1, borderColor: '#303030', shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 14, shadowOffset: { width: 0, height: 7 } },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2FA76E' },
  copy: { marginTop: 10 },
  eyebrow: { color: '#FF8A38', fontSize: 10, fontWeight: '900', letterSpacing: 1.2 },
  title: { color: '#FFFFFF', fontSize: 19, lineHeight: 23, fontWeight: '900', marginTop: 8 },
  body: { color: '#B1B1B1', fontSize: 13, lineHeight: 19, marginTop: 7 },
  primary: { minHeight: 48, marginTop: 14, borderRadius: 14, backgroundColor: '#FF6B00', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  primaryText: { color: '#111111', fontSize: 14, fontWeight: '900' },
  secondary: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800' },
});
