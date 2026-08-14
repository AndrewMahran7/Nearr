/**
 * lib/photoCarousel.ts
 *
 * PURE paging math for the saved-place photo carousel. Extracted so the
 * "which page is centered" and "what should we warm next" decisions are
 * unit-testable without a render harness.
 *
 * Context: the gallery dims non-centered pages (opacity 0.45 / scale 0.92) as
 * an intentional focus treatment. The centered page must reach full brightness
 * the moment it is centered — the visual state is driven from the native scroll
 * offset, and these helpers only back the page counter, the dots, and a small
 * bounded prefetch window.
 */

/** Nearest page for a horizontal scroll offset. Never returns out of range. */
export function pageIndexFromOffset(
  offsetX: number,
  snapInterval: number,
  pageCount: number,
): number {
  if (!Number.isFinite(pageCount) || pageCount <= 0) return 0;
  // A missing/degenerate interval means the page cannot be computed. Hold the
  // first page rather than snapping to the end of the album.
  if (!Number.isFinite(snapInterval) || snapInterval <= 0) return 0;
  const offset = Number.isFinite(offsetX) ? offsetX : 0;
  const page = Math.round(offset / snapInterval);
  return Math.max(0, Math.min(page, pageCount - 1));
}

/**
 * The photos worth warming around the centered page: the next one first (the
 * likelier swipe direction), then the previous one.
 *
 * Deliberately bounded — `radius` defaults to one page in each direction, the
 * centered photo is excluded (it is already on screen), duplicates and blank
 * entries are dropped, and nothing beyond the array is invented. A place with
 * one or zero photos yields an empty list, so no request is ever made.
 */
export function adjacentPrefetchTargets(
  urls: readonly (string | null | undefined)[],
  index: number,
  radius = 1,
): string[] {
  if (!Array.isArray(urls) || urls.length <= 1) return [];
  const span = Math.max(0, Math.floor(radius));
  if (span === 0) return [];
  const center = pageIndexFromOffset(index, 1, urls.length);

  const ordered: number[] = [];
  for (let step = 1; step <= span; step += 1) {
    ordered.push(center + step, center - step);
  }

  const seen = new Set<string>();
  const targets: string[] = [];
  for (const position of ordered) {
    if (position < 0 || position >= urls.length) continue;
    const url = urls[position];
    if (typeof url !== 'string') continue;
    const trimmed = url.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    targets.push(trimmed);
  }
  return targets;
}
