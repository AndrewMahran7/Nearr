import {
  evaluateAiPlaceNote,
  type AiPlaceNoteEvidence,
  type AiPlaceNoteResult,
} from './aiPlaceNote';

export type VideoDerivedSource = {
  source_url?: string | null;
  source_type?: string | null;
};

export type TargetedAiNotePlace = {
  name?: string | null;
  memoryCue?: string | null;
  memoryCueEvidence?: readonly AiPlaceNoteEvidence[] | null;
};

export type TargetedAiNoteResult = AiPlaceNoteResult & {
  targetMatch: 'matched' | 'missing' | 'ambiguous';
};

function cleaned(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

/**
 * Canonical application-side definition of video/share provenance.
 *
 * A real attached source URL is the durable fact. `manual` explicitly opts
 * out; null/legacy and `link` remain eligible because older and future social
 * platforms can reach the save layer before their normalized platform label
 * is available. This deliberately does not depend on a UI route.
 */
export function isVideoDerivedSavedPlace(
  source: VideoDerivedSource | null | undefined,
): boolean {
  if (!cleaned(source?.source_url)) return false;
  return cleaned(source?.source_type)?.toLowerCase() !== 'manual';
}

export function hasUsefulAiNote(value: unknown): boolean {
  return cleaned(value) !== null;
}

export type VideoAiNoteInvariantAction =
  | 'not_video_derived'
  | 'already_satisfied'
  | 'ensure_enrichment';

export function planVideoAiNoteInvariant(
  source: VideoDerivedSource | null | undefined,
  aiNote: unknown,
): VideoAiNoteInvariantAction {
  if (!isVideoDerivedSavedPlace(source)) return 'not_video_derived';
  return hasUsefulAiNote(aiNote) ? 'already_satisfied' : 'ensure_enrichment';
}

export function normalizePlaceIdentity(value: unknown): string {
  return (cleaned(value) ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Select a cue only for the FINAL saved place. Exact normalized identity is
 * intentional: a correction from Place A to Place B must never inherit A's
 * otherwise well-grounded cue, and a multi-place post must never borrow a
 * sibling's evidence.
 */
export function evaluateTargetedVideoAiNote(input: {
  finalPlaceName: string | null | undefined;
  places: readonly TargetedAiNotePlace[] | null | undefined;
}): TargetedAiNoteResult {
  const target = normalizePlaceIdentity(input.finalPlaceName);
  const matches = target
    ? (input.places ?? []).filter(
        (place) => normalizePlaceIdentity(place.name) === target,
      )
    : [];

  if (matches.length !== 1) {
    return {
      note: null,
      status: 'insufficient_evidence',
      reason: null,
      targetMatch: matches.length > 1 ? 'ambiguous' : 'missing',
    };
  }

  const match = matches[0]!;
  return {
    ...evaluateAiPlaceNote({
      placeName: input.finalPlaceName,
      proposedNote: match.memoryCue,
      evidence: match.memoryCueEvidence ?? [],
    }),
    targetMatch: 'matched',
  };
}
