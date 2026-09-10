/** Stable preference overlay. The database's role/priority ordering remains the
 * fallback; an exact platform match moves ahead without changing either tier. */
export function prioritizeOnboardingTutorialFixtures<T extends { platform: string }>(
  rows: readonly T[],
  preferredPlatform: string | null,
): T[] {
  if (!preferredPlatform) return [...rows];
  return [...rows].sort((a, b) =>
    Number(b.platform === preferredPlatform) - Number(a.platform === preferredPlatform));
}
