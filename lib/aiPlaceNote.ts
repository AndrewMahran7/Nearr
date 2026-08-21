/**
 * Conservative validation for the media model's source-grounded memory cue.
 * The model proposes wording; this module decides whether it is safe/useful
 * enough to persist. User-authored `saved_places.notes` is never involved.
 *
 * GROUNDING MODEL
 * ---------------
 * A casual reaction note mixes two kinds of words, and only one of them can
 * be checked against evidence:
 *
 *   claims  — nouns, proper nouns, numbers and dates that assert something
 *             about the world: a menu item, an ingredient, a feature, an offer
 *             window. These MUST appear in the evidence scoped to this logical
 *             place. This is the rule that stops "lobster roll" from appearing
 *             when the transcript said "birria burrito", stops one place's food
 *             leaking onto its sibling in a multi-place post, and stops
 *             "sunset" from being invented over a daylight frame.
 *
 *   stance  — the speaker's reaction to what they saw ("sick", "unreal",
 *             "ridiculous") and their own intent ("saving this", "need to try
 *             this"). These assert nothing checkable, so requiring evidence for
 *             them is a category error.
 *
 * An earlier revision had no such split: every content word had to appear in
 * the evidence, with a hand-maintained allowlist as the only escape hatch.
 * That allowlist was therefore the de facto vocabulary of the whole feature, so
 * any reaction word nobody had thought to add rejected the entire note —
 * measured against the target voice it refused 8 of 9 acceptable notes.
 * Widening it ad hoc would eventually let a factual claim through, so the
 * lexicons below are CLOSED and deliberately contain no noun that names
 * anything in the world.
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

/**
 * Why a cue did or did not become an `ai_note`. Bounded and closed so it can be
 * logged as a status code — it never carries caption, note, or model text.
 */
export type AiPlaceNoteStatus =
  | 'generated'
  /** The model declined to propose a cue for this place. */
  | 'not_requested'
  /** Nothing survived to scope a cue against. */
  | 'insufficient_evidence'
  /** A cue was proposed but failed validation; see `reason`. */
  | 'rejected';

export type AiPlaceNoteRejection =
  | 'banned_opening'
  | 'generic_description'
  | 'disallowed_punctuation'
  | 'too_many_sentences'
  | 'too_short'
  | 'too_long'
  | 'ungrounded_claim'
  | 'no_hook';

export type AiPlaceNoteResult = {
  note: string | null;
  status: AiPlaceNoteStatus;
  reason: AiPlaceNoteRejection | null;
};

export type DeliverableAiPlaceNoteResult = AiPlaceNoteResult & {
  /** True only when a rejected model cue was replaced with scoped evidence. */
  groundedFallbackUsed: boolean;
};

