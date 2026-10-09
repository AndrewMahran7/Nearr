import { useMemo } from 'react';
import { LightPalette } from '@/constants';
import { useTheme } from '@/lib/theme';

/** Legacy asset fallback; live onboarding surfaces use useOnboardingColors. */
export const OnboardingColors = {
  /** Screen background. */
  background: LightPalette.bg,
  /** Standard paper or dark surface. */
  card: LightPalette.surface,
  action: LightPalette.primary,
  controlBorder: LightPalette.controlBorder,
  /** Slightly lighter elevated card (rows, previews). */
  cardElevated: LightPalette.surfaceElevated,
  /** Hairline border for cards and rows. */
  border: LightPalette.border,
  /** Primary text (headlines, titles). */
  text: LightPalette.text,
  /** Muted gray secondary text. */
  textMuted: LightPalette.textSecondary,
  /** Accessible warm accent for text and details. */
  orange: LightPalette.accent,
  /** Inline validation / failure text. */
  error: LightPalette.danger,
  /** Foreground on filled controls. */
  onOrange: LightPalette.textInverse,
  /** Muted segment for the progress indicator. */
  progressInactive: LightPalette.border,
} as const;

export function useOnboardingColors() {
  const { colors } = useTheme();
  return useMemo(() => ({
    background: colors.bg, card: colors.surface, action: colors.primary, controlBorder: colors.controlBorder, cardElevated: colors.surfaceElevated,
    border: colors.border, text: colors.text, textMuted: colors.textSecondary,
    orange: colors.accent, error: colors.danger, onOrange: colors.textInverse,
    progressInactive: colors.border,
  }), [colors]);
}

/** Corner radii used across onboarding. */
export const OnboardingRadius = {
  card: 12,
  button: 12,
  pill: 999,
} as const;

/** Fixed control sizes. */
export const OnboardingSizes = {
  primaryButtonHeight: 50,
  iconBadge: 44,
  numberBadge: 32,
} as const;
