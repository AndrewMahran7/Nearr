/** Manual emulator fixture. NOT imported by the app or reachable by a production route.
 * Temporarily register this component as the local Metro entry for offline visual QA.
 * It mounts the real UI with local callbacks, never auth/provider/consent RPCs. */
import { useEffect, useState } from 'react';
import * as SplashScreen from 'expo-splash-screen';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { ThemeProvider, useTheme } from '../../lib/theme';
import { LocaleProvider } from '../../hooks/useLocale';
import { AgeEligibilityGate } from '../../components/AgeEligibilityGate';
import { assessDeclaration } from '../../lib/globalEligibility';
import type { AgeEligibilityState } from '../../hooks/useAgeEligibility';

function Fixture() {
  const { colors, setThemePreference, resolvedTheme } = useTheme();
  const [status, setStatus] = useState<AgeEligibilityState>('pending');
  const [fails, setFails] = useState(true);
  return <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <SafeAreaView edges={['top']} style={{ backgroundColor: colors.surface }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 4, gap: 8 }}>
        {[
          { label: 'QA: theme', action: () => setThemePreference(resolvedTheme === 'light' ? 'dark' : 'light') },
          { label: 'Pending', action: () => setStatus('pending') },
          { label: 'Delay', action: () => setStatus('error') },
          { label: 'Restricted', action: () => setStatus('under_minimum') },
          { label: fails ? 'Retry: fails' : 'Retry: works', action: () => setFails(!fails) },
        ].map(item => <Pressable key={item.label} onPress={item.action} style={{ minHeight: 36, justifyContent: 'center', paddingHorizontal: 6 }}><Text style={{ color: colors.text, fontSize: 12 }}>{item.label}</Text></Pressable>)}
      </View>
    </SafeAreaView>
    <AgeEligibilityGate status={status} submitting={false} onRetry={() => setStatus('pending')} onViewSavedData={() => {}}
      onDeclare={async answer => { if (fails) return false; setStatus(assessDeclaration(answer).status); return true; }} />
    {status === 'eligible' && <Text style={{ padding: 24, color: colors.text }}>Local fixture complete. No account or network request was created.</Text>}
  </View>;
}
export default function BirthdayOnboardingVisualFixture() {
  useEffect(() => { void SplashScreen.hideAsync(); }, []);
  return <SafeAreaProvider><ThemeProvider><LocaleProvider><Fixture /></LocaleProvider></ThemeProvider></SafeAreaProvider>;
}
