/**
 * lib/opportunityUi.ts
 *
 * PURE presentation logic for the nearby-opportunity screen.
 *
 * The screen appears at a high-intent moment — the user is standing near
 * somewhere they wanted to go — so it leads with the PLACE, not with reminder
 * bookkeeping. These helpers keep the copy and the "what can we honestly show"
 * decisions testable, and keep the three-opportunity semantics in one place.
 */

import { CATEGORY_LABELS, savedPlaceCategory } from './placeCategory';
import { splitPlaceAddress } from './sharePhase1Ui';
import type { SavedPlaceWithPlace } from '@/types';

/** Unchanged policy: the third declined opportunity archives the reminder. */
export const MAX_OPPORTUNITIES = 3;

export type OpportunityCopy = {
  /** Small context line above the place. Never "Opportunity 2 of 3". */
  eyebrow: string;
  /** Prompt above the visit decision. */
  decisionPrompt: string;
  /** Only set on the final opportunity, to explain what happens next. */
  finalNote: string | null;
};

/**
 * Copy for the Nth opportunity.
 *
 * The old screen led with "Opportunity N of 3", which framed the moment as
 * reminder-policy admin. The count still matters on the LAST one — the user
 * should know reminders are about to stop — so it is surfaced as plain
 * consequence, without guilt or pressure.
 */
export function opportunityCopy(
  opportunityNumber: number,
  max: number = MAX_OPPORTUNITIES,
): OpportunityCopy {
  const n = Number.isFinite(opportunityNumber) ? Math.max(1, Math.floor(opportunityNumber)) : 1;
  const isFinal = n >= Math.max(1, Math.floor(max));
  return {
    eyebrow: "You're nearby",
    decisionPrompt: 'Did you visit?',
    finalNote: isFinal
      ? "Still not feeling it? We'll quiet reminders for this place."
      : null,
  };
}

/** Whether declining now exhausts the reminder and archives the place. */
export function shouldArchiveOnDecline(
  reminderOpportunityCount: number | null | undefined,
  max: number = MAX_OPPORTUNITIES,
): boolean {
  const count = typeof reminderOpportunityCount === 'number' ? reminderOpportunityCount : 0;
  return count >= Math.max(1, Math.floor(max));
}

/** Clamp the delivered count into a displayable opportunity number. */
export function opportunityNumberFor(
  reminderOpportunityCount: number | null | undefined,
  max: number = MAX_OPPORTUNITIES,
): number {
  const raw = typeof reminderOpportunityCount === 'number' ? reminderOpportunityCount : 1;
  return Math.min(Math.max(raw, 1), Math.max(1, Math.floor(max)));
}

/**
 * The short factual chips shown under the place name.
 *
 * ONLY fields Nearr genuinely holds. Nearr's Places details request does not
 * fetch rating, opening hours, or price level, so none of those are invented
 * here — an empty slot is omitted rather than filled with a guess. Category is
 * always meaningful (a beach is not a restaurant); `business_status` is the one
 * honest "should I go right now?" signal available today.
 */
export function opportunityMetaChips(saved: SavedPlaceWithPlace | null | undefined): string[] {
  if (!saved?.place) return [];
  const chips: string[] = [];

  try {
    const label = CATEGORY_LABELS[savedPlaceCategory(saved)];
    if (label) chips.push(label);
  } catch {
    // An unknown category never breaks the screen.
  }

  const locality = splitPlaceAddress(saved.place.formatted_address).locality;
  if (locality) chips.push(locality);

  const closed = businessStatusLabel(saved.place.business_status);
  if (closed) chips.push(closed);

  return chips;
}

/** Consumer wording for a non-operational place. Null when it is open/unknown. */
export function businessStatusLabel(status: string | null | undefined): string | null {
  switch ((status ?? '').toUpperCase()) {
    case 'CLOSED_TEMPORARILY':
      return 'Temporarily closed';
    case 'CLOSED_PERMANENTLY':
      return 'Permanently closed';
    default:
      return null;
  }
}

/** Consumer label for reopening the post that caused the save. */
export function sourcePostLabel(sourceType: string | null | undefined): string {
  switch ((sourceType ?? '').toLowerCase()) {
    case 'instagram':
      return 'Watch original reel';
    case 'tiktok':
      return 'Watch original post';
    case 'link':
      return 'Open original link';
    default:
      return 'View original';
  }
}

export type OpportunityNarrative = {
  /** `saved_places.ai_note` — why this looked worth going. */
  savedBecause: string | null;
  /** The user's own note, shown only when they wrote one. */
  userNote: string | null;
  /** A usable source URL, or null. Never rendered as a raw URL. */
  sourceUrl: string | null;
};

function trimmed(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * The optional context blocks. Each is null when absent so the screen can omit
 * the section entirely — an empty "Saved because / no information" card would
 * read as broken.
 */
export function opportunityNarrative(
  saved: SavedPlaceWithPlace | null | undefined,
): OpportunityNarrative {
  return {
    savedBecause: trimmed(saved?.ai_note),
    userNote: trimmed(saved?.notes),
    sourceUrl: trimmed(saved?.source_url),
  };
}
