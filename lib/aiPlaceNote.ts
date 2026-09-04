/**
 * Last-mile validation for a source-grounded saved-place memory cue.
 *
 * Voice and wording belong to the model prompt. This module enforces the
 * authenticity contract at the storage boundary and deliberately contains no
 * replacement prose, category template, canned opener, or fallback generator.
 * A rejected generation is retried with broader evidence by the durable worker
 * once, then omitted.
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
  | 'malformed_construction'
  | 'duplicated_subject'
  | 'generic_visual_filler'
  | 'summary_like'
  | 'marketing_like'
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

export type AiNoteStructureFamily =
  | 'DEMONSTRATIVE_DECLARATIVE'
  | 'FIRST_PERSON'
  | 'QUESTION'
  | 'FRAGMENT'
  | 'ACTION_INTENT'
  | 'VERB_LED'
  | 'COMPARISON'
  | 'OTHER';

export type AiNoteCorpusEvaluation = {
  accepted: number;
  omitted: number;
  averageWords: number;
  medianWords: number;
  structuralFamilies: Record<AiNoteStructureFamily, number>;
  exactOpeners: Record<string, number>;
  repeatedThreeWordPrefixes: Record<string, number>;
  demonstrativeDescriptiveCount: number;
  demonstrativeDescriptiveRate: number;
  largestFamily: { family: AiNoteStructureFamily; count: number; rate: number } | null;
  malformedCount: number;
  summaryLikeCount: number;
  phraseCounts: Record<'looked unreal' | 'looks amazing' | 'looks incredible', number>;
  passed: boolean;
  failures: string[];
};

export type LegacyBadAiNoteReason =
  | 'historical_looked_unreal_fallback'
  | 'malformed_demonstrative_article'
  | 'legacy_generic_visual_filler';

export type LegacyAiNoteReenrichmentPlan =
  | { action: 'preserve'; reason: 'not_legacy_pattern' | 'unsupported_source' }
  | { action: 'clear_ai_note_and_rearm'; reason: LegacyBadAiNoteReason };

const VALID_SOURCES = new Set<AiPlaceNoteEvidenceSource>([
  'caption', 'speech', 'visible_text', 'frame',
]);

const MALFORMED_DEMONSTRATIVE_ARTICLE = /^(?:that|those)\s+(?:the|a|an|this|that|these|those)\b/i;
const DUPLICATED_SUBJECT = /\b([a-z][a-z'-]{2,})\b\s+(?:\w+\s+){0,2}(?:had|has|have|with|featuring|features)\s+(?:\w+\s+){0,2}\1(?:s|es)?\b/i;
const GENERIC_VISUAL_FILLER = /\b(?:looks? (?:amazing|incredible|so good|unreal)|looked unreal)\b/i;
const SUMMARY_LIKE = /^(?:the|this)\s+(?:video|post|reel)\b|\b(?:video|post|reel)\s+(?:shows|showcases|features|highlights|is about)\b/i;
const MARKETING_LIKE = /\b(?:must[- ]visit|hidden gem|perfect (?:spot|place)|worth checking out|you should visit|add (?:it|this) to your bucket list)\b/i;

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

// Closed non-claim vocabulary used only to distinguish personal stance and
// grammar from observable claims. Concrete objects, ingredients, activities,
// sensory properties, dates, prices, weather, and place facts are intentionally
// absent: those must overlap the place-scoped evidence.
const NON_CLAIM_TOKENS = new Set([
  ...GROUNDING_GLUE,
  'absolute', 'absolutely', 'actually', 'again', 'against', 'almost', 'alone', 'already', 'also', 'apparently',
  'after', 'arent', 'around', 'back', 'basically', 'before', 'behind', 'below', 'beneath', 'beside', 'between', 'bit', 'cant', 'couldnt', 'definitely', 'doesnt', 'dont', 'enough', 'especially', 'even',
  'being', 'desperately', 'directly', 'endlessly', 'ever', 'exactly', 'finally', 'genuinely', 'honestly', 'immediately', 'inside', 'instead', 'intensely',
  'id', 'isnt', 'kinda', 'literally', 'maybe', 'much', 'nearly', 'never', 'next', 'now', 'okay', 'only', 'outside', 'over', 'own',
  'cleanly', 'equal', 'overhead', 'parts', 'pretty', 'probably', 'properly', 'quite', 'rather', 'really', 'seriously', 'since', 'single', 'slightly', 'super', 'utterly',
  'right', 'shouldnt', 'simply', 'somehow', 'still', 'straight', 'surely', 'through', 'top', 'totally', 'under', 'until', 'very', 'wasnt', 'way', 'werent', 'whatever', 'whole', 'wont', 'wouldnt',
  'wildly', 'wow', 'yeah', 'yep',
  'amazing', 'awesome', 'beautiful', 'bonkers', 'brilliant', 'brutal', 'cool', 'crazy',
  'calming', 'chaotic', 'claustrophobic', 'clean', 'cute', 'dangerous', 'dangerously', 'dedication', 'dramatic', 'dreamy', 'easy', 'enormous', 'excellent', 'fantastic', 'fine', 'good',
  'gorgeous', 'great', 'huge', 'incredible', 'insane', 'legit', 'lovely', 'mad',
  'brave', 'chills', 'dedicated', 'dying', 'freak', 'fun', 'glued', 'hard', 'hell', 'hungry', 'hypnotic', 'intimidating', 'intimidation', 'little', 'magical', 'massive', 'mesmerizing', 'mess', 'nervous', 'nice', 'nuts', 'obsessed', 'peaceful', 'presentation', 'promising', 'pure', 'ready', 'resist', 'ridiculous', 'ridiculously', 'serious', 'setup', 'sick', 'sign', 'solid', 'sucker', 'surreal', 'tempted', 'terrifies', 'terrifying', 'terrifyingly',
  'stunning', 'sweet', 'unbelievable', 'unreal', 'wild', 'worth',
  'add', 'adding', 'bookmark', 'bookmarking', 'crave', 'craving', 'get', 'getting',
  'browse', 'browsing', 'climb', 'climbing', 'cross', 'crossing', 'dive', 'diving', 'finish', 'finishing', 'give', 'go', 'going', 'gotta', 'grab', 'grabbing', 'hear', 'hearing', 'imagine', 'keep', 'keeping',
  'know', 'look', 'looked', 'looking', 'looks', 'love', 'need', 'needed', 'order', 'ordering', 'pick', 'picking', 'remember',
  'catch', 'claim', 'claiming', 'ducking', 'explain', 'explains', 'feel', 'feels', 'gave', 'get', 'gets', 'having', 'keep', 'leave', 'like', 'made', 'make', 'makes', 'messing', 'psych', 'routine', 'save', 'saving', 'see', 'seeing', 'show', 'shows', 'sit', 'sitting', 'skip', 'soaking', 'sold', 'someone', 'sound', 'sounds', 'spend', 'stand', 'stay', 'staying', 'stop', 'take', 'taking', 'taste', 'tasting', 'test', 'testing', 'trudge', 'try', 'trying', 'visit', 'wait', 'waiting', 'wake', 'waking', 'walk', 'walking', 'wander', 'waste', 'watch', 'watching',
  'want', 'wanted', 'would',
  'best', 'bit', 'bite', 'chance', 'entire', 'first', 'full', 'left', 'list', 'me', 'mine', 'myself', 'nope', 'one', 'piece', 'please', 'something', 'theres', 'work',
  'queue', 'someday', 'soon', 'yes',
]);

const GROUNDED_EQUIVALENT_GROUPS: readonly (readonly string[])[] = [
  ['bicycle', 'bike'],
  ['bathtub', 'tub'],
  ['age', 'aged', 'aging'],
  ['bed', 'bedroom'],
  ['built', 'tucked'],
  ['center', 'central', 'centered'],
  ['close', 'near', 'nearby', 'next'],
  ['crisp', 'crispy', 'crunchy'],
  ['aim', 'aimed', 'face', 'facing'],
  ['high', 'height', 'tall'],
  ['liquid', 'molten'],
  ['lined', 'ringing', 'stacked'],
  ['narrow', 'packed', 'tight', 'crowded'],
  ['passage', 'gap', 'crack'],
  ['snow', 'powder'],
  ['spiral', 'winding', 'curling', 'wrap'],
  ['covered', 'buried', 'hung', 'strung'],
  ['flower', 'flowers', 'bloom', 'blooms'],
  ['overlook', 'overlooking', 'view'],
  ['rotate', 'switch', 'switching'],
  ['road', 'stretch'],
  ['ride', 'train'],
  ['throwing', 'centering'],
];

function groundingVariants(value: string): string[] {
  const variants = new Set(tokenVariants(value));
  const base = token(value);
  for (const group of GROUNDED_EQUIVALENT_GROUPS) {
    if (group.includes(base)) group.flatMap(tokenVariants).forEach((variant) => variants.add(variant));
  }
  return [...variants];
}

// These words assert observable time/weather context rather than mere stance.
// They are permitted only when the scoped evidence actually supplies them.
const OBSERVATION_GATED_TOKENS = new Set([
  'afternoon', 'daylight', 'dawn', 'evening', 'fog', 'foggy', 'hot',
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

export function isMalformedAiNote(note: string): boolean {
  const value = note.replace(/\s+/g, ' ').trim();
  return MALFORMED_DEMONSTRATIVE_ARTICLE.test(value) || DUPLICATED_SUBJECT.test(value);
}

export function isSummaryLikeAiNote(note: string): boolean {
  return SUMMARY_LIKE.test(note.trim());
}

export function classifyAiNoteStructure(note: string): AiNoteStructureFamily {
  const value = note.trim();
  if (/^(?:that|those|these|this)\b.+\b(?:look|looks|looked|is|are|was|were)\b/i.test(value)) {
    return 'DEMONSTRATIVE_DECLARATIVE';
  }
  if (/^(?:i\b|i'd\b|i'm\b|i'll\b|i've\b|me\b|my\b)/i.test(value)) return 'FIRST_PERSON';
  if (/\?/.test(value)) return 'QUESTION';
  if (/\b(?:like|unlike|than|reminds? me of|straight out of)\b/i.test(value)) return 'COMPARISON';
  if (/^(?:need|order|save|try|grab|give|take|put|add|skip|keep|going|gotta)\b/i.test(value)) {
    return 'ACTION_INTENT';
  }
  if (/^(?:[a-z]+ing|imagine|picture|watch|look|walk|climb|swim|drive|bring|make|show|listen)\b/i.test(value)) {
    return 'VERB_LED';
  }
  const withoutEnd = value.replace(/[.!?]+$/, '');
  const finiteVerb = /\b(?:am|are|is|was|were|be|been|being|look|looks|looked|feel|feels|felt|want|wants|wanted|need|needs|needed|have|has|had|do|does|did|can|could|will|would|should|might|must)\b/i;
  if (!finiteVerb.test(withoutEnd)) return 'FRAGMENT';
  return 'OTHER';
}

function wordCount(value: string): number {
  return words(value.replace(/[.!?]+$/, '')).length;
}

function phraseCount(notes: readonly string[], phrase: string): number {
  return notes.filter((note) => note.toLowerCase().includes(phrase)).length;
}

/** Corpus-level diversity gate. Individual natural demonstratives remain legal. */
export function evaluateAiNoteCorpus(notes: readonly (string | null | undefined)[]): AiNoteCorpusEvaluation {
  const acceptedNotes = notes.map((note) => note?.trim() ?? '').filter(Boolean);
  const families: Record<AiNoteStructureFamily, number> = {
    DEMONSTRATIVE_DECLARATIVE: 0,
    FIRST_PERSON: 0,
    QUESTION: 0,
    FRAGMENT: 0,
    ACTION_INTENT: 0,
    VERB_LED: 0,
    COMPARISON: 0,
    OTHER: 0,
  };
  const exactOpeners: Record<string, number> = {};
  const prefixes: Record<string, number> = {};
  const counts = acceptedNotes.map(wordCount).sort((a, b) => a - b);
  for (const note of acceptedNotes) {
    families[classifyAiNoteStructure(note)] += 1;
    const noteWords = words(note).map((value) => value.toLowerCase());
    const opener = noteWords.slice(0, 2).join(' ');
    const prefix = noteWords.slice(0, 3).join(' ');
    if (opener) exactOpeners[opener] = (exactOpeners[opener] ?? 0) + 1;
    if (prefix) prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
  }
  const denominator = acceptedNotes.length;
  const familyEntries = (Object.entries(families) as Array<[AiNoteStructureFamily, number]>)
    .sort((a, b) => b[1] - a[1]);
  const largest = familyEntries[0];
  const demonstrativeCount = families.DEMONSTRATIVE_DECLARATIVE;
  const repeatedPrefixes = Object.fromEntries(Object.entries(prefixes).filter(([, count]) => count > 1));
  const failures: string[] = [];
  if (denominator === 0) failures.push('no accepted notes');
  if (largest && denominator > 0 && largest[1] / denominator > 0.40) {
    failures.push(`${largest[0]} exceeds 40%`);
  }
  if (denominator > 0 && demonstrativeCount / denominator > 0.15) {
    failures.push('demonstrative descriptive family exceeds 15%');
  }
  for (const [prefix, count] of Object.entries(repeatedPrefixes)) {
    if (count > 2) failures.push(`three-word opener "${prefix}" occurs ${count} times`);
  }
  const malformedCount = acceptedNotes.filter(isMalformedAiNote).length;
  const summaryLikeCount = acceptedNotes.filter(isSummaryLikeAiNote).length;
  if (malformedCount > 0) failures.push(`${malformedCount} malformed note(s)`);
  if (summaryLikeCount > 0) failures.push(`${summaryLikeCount} summary-like note(s)`);
  const phraseCounts = {
    'looked unreal': phraseCount(acceptedNotes, 'looked unreal'),
    'looks amazing': phraseCount(acceptedNotes, 'looks amazing'),
    'looks incredible': phraseCount(acceptedNotes, 'looks incredible'),
  };
  for (const [phrase, count] of Object.entries(phraseCounts)) {
    if (count > 0) failures.push(`"${phrase}" occurs ${count} time(s)`);
  }
  const middle = Math.floor(counts.length / 2);
  const medianWords = counts.length === 0
    ? 0
    : counts.length % 2 === 1
      ? counts[middle]!
      : (counts[middle - 1]! + counts[middle]!) / 2;
  return {
    accepted: denominator,
    omitted: notes.length - denominator,
    averageWords: denominator ? counts.reduce((sum, count) => sum + count, 0) / denominator : 0,
    medianWords,
    structuralFamilies: families,
    exactOpeners,
    repeatedThreeWordPrefixes: repeatedPrefixes,
    demonstrativeDescriptiveCount: demonstrativeCount,
    demonstrativeDescriptiveRate: denominator ? demonstrativeCount / denominator : 0,
    largestFamily: largest
      ? { family: largest[0], count: largest[1], rate: denominator ? largest[1] / denominator : 0 }
      : null,
    malformedCount,
    summaryLikeCount,
    phraseCounts,
    passed: failures.length === 0,
    failures,
  };
}

