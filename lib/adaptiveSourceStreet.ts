/** Literal source-only retrieval hints. No providers, scoring, canonicalization, or auto-save. */
import type { Evidence } from '../supabase/functions/process-share-link/evidence/extractEvidence.ts';
import type { VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions.ts';
import type { MediaPlaceEvidence } from '../supabase/functions/process-share-jobs/mediaEvidence.ts';
import { parseAdaptiveRecognitionConfig, type AdaptiveRecognitionConfig } from './adaptiveRecognitionConfig.ts';

export const ADAPTIVE_STREET_VERSION = 'adaptive-literal-source-street.v1';
export type LiteralSourceText = { id: string; kind: 'title' | 'caption' | 'transcript' | 'ocr'; text: string };
export type LiteralStreetSpan = { sourceId: string; sourceKind: LiteralSourceText['kind']; start: number; end: number; raw: string; normalized: string };
export type LiteralStreetHint = { version: typeof ADAPTIVE_STREET_VERSION; retrievalOnly: true; street: string; spans: LiteralStreetSpan[] };
export type AdaptiveStreetMention = VenueMention & { adaptiveSourceStreet?: LiteralStreetHint };
type Prepared = { mediaEvidence: Evidence; mediaMentions: { mentions: VenueMention[] } };
const fold = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/\s+/g, ' ').trim();
const PREFIX = new Set(['rue', 'avenue', 'av', 'boulevard', 'bd', 'blvd', 'calle', 'via', 'rua', 'estrada', 'plaza', 'piazza', 'chemin', 'quai', 'cours']);
const SUFFIX = new Set(['street', 'st', 'road', 'rd', 'avenue', 'ave', 'boulevard', 'blvd', 'lane', 'ln', 'drive', 'dr', 'court', 'ct', 'way', 'place', 'pl', 'terrace', 'square']);
const STOP = new Set(['at', 'in', 'on', 'where', 'which', 'with', 'is', 'was', 'and', 'but', 'near', 'opposite', 'today', 'now', 'visit', 'follow', 'subscribe', 'best', 'shops']);
const ALIASES: Record<string, string> = { av: 'avenue', ave: 'avenue', bd: 'boulevard', blvd: 'boulevard', st: 'street', rd: 'road', ln: 'lane', dr: 'drive', ct: 'court', pl: 'place' };
const streetKey = (s: string) => fold(s).split(' ').map((w) => ALIASES[w] ?? w).join(' ');
const BUSINESS = new Set(['restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert', 'hotel', 'resort', 'shopping', 'museum', 'entertainment', 'nightlife', 'fitness', 'wellness', 'education', 'service']);
const BLOCKED_ROLES = new Set(['BRAND', 'PERSON_CREATOR', 'PRODUCT', 'EVENT_TOUR', 'AMBIGUOUS']);

function checkedSources(sources: readonly LiteralSourceText[]): void {
  if (sources.some((s) => !s || typeof s.text !== 'string') || sources.length > 8 || sources.reduce((n, s) => n + s.text.length, 0) > 80_000 ||
      new Set(sources.map((s) => s.id)).size !== sources.length || sources.some((s) =>
        !/^[a-z][a-z0-9_-]{0,39}$/.test(s.id) || !['title', 'caption', 'transcript', 'ocr'].includes(s.kind) ||
        typeof s.text !== 'string' || s.text.length > 40_000)) throw new Error('invalid_literal_street_sources');
}

