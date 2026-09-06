/**
 * Small last-mile safety check for an LLM-authored reason-to-save note.
 * The model writes the prose. This module only normalizes harmless wrapping
 * and rejects clearly unsafe or malformed output; it never rewrites or builds
 * a replacement sentence.
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

export type AiPlaceNoteStatus = 'generated' | 'not_requested' | 'insufficient_evidence' | 'rejected';
export type AiPlaceNoteRejection =
  | 'invalid_format'
  | 'malformed_construction'
  | 'generic_visual_filler'
  | 'summary_like'
  | 'meta_language'
  | 'too_short'
  | 'too_long'
  | 'ungrounded_claim';

export type AiPlaceNoteResult = {
  note: string | null;
  status: AiPlaceNoteStatus;
  reason: AiPlaceNoteRejection | null;
};

export type DeliverableAiPlaceNoteResult = AiPlaceNoteResult & { groundedFallbackUsed: false };

export const AI_NOTE_MIN_WORDS = 3;
export const AI_NOTE_MAX_WORDS = 24;
export const AI_NOTE_MAX_CHARACTERS = 220;

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

const VALID_SOURCES = new Set<AiPlaceNoteEvidenceSource>(['caption', 'speech', 'visible_text', 'frame']);
const MALFORMED_DEMONSTRATIVE_ARTICLE = /^(?:that|those)\s+(?:the|a|an|this|that|these|those)\b/i;
const LEGACY_LOOKED_UNREAL = /^That\s+.+\s+looked unreal[.!?]*$/i;
const SUMMARY_LIKE = /^(?:the|this)\s+(?:video|post|reel)\b|\b(?:video|post|reel)\s+(?:shows|showcases|features|highlights|is about)\b/i;
const META_LANGUAGE = /\b(?:as an ai|ai assistant|language model|the user|the creator|nearr|provided evidence|supplied evidence|my analysis)\b/i;
const EMPTY_GENERIC = /^(?:(?:that|this|it|the place)\s+)?(?:looks?|looked|is|was)\s+(?:amazing|incredible|unreal|awesome|beautiful|great|so good)[.!?]*$/i;
const JSON_SHAPE = /^\s*[\[{]/;
const QUOTE_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['"', '"'], ["'", "'"], ['“', '”'], ['‘', '’'],
];
const GROUNDING_STOP = new Set([
  'a', 'an', 'and', 'are', 'at', 'be', 'because', 'but', 'by', 'can', 'could', 'for', 'from',
  'had', 'has', 'have', 'i', 'id', 'if', 'in', 'is', 'it', 'its', 'look', 'looked', 'looking',
  'looks', 'me', 'my', 'of', 'on', 'or', 'our', 'really', 'save', 'someone', 'that', 'the',
  'their', 'this', 'those', 'to', 'too', 'try', 'visit', 'was', 'we', 'were', 'with', 'worth',
  'would', 'you', 'your', 'absolutely', 'just', 'perfect', 'place', 'reason', 'remember', 'spot',
]);

function words(value: string): string[] {
  return value.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
}

function token(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
}

function related(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const stems = (value: string) => [
    value,
    value.endsWith('ies') ? `${value.slice(0, -3)}y` : value,
    value.endsWith('ing') ? value.slice(0, -3) : value,
    value.endsWith('ed') ? value.slice(0, -2) : value,
    value.endsWith('es') ? value.slice(0, -2) : value,
    value.endsWith('s') ? value.slice(0, -1) : value,
  ];
  return stems(a).some((left) => stems(b).some((right) => left === right || left.startsWith(right) || right.startsWith(left)));
}

function meaningfulEvidence(input: AiPlaceNoteInput): AiPlaceNoteEvidence[] {
  return input.evidence.filter((item) => VALID_SOURCES.has(item.source) && typeof item.value === 'string' && item.value.trim().length >= 3);
}

function reject(reason: AiPlaceNoteRejection): AiPlaceNoteResult {
  return { note: null, status: 'rejected', reason };
}

/** Only harmless envelope cleanup. No prose is inserted, removed, or rearranged. */
export function normalizeAiPlaceNote(value: string): string {
  let note = value.trim();
  for (const [open, close] of QUOTE_PAIRS) {
    if (note.length >= 2 && note.startsWith(open) && note.endsWith(close)) {
      note = note.slice(open.length, -close.length).trim();
      break;
    }
  }
  return note.replace(/\s+/g, ' ').trim();
}

export function isMalformedAiNote(note: string): boolean {
  const value = normalizeAiPlaceNote(note);
  return MALFORMED_DEMONSTRATIVE_ARTICLE.test(value) || LEGACY_LOOKED_UNREAL.test(value) || JSON_SHAPE.test(value);
}

export function isSummaryLikeAiNote(note: string): boolean {
  return SUMMARY_LIKE.test(note.trim());
}

