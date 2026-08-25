/**
 * Last-mile validation for Vayrin's source-grounded AI Note.
 *
 * Voice and wording belong to the model prompt. This module enforces only the
 * storage/UI bound, a one-reaction format, and a minimal evidence relationship.
 * It deliberately contains no phrase bank, adjective allowlist, category map,
 * canned opener, synonym substitution, or fallback sentence generator.
 */

export type AiPlaceNoteEvidenceSource = 'caption' | 'speech' | 'visible_text' | 'frame';

export type AiPlaceNoteEvidence = {
  source: AiPlaceNoteEvidenceSource;
  value: string;
  timestampSeconds?: number | null;
};

export type AiPlaceNoteInput = {
  placeName: string | null | undefined;
  proposedNote: string | null | undefined;
  evidence: readonly AiPlaceNoteEvidence[];
};

export type AiPlaceNoteStatus =
  | 'generated'
  | 'not_requested'
  | 'insufficient_evidence'
  | 'rejected';

export type AiPlaceNoteRejection =
  | 'invalid_format'
  | 'too_short'
  | 'too_long'
  | 'ungrounded_claim';

export type AiPlaceNoteResult = {
  note: string | null;
  status: AiPlaceNoteStatus;
  reason: AiPlaceNoteRejection | null;
};

export type DeliverableAiPlaceNoteResult = AiPlaceNoteResult & {
  /** Retained for bounded diagnostics compatibility. V2 never generates filler. */
  groundedFallbackUsed: false;
};

export const AI_NOTE_MIN_WORDS = 3;
export const AI_NOTE_MAX_WORDS = 18;
export const AI_NOTE_MAX_CHARACTERS = 180;

const VALID_SOURCES = new Set<AiPlaceNoteEvidenceSource>([
  'caption', 'speech', 'visible_text', 'frame',
]);

// Grammar words are ignored only when measuring evidence overlap. This is not
// a writing vocabulary: no word here is accepted or rejected for style.
const GROUNDING_GLUE = new Set([
  'a', 'all', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'can', 'could',
  'did', 'do', 'does', 'for', 'from', 'get', 'got', 'had', 'has', 'have', 'he',
  'her', 'here', 'him', 'his', 'how', 'i', 'if', 'im', 'in', 'into', 'is', 'it',
  'its', 'ive', 'just', 'me', 'my', 'no', 'not', 'of', 'off', 'on', 'or', 'our',
  'out', 'she', 'so', 'some', 'that', 'the', 'their', 'them', 'there', 'these',
  'they', 'this', 'those', 'to', 'too', 'up', 'us', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

// These words assert observable time/weather context rather than mere stance.
// They are permitted only when the scoped evidence actually supplies them.
const OBSERVATION_GATED_TOKENS = new Set([
  'afternoon', 'day', 'daylight', 'dawn', 'evening', 'fog', 'foggy', 'hot',
  'morning', 'night', 'rain', 'rainy', 'snow', 'snowy', 'storm', 'stormy',
  'sunrise', 'sunset', 'tonight', 'wind', 'windy',
]);

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
}

function token(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokenVariants(value: string): string[] {
  const base = token(value);
  if (!base) return [];
  const variants = new Set([base]);
  if (base.length > 4 && base.endsWith('ies')) variants.add(`${base.slice(0, -3)}y`);
  if (base.length > 5 && base.endsWith('ing')) variants.add(base.slice(0, -3));
  if (base.length > 4 && base.endsWith('ed')) variants.add(base.slice(0, -2));
  if (base.length > 4 && base.endsWith('es')) variants.add(base.slice(0, -2));
  if (base.length > 3 && base.endsWith('s')) variants.add(base.slice(0, -1));
  return [...variants];
}

function analysisTokens(value: string): string[] {
  return words(value).flatMap((word) => word.split('-')).flatMap(tokenVariants).filter(Boolean);
}

function related(a: string, b: string): boolean {
  return a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)));
}

function meaningfulEvidence(input: AiPlaceNoteInput): AiPlaceNoteEvidence[] {
  return input.evidence.filter((item) =>
    VALID_SOURCES.has(item.source) &&
    typeof item.value === 'string' &&
    item.value.trim().length >= 3,
  );
}

function reject(reason: AiPlaceNoteRejection): AiPlaceNoteResult {
  return { note: null, status: 'rejected', reason };
}

export function evaluateAiPlaceNote(input: AiPlaceNoteInput): AiPlaceNoteResult {
  const raw = input.proposedNote?.trim() ?? '';
  if (!raw) return { note: null, status: 'not_requested', reason: null };
  const evidence = meaningfulEvidence(input);
  if (evidence.length === 0) return { note: null, status: 'insufficient_evidence', reason: null };
  if (/\r|\n/.test(raw)) return reject('invalid_format');

  const proposed = raw.replace(/\s+/g, ' ').trim();
  if (proposed.length > AI_NOTE_MAX_CHARACTERS) return reject('too_long');
  const wordCount = words(proposed.replace(/[.!?]+$/, '')).length;
  if (wordCount < AI_NOTE_MIN_WORDS) return reject('too_short');
  if (wordCount > AI_NOTE_MAX_WORDS) return reject('too_long');
  const sentenceCount = proposed.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  if (sentenceCount > 2) return reject('invalid_format');

  const evidenceTokens = new Set(evidence.flatMap((item) => analysisTokens(item.value)));
  const placeTokens = new Set(analysisTokens(input.placeName ?? ''));
  const noteTokens = analysisTokens(proposed);
  const noteNumbers = noteTokens.filter((value) => /^\d+$/.test(value));
  if (noteNumbers.some((value) => !evidenceTokens.has(value))) return reject('ungrounded_claim');
  const gatedClaims = noteTokens.filter((value) => OBSERVATION_GATED_TOKENS.has(value));
  if (gatedClaims.some((value) => ![...evidenceTokens].some((item) => related(value, item)))) {
    return reject('ungrounded_claim');
  }

  const possibleDetails = noteTokens.filter((value) =>
    value.length >= 3 && !GROUNDING_GLUE.has(value) && !placeTokens.has(value),
  );
  const hasGroundedDetail = possibleDetails.some((candidate) =>
    [...evidenceTokens].some((evidenceToken) => related(candidate, evidenceToken)),
  );
  if (!hasGroundedDetail) return reject('ungrounded_claim');

  return { note: proposed, status: 'generated', reason: null };
}

/** Delivery validation never manufactures replacement prose. */
export function evaluateDeliverableAiPlaceNote(
  input: AiPlaceNoteInput,
): DeliverableAiPlaceNoteResult {
  return { ...evaluateAiPlaceNote(input), groundedFallbackUsed: false };
}

export function generateAiPlaceNote(input: AiPlaceNoteInput): string | null {
  return evaluateAiPlaceNote(input).note;
}

export function preserveUserNote(
  userNote: string | null | undefined,
  aiNote: string | null | undefined,
): { notes: string | null; aiNote: string | null } {
  return {
    notes: userNote?.trim() ? userNote.trim() : null,
    aiNote: aiNote?.trim() ? aiNote.trim() : null,
  };
}

/** AI-note persistence is supplemental and must never unwind a place save. */
export async function persistAiNoteSupplementally(
  aiNote: string | null | undefined,
  persist: (note: string) => Promise<void>,
): Promise<'stored' | 'skipped' | 'failed'> {
  const note = aiNote?.trim() ?? '';
  if (!note) return 'skipped';
  try {
    await persist(note);
    return 'stored';
  } catch {
    return 'failed';
  }
}
