import type { EvidenceItem } from '../types/evidence.js';

export const AI_NOTE_PROMPT_VERSION = 'nearr-ai-save-reason-2026-09-05.v16';

export const AI_SAVE_NOTE_SYSTEM_PROMPT = `You write the short personal note attached to a place someone saved from a social video.

Using only the evidence provided, answer this question:

"Why would someone save this video?"

Return exactly one short natural sentence describing the most compelling reason to remember or visit what is shown.

Rules:
- Sound like a normal person, not an assistant.
- Focus on the specific thing that made the content worth saving.
- Prefer concrete visual or content details over generic praise.
- Do not summarize the whole video.
- Do not mention "the video", "the user", "the creator", "Nearr", or AI.
- Do not invent facts not supported by the evidence.
- Do not add quotation marks.
- Do not add labels or JSON.
- Keep it concise, roughly 6-20 words.
- Never use the construction "That ... looked unreal."
- Never begin with "That" merely to force a sentence template.
- Avoid empty phrases like "looks amazing", "looks incredible", or "must visit" unless paired with a concrete reason.`;

export const AI_SAVE_NOTE_REPAIR_PROMPT =
  'Write one short natural reason someone would save this content. Use only the supplied evidence. Return one sentence and nothing else.';

function bounded(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '(none)';
}

export function buildAiNoteUserContext(input: {
  platform: string;
  targetPlace: { name: string; category?: string | null; formattedAddress?: string | null };
  transcriptText: string;
  ocrText: string;
  ocrExtracted?: boolean;
  metadataTitle?: string | null;
  metadataDescription?: string | null;
  retainedEvidence?: readonly EvidenceItem[];
  attempt?: 'initial' | 'repair';
}): string {
  const retained = (input.retainedEvidence ?? []).slice(0, 16).map((item) => ({
    source: item.source,
    value: bounded(item.value, 240),
    timestampSeconds: typeof item.timestampSeconds === 'number' ? item.timestampSeconds : null,
  }));
  const evidence = {
    platform: bounded(input.platform, 40),
    finalSavedPlace: {
      name: bounded(input.targetPlace.name, 200),
      category: bounded(input.targetPlace.category, 80),
      formattedAddress: bounded(input.targetPlace.formattedAddress, 300),
    },
    retainedObservations: retained,
    transcript: bounded(input.transcriptText, 4_000),
    visibleText: input.ocrText
      ? bounded(input.ocrText, 2_000)
      : input.ocrExtracted
        ? '(none detected by OCR)'
        : '(inspect the supplied frames)',
    captionTitle: bounded(input.metadataTitle, 500),
    captionText: bounded(input.metadataDescription, 2_000),
  };
  return [
    input.attempt === 'repair' ? AI_SAVE_NOTE_REPAIR_PROMPT : 'Why would someone save this video?',
    'The saved-place identity is context only. Focus on the compelling source detail, not the place name.',
    '<untrusted_saved_post_evidence>',
    JSON.stringify(evidence),
    '</untrusted_saved_post_evidence>',
    'Return only the sentence.',
  ].join('\n');
}
