/**
 * Fixed dark design palette for the Nearr onboarding flow.
 *
 * Onboarding deliberately does NOT use the app-wide `useTheme()` palette.
 * It always renders on a premium dark background regardless of the user's
 * light/dark OS preference, so these values are intentionally hardcoded
 * here and reused by every `components/onboarding/*` component.
 *
 * Keep all colors in this one place so the whole flow can be re-skinned by
 * editing a single file.
 */
export const OnboardingColors = {
  /** Screen background. */
  background: '#080808',
  /** Standard charcoal card. */
  card: '#161616',
  /** Slightly lighter elevated card (rows, previews). */
  cardElevated: '#1E1E1E',
  /** Hairline border for cards and rows. */
  border: '#2A2A2A',
  /** Primary white text (headlines, titles). */
  text: '#FFFFFF',
  /** Muted gray secondary text. */
  textMuted: '#888888',
  /** Orange accent + primary CTA. */
  orange: '#FF6B00',
  /** Dark text used on top of the orange CTA. */
  onOrange: '#080808',
  /** Muted segment for the progress indicator. */
  progressInactive: '#2A2A2A',
} as const;

/** Corner radii used across onboarding. */
export const OnboardingRadius = {
  card: 20,
  button: 18,
  pill: 999,
} as const;

/** Fixed control sizes. */
export const OnboardingSizes = {
  primaryButtonHeight: 60,
  iconBadge: 44,
  numberBadge: 32,
} as const;