export function classifyAiNoteStructure(note: string): AiNoteStructureFamily {
  const value = note.trim();
  if (/^(?:that|those|these|this)\b.+\b(?:look|looks|looked|is|are|was|were)\b/i.test(value)) return 'DEMONSTRATIVE_DECLARATIVE';
  if (/^(?:i\b|i'd\b|i'm\b|i'll\b|i've\b|me\b|my\b)/i.test(value)) return 'FIRST_PERSON';
  if (/\?/.test(value)) return 'QUESTION';
  if (/\b(?:like|unlike|than|reminds? me of|straight out of)\b/i.test(value)) return 'COMPARISON';
  if (/^(?:need|order|save|try|grab|give|take|put|add|skip|keep|going|gotta|perfect)\b/i.test(value)) return 'ACTION_INTENT';
  if (/^(?:[a-z]+ing|imagine|picture|watch|look|walk|climb|swim|drive|bring|make|show|listen)\b/i.test(value)) return 'VERB_LED';
  const withoutEnd = value.replace(/[.!?]+$/, '');
  if (!/\b(?:am|are|is|was|were|look|looks|feel|feels|want|wants|need|needs|can|could|will|would|should|might|must)\b/i.test(withoutEnd)) return 'FRAGMENT';
  return 'OTHER';
}

function wordCount(value: string): number {
  return words(value.replace(/[.!?]+$/, '')).length;
}

export function evaluateAiNoteCorpus(notes: readonly (string | null | undefined)[]): AiNoteCorpusEvaluation {
  const acceptedNotes = notes.map((note) => note?.trim() ?? '').filter(Boolean);
  const structuralFamilies = Object.fromEntries([
    'DEMONSTRATIVE_DECLARATIVE', 'FIRST_PERSON', 'QUESTION', 'FRAGMENT',
    'ACTION_INTENT', 'VERB_LED', 'COMPARISON', 'OTHER',
  ].map((family) => [family, 0])) as Record<AiNoteStructureFamily, number>;
  const exactOpeners: Record<string, number> = {};
  const prefixes: Record<string, number> = {};
  const counts: number[] = [];
  for (const note of acceptedNotes) {
    structuralFamilies[classifyAiNoteStructure(note)] += 1;
    const noteWords = words(note).map((item) => item.toLowerCase());
    const opener = noteWords.slice(0, 2).join(' ');
    const prefix = noteWords.slice(0, 3).join(' ');
    if (opener) exactOpeners[opener] = (exactOpeners[opener] ?? 0) + 1;
    if (prefix) prefixes[prefix] = (prefixes[prefix] ?? 0) + 1;
    counts.push(wordCount(note));
  }
  counts.sort((a, b) => a - b);
  const repeatedThreeWordPrefixes = Object.fromEntries(Object.entries(prefixes).filter(([, count]) => count > 2));
  const familyEntries = Object.entries(structuralFamilies) as Array<[AiNoteStructureFamily, number]>;
  familyEntries.sort((a, b) => b[1] - a[1]);
  const largest = familyEntries[0] ?? null;
  const demonstrativeDescriptiveCount = structuralFamilies.DEMONSTRATIVE_DECLARATIVE;
  const malformedCount = acceptedNotes.filter(isMalformedAiNote).length;
  const summaryLikeCount = acceptedNotes.filter(isSummaryLikeAiNote).length;
  const phraseCounts = {
    'looked unreal': acceptedNotes.filter((note) => /looked unreal/i.test(note)).length,
    'looks amazing': acceptedNotes.filter((note) => /looks amazing/i.test(note)).length,
    'looks incredible': acceptedNotes.filter((note) => /looks incredible/i.test(note)).length,
  };
  const failures: string[] = [];
  if (!acceptedNotes.length) failures.push('no accepted notes');
  if (malformedCount) failures.push(`${malformedCount} malformed note(s)`);
  if (summaryLikeCount) failures.push(`${summaryLikeCount} summary-like note(s)`);
  if (phraseCounts['looked unreal']) failures.push(`"looked unreal" occurs ${phraseCounts['looked unreal']} time(s)`);
  const middle = Math.floor(counts.length / 2);
  const medianWords = counts.length === 0 ? 0 : counts.length % 2 ? counts[middle]! : (counts[middle - 1]! + counts[middle]!) / 2;
  return {
    accepted: acceptedNotes.length,
    omitted: notes.length - acceptedNotes.length,
    averageWords: counts.length ? counts.reduce((sum, count) => sum + count, 0) / counts.length : 0,
    medianWords,
    structuralFamilies,
    exactOpeners,
    repeatedThreeWordPrefixes,
    demonstrativeDescriptiveCount,
    demonstrativeDescriptiveRate: acceptedNotes.length ? demonstrativeDescriptiveCount / acceptedNotes.length : 0,
    largestFamily: largest ? { family: largest[0], count: largest[1], rate: acceptedNotes.length ? largest[1] / acceptedNotes.length : 0 } : null,
    malformedCount,
    summaryLikeCount,
    phraseCounts,
    passed: failures.length === 0,
    failures,
  };
}

