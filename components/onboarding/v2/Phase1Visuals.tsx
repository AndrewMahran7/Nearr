import { useMemo, type ReactNode } from 'react';
import {
  Pressable,
  Image,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  View,
  ViewStyle,
  useWindowDimensions,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingPrimaryButton } from '@/components/onboarding';
import { LightPalette } from '@/constants';
import { useTheme } from '@/lib/theme';

export const Phase1Colors = {
  background: LightPalette.bg,
  surface: LightPalette.surface,
  surfaceRaised: LightPalette.surfaceElevated,
  border: LightPalette.border,
  text: LightPalette.text,
  textMuted: LightPalette.textSecondary,
  orange: LightPalette.accent,
  onOrange: LightPalette.textInverse,
  success: LightPalette.success,
  successSurface: LightPalette.successSurface,
  danger: LightPalette.danger,
  action: LightPalette.primary,
  onAction: LightPalette.textInverse,
  mapLand: '#EEEBDF',
  mapWater: '#B8D5D9',
} as const;

export function usePhase1Colors() {
  const { colors, resolvedTheme } = useTheme();
  return useMemo(() => ({
    background: colors.bg, surface: colors.surface, surfaceRaised: colors.surfaceElevated,
    border: colors.border, text: colors.text, textMuted: colors.textSecondary,
    orange: colors.accent, onOrange: colors.textInverse, success: colors.success,
    successSurface: colors.successSurface, danger: colors.danger, action: colors.primary, onAction: colors.textInverse,
    mapLand: resolvedTheme === 'dark' ? '#303A31' : '#EEEBDF',
    mapWater: resolvedTheme === 'dark' ? '#203B42' : '#B8D5D9',
  }), [colors, resolvedTheme]);
}

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
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const insets = useSafeAreaInsets();
  const { resolvedTheme } = useTheme();
  const { fontScale, height } = useWindowDimensions();
  const content = (
    <View style={[styles.content, immersive && styles.immersiveContent, contentStyle]}>
      {children}
    </View>
  );

  return (
    <View style={[styles.frame, { paddingTop: insets.top }]}>
      <StatusBar style={resolvedTheme === 'dark' ? 'light' : 'dark'} />
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
            <Image source={require('../../../assets/icon.png')} style={styles.brandLogo} />
            <Text style={styles.brandText}>NEARR</Text>
          </View>
        )}
        {typeof progress === 'number' ? (
          <Phase1Progress value={progress} label={progressLabel ?? 'Learn progress'} />
        ) : <View />}
        <View style={styles.topBarBalance} />
      </View>

      {scroll || fontScale >= 1.5 || height < 700 ? (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={[styles.scrollContent, !!footer && styles.scrollContentWithFooter]}
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
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      style={styles.progressTrack}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={[styles.progressFill, { width: `${Math.max(4, clamped * 100)}%` }]} />
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
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return (
    <View style={[styles.prompt, light && styles.promptLight]} accessibilityRole="text">
      <View style={styles.promptIcon}><Feather name={icon} size={14} color={Phase1Colors.onOrange} /></View>
      <Text style={[styles.promptText, light && styles.promptTextLight]}>{children}</Text>
    </View>
  );
}

export function Phase1PrimaryButton(props: React.ComponentProps<typeof OnboardingPrimaryButton>) {
  const Phase1Colors = usePhase1Colors();
  const styles = useMemo(() => createStyles(Phase1Colors), [Phase1Colors]);

  return <OnboardingPrimaryButton {...props} style={StyleSheet.flatten([styles.primaryButton, props.style])} />;
}

function createStyles(Phase1Colors: ReturnType<typeof usePhase1Colors>) { return StyleSheet.create({
  frame: { flex: 1, backgroundColor: Phase1Colors.background },
  topBar: {
    height: 64,
    paddingHorizontal: 20,
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
  brandLogo: { width: 30, height: 30, borderRadius: 10 },
  brandText: { color: Phase1Colors.text, fontSize: 13, fontWeight: '600', letterSpacing: 1.4 },
  topBarBalance: { width: 44 },
  progressTrack: {
    width: 152,
    flexShrink: 1,
    marginHorizontal: 12,
    height: 6,
    overflow: 'hidden',
    borderRadius: 99,
    backgroundColor: Phase1Colors.border,
  },
  progressFill: { height: 6, borderRadius: 99, backgroundColor: Phase1Colors.orange },
  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  scrollContentWithFooter: { paddingBottom: 8 },
  content: { flex: 1, paddingHorizontal: 24, paddingTop: 18, paddingBottom: 28 },
  immersiveContent: { paddingHorizontal: 12, paddingTop: 6, paddingBottom: 12 },
  footer: {
    flexShrink: 0,
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
  promptLight: { backgroundColor: Phase1Colors.surface, borderWidth: 1, borderColor: Phase1Colors.border },
  promptIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Phase1Colors.orange,
  },
  promptText: { color: Phase1Colors.surface, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  promptTextLight: { color: Phase1Colors.text },
  primaryButton: { backgroundColor: Phase1Colors.action, minHeight: 50 },
  pressed: { opacity: 0.72,  },
}); }
