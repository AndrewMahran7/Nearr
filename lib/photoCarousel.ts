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
// breaking horizontal paging. Both gestures live on the same pixels, so the
// axis is decided from the first few move samples and then owned for the rest
// of the touch:
//
//   horizontal first   → the carousel pages, the dismiss gesture FAILS
//   decisively downward → the dismiss layer activates and follows the finger
//   upward             → never dismisses
//
// These thresholds are not merely advisory: they are handed straight to the
// native pan recogniser as `failOffsetX` / `activeOffsetY` / `failOffsetY`, so
// the arbitration happens in native land before the horizontal scroll view can
// claim the touch. The pure functions below mirror the recogniser's own rules
// (fail is evaluated before activation on every sample — see
// RNPanHandler.m `interactionsMoved`) so the decision is unit-testable without
// a device.
// ---------------------------------------------------------------------------

/**
 * Downward travel (px) that activates the dismiss gesture.
 *
 * Above a finger's incidental wobble, below the ~10pt at which iOS' scroll view
 * would otherwise take the touch for itself.
 */
export const GALLERY_DISMISS_ACTIVATE_DY = 14;
/**
 * Horizontal travel (px) that hands the touch back to the carousel for good.
 *
 * Deliberately small: a swipe with any real sideways intent must page photos,
 * never dismiss. A slightly diagonal downward drag still clears
 * `GALLERY_DISMISS_ACTIVATE_DY` first and dismisses.
 */
export const GALLERY_DISMISS_FAIL_DX = 10;
/** Upward travel (px) that hands the touch back — dragging up is not a close. */
export const GALLERY_DISMISS_FAIL_DY = 14;
/** Downward travel (px), measured from activation, that commits on release. */
export const GALLERY_DISMISS_DISTANCE = 110;
/** Downward velocity (px/second) that commits even on a short drag. */
export const GALLERY_DISMISS_VELOCITY = 750;

/** What a single move sample tells us about the user's intent. */
export type GallerySwipeIntent = 'page' | 'dismiss' | 'undecided';

/**
 * The axis decision for one move sample, in the recogniser's own order:
 * failure criteria first, activation second. A sample that crosses BOTH
 * thresholds therefore pages rather than dismisses, which is the safe way
 * round — an unwanted dismissal costs the user their place in the album.
 */
export function gallerySwipeIntent(sample: { dx: number; dy: number }): GallerySwipeIntent {
  'worklet';
  const dx = Number.isFinite(sample?.dx) ? sample.dx : 0;
  const dy = Number.isFinite(sample?.dy) ? sample.dy : 0;
  if (Math.abs(dx) > GALLERY_DISMISS_FAIL_DX) return 'page';
  if (dy < -GALLERY_DISMISS_FAIL_DY) return 'page'; // dragged up: not a dismiss
  if (dy > GALLERY_DISMISS_ACTIVATE_DY) return 'dismiss';
  return 'undecided';
}

/**
 * Replay a whole move stream through {@link gallerySwipeIntent}. The FIRST
 * decisive sample owns the gesture — neither side can change its mind later,
 * which is what stops a long horizontal swipe that drifts downward at the end
 * from closing the gallery.
 */
export function resolveGallerySwipe(
  samples: readonly { dx: number; dy: number }[],
): GallerySwipeIntent {
  if (!Array.isArray(samples)) return 'undecided';
  for (const sample of samples) {
    const intent = gallerySwipeIntent(sample);
    if (intent !== 'undecided') return intent;
  }
  return 'undecided';
}

/**
 * On release: commit to closing, or spring the gallery back?
 *
 * Distance OR downward velocity commits, so a short flick feels as responsive
 * as a long drag. `dy` is measured from the moment the gesture ACTIVATED (the
 * recogniser zeroes its translation there), so the horizontal axis has already
 * been ruled out by then and plays no part in this decision.
 */
export function shouldDismissGalleryOnRelease(gesture: { dy: number; vy: number }): boolean {
  'worklet';
  const dy = Number.isFinite(gesture?.dy) ? gesture.dy : 0;
  const vy = Number.isFinite(gesture?.vy) ? gesture.vy : 0;
  if (dy <= 0) return false; // upward / no movement never closes
  return dy > GALLERY_DISMISS_DISTANCE || vy > GALLERY_DISMISS_VELOCITY;
}

/**
 * How far the gallery has been dragged, clamped to downward-only. Feeds the
 * interactive translate + backdrop fade so the sheet tracks the finger.
 */
export function galleryDragOffset(dy: number): number {
  'worklet';
  if (!Number.isFinite(dy) || dy <= 0) return 0;
  return dy;
}

/** Backdrop opacity for a given drag distance. Never fully transparent. */
export function galleryBackdropOpacity(dy: number, viewportHeight: number): number {
  'worklet';
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
