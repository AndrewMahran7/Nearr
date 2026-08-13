/**
 * lib/shareCompletionUi.ts
 *
 * PURE layout + motion policy for the share-extension completion surface.
 *
 * The native controller requests a compact host height, and React fills the
 * bounds iOS actually grants. Motion must degrade to a static final frame when
 * the OS reports Reduce Motion.
 *
 * No React Native imports and no I/O so it is unit-testable from ts-node.
 */

export type ShareCompletionState = 'submitting' | 'accepted' | 'recoverable';

/** Completion-surface metrics shared by the React view and focused tests. */
export const SHARE_COMPLETION_LAYOUT = {
  horizontalPadding: 22,
  /** Diameter of the animated confirmation mark. */
  markSize: 56,
  primaryHeight: 52,
  secondaryHeight: 48,
} as const;

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
  failureTitle: "Couldn't send this to Nearr",
  failureBody: 'Check your connection and try again.',
  retry: 'Try again',
  cancel: 'Cancel',
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