/** Narrow signatures only; this must never become a broad taste classifier. */
export function classifyLegacyBadAiNote(note: string | null | undefined): LegacyBadAiNoteReason | null {
  const value = note?.replace(/\s+/g, ' ').trim() ?? '';
  if (!value) return null;
  if (MALFORMED_DEMONSTRATIVE_ARTICLE.test(value)) return 'malformed_demonstrative_article';
  if (/^That\s+.+\s+looked unreal[.!?]*$/i.test(value)) return 'historical_looked_unreal_fallback';
  if (/^.+\s+looks (?:amazing|incredible|so good)[.!?]*$/i.test(value)) {
    return 'legacy_generic_visual_filler';
  }
  return null;
}

/**
 * The database's existing saved-place trigger performs the actual idempotent
 * queue re-arm when `ai_note` transitions from nonblank to null. This planner
 * keeps the candidate decision narrow and makes a second pass a no-op.
 */
export function planLegacyAiNoteReenrichment(input: {
  aiNote: string | null | undefined;
  sourceType: string | null | undefined;
  sourceUrl: string | null | undefined;
}): LegacyAiNoteReenrichmentPlan {
  const reason = classifyLegacyBadAiNote(input.aiNote);
  if (!reason) return { action: 'preserve', reason: 'not_legacy_pattern' };
  const sourceType = input.sourceType?.trim().toLowerCase() ?? '';
  const sourceUrl = input.sourceUrl?.trim() ?? '';
  const supportedType = ['', 'link', 'instagram', 'tiktok', 'youtube', 'facebook', 'snapchat'].includes(sourceType);
  const supportedUrl = /^https:\/\/(?:[^/?#]+\.)?(?:instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|snapchat\.com)\//i.test(sourceUrl);
  if (sourceType === 'manual' || !supportedType || !supportedUrl) {
    return { action: 'preserve', reason: 'unsupported_source' };
  }
  return { action: 'clear_ai_note_and_rearm', reason };
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
  if (MALFORMED_DEMONSTRATIVE_ARTICLE.test(proposed)) return reject('malformed_construction');
  if (DUPLICATED_SUBJECT.test(proposed)) return reject('duplicated_subject');
  if (GENERIC_VISUAL_FILLER.test(proposed)) return reject('generic_visual_filler');
  if (SUMMARY_LIKE.test(proposed)) return reject('summary_like');
  if (MARKETING_LIKE.test(proposed)) return reject('marketing_like');

  const evidenceTokens = new Set(evidence.flatMap((item) => analysisTokens(item.value)));
  const placeTokens = new Set(analysisTokens(input.placeName ?? ''));
  // Keep one base token per note word. Evidence receives morphological
  // variants, but treating those variants as additional claims would turn
  // stance words such as "nervous" into a bogus unsupported token "nervou".
  const noteTokens = words(proposed).flatMap((word) => word.split('-')).map(token).filter(Boolean);
  const noteNumbers = noteTokens.filter((value) => /^\d+$/.test(value));
  if (noteNumbers.some((value) => !evidenceTokens.has(value))) return reject('ungrounded_claim');
  const gatedClaims = noteTokens.filter((value) => OBSERVATION_GATED_TOKENS.has(value));
  if (gatedClaims.some((value) => ![...evidenceTokens].some((item) => related(value, item)))) {
    return reject('ungrounded_claim');
  }

  const possibleDetails = noteTokens.filter((value) =>
    value.length >= 3 && !NON_CLAIM_TOKENS.has(value) && !placeTokens.has(value),
  );
  if (possibleDetails.some((candidate) =>
    !groundingVariants(candidate).some((variant) =>
      [...evidenceTokens].some((evidenceToken) => related(variant, evidenceToken))),
  )) return reject('ungrounded_claim');
  const hasGroundedDetail = possibleDetails.some((candidate) =>
    groundingVariants(candidate).some((variant) =>
      [...evidenceTokens].some((evidenceToken) => related(variant, evidenceToken))),
  );
  // A purely personal reaction can omit the obvious subject ("I need to try
  // this") when it makes no concrete claim. Any concrete detail, however,
  // must be supported token-by-token above.
  const isPersonalReaction = /^(?:i\b|i'd\b|i'm\b|i'll\b|i've\b|need\b|save\b|try\b|grab\b|okay\b|wow\b)/i.test(proposed);
  if (!hasGroundedDetail && possibleDetails.length > 0 && !isPersonalReaction) return reject('ungrounded_claim');

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