const MIN_WORDS = 4;
const MAX_WORDS = 22;
const VALID_SOURCES = new Set<AiPlaceNoteEvidenceSource>([
  'caption',
  'speech',
  'visible_text',
  'frame',
]);
const BANNED_OPENING = /^(?:this place|the user|the video|you should)\b/i;
const GENERIC_DESCRIPTION = /\b(?:great place|must[- ]visit|popular (?:restaurant|cafe|hotel|destination)|delicious food|scenic (?:destination|spot)|luxury hotel|worth checking out)\b/i;
const HASHTAG_QUOTE_OR_EMOJI = /[#"“”]|[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
const GENERIC_HOOK_WORDS = new Set([
  'attraction', 'bar', 'beach', 'business', 'cafe', 'coffee', 'destination',
  'deli', 'food', 'hotel', 'museum', 'park', 'place', 'restaurant', 'shop',
  'spot', 'store', 'trail', 'venue', 'view', 'american', 'chinese', 'french',
  'indian', 'italian', 'japanese', 'mediterranean', 'mexican', 'thai',
]);

// Nouns that name nothing in particular ("tiny spot", "the food stuff"). They
// carry no fact to corroborate, so they are not claims — and because they are
// dropped from `claims` they can never become the grounded hook either.
const CONTENTLESS_NOUNS = new Set([
  'bit', 'one', 'ones', 'place', 'spot', 'stuff', 'thing', 'things',
]);

// Grammar and provenance glue. Nothing here names a thing in the world, so
// none of it can smuggle an invented fact into a note.
const FUNCTION_WORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'an', 'and', 'another', 'any', 'are',
  'around', 'as', 'at', 'back', 'be', 'been', 'behind', 'both', 'but', 'by',
  'can', 'creator', 'did', 'do', 'does', 'down', 'each', 'even', 'every',
  'for', 'from', 'get', 'gets', 'got', 'had', 'has', 'have', 'he', 'her',
  'here', 'hers', 'him', 'his', 'how', 'i', 'if', 'im', 'in', 'inside',
  'into', 'is', 'it', 'its', 'ive', 'just', 'kind', 'like', 'looked',
  'looks', 'made', 'makes', 'me', 'more', 'most', 'my', 'no', 'not', 'of',
  'off', 'on', 'one', 'or', 'our', 'out', 'over', 'own', 'plus', 'post',
  'put', 'said', 'same', 'says', 'see', 'she', 'show', 'showed', 'shown',
  'shows', 'since', 'so', 'some', 'still', 'such', 'than', 'that', 'thats',
  'the', 'their', 'theirs', 'them', 'then', 'there', 'theres', 'these',
  'they', 'theyre', 'this', 'those', 'through', 'to', 'too', 'under', 'up',
  'us', 'very', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'while', 'who', 'why', 'will', 'with', 'without', 'would', 'you', 'your',
]);

// Subjective reaction and the saver's own intent. Closed on purpose: these
// express a stance toward the evidence, never a new fact about the place.
const REACTION_WORDS = new Set([
  // intensity / evaluation
  'absolutely', 'absurd', 'actually', 'amazing', 'awesome', 'beautiful',
  'best', 'better', 'bonkers', 'brilliant', 'clean', 'cool', 'crazy',
  'criminally', 'cute', 'dangerously', 'dreamy', 'excellent', 'fantastic',
  'fine', 'genuinely', 'good', 'gorgeous', 'great', 'honestly', 'huge',
  'incredible', 'insane', 'legit', 'lovely', 'lowkey', 'mad', 'magical',
  'nice', 'nuts', 'obsessed', 'okay', 'peaceful', 'peak', 'pretty', 'proper',
  'quietly', 'real', 'really', 'ridiculous', 'seriously', 'sick', 'silly',
  'small', 'solid', 'stunning', 'stupid', 'super', 'sweet', 'tiny',
  'unbelievable', 'unreal', 'wild', 'wildly', 'wonderful',
  // contentless intensifiers and hedges ("straight out of", "literally the")
  'basically', 'instantly', 'kinda', 'literally', 'straight', 'totally',
  // stance verbs / interjections
  'go', 'goes', 'going', 'love', 'loved', 'obsessing', 'sold', 'sure',
  'want', 'wanted', 'wow', 'yeah', 'yep', 'yes',
  // saving intent
  'add', 'adding', 'bookmark', 'bookmarking', 'definitely', 'gonna', 'gotta',
  'immediately', 'list', 'must', 'need', 'needed', 'now', 'queue', 'remember',
  'save', 'saved', 'saving', 'someday', 'soon', 'try', 'trying', 'visit',
  'worth',
  // provenance verbs, so a cue can attribute an opinion to the creator
  'called', 'calling', 'claim', 'claims', 'highlight', 'highlighted', 'known',
  'ordered', 'picked', 'ranked', 'rated', 'walked',
]);

// Characterizing an offer as time-bound is an inference the evidence licenses
// only when the evidence actually supplied the times. Gated accordingly.
const DATE_INFERENCE_WORDS = new Set([
  'before', 'catch', 'ends', 'ending', 'limited', 'move', 'only', 'runs',
  'time', 'until', 'window',
]);

