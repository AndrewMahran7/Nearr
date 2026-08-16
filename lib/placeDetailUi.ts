import type { Profile, RadiusUnit } from '@/types';

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

function formatUnit(value: number, unit: RadiusUnit): string {
  const noun = unit === 'miles'
    ? value === 1 ? 'mile' : 'miles'
    : value === 1 ? 'minute' : 'minutes';
  return `${value} ${noun}`;
}

export function reminderStatusLabel(args: {
  enabled: boolean;
  mode: ReminderDisplayMode;
  profile: Pick<Profile, 'default_radius_value' | 'default_radius_unit'> | null;
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
  return args.profile
    ? `On · ${formatUnit(args.profile.default_radius_value, args.profile.default_radius_unit)}`
    : 'On';
}
