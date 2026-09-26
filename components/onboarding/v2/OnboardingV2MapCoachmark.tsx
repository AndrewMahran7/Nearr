import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';

import { useOnboardingV2 } from '@/hooks/useOnboardingV2';
import { deferOnboardingV2Practice } from '@/lib/onboardingV2';

/**
 * Compatibility surface for checkpoints written by the retired live-practice
 * flow. New onboarding never routes through the real map. An older
 * `practice_ready` checkpoint gets one local continuation and cannot open a
 * social app, poll share jobs, or create a save.
 */
export function OnboardingV2MapCoachmark({ topOffset }: { topOffset: number }) {
  const { state } = useOnboardingV2();
  if (state?.stage !== 'practice_ready') return null;

  return <View style={[styles.dock, { top: topOffset }]}>
    <View style={styles.icon}><Feather name="check" size={18} color="#FFFFFF" /></View>
    <View style={styles.copy}>
      <Text style={styles.eyebrow}>PRACTICE COMPLETE</Text>
      <Text style={styles.title}>Continue with your local walkthrough.</Text>
      <Text style={styles.body}>This checkpoint came from an older build. Nearr no longer asks onboarding to open or process a live post.</Text>
    </View>
    <Pressable style={styles.primary} onPress={() => void deferOnboardingV2Practice()} accessibilityRole="button" accessibilityLabel="Continue onboarding">
      <Text style={styles.primaryText}>Continue</Text>
    </Pressable>
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
});
