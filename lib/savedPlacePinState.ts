/**
 * lib/savedPlacePinState.ts
 *
 * How bright a saved place's map pin is.
 *
 * The bug this exists to fix: the marker's opacity was
 *
 *     p.archived_at || p.visited_at ? 0.45 : 1
 *
 * which reads HISTORY. Marking a place visited stamps `visited_at` forever, so
 * the pin dimmed forever — turning nearby reminders back on could never
 * brighten it again, and the only "fix" the expression allowed would have been
 * to erase the visit.
 *
 * The distinction the product actually wants:
 *
 *     visited      is history      — it happened, and it keeps being true
 *     dimmed       is inactivity   — nothing is expected of this place today
 *
 * So the pin is derived from BOTH: a place that is done AND is not currently
 * reminding you is inactive; the moment you re-enable its reminder it is live
 * again, with its visit still on the record.
 *
 * Note the deliberate asymmetry. Turning reminders off on a place you have
 * NEVER visited does not dim it — that is a quiet save you still intend to go
 * to, not a finished one. "Reminders off" and "visited" are not the same fact
 * and this never conflates them.
 *
 * PURE — no React Native, no I/O. Unit-tested from ts-node.
 */

/** The subset of a saved_places row the pin's appearance depends on. */
export type SavedPlacePinInput = {
  /** Set when the user marked the place visited. Never cleared to brighten. */
  visited_at?: string | null;
  /** Set when the save left active rotation (manually or after 3 declines). */
  archived_at?: string | null;
  /** Whether this place is currently allowed to nudge the user. */
  notifications_enabled?: boolean | null;
};

export type SavedPlacePinState =
  /** Live: full opacity. */
  | 'active'
  /** Done and quiet: dimmed, but still on the map and still a saved place. */
  | 'inactive';

/** Opacity for a live pin. */
export const PIN_OPACITY_ACTIVE = 1;
/** Opacity for a completed, currently-quiet pin. Legible, clearly secondary. */
export const PIN_OPACITY_INACTIVE = 0.45;
/** Opacity for a pin outside the current map-group focus. Unrelated concern. */
export const PIN_OPACITY_OUT_OF_FOCUS = 0.22;

function isStamped(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * `'inactive'` only when the place has a completed history AND is not currently
 * reminding the user. Re-enabling the reminder returns it to `'active'` without
 * touching `visited_at` or `archived_at` — this function reads state, it never
 * implies a write.
 */
export function savedPlacePinState(place: SavedPlacePinInput | null | undefined): SavedPlacePinState {
  const completed = isStamped(place?.visited_at) || isStamped(place?.archived_at);
  if (!completed) return 'active';
  // History plus a live reminder means the user has re-armed this place.
  return place?.notifications_enabled ? 'active' : 'inactive';
}

/**
 * Final marker opacity. `outOfFocus` is the map-group dimming, which is a
 * separate concern and always wins — it means "not part of what you asked to
 * see right now", not "done".
 */
export function savedPlacePinOpacity(
  place: SavedPlacePinInput | null | undefined,
  outOfFocus = false,
): number {
  if (outOfFocus) return PIN_OPACITY_OUT_OF_FOCUS;
  return savedPlacePinState(place) === 'inactive' ? PIN_OPACITY_INACTIVE : PIN_OPACITY_ACTIVE;
}