export function classifyLegacyBadAiNote(note: string | null | undefined): LegacyBadAiNoteReason | null {
  const value = note ? normalizeAiPlaceNote(note) : '';
  if (!value) return null;
  if (MALFORMED_DEMONSTRATIVE_ARTICLE.test(value)) return 'malformed_demonstrative_article';
  if (LEGACY_LOOKED_UNREAL.test(value)) return 'historical_looked_unreal_fallback';
  if (/^.+\s+looks (?:amazing|incredible|so good)[.!?]*$/i.test(value)) return 'legacy_generic_visual_filler';
  return null;
}

export function planLegacyAiNoteReenrichment(input: { aiNote: string | null | undefined; sourceType: string | null | undefined; sourceUrl: string | null | undefined }): LegacyAiNoteReenrichmentPlan {
  const reason = classifyLegacyBadAiNote(input.aiNote);
  if (!reason) return { action: 'preserve', reason: 'not_legacy_pattern' };
  const sourceType = input.sourceType?.trim().toLowerCase() ?? '';
  const sourceUrl = input.sourceUrl?.trim() ?? '';
  const supportedType = ['', 'link', 'instagram', 'tiktok', 'youtube', 'facebook', 'snapchat'].includes(sourceType);
  const supportedUrl = /^https:\/\/(?:[^/?#]+\.)?(?:instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch|snapchat\.com)\//i.test(sourceUrl);
  return sourceType === 'manual' || !supportedType || !supportedUrl
    ? { action: 'preserve', reason: 'unsupported_source' }
    : { action: 'clear_ai_note_and_rearm', reason };
}

export function evaluateAiPlaceNote(input: AiPlaceNoteInput): AiPlaceNoteResult {
  const raw = input.proposedNote?.trim() ?? '';
  if (!raw) return { note: null, status: 'not_requested', reason: null };
  const evidence = meaningfulEvidence(input);
  if (!evidence.length) return { note: null, status: 'insufficient_evidence', reason: null };
  if (JSON_SHAPE.test(raw)) return reject('invalid_format');
  const proposed = normalizeAiPlaceNote(raw);
  if (!proposed || /[{}\[\]]/.test(proposed)) return reject('invalid_format');
  const count = wordCount(proposed);
  if (count < AI_NOTE_MIN_WORDS) return reject('too_short');
  if (count > AI_NOTE_MAX_WORDS || proposed.length > AI_NOTE_MAX_CHARACTERS) return reject('too_long');
  if ((proposed.match(/[.!?](?=\s|$)/g) ?? []).length > 1) return reject('invalid_format');
  if (MALFORMED_DEMONSTRATIVE_ARTICLE.test(proposed) || LEGACY_LOOKED_UNREAL.test(proposed)) return reject('malformed_construction');
  if (EMPTY_GENERIC.test(proposed)) return reject('generic_visual_filler');
  if (SUMMARY_LIKE.test(proposed)) return reject('summary_like');
  if (META_LANGUAGE.test(proposed)) return reject('meta_language');

  const evidenceTokens = evidence.flatMap((item) => words(item.value).map(token)).filter((item) => item.length >= 3 && !GROUNDING_STOP.has(item));
  const noteTokens = words(proposed).map(token).filter((item) => item.length >= 3 && !GROUNDING_STOP.has(item));
  const hasVisualFrames = evidence.some((item) => item.source === 'frame' && /visual frames supplied/i.test(item.value));
  if (!hasVisualFrames && noteTokens.length > 0 && !noteTokens.some((candidate) => evidenceTokens.some((item) => related(candidate, item)))) {
    return reject('ungrounded_claim');
  }
  const groundingText = `${input.placeName ?? ''} ${evidence.map((item) => item.value).join(' ')}`;
  const groundedTokens = words(groundingText).map(token);
  const properNouns = words(proposed).slice(1).filter((item) =>
    /^[A-Z][\p{L}\p{N}'-]*$/u.test(item) && !/^I(?:'|$)/.test(item),
  );
  if (properNouns.some((item) => !groundedTokens.some((grounded) => related(token(item), grounded)))) return reject('ungrounded_claim');
  const numbers = words(proposed).map(token).filter((item) => /^\d+$/.test(item));
  if (numbers.some((item) => !groundedTokens.includes(item))) return reject('ungrounded_claim');
  return { note: proposed, status: 'generated', reason: null };
}

export function evaluateDeliverableAiPlaceNote(input: AiPlaceNoteInput): DeliverableAiPlaceNoteResult {
  return { ...evaluateAiPlaceNote(input), groundedFallbackUsed: false };
}

export function generateAiPlaceNote(input: AiPlaceNoteInput): string | null {
  return evaluateAiPlaceNote(input).note;
}

export function preserveUserNote(userNote: string | null | undefined, aiNote: string | null | undefined): { notes: string | null; aiNote: string | null } {
  return { notes: userNote?.trim() ? userNote.trim() : null, aiNote: aiNote?.trim() ? aiNote.trim() : null };
}

export async function persistAiNoteSupplementally(aiNote: string | null | undefined, persist: (note: string) => Promise<void>): Promise<'stored' | 'skipped' | 'failed'> {
  const note = aiNote?.trim() ?? '';
  if (!note) return 'skipped';
  try { await persist(note); return 'stored'; } catch { return 'failed'; }
}
