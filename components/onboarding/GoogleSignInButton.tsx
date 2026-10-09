import { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { AntDesign } from '@expo/vector-icons';

import { OnboardingColors, OnboardingRadius, OnboardingSizes, useOnboardingColors } from './theme';

/** Google Blue, used for the mark only — never for the Nearr CTA. */
const GOOGLE_BLUE = '#4285F4';
const GOOGLE_TEXT = '#1F1F1F';

type Props = {
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
};

/**
 * "Continue with Google" — a light button on the Nearr dark background, sized
 * to match the native Apple button and the orange email CTA.
 *
 * The mark comes from `@expo/vector-icons` (already a dependency) rather than
 * pulling in an SVG/brand-icon package.
 */
export function GoogleSignInButton({ onPress, loading, disabled }: Props) {
  const OnboardingColors = useOnboardingColors();
  const styles = useMemo(() => createStyles(OnboardingColors), [OnboardingColors]);

  const blocked = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: !!blocked, busy: !!loading }}
      style={({ pressed }) => [
        styles.button,
        pressed && !blocked && styles.pressed,
        blocked && styles.disabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={GOOGLE_TEXT} />
      ) : (
        <View style={styles.content}>
          <AntDesign name="google" size={20} color={GOOGLE_BLUE} />
          <Text style={styles.label}>Continue with Google</Text>
        </View>
      )}
    </Pressable>
  );
}

function createStyles(OnboardingColors: ReturnType<typeof useOnboardingColors>) { return StyleSheet.create({
  button: {
    minHeight: OnboardingSizes.primaryButtonHeight,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: OnboardingColors.border,
    borderRadius: OnboardingRadius.button,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  pressed: {
    opacity: 0.88,
  },
  disabled: {
    opacity: 0.5,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  label: {
    color: GOOGLE_TEXT,
    fontSize: 17,
    fontWeight: '700',
  },
}); }

/** Thin "or" rule separating the provider buttons from the email form. */
export function AuthDivider({ label = 'or' }: { label?: string }) {
  const dividerStyles = createDividerStyles(useOnboardingColors());
  return (
    <View style={dividerStyles.row} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={dividerStyles.rule} />
      <Text style={dividerStyles.label}>{label}</Text>
      <View style={dividerStyles.rule} />
    </View>
  );
}

function createDividerStyles(OnboardingColors: ReturnType<typeof useOnboardingColors>) { return StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rule: {
    flex: 1,
    height: 1,
    backgroundColor: OnboardingColors.border,
  },
  label: {
    color: OnboardingColors.textMuted,
    fontSize: 13,
    fontWeight: '600',
  },
}); }
