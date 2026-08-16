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

// ---------------------------------------------------------------------------
// Swipe-down-to-dismiss arbitration.
//
// The gallery promises "↓ Swipe down to close" and must honour it WITHOUT
// breaking horizontal paging. The two gestures live on the same pixels, so the
// decision is made from the first few move samples and then owned for the rest
// of the gesture:
//
//   mostly horizontal  → the FlatList keeps the responder (photo paging)
//   decisively downward → the dismiss layer claims it
//   upward             → never dismisses
//
// Extracted as pure functions so the thresholds are unit-tested without a
// native gesture harness.
// ---------------------------------------------------------------------------

/** Downward travel (px) before a drag is even considered a dismiss attempt. */
export const GALLERY_DISMISS_CLAIM_DY = 12;
/** How much more vertical than horizontal a drag must be to claim dismissal. */
export const GALLERY_DISMISS_AXIS_RATIO = 1.6;
/** Downward travel (px) that commits to dismissal on release. */
export const GALLERY_DISMISS_DISTANCE = 110;
/** Downward velocity that commits to dismissal even on a short drag. */
export const GALLERY_DISMISS_VELOCITY = 0.75;

/**
 * Should the dismiss layer take the gesture away from the horizontal list?
 *
 * Evaluated in the CAPTURE phase, so it must be strict: anything with real
 * horizontal intent has to fall through to the carousel. Upward drags never
 * qualify.
 */
export function shouldClaimGalleryDismiss(gesture: { dx: number; dy: number }): boolean {
  const dx = Number.isFinite(gesture?.dx) ? gesture.dx : 0;
  const dy = Number.isFinite(gesture?.dy) ? gesture.dy : 0;
  if (dy < GALLERY_DISMISS_CLAIM_DY) return false; // upward or not yet moved
  return dy > Math.abs(dx) * GALLERY_DISMISS_AXIS_RATIO;
}

/**
 * On release: commit to closing, or spring the gallery back?
 *
 * Distance OR downward velocity commits, so a short flick feels as responsive
 * as a long drag. An upward or horizontal release always settles back.
 */
export function shouldDismissGalleryOnRelease(gesture: {
  dx: number;
  dy: number;
  vy: number;
}): boolean {
  const dx = Number.isFinite(gesture?.dx) ? gesture.dx : 0;
  const dy = Number.isFinite(gesture?.dy) ? gesture.dy : 0;
  const vy = Number.isFinite(gesture?.vy) ? gesture.vy : 0;
  if (dy <= 0) return false; // upward / no movement never closes
  // A gesture that turned out to be mostly horizontal is paging, not dismissal.
  if (dy <= Math.abs(dx)) return false;
  return dy > GALLERY_DISMISS_DISTANCE || vy > GALLERY_DISMISS_VELOCITY;
}

/**
 * How far the gallery has been dragged, clamped to downward-only. Feeds the
 * interactive translate + backdrop fade so the sheet tracks the finger.
 */
export function galleryDragOffset(dy: number): number {
  if (!Number.isFinite(dy) || dy <= 0) return 0;
  return dy;
}

/** Backdrop opacity for a given drag distance. Never fully transparent. */
export function galleryBackdropOpacity(dy: number, viewportHeight: number): number {
  const height = Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1;
  const travel = galleryDragOffset(dy);
  const faded = 1 - (travel / height) * 1.4;
  return Math.max(0.35, Math.min(1, faded));
}

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
