import type { RadiusUnit } from '@/types';

export type ReminderDisplayMode = 'default' | 'miles' | 'minutes';

/**
 * The two notes a saved place can carry are deliberately separate:
 *
 *   sourceNote — `saved_places.ai_note`, the persisted cue describing what
 *     looked interesting in the original post. Written by the enrichment
 *     pipeline, never by the user, and surfaced as "Why you saved it".
 *   userNote   — `saved_places.notes`, authored by the user and editable.
 *
 * Keeping the decision here (rather than inline in the sheet) means the
 * "never show an empty From-the-post section" and "never blend the two
 * fields" rules are unit-testable.
 */
export type SavedPlaceNarrative = {
  sourceNote: string | null;
  userNote: string | null;
  /** Render the source-cue section at all. False for missing/blank cues. */
  showSourceNote: boolean;
  /** Offer "Use as my note" — only when there is a cue and no user note yet. */
  canPromoteSourceNote: boolean;
};

function trimmedOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function savedPlaceNarrative(saved: {
  notes?: string | null;
  ai_note?: string | null;
}): SavedPlaceNarrative {
  const sourceNote = trimmedOrNull(saved?.ai_note);
  const userNote = trimmedOrNull(saved?.notes);
  return {
    sourceNote,
    userNote,
    showSourceNote: sourceNote !== null,
    canPromoteSourceNote: sourceNote !== null && userNote === null,
  };
}

/**
 * ONE user-facing surface: "Why you saved it".
 *
 * The two fields stay separate in the DATA (ai_note is provenance written by
 * enrichment and must never be clobbered), but the user should experience a
 * single concept, not an "AI note" block stacked on a "Your note" block:
 *
 *   displayValue = notes ?? ai_note
 *   any user edit  → notes            (ai_note left exactly as it was)
 *
 * `seedFromSourceNote` tells the editor to open pre-filled with the AI cue —
 * true only while the user has not written their own note yet, so editing feels
 * like refining what is on screen rather than starting from a blank box.
 */
export type WhySavedDisplay = {
  /** What to render. Null when there is neither a user note nor a cue. */
  text: string | null;
  /** Which field produced `text`. Null when empty. */
  origin: 'user' | 'source' | null;
  /** Open the editor seeded with the AI cue instead of an empty draft. */
  seedFromSourceNote: boolean;
};

export function whySavedDisplay(saved: {
  notes?: string | null;
  ai_note?: string | null;
}): WhySavedDisplay {
  const userNote = trimmedOrNull(saved?.notes);
  if (userNote) return { text: userNote, origin: 'user', seedFromSourceNote: false };
  const sourceNote = trimmedOrNull(saved?.ai_note);
  if (sourceNote) return { text: sourceNote, origin: 'source', seedFromSourceNote: true };
  return { text: null, origin: null, seedFromSourceNote: false };
}

/**
 * "Did you go yet?" — a saved place can be BOTH saved and visited.
 *
 * Visiting is not deleting. Marking a place visited records `visited_at` and
 * stops the "you should go here" reminder, but the save itself stays in the
 * user's collection and on their map. The older nearby-reminder flow removed
 * the row from the shared cache after marking it visited, which made the place
 * vanish from the map until the next refetch — that conflated "no longer an
 * actionable nearby opportunity" with "no longer saved".
 */
export type VisitedDisplay = {
  visited: boolean;
  /** ISO timestamp, when known. */
  visitedAt: string | null;
  /** Prompt shown while the place is still unvisited. */
  prompt: string;
  /**
   * What answering actually does. Kept truthful on purpose: Nearr has no
   * recommendation engine to personalize, so the copy promises the one thing
   * `markVisited` really changes — it stops the nearby nudges — instead of
   * inventing a benefit the product does not deliver.
   */
  supportCopy: string;
};

export function visitedDisplay(saved: { visited_at?: string | null }): VisitedDisplay {
  const visitedAt = trimmedOrNull(saved?.visited_at);
  return {
    visited: visitedAt !== null,
    visitedAt,
    prompt: 'Did you go yet?',
    // Exactly what `markVisited` does — stamps the visit and clears
    // `notifications_enabled` — in five words, because this line sits beside
    // the buttons rather than above them.
    supportCopy: 'Marks it visited and pauses reminders.',
  };
}

function formatUnit(value: number, unit: RadiusUnit): string {
  const noun = unit === 'miles'
    ? value === 1 ? 'mile' : 'miles'
    : value === 1 ? 'minute' : 'minutes';
  return `${value} ${noun}`;
}

export function reminderStatusLabel(args: {
  enabled: boolean;
  mode: ReminderDisplayMode;
  milesText: string;
  minutesText: string;
}): string {
  if (!args.enabled) return 'Off';
  if (args.mode === 'miles') {
    const value = Number.parseFloat(args.milesText);
    return Number.isFinite(value) && value > 0 ? `On · ${formatUnit(value, 'miles')}` : 'On';
  }
  if (args.mode === 'minutes') {
    const value = Number.parseInt(args.minutesText, 10);
    return Number.isFinite(value) && value > 0 ? `On · ${formatUnit(value, 'minutes')}` : 'On';
  }
  // A category-aware radius applies in default mode. This label has no place
  // category to compute that number from, so a plain "On" is the honest copy.
  return 'On';
}

/**
 * The distance shown INSIDE the compact action-row reminder control, next to
 * the bell. Deliberately just the magnitude ("1 mi", "10 min") — the adjacent
 * switch already says whether reminders are on, so repeating "On ·" there
 * would be noise. In automatic mode there is no single number to show (see
 * `reminderStatusLabel` above), so this uses "Auto" rather than a specific,
 * no-longer-accurate figure.
 */
export function reminderDistanceLabel(args: {
  mode: ReminderDisplayMode;
  milesText: string;
  minutesText: string;
}): string {
  if (args.mode === 'miles') {
    const value = Number.parseFloat(args.milesText);
    return Number.isFinite(value) && value > 0 ? `${value} mi` : 'Distance';
  }
  if (args.mode === 'minutes') {
    const value = Number.parseInt(args.minutesText, 10);
    return Number.isFinite(value) && value > 0 ? `${value} min` : 'Time';
  }
  return 'Auto';
}
