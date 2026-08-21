import type { ReactNode } from 'react';
import {
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingPrimaryButton } from '@/components/onboarding';

export const Phase1Colors = {
  background: '#090908',
  surface: '#151513',
  surfaceRaised: '#1D1C19',
  border: '#2B2925',
  text: '#FFF7ED',
  textMuted: '#A9A39A',
  orange: '#FF6A1A',
  onOrange: '#17100B',
  success: '#68D391',
} as const;

type FrameProps = {
  children: ReactNode;
  footer?: ReactNode;
  onBack?: () => void;
  progress?: number;
  progressLabel?: string;
  immersive?: boolean;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
};

export function Phase1Frame({
  children,
  footer,
  onBack,
  progress,
  progressLabel,
  immersive = false,
  scroll = true,
  contentStyle,
}: FrameProps) {
  const insets = useSafeAreaInsets();
  const content = (
    <View style={[styles.content, immersive && styles.immersiveContent, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={[styles.frame, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Go back"
            hitSlop={8}
            style={({ pressed }) => [styles.backButton, pressed && styles.pressed]}
          >
            <Feather name="arrow-left" size={22} color={Phase1Colors.text} />
          </Pressable>
        ) : (
          <View style={styles.brandMark} accessibilityLabel="Nearr">
            <View style={styles.brandPin}><Feather name="map-pin" size={15} color={Phase1Colors.onOrange} /></View>
            <Text style={styles.brandText}>NEARR</Text>
          </View>
        )}
        {typeof progress === 'number' ? (
          <Phase1Progress value={progress} label={progressLabel ?? 'Learn progress'} />
        ) : <View />}
        <View style={styles.topBarBalance} />
      </View>

      {scroll ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {content}
        </ScrollView>
      ) : content}

      {footer ? (
        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 14) }]}>{footer}</View>
      ) : null}
    </View>
  );
}

export function Phase1Progress({ value, label }: { value: number; label: string }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      style={styles.progressTrack}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={[styles.progressFill, { width: Math.max(5, 92 * clamped) }]} />
    </View>
  );
}

export function Phase1Prompt({
  icon,
  children,
  light = false,
}: {
  icon: keyof typeof Feather.glyphMap;
  children: ReactNode;
  light?: boolean;
}) {
  return (
    <View style={[styles.prompt, light && styles.promptLight]} accessibilityRole="text">
      <View style={styles.promptIcon}><Feather name={icon} size={14} color={Phase1Colors.onOrange} /></View>
      <Text style={[styles.promptText, light && styles.promptTextLight]}>{children}</Text>
    </View>
  );
}

export function Phase1PrimaryButton(props: React.ComponentProps<typeof OnboardingPrimaryButton>) {
  return <OnboardingPrimaryButton {...props} style={StyleSheet.flatten([styles.primaryButton, props.style])} />;
}

const styles = StyleSheet.create({
  frame: { flex: 1, backgroundColor: Phase1Colors.background },
  topBar: {
    height: 58,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Phase1Colors.surface,
    borderWidth: 1,
    borderColor: Phase1Colors.border,
  },
  brandMark: { minWidth: 88, height: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandPin: {
    width: 28,
    height: 28,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Phase1Colors.orange,
  },
  brandText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '900', letterSpacing: 1.4 },
  topBarBalance: { width: 44 },
  progressTrack: {
    width: 92,
    height: 3,
    overflow: 'hidden',
    borderRadius: 99,
    backgroundColor: '#302E2A',
  },
  progressFill: { height: 3, borderRadius: 99, backgroundColor: Phase1Colors.orange },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  content: { flex: 1, paddingHorizontal: 22, paddingTop: 14, paddingBottom: 24 },
  immersiveContent: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 12 },
  footer: {
    paddingTop: 10,
    paddingHorizontal: 18,
    backgroundColor: Phase1Colors.background,
  },
  prompt: {
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    paddingVertical: 8,
    paddingLeft: 8,
    paddingRight: 15,
    borderRadius: 999,
    backgroundColor: Phase1Colors.text,
  },
  promptLight: { backgroundColor: '#25231F', borderWidth: 1, borderColor: '#37342F' },
  promptIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Phase1Colors.orange,
  },
  promptText: { color: Phase1Colors.onOrange, fontSize: 14, fontWeight: '900' },
  promptTextLight: { color: Phase1Colors.text },
  primaryButton: { backgroundColor: Phase1Colors.orange },
  pressed: { opacity: 0.72, transform: [{ scale: 0.96 }] },
});
