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
  horizontalPadding: 24,
  /** Diameter of the animated confirmation mark. */
  markSize: 56,
  primaryHeight: 50,
  secondaryHeight: 44,
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
  return { animate: true, durationMs: 220, fromScale: 0.96, fromOpacity: 0 };
}

export const SHARE_COMPLETION_COPY = {
  submittingTitle: 'Sending to Nearr\u2026',
  submittingBody: 'Keep this open until it is sent.',
  acceptedTitle: 'Sent to Nearr',
  acceptedBody: 'You can close this.',
  duplicateBody: 'Already sent to Nearr. You can close this.',
  primary: 'Done',
  secondary: 'Open Nearr',
  failureTitle: "Couldn't send this to Nearr",
  failureBody: "We couldn't confirm this share. Try again.",
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

/** Receipt identity uses the actual shared payload, never a guessed destination or fetched preview. */
export function shareReceiptSource(url: string | null, text?: string, images?: string[]) {
  let host = '';
  try { host = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { /* Invalid payload has no source label. */ }
  const platform = /(^|\.)instagram\.com$/i.test(host) ? 'Instagram'
    : /(^|\.)tiktok\.com$/i.test(host) ? 'TikTok'
    : /(^|\.)(youtube\.com|youtu\.be)$/i.test(host) ? 'YouTube' : host;
  const caption = text?.replace(/https?:\/\/[^\s<>"']+/gi, '').replace(/\s+/g, ' ').trim();
  const thumbnail = images?.find(uri => /^file:\/\//i.test(uri));
  return { title: platform ? `Your ${platform} post` : 'Your shared post', caption: caption || 'Original post', thumbnail };
}
