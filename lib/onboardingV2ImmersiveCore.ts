export const SUPPORTED_ONBOARDING_WIDTHS = [375, 390, 430] as const;

const PHASE_ONE_HORIZONTAL_PADDING = 44;
const SOURCE_CARD_GAP = 10;
// 22px horizontal padding + 38px icon + 9px gap.
const SOURCE_CARD_FIXED_CONTENT = 69;

export function sourceChoiceLayout(viewportWidth: number) {
  const contentWidth = Math.max(0, viewportWidth - PHASE_ONE_HORIZONTAL_PADDING);
  const cardWidth = Math.max(0, (contentWidth - SOURCE_CARD_GAP) / 2);
  return {
    cardWidth,
    labelWidth: Math.max(0, cardWidth - SOURCE_CARD_FIXED_CONTENT),
  };
}

export function personalizedSavePrompt(platform: string, interest: string): string {
  if (platform === 'Instagram' && interest === 'Food') {
    return "Let's save a restaurant from Instagram.";
  }
  const normalized = interest.trim().toLowerCase();
  if (!normalized || normalized === 'anything' || normalized === 'anything interesting') {
    return `Let's save something interesting from ${platform}.`;
  }
  const article = /^[aeiou]/.test(normalized) ? 'an' : 'a';
  return `Let's save ${article} ${normalized} find from ${platform}.`;
}
