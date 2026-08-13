/**
 * Conservative validation for the media model's source-grounded memory cue.
 * The model proposes wording; this module decides whether it is safe/useful
 * enough to persist. User-authored `saved_places.notes` is never involved.
 */

export type AiPlaceNoteEvidenceSource = 'caption' | 'speech' | 'visible_text' | 'frame';

export type AiPlaceNoteEvidence = {
  source: AiPlaceNoteEvidenceSource;
  value: string;
  timestampSeconds?: number | null;
};

export type AiPlaceNoteInput = {
  placeName: string | null | undefined;
  /** One-sentence cue proposed by the source-analysis model. */
  proposedNote: string | null | undefined;
  /** Evidence assigned to this logical place only. */
  evidence: readonly AiPlaceNoteEvidence[];
};

const MIN_WORDS = 6;
const MAX_WORDS = 18;
const VALID_SOURCES = new Set<AiPlaceNoteEvidenceSource>([
  'caption',
  'speech',
  'visible_text',
  'frame',
]);
const BANNED_OPENING = /^(?:this place|the user|the video|you should)\b/i;
const GENERIC_DESCRIPTION = /\b(?:great place|must[- ]visit|popular (?:restaurant|cafe|hotel|destination)|delicious food|scenic (?:destination|spot)|luxury hotel|worth checking out)\b/i;
const HASHTAG_QUOTE_OR_EMOJI = /[#"'\u2018\u2019\u201c\u201d]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

// Words that may legitimately be added to turn evidence into a conversational
// memory cue. All remaining content words must appear in the supplied evidence.
const STYLE_WORDS = new Set([
  'a', 'about', 'an', 'and', 'as', 'at', 'by', 'creator', 'down', 'for', 'from',
  'go', 'highlight', 'highlighted', 'in', 'inside', 'it', 'known', 'of', 'on',
  'or', 'ordered', 'post', 'save', 'saved', 'see', 'show', 'showed', 'shown',
  'the', 'their', 'them', 'they', 'this', 'to', 'try', 'up', 'walked', 'was',
  'were', 'with',
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

function meaningfulEvidence(input: AiPlaceNoteInput): AiPlaceNoteEvidence[] {
  return input.evidence.filter((item) =>
    VALID_SOURCES.has(item.source) &&
    typeof item.value === 'string' &&
    item.value.trim().length >= 3,
  );
}

/**
 * Accept a cue only when it is concise, non-generic, and every substantive
 * word is supported by evidence scoped to this logical place. Provider fields
 * and category labels are deliberately absent from this input contract.
 */
export function generateAiPlaceNote(input: AiPlaceNoteInput): string | null {
  const proposed = input.proposedNote?.replace(/\s+/g, ' ').trim() ?? '';
  const evidence = meaningfulEvidence(input);
  if (!proposed || evidence.length === 0) return null;
  if (BANNED_OPENING.test(proposed) || GENERIC_DESCRIPTION.test(proposed)) return null;
  if (HASHTAG_QUOTE_OR_EMOJI.test(proposed)) return null;

  const withoutFinalPunctuation = proposed.replace(/[.!?]+$/, '').trim();
  if (!withoutFinalPunctuation || /[.!?]\s+\S/.test(withoutFinalPunctuation)) return null;
  const noteWords = words(withoutFinalPunctuation);
  if (noteWords.length < MIN_WORDS || noteWords.length > MAX_WORDS) return null;

  const evidenceTokens = new Set(
    evidence.flatMap((item) => words(item.value).flatMap(tokenVariants)),
  );
  const placeTokens = new Set(words(input.placeName ?? '').flatMap(tokenVariants));
  const substantive = noteWords
    .map(token)
    .filter((value) => value && !STYLE_WORDS.has(value) && !placeTokens.has(value));
  if (substantive.length === 0) return null;
  if (substantive.some((value) => !tokenVariants(value).some((variant) => evidenceTokens.has(variant)))) {
    return null;
  }

  return `${withoutFinalPunctuation}.`;
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
