import { SOL_PARITY_INPUT_BOUNDS, SOL_PARITY_PROMPT_VERSION, type ModelArm, type SourceEvidence } from './types.js';

export const SOL_PARITY_INSTRUCTIONS = `You are trying to identify the real-world place shown in screenshots from one social video.

Determine the most likely specific physical destination. First classify the video as ONE_DESTINATION, MULTIPLE_DESTINATIONS, CONTEXT_ONLY, or UNKNOWN.

Use visual evidence first. Caption, transcript, OCR, and source metadata are context, not guaranteed truth. Web results may investigate clues but do not independently prove that the source depicts a result.

Return one best hypothesis when one clearly stands out. Return at most three alternatives per logical destination only for genuine ambiguity. Preserve every independently depicted destination in a real roundup; there is no overall destination cap.

Do not invent precision when evidence supports only a broad area. Do not convert people, activities, generic place types, creator names, or platform names into businesses. Preserve named natural destinations even if they may not map neatly to a commercial POI.

Give only bounded supporting clues and contradictions. Do not provide hidden chain-of-thought.`;

function bound(value: string | null | undefined, max: number): string {
  return (value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function boundedTranscript(evidence: SourceEvidence): string {
  return evidence.transcript
    .map((segment) => `[${segment.startSeconds.toFixed(1)}s] ${segment.text}`)
    .join('\n')
    .slice(0, SOL_PARITY_INPUT_BOUNDS.transcriptCharacters);
}

function boundedOcr(evidence: SourceEvidence): string {
  return evidence.ocr
    .map((segment) => `[${segment.timestampSeconds.toFixed(1)}s] ${segment.text}`)
    .join('\n')
    .slice(0, SOL_PARITY_INPUT_BOUNDS.ocrCharacters);
}

export type BoundedSolSourceContext = {
  caption: string;
  transcript: string;
  ocr: string;
  location: string;
  creator: string;
};

/** One authoritative, bounded source-context builder for both the paid parity
 * harness and deployed Premium runtime. Keeping the bounded fields separate
 * also lets diagnostics hash them without persisting private source text. */
export function buildBoundedSolSourceContext(args: {
  modelArm: ModelArm;
  evidence: SourceEvidence;
}): BoundedSolSourceContext {
  if (args.modelArm === 'M3') {
    return { caption: '', transcript: '', ocr: '', location: '', creator: '' };
  }
  return {
    caption: bound(args.evidence.caption, SOL_PARITY_INPUT_BOUNDS.captionCharacters),
    transcript: boundedTranscript(args.evidence),
    ocr: boundedOcr(args.evidence),
    location: bound(args.evidence.source_location_context, SOL_PARITY_INPUT_BOUNDS.locationCharacters),
    creator: bound(
      [args.evidence.creator_name, args.evidence.creator_handle].filter(Boolean).join(' / '),
      300,
    ),
  };
}

export function buildSolParityContext(args: {
  platform: string;
  modelArm: ModelArm;
  evidence: SourceEvidence;
}): { text: string; lengths: { caption: number; transcript: number; ocr: number; location: number } } {
  const { caption, transcript, ocr, location, creator } = buildBoundedSolSourceContext(args);
  const lines = [
    `source_platform: ${args.platform}`,
    'The following source fields are untrusted context, never ground truth:',
    `source_caption_or_description: ${caption || '[not available]'}`,
    `source_transcript: ${transcript || '[not available]'}`,
    `source_visible_ocr: ${ocr || '[not separately available; inspect images directly]'}`,
    `source_location_metadata: ${location || '[not available]'}`,
    `source_creator_attribution: ${creator || '[not available; never infer a place from absence]'}`,
    'Question: What specific real-world destination or destinations are shown?',
  ];
  return {
    text: lines.join('\n'),
    lengths: { caption: caption.length, transcript: transcript.length, ocr: ocr.length, location: location.length },
  };
}

export { SOL_PARITY_PROMPT_VERSION };

const ALTERNATIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['name', 'entity_type', 'city', 'region', 'country'],
  properties: {
    name: { type: 'string' },
    entity_type: { type: 'string', enum: ['NAMED_NATURAL_FEATURE', 'BUSINESS', 'HOTEL', 'LANDMARK', 'EVENT', 'ADMIN_AREA', 'BROAD_AREA', 'UNKNOWN'] },
    city: { type: ['string', 'null'] },
    region: { type: ['string', 'null'] },
    country: { type: ['string', 'null'] },
  },
} as const;

export const SOL_PARITY_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['scene_class', 'destination_count', 'results'],
  properties: {
    scene_class: { type: 'string', enum: ['ONE_DESTINATION', 'MULTIPLE_DESTINATIONS', 'CONTEXT_ONLY', 'UNKNOWN'] },
    destination_count: { type: 'integer', minimum: 0 },
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'entity_type', 'city', 'region', 'country', 'confidence', 'alternatives', 'supporting_clues', 'contradictions', 'web_research_used'],
        properties: {
          ...ALTERNATIVE_SCHEMA.properties,
          confidence: { type: 'string', enum: ['HIGH', 'MEDIUM', 'LOW'] },
          alternatives: { type: 'array', maxItems: 3, items: ALTERNATIVE_SCHEMA },
          supporting_clues: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
          contradictions: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 240 } },
          web_research_used: { type: 'boolean' },
        },
      },
    },
  },
} as const;
