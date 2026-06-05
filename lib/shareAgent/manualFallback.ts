// lib/shareAgent/manualFallback.ts
//
// Pure, dependency-free helpers for the "graceful manual fallback" path
// on the share screen. A failed/ambiguous extraction is a NORMAL product
// state, not a crash: when Nearr cannot confidently identify a place we
// transition the user into the existing manual Google-Places search flow
// while preserving the original social URL.
//
// This module deliberately imports nothing (no React Native, no Deno, no
// Supabase) so it can be unit-tested in plain Node (scripts/testManualFallback.ts)
// and reused by the host app without pulling in UI dependencies.
//
// HARD RULES:
//   - Never auto-submit a derived query.
//   - Never save automatically.
//   - Never throw — every helper is total over arbitrary input.

/**
 * Inline message shown ABOVE the manual search box when an automatic
 * extraction could not identify a place. Intentionally friendly and
 * non-alarming — this is an expected outcome, not an error.
 */
export const MANUAL_FALLBACK_MESSAGE =
  "We couldn’t identify this place automatically. Search for it below and we’ll keep the original post attached.";

/**
 * Minimal shape we need to safely RENDER a candidate row. Rendering only
 * requires a stable key (`googlePlaceId`) and a label (`name`); saving a
 * candidate requires coordinates, but that is validated separately at the
 * save-side. Keeping the render guard narrow means one malformed/partial
 * candidate can be skipped without dropping otherwise-valid rows.
 */
export type RenderableCandidateLike = {
  googlePlaceId?: unknown;
  name?: unknown;
};

/**
 * True iff a candidate has the minimum fields required to render a row
 * without throwing at render time (non-empty string id + non-empty name).
 */
export function isRenderableCandidate(candidate: unknown): boolean {
  if (!candidate || typeof candidate !== 'object') return false;
  const c = candidate as RenderableCandidateLike;
  if (typeof c.googlePlaceId !== 'string' || c.googlePlaceId.trim() === '') {
    return false;
  }
  if (typeof c.name !== 'string' || c.name.trim() === '') {
    return false;
  }
  return true;
}

/**
 * Partition a candidate array into renderable rows + a count of the rows
 * that were skipped. Tolerates `null`/`undefined`/non-array input.
 *
 *   skip invalid candidate
 *   → if no valid candidates remain → caller enters manual fallback
 */
export function filterRenderableCandidates<T>(
  list: readonly T[] | null | undefined,
): { valid: T[]; invalidCount: number } {
  if (!Array.isArray(list)) return { valid: [], invalidCount: 0 };
  const valid: T[] = [];
  let invalidCount = 0;
  for (const candidate of list) {
    if (isRenderableCandidate(candidate)) valid.push(candidate);
    else invalidCount += 1;
  }
  return { valid, invalidCount };
}

export type ManualFallbackQuerySource = {
  placeName?: string | null;
  city?: string | null;
  state?: string | null;
  address?: string | null;
  query?: string | null;
};

/**
 * Derive a SAFE, name-led prefill query for the manual search box from
 * already-extracted, explicit caption fields. We prefer
 * "<place> <city> <state>" over a raw street address because a bare
 * address is useless to a user trying to find a named venue.
 *
 * The result is only a *prefill* — it is never auto-submitted. Returns ''
 * when no explicit signal is available (the box stays empty).
 */
export function deriveManualFallbackQuery(
  source: ManualFallbackQuerySource | null | undefined,
): string {
  if (!source) return '';
  const place = (source.placeName ?? '').trim();
  const city = (source.city ?? '').trim();
  const state = (source.state ?? '').trim();
  const address = (source.address ?? '').trim();

  const parts: string[] = [];
  if (place) parts.push(place);
  if (city) parts.push(city);
  else if (address && !place) parts.push(address);
  if (state && parts.length > 0 && !parts.join(' ').includes(state)) {
    parts.push(state);
  }

  const derived = parts.join(' ').replace(/\s+/g, ' ').trim();
  if (derived) return derived;
  return (source.query ?? '').replace(/\s+/g, ' ').trim();
}
