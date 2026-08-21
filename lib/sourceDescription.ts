/**
 * Durable social-source text contract.
 *
 * This is an ingestion/retention guard, not a display or model-context limit.
 * Keep the creator's line ordering, punctuation, hashtags, and Unicode so a
 * later list item or location clue remains available to recognition and
 * reprocessing. Presentation and model callers derive their own smaller
 * excerpts without replacing this value.
 */
export const SOURCE_DESCRIPTION_RETENTION_MAX = 10_000;

function sliceWithoutSplittingSurrogate(value: string, max: number): string {
  let bounded = value.slice(0, Math.max(0, max));
  const last = bounded.charCodeAt(bounded.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

export function normalizeSourceDescription(
  value: unknown,
  max = SOURCE_DESCRIPTION_RETENTION_MAX,
): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return normalized.length > max
    ? sliceWithoutSplittingSurrogate(normalized, max)
    : normalized;
}