/** Bounded numbered streets; provenance offsets address the unmodified source string. */
export function extractLiteralStreetSpans(sources: readonly LiteralSourceText[]): LiteralStreetSpan[] {
  checkedSources(sources); const spans: LiteralStreetSpan[] = [];
  for (const source of sources) {
    const starts = source.text.matchAll(/(?<![\p{L}\p{N}])#?\d{1,5}[a-z]?(?:\s+(?:bis|ter))?\s+/giu);
    let attempts = 0;
    for (const start of starts) {
      if (++attempts > 128 || spans.length >= 20) break;
      const offset = start.index!, bodyStart = offset + start[0].length;
      const fragment = source.text.slice(bodyStart, bodyStart + 140).split(/[,;\n\r!?]/, 1)[0]!;
      const words = [...fragment.matchAll(/[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N}'’.-]*/gu)];
      if (!words.length || words[0]!.index !== 0) continue;
      let last = -1;
      if (PREFIX.has(fold(words[0]![0]))) {
        for (let i = 1; i < words.length && i <= 7; i++) {
          const word = words[i]![0]; if (STOP.has(fold(word))) break;
          last = i; if (word.endsWith('.')) break;
        }
        if (last < 1 || last > 6) continue;
      } else {
        for (let i = 1; i < words.length && i <= 6; i++) {
          if (STOP.has(fold(words[i - 1]![0]))) break;
          if (SUFFIX.has(fold(words[i]![0]))) { last = i; break; }
        }
        if (last < 1) continue;
      }
      let end = bodyStart + words[last]!.index! + words[last]![0].length;
      if (source.text[end - 1] === '.') end--;
      const raw = source.text.slice(offset, end);
      if (raw.length > 120 || /\b(?:years?|hours?|minutes?|miles?|kilomet(?:er|re)s?)\b/i.test(raw)) continue;
      spans.push({ sourceId: source.id, sourceKind: source.kind, start: offset, end, raw, normalized: streetKey(raw) });
    }
  }
  return spans;
}

function clause(source: LiteralSourceText, span: LiteralStreetSpan): string {
  const prior = source.text.slice(Math.max(0, span.start - 260), span.start);
  const begin = Math.max(prior.lastIndexOf('\n'), prior.lastIndexOf(';'), prior.lastIndexOf('!'), prior.lastIndexOf('?')) + 1;
  const after = source.text.slice(span.end, span.end + 120).split(/[;\r\n!?]/, 1)[0]!;
  return prior.slice(begin) + span.raw + after;
}
function nameTokens(mention: VenueMention): string[] {
  const geo = new Set(fold([mention.geo.city, mention.geo.region, mention.geo.country].filter(Boolean).join(' ')).split(' '));
  return [...new Set(mention.distinctiveTokens.flatMap((s) => fold(s).split(' ')).filter((s) => s.length > 1 && !geo.has(s)))];
}
function hasTokens(text: string, tokens: string[]): boolean {
  const words = new Set(fold(text).split(' ')); return tokens.length > 0 && tokens.every((w) => words.has(w));
}
function unsafeClause(text: string): boolean {
  return /\b(?:not|old|former|previous|closed|avoid|headquarters|mailing|shipping|billing)\b|\bmoved\s+from\b|\b(?:filmed|shot|sponsored|powered|presented|tour)\s+by\b/i.test(text);
}

export function applyLiteralSourceStreetEvidence<T extends Prepared>(args: {
  prepared: T;
  sources: readonly LiteralSourceText[];
  groundedEvidence: Pick<MediaPlaceEvidence, 'places'>;
  config?: AdaptiveRecognitionConfig;
}): { input: T; trace: { version: string; enabled: boolean; hints: Array<{ mentionId: string; hint: LiteralStreetHint }>; rejected: Array<{ mentionId: string; reason: string }> } } {
  const config = parseAdaptiveRecognitionConfig(args.config);
  const trace = { version: ADAPTIVE_STREET_VERSION, enabled: config.literalSourceStreet,
    hints: [] as Array<{ mentionId: string; hint: LiteralStreetHint }>, rejected: [] as Array<{ mentionId: string; reason: string }> };
  if (!config.literalSourceStreet) return { input: args.prepared, trace };
  const original = args.prepared.mediaMentions.mentions;
  let spans: LiteralStreetSpan[];
  try { spans = extractLiteralStreetSpans(args.sources); }
  catch {
    trace.rejected = original.map((m) => ({ mentionId: m.id, reason: 'literal_source_bounds_or_shape_invalid' }));
    return { input: args.prepared, trace };
  }
  const sources = new Map(args.sources.map((s) => [s.id, s]));
  const allText = args.sources.map((s) => s.text).join('\n');
  const reject = (mention: VenueMention, reason: string) => { trace.rejected.push({ mentionId: mention.id, reason }); return mention; };
  const mentions: AdaptiveStreetMention[] = original.map((mention) => {
    if (mention.identityEvidenceKind === 'model_prior' || mention.creatorHandleEvidenceOnly || mention.resolutionMode === 'geographic' ||
        !BUSINESS.has(mention.category ?? '') || BLOCKED_ROLES.has(args.prepared.mediaEvidence.placeNameRole ?? '') ||
        !(mention.nameEvidenceCount || mention.nameEvidenceSources.some((s) => ['caption', 'speech', 'visible_text'].includes(s)))) return reject(mention, 'identity_role_not_eligible');
    const tokens = nameTokens(mention);
    const badRole = (args.prepared.mediaEvidence.entityRoles ?? []).some((e) => BLOCKED_ROLES.has(e.role) &&
      (fold(e.value) === fold(mention.displayName) || fold(e.normalizedValue) === tokens.join('')));
    if (badRole || !hasTokens(allText, tokens)) return reject(mention, 'source_name_not_literal_or_role_limited');
    if (original.length === 1 && new Set(spans.map((s) => s.normalized)).size > 1) return reject(mention, 'conflicting_literal_streets');
    let relevant = spans.filter((span) => {
      const text = clause(sources.get(span.sourceId)!, span);
      if (unsafeClause(text)) return false;
      // Even a singleton must have its distinctive name locally beside the address.
      // This blocks a recommendation for another named venue elsewhere in the caption.
      if (original.length === 1) return tokens.some((token) => hasTokens(text, [token]));
      if (!hasTokens(text, tokens)) return false;
      return !original.some((other) => other.id !== mention.id && hasTokens(text, nameTokens(other)));
    });
    const unique = new Set(relevant.map((s) => s.normalized));
    if (unique.size !== 1) return reject(mention, unique.size > 1 ? 'conflicting_literal_streets' : 'no_unambiguous_literal_street');
    const modeled = args.groundedEvidence.places.filter((p) => [mention.displayName, mention.primaryVenueName].some((name) => name && fold(name) === fold(p.name)));
    if (modeled.some((p) => p.address && !unique.has(streetKey(p.address.split(',', 1)[0]!)))) return reject(mention, 'model_address_conflicts_with_literal_source');
    relevant = relevant.slice(0, 8);
    const hint: LiteralStreetHint = { version: ADAPTIVE_STREET_VERSION, retrievalOnly: true, street: relevant[0]!.raw, spans: relevant };
    trace.hints.push({ mentionId: mention.id, hint });
    return { ...mention, adaptiveSourceStreet: hint };
  });
  if (!trace.hints.length) return { input: args.prepared, trace };
  // Do not set evidence.address/address_verified: that invokes different verification/save lanes.
  return { input: { ...args.prepared, mediaMentions: { ...args.prepared.mediaMentions, mentions } }, trace };
}

/** Hook only at nameDrivenResolver.buildMentionQuery; all ranking/veto logic stays intact. */
export function appendLiteralStreetToQuery(baseQuery: string, mention: VenueMention, config?: AdaptiveRecognitionConfig): string {
  if (!parseAdaptiveRecognitionConfig(config).literalSourceStreet) return baseQuery;
  const hint = (mention as AdaptiveStreetMention).adaptiveSourceStreet;
  if (!hint || hint.version !== ADAPTIVE_STREET_VERSION || hint.retrievalOnly !== true || !hint.spans.length ||
      hint.street.length > 120 || !hint.spans.every((s) => s.normalized === streetKey(hint.street) &&
        s.normalized === streetKey(s.raw) && s.end - s.start === s.raw.length)) return baseQuery;
  if (streetKey(baseQuery).includes(streetKey(hint.street))) return baseQuery;
  return `${baseQuery} ${hint.street.replace(/^#/, '')}`.replace(/\s+/g, ' ').trim();
}
