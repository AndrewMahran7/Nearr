import { useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import type { AgeEligibilityState } from '@/hooks/useAgeEligibility';

type Props = {
  status: AgeEligibilityState;
  submitting: boolean;
  onDeclare: (atLeast18: boolean) => Promise<boolean>;
  onRetry: () => void;
  onSignOut: () => Promise<void>;
};

export function AgeEligibilityGate({ status, submitting, onDeclare, onRetry, onSignOut }: Props) {
  const { colors } = useTheme();
  const styles = createStyles(colors);
  const [submitError, setSubmitError] = useState(false);
  const restricted = status === 'under_18' || status === 'revoked';
  const loading = status === 'loading';
  const failed = status === 'error';

  async function answer(atLeast18: boolean) {
    setSubmitError(false);
    if (!(await onDeclare(atLeast18))) setSubmitError(true);
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.mark}><Text style={styles.markText}>N</Text></View>
        <Text style={styles.eyebrow}>YOUR NEARR ACCOUNT</Text>
        <Text style={styles.title}>{restricted ? 'Nearr is for adults.' : 'Nearr is for adults 18 and older.'}</Text>
        <Text style={styles.body}>
          {restricted
            ? 'This account cannot use Nearr’s live features because Nearr is available only to people 18 or older. Your saved account data has not been deleted.'
            : 'Before you use live place-finding, please tell us whether you are at least 18. This is your declaration; Nearr is not independently verifying your age here.'}
        </Text>
        {loading ? <ActivityIndicator accessibilityLabel="Checking account eligibility" color={colors.primary} /> : null}
        {failed ? (
          <>
            <Text style={styles.error}>We could not check this account. Connect to the internet and try again. Live analysis remains unavailable until the check succeeds.</Text>
            <Pressable accessibilityRole="button" onPress={onRetry} style={styles.primary}>
              <Text style={styles.primaryText}>Try again</Text>
            </Pressable>
          </>
        ) : null}
        {status === 'pending' ? (
          <>
            <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void answer(true)} style={styles.primary}>
              <Text style={styles.primaryText}>{submitting ? 'Saving…' : 'I am 18 or older'}</Text>
            </Pressable>
            <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void answer(false)} style={styles.secondary}>
              <Text style={styles.secondaryText}>I am under 18</Text>
            </Pressable>
            <Text style={styles.note}>Please answer accurately. An under-18 decision cannot be changed by repeating this step.</Text>
          </>
        ) : null}
        {submitError ? <Text style={styles.error}>We could not save your answer. Check your connection and try again.</Text> : null}
        {restricted ? (
          <Pressable accessibilityRole="link" onPress={() => void Linking.openURL('mailto:andrew.mahran@icloud.com?subject=Nearr%20account%20or%20data%20request')} style={styles.secondary}>
            <Text style={styles.secondaryText}>Contact support about your account or data</Text>
          </Pressable>
        ) : null}
        <Pressable accessibilityRole="button" disabled={submitting} onPress={() => void onSignOut()} style={styles.secondary}>
          <Text style={styles.secondaryText}>Sign out</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function createStyles(colors: ReturnType<typeof useTheme>['colors']) {
  return StyleSheet.create({
    safe: { flex: 1, backgroundColor: colors.bg },
    content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 28, paddingVertical: 32, gap: 16 },
    mark: { width: 56, height: 56, borderRadius: 16, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
    markText: { color: colors.textInverse, fontSize: 32, fontWeight: '900' },
    eyebrow: { color: colors.primary, fontSize: 12, letterSpacing: 2, fontWeight: '800' },
    title: { color: colors.text, fontSize: 30, lineHeight: 36, fontWeight: '800' },
    body: { color: colors.textSecondary, fontSize: 16, lineHeight: 24 },
    primary: { minHeight: 52, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
    primaryText: { color: colors.textInverse, fontSize: 16, fontWeight: '800' },
    secondary: { minHeight: 48, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
    secondaryText: { color: colors.text, fontSize: 15, fontWeight: '700', textAlign: 'center' },
    note: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
    error: { color: colors.danger, fontSize: 14, lineHeight: 21 },
  });
}
