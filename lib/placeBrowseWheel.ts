export const PLACE_BROWSE_WHEEL_MAX_RENDER_BATCH = 3;

export function placeBrowseWheelCardWidth(viewportWidth: number): number {
  const width = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  return Math.min(320, Math.max(272, width - 56));
}

export function placeBrowseWheelCardSideInset(viewportWidth: number): number {
  return Math.max(24, (viewportWidth - placeBrowseWheelCardWidth(viewportWidth)) / 2);
}
