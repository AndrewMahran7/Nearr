import { SOL_PARITY_INPUT_BOUNDS, type Confidence, type EntityType, type SceneClass, type SolAlternative, type SolDestination, type SolParityPayload } from './types.js';

const SCENES = new Set<SceneClass>(['ONE_DESTINATION', 'MULTIPLE_DESTINATIONS', 'CONTEXT_ONLY', 'UNKNOWN']);
const ENTITIES = new Set<EntityType>(['NAMED_NATURAL_FEATURE', 'BUSINESS', 'HOTEL', 'LANDMARK', 'EVENT', 'ADMIN_AREA', 'BROAD_AREA', 'UNKNOWN']);
const CONFIDENCE = new Set<Confidence>(['HIGH', 'MEDIUM', 'LOW']);

function text(value: unknown, max = 300): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized ? normalized.slice(0, max) : null;
}

function nullableText(value: unknown): string | null {
  return value === null ? null : text(value, 160);
}

function alternative(value: unknown): SolAlternative | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const name = text(raw.name, 200);
  if (!name || !ENTITIES.has(raw.entity_type as EntityType)) return null;
  return {
    name,
    entity_type: raw.entity_type as EntityType,
    city: nullableText(raw.city),
    region: nullableText(raw.region),
    country: nullableText(raw.country),
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => text(item, SOL_PARITY_INPUT_BOUNDS.clueCharacters)).filter((item): item is string => !!item).slice(0, SOL_PARITY_INPUT_BOUNDS.clueItems)
    : [];
}

function destination(value: unknown): SolDestination | null {
  const base = alternative(value);
  if (!base || !value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!CONFIDENCE.has(raw.confidence as Confidence)) return null;
  return {
    ...base,
    confidence: raw.confidence as Confidence,
    alternatives: Array.isArray(raw.alternatives)
      ? raw.alternatives.map(alternative).filter((item): item is SolAlternative => !!item).slice(0, 3)
      : [],
    supporting_clues: stringList(raw.supporting_clues),
    contradictions: stringList(raw.contradictions),
    web_research_used: raw.web_research_used === true,
  };
}

export function parseSolParityPayload(value: unknown): SolParityPayload | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (!SCENES.has(raw.scene_class as SceneClass) || !Array.isArray(raw.results)) return null;
  const results = raw.results.map(destination).filter((item): item is SolDestination => !!item);
  if (results.length !== raw.results.length) return null;
  const expectedCount = raw.scene_class === 'CONTEXT_ONLY' || raw.scene_class === 'UNKNOWN' ? 0 : results.length;
  if (typeof raw.destination_count !== 'number' || !Number.isInteger(raw.destination_count)) return null;
  if (raw.destination_count !== expectedCount) return null;
  if (raw.scene_class === 'ONE_DESTINATION' && results.length !== 1) return null;
  if (raw.scene_class === 'MULTIPLE_DESTINATIONS' && results.length < 2) return null;
  return { scene_class: raw.scene_class as SceneClass, destination_count: raw.destination_count, results };
}

export function extractResponsesText(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const raw = body as Record<string, unknown>;
  if (typeof raw.output_text === 'string') return raw.output_text;
  const chunks: string[] = [];
  for (const item of Array.isArray(raw.output) ? raw.output : []) {
    if (!item || typeof item !== 'object') continue;
    for (const part of Array.isArray((item as Record<string, unknown>).content) ? (item as Record<string, unknown>).content as unknown[] : []) {
      if (part && typeof part === 'object' && typeof (part as Record<string, unknown>).text === 'string') chunks.push((part as Record<string, unknown>).text as string);
    }
  }
  return chunks.join('');
}