const MONTHS: Record<string, string> = {
  jan: 'january', feb: 'february', mar: 'march', apr: 'april',
  jun: 'june', jul: 'july', aug: 'august', sep: 'september',
  sept: 'september', oct: 'october', nov: 'november', dec: 'december',
};
const DATE_SIGNAL = new RegExp(
  `\\b(?:${[...new Set([...Object.keys(MONTHS), ...Object.values(MONTHS)])].join('|')}` +
    '|today|tonight|tomorrow|weekend|until|through|thru)\\b',
  'i',
);

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
}

/**
 * Tokens used for grounding (not for length). Hyphenated compounds are split
 * so "limited-time" is checked as "limited" + "time", and a numeric range like
 * "1-14" is checked as the two numbers it actually names rather than as the
 * nonsense token "114".
 */
function analysisTokens(value: string): string[] {
  return words(value).flatMap((word) => word.split('-')).filter(Boolean);
}

function token(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function tokenVariants(value: string): string[] {
  const base = token(value);
  if (!base) return [];
  const variants = new Set([base]);
  // "Sept 1-14" must ground against "September 1 through September 14": a note
  // may SHORTEN a date, never restate it as a different one.
  if (MONTHS[base]) variants.add(MONTHS[base]);
  if (base.length > 4 && base.endsWith('ies')) variants.add(`${base.slice(0, -3)}y`);
  if (base.length > 5 && base.endsWith('ing')) variants.add(base.slice(0, -3));
  if (base.length > 4 && base.endsWith('ed')) variants.add(base.slice(0, -2));
  if (base.length > 4 && base.endsWith('es')) variants.add(base.slice(0, -2));
  if (base.length > 3 && base.endsWith('s')) variants.add(base.slice(0, -1));
  return [...variants];
}

/** Digits only, with any ordinal suffix removed: "1st" and "1" are one date. */
function numeralOf(value: string): string | null {
  const match = /^(\d+)(?:st|nd|rd|th)?$/.exec(token(value));
  return match ? match[1]! : null;
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

/**
 * Accept a cue only when it is concise, non-generic, and every CLAIM it makes
 * is supported by evidence scoped to this logical place. Provider fields and
 * category labels are deliberately absent from this input contract.
 */
export function evaluateAiPlaceNote(input: AiPlaceNoteInput): AiPlaceNoteResult {
  const proposed = input.proposedNote?.replace(/\s+/g, ' ').trim() ?? '';
  const evidence = meaningfulEvidence(input);
  if (!proposed) return { note: null, status: 'not_requested', reason: null };
  if (evidence.length === 0) return { note: null, status: 'insufficient_evidence', reason: null };
  if (BANNED_OPENING.test(proposed)) return reject('banned_opening');
  if (GENERIC_DESCRIPTION.test(proposed)) return reject('generic_description');
  if (HASHTAG_QUOTE_OR_EMOJI.test(proposed)) return reject('disallowed_punctuation');

  const withoutFinalPunctuation = proposed.replace(/[.!?]+$/, '').trim();
  if (!withoutFinalPunctuation) return reject('too_short');
  const sentenceCount = proposed.split(/[.!?]+/).map((part) => part.trim()).filter(Boolean).length;
  if (sentenceCount > 2) return reject('too_many_sentences');
  const wordCount = words(withoutFinalPunctuation).length;
  if (wordCount < MIN_WORDS) return reject('too_short');
  if (wordCount > MAX_WORDS) return reject('too_long');

  const evidenceText = evidence.map((item) => item.value).join(' ');
  const evidenceTokens = new Set(
    evidence.flatMap((item) => analysisTokens(item.value).flatMap(tokenVariants)),
  );
  const evidenceNumerals = new Set(
    analysisTokens(evidenceText).map(numeralOf).filter((value): value is string => value !== null),
  );
  const placeTokens = new Set(analysisTokens(input.placeName ?? '').flatMap(tokenVariants));
  const noteTokens = analysisTokens(withoutFinalPunctuation).map(token).filter(Boolean);

  const isGrounded = (value: string): boolean =>
    tokenVariants(value).some((variant) => evidenceTokens.has(variant));

  // Numbers are claims with no synonyms: a date the evidence never named is an
  // invented date, so this runs before any lexicon can excuse it.
  const numerals = noteTokens.map(numeralOf).filter((value): value is string => value !== null);
  if (numerals.some((value) => !evidenceNumerals.has(value))) return reject('ungrounded_claim');

  // "Limited-time" is licensed BY an evidenced date, never asserted on its own.
  const datesLicensed = numerals.length > 0 && DATE_SIGNAL.test(evidenceText);

  const claims = noteTokens.filter((value) =>
    numeralOf(value) === null &&
    !FUNCTION_WORDS.has(value) &&
    !CONTENTLESS_NOUNS.has(value) &&
    !REACTION_WORDS.has(value) &&
    !(datesLicensed && DATE_INFERENCE_WORDS.has(value)) &&
    !placeTokens.has(value),
  );
  if (claims.some((value) => !isGrounded(value))) return reject('ungrounded_claim');

  // A provider name or generic category alone does not explain why the post was
  // compelling. Require at least one grounded hook detail (an item, activity,
  // concrete visual feature, offer date, etc.) beyond the place identity.
  // Reaction words are excluded on purpose: "Sick spot, insane" is a mood, not
  // a reason, and would read identically on every place the user ever saved.
  const hookTokens = claims.filter((value) => !GENERIC_HOOK_WORDS.has(value));
  if (hookTokens.length === 0 && numerals.length === 0) return reject('no_hook');

  return {
    note: /[.!?]$/.test(proposed) ? proposed : `${proposed}.`,
    status: 'generated',
    reason: null,
  };
}

/**
 * Build a conservative last-mile cue by quoting only normalized words from one
 * scoped evidence item. This is intentionally not a second generator and does
 * not relax validation: every candidate goes back through evaluateAiPlaceNote.
 * Frame/visible-text observations are preferred because they read naturally as
 * "That ... looked unreal"; weak/generic evidence still fails the hook rule.
 */
export function groundedAiPlaceNoteFallback(
  input: Pick<AiPlaceNoteInput, 'placeName' | 'evidence'>,
): AiPlaceNoteResult {
  const rankedEvidence = meaningfulEvidence({ ...input, proposedNote: null })
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const rank = (source: AiPlaceNoteEvidenceSource) =>
        source === 'frame' ? 0 : source === 'visible_text' ? 1 : source === 'speech' ? 2 : 3;
      return rank(a.item.source) - rank(b.item.source) || a.index - b.index;
    });

  for (const { item } of rankedEvidence) {
    // 18 evidence words + "That" + "looked unreal" stays within the 22-word
    // product bound. Tokenization also removes quotes, emoji and extra stops.
    const evidencePhrase = words(item.value).slice(0, 18).join(' ');
    if (!evidencePhrase) continue;
    const candidate = evaluateAiPlaceNote({
      placeName: input.placeName,
      proposedNote: `That ${evidencePhrase} looked unreal.`,
      evidence: input.evidence,
    });
    if (candidate.note) return candidate;
  }
  return reject('ungrounded_claim');
}

/**
 * Delivery-boundary evaluation. The model's cue wins whenever it is valid.
 * Only an ungrounded-claim rejection may use the evidence-derived fallback;
 * every other safety/quality rejection keeps its original result.
 */
export function evaluateDeliverableAiPlaceNote(
  input: AiPlaceNoteInput,
): DeliverableAiPlaceNoteResult {
  const primary = evaluateAiPlaceNote(input);
  if (primary.note || primary.reason !== 'ungrounded_claim') {
    return { ...primary, groundedFallbackUsed: false };
  }
  const fallback = groundedAiPlaceNoteFallback(input);
  if (!fallback.note) return { ...primary, groundedFallbackUsed: false };
  return { ...fallback, groundedFallbackUsed: true };
}

/** Back-compatible wrapper: the note, or null when it must not be persisted. */
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
