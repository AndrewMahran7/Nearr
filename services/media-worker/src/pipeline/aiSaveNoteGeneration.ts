import type { AnalyzeOutput } from '../providers/model.js';

export type AiSaveNoteGenerationOutcome =
  | 'accepted'
  | 'accepted_after_retry'
  | 'omitted_provider_failure'
  | 'omitted_invalid_after_retry';

export type AiSaveNoteGenerationResult = {
  analysis: AnalyzeOutput | null;
  lastOutput: AnalyzeOutput | null;
  attempts: 1 | 2;
  retried: boolean;
  outcome: AiSaveNoteGenerationOutcome;
};

const STOP_WORDS = new Set([
  'and', 'are', 'for', 'from', 'has', 'have', 'look', 'looked', 'looks', 'save',
  'someone', 'that', 'the', 'this', 'those', 'with', 'worth', 'would', 'place',
]);

function tokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9]+/g) ?? [])
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

function related(left: string, right: string): boolean {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  return left.startsWith(right) || right.startsWith(left);
}

/** Lightweight safety check used only to decide whether to spend the one
 * repair call. The Edge finalizer repeats the authoritative validation. */
function hasAcceptableCandidate(output: AnalyzeOutput): boolean {
  return output.evidence.places.some((place) => {
    const note = place.memoryCue?.trim() ?? '';
    const words = note.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [];
    const evidenceText = `${place.name ?? ''} ${place.memoryCueEvidence.map((item) => item.value).join(' ')}`;
    const evidenceTokens = tokens(evidenceText);
    const noteTokens = tokens(note);
    const hasVisualFrames = place.memoryCueEvidence.some((item) =>
      item.source === 'frame' && /visual frames supplied/i.test(item.value));
    const properNouns = words.slice(1).filter((word) =>
      /^[A-Z][\p{L}\p{N}'-]*$/u.test(word) && !/^I(?:'|$)/.test(word));
    const numbers = words.filter((word) => /^\d+$/.test(word));
    return place.memoryCueEvidence.some((item) => item.value.trim().length >= 3) &&
      // Spend the repair call when the model misses the prompt's 20-word
      // target; Edge remains slightly more permissive at 24 words.
      words.length >= 3 && words.length <= 20 && note.length <= 180 &&
      !/^[\[{]|[{}\[\]]/.test(note) &&
      !/^That\s+.+\s+looked unreal[.!?]*$/i.test(note) &&
      !/^(?:that|those)\s+(?:the|a|an|this|that|these|those)\b/i.test(note) &&
      !/^(?:(?:that|this|it|the place)\s+)?(?:looks?|looked|is|was)\s+(?:amazing|incredible|unreal|awesome|beautiful|great|so good)[.!?]*$/i.test(note) &&
      !/\b(?:as an ai|ai assistant|language model|the user|the creator|nearr|provided evidence|supplied evidence|my analysis)\b/i.test(note) &&
      !/^(?:the|this)\s+(?:video|post|reel)\b|\b(?:video|post|reel)\s+(?:shows|showcases|features|highlights|is about)\b/i.test(note) &&
      (note.match(/[.!?](?=\s|$)/g) ?? []).length <= 1 &&
      (hasVisualFrames || noteTokens.length === 0 || noteTokens.some((candidate) => evidenceTokens.some((item) => related(candidate, item)))) &&
      properNouns.every((word) => tokens(word).some((candidate) => evidenceTokens.some((item) => related(candidate, item)))) &&
      numbers.every((number) => evidenceTokens.includes(number));
  });
}

/** Exactly one normal attempt plus at most one repair; rejected prose is never
 * passed into the repair call. */
export async function generateAiSaveNoteWithRetry(
  initial: () => Promise<AnalyzeOutput>,
  repair: () => Promise<AnalyzeOutput>,
  onOutput?: (output: AnalyzeOutput) => void,
): Promise<AiSaveNoteGenerationResult> {
  let first: AnalyzeOutput | null = null;
  try {
    first = await initial();
    onOutput?.(first);
    if (hasAcceptableCandidate(first)) {
      return { analysis: first, lastOutput: first, attempts: 1, retried: false, outcome: 'accepted' };
    }
  } catch {
    // A provider failure gets the same one bounded retry as invalid output.
  }
  try {
    const second = await repair();
    onOutput?.(second);
    return hasAcceptableCandidate(second)
      ? { analysis: second, lastOutput: second, attempts: 2, retried: true, outcome: 'accepted_after_retry' }
      : { analysis: null, lastOutput: second, attempts: 2, retried: true, outcome: 'omitted_invalid_after_retry' };
  } catch {
    return { analysis: null, lastOutput: first, attempts: 2, retried: true, outcome: 'omitted_provider_failure' };
  }
}
