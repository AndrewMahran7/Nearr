/**
 * lib/aiPlaceNote.ts
 *
 * Conservative source-grounded note generation. This is intentionally not a
 * free-form marketing writer: it only returns a short sentence from evidence
 * Nearr already extracted, and returns null when the evidence is not useful.
 *
 * The resulting text belongs in `saved_places.ai_note`; it must never replace a
 * user's explicit `saved_places.notes` value.
 */

export type AiPlaceNoteInput = {
  placeName: string | null | undefined;
  category?: string | null;
  /** Direct caption/transcript/visible-text evidence, not model reasoning. */
  evidence?: readonly string[] | null;
};

const MAX_NOTE_LENGTH = 180;
const UNSUPPORTED_ONLY = /^(?:here|this|look|check|wow|nice|great|love|visit|must see)[.! ]*$/i;
const ADDRESS_ONLY = /^\d{1,6}\s+[^,]+(?:,|$)/i;

function cleanEvidence(value: string): string | null {
  const cleaned = value.replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');
  if (!cleaned || cleaned.length < 8 || UNSUPPORTED_ONLY.test(cleaned) || ADDRESS_ONLY.test(cleaned)) {
    return null;
  }
  return cleaned.length > MAX_NOTE_LENGTH ? `${cleaned.slice(0, MAX_NOTE_LENGTH - 1).trim()}…` : cleaned;
}

/**
 * Build one concise note only when direct source evidence says something useful.
 * The wording is attributional rather than probabilistic: it does not claim a
 * fact that is absent from the source evidence.
 */
export function generateAiPlaceNote(input: AiPlaceNoteInput): string | null {
  const evidence = (input.evidence ?? []).map(cleanEvidence).filter((v): v is string => !!v);
  if (evidence.length === 0) return null;
  const first = evidence[0]!;
  const placeName = (input.placeName ?? '').trim();
  if (/^(known for|scenic|luxury|best known for)\b/i.test(first)) return `${first}.`;
  if (!placeName) return `From the shared post: ${first}.`;
  if (first.toLowerCase().includes(placeName.toLowerCase())) return `${first}.`;
  return `From the shared post: ${first}.`;
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
