/**
 * lib/shareCompletionUi.ts
 *
 * PURE layout + motion policy for the share-extension completion sheet.
 *
 * Why this exists: the extension previously rendered its card at `height:100%`,
 * so a four-line success message occupied the entire display with a large dead
 * region (see the production screenshot). The sheet must instead be a compact,
 * content-sized bottom sheet, and its confirmation motion must degrade to a
 * static frame when the OS reports Reduce Motion.
 *
 * No React Native imports and no I/O so it is unit-testable from ts-node.
 */

export type ShareCompletionState = 'submitting' | 'accepted' | 'recoverable';

/**
 * Compact bottom-sheet metrics. `maxHeightRatio` is the hard ceiling applied to
 * the extension window: the sheet is content-sized, but may never grow past
 * this fraction of the screen even with Dynamic Type at its largest.
 */
export const SHARE_COMPLETION_SHEET = {
  cornerRadius: 28,
  horizontalPadding: 22,
  topPadding: 20,
  /** Extra bottom padding added on top of the device safe-area inset. */
  bottomPadding: 10,
  /** Never taller than this share of the extension window. */
  maxHeightRatio: 0.52,
  /** Diameter of the animated confirmation mark. */
  markSize: 56,
  primaryHeight: 50,
  secondaryHeight: 40,
} as const;

/**
 * Resolve the sheet's max pixel height for a given window. Always returns a
 * positive number so a zero/unknown window height can never collapse the sheet.
 */
export function shareCompletionMaxHeight(windowHeight: number): number {
  if (!Number.isFinite(windowHeight) || windowHeight <= 0) return 360;
  return Math.round(windowHeight * SHARE_COMPLETION_SHEET.maxHeightRatio);
}

/** True when the sheet would occupy essentially the whole screen (the bug). */
export function occupiesFullScreen(sheetHeight: number, windowHeight: number): boolean {
  if (!Number.isFinite(sheetHeight) || !Number.isFinite(windowHeight) || windowHeight <= 0) {
    return false;
  }
  return sheetHeight / windowHeight > 0.8;
}

export type ShareCompletionMotion = {
  /** Whether to run the entrance/pulse animation at all. */
  animate: boolean;
  /** Total duration of the confirmation animation in ms. */
  durationMs: number;
  /** Scale the mark starts at before settling to 1. */
  fromScale: number;
  /** Opacity the sheet content starts at. */
  fromOpacity: number;
};

/**
 * Motion policy. With Reduce Motion enabled the confirmation renders in its
 * final state immediately (no scale, no fade), which is the accessible
 * equivalent rather than a slower animation.
 */
export function shareCompletionMotion(reduceMotion: boolean): ShareCompletionMotion {
  if (reduceMotion) {
    return { animate: false, durationMs: 0, fromScale: 1, fromOpacity: 1 };
  }
  return { animate: true, durationMs: 260, fromScale: 0.82, fromOpacity: 0 };
}

export const SHARE_COMPLETION_COPY = {
  submittingTitle: 'Finding the place…',
  submittingBody: 'You can close this — Nearr keeps working.',
  acceptedTitle: 'Sent to Nearr',
  acceptedBody: "We'll find the place and add it to your map.",
  duplicateBody: "You already shared this one — we're still on it.",
  primary: 'Done',
  secondary: 'Open Nearr',
} as const;

/** Body copy for the accepted state; a duplicate submission is stated honestly. */
export function acceptedBody(duplicate: boolean): string {
  return duplicate ? SHARE_COMPLETION_COPY.duplicateBody : SHARE_COMPLETION_COPY.acceptedBody;
}

/**
 * The extension must never block on Phase 2. A submitting state is allowed to
 * transition into the accepted confirmation, but the sheet always exposes a
 * dismiss action so Instagram/TikTok can be returned to immediately.
 */
export function canDismiss(state: ShareCompletionState): boolean {
  return state === 'submitting' || state === 'accepted' || state === 'recoverable';
}
