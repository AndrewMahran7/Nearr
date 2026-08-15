/**
 * lib/transientMessage.ts
 *
 * PURE lifecycle rules for the map's transient confirmation ("Saved to your
 * map"). Extracted so the timing, the stale-timer guard, and the
 * user-vs-system distinction are testable without a render harness.
 *
 * The message is a lightweight acknowledgement, not something to read
 * carefully — it exists to say "Nearr worked". Once the user starts doing
 * anything else it has already served its purpose.
 */

/**
 * Idle auto-dismiss. Short on purpose: long enough to register and for
 * VoiceOver to announce, short enough that it never feels stale.
 */
export const TRANSIENT_MESSAGE_MS = 3000;

export type TransientMessage = {
  /** Monotonic identity. Two identical strings are still distinct messages. */
  id: number;
  message: string;
  undoId: string | null;
};

/**
 * Sources that may dismiss the confirmation. ONLY things the user did — an
 * image finishing, a Realtime row arriving, or a layout pass must never count,
 * or the confirmation would vanish before it was ever seen.
 */
export type InteractionSource =
  | 'press'
  | 'scroll'
  | 'gesture'
  | 'marker_press'
  | 'sheet_dismiss'
  | 'navigation';

const MEANINGFUL_INTERACTIONS: ReadonlySet<string> = new Set<InteractionSource>([
  'press',
  'scroll',
  'gesture',
  'marker_press',
  'sheet_dismiss',
  'navigation',
]);

/** System activity that must NOT dismiss the confirmation. */
const SYSTEM_EVENTS: ReadonlySet<string> = new Set([
  'image_load',
  'realtime_update',
  'cache_refresh',
  'layout',
  'animation_frame',
  'sheet_auto_expand',
  'camera_animation',
  'ai_note_arrived',
]);

/**
 * Whether an event should dismiss the confirmation. Unknown sources default to
 * NOT dismissing: a new internal event should never silently start eating the
 * user's confirmation.
 */
export function isMeaningfulInteraction(source: string | null | undefined): boolean {
  if (!source) return false;
  if (SYSTEM_EVENTS.has(source)) return false;
  return MEANINGFUL_INTERACTIONS.has(source);
}

/** Build the next message, carrying a fresh identity so its timer is its own. */
export function nextTransientMessage(
  previous: TransientMessage | null,
  message: string,
  undoId: string | null = null,
): TransientMessage {
  const id = (previous?.id ?? 0) + 1;
  return { id, message, undoId };
}

/**
 * Whether a dismiss request should be honored.
 *
 * A timer captures the id of the message it was started for. If a newer
 * message has since replaced it, the old timer must not take the new one down
 * with it — the classic stale-timeout bug.
 */
export function shouldHonorDismiss(
  current: TransientMessage | null,
  dismissId: number | null | undefined,
): boolean {
  if (!current) return false;
  // A dismiss with no id (explicit user close) always applies to whatever is up.
  if (dismissId == null) return true;
  return current.id === dismissId;
}
