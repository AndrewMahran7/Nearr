import test from 'node:test';
import assert from 'node:assert/strict';
import { MediaPlaceEvidence } from '../src/types/evidence.js';
import { evaluateNormalResultSpecificity } from '../src/automaticDeep/normalResultSpecificity.js';
import { evaluateAdaptiveNormalSpecificity as adaptiveSpecificity, type AdaptiveSpecificitySource } from '../src/automaticDeep/adaptiveNormalSpecificity.js';
import { withAutomaticDeepRecognition } from '../src/automaticDeep/automaticDeepRecognitionProvider.js';
import { extendMentionQuery, resolveVenueMentions } from '../../../supabase/functions/process-share-link/resolver/nameDrivenResolver.ts';
import type { AnalyzeInput, ModelProvider } from '../src/providers/model.js';
import type { WorkerConfig } from '../src/config/env.js';
import { BASELINE_ADAPTIVE_CONFIG, parseAdaptiveRecognitionConfig } from '../../../lib/adaptiveRecognitionConfig.ts';
import { applyLiteralSourceStreetEvidence, appendLiteralStreetToQuery, extractLiteralStreetSpans,
  type LiteralSourceText, type AdaptiveStreetMention } from '../../../lib/adaptiveSourceStreet.ts';
import { prepareMediaResolverInput } from '../../../supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts';
import { parseMediaSourceMetadata } from '../../../supabase/functions/process-share-jobs/mediaSourceMetadata.ts';
import { evaluateMediaAutoSave } from '../../../supabase/functions/process-share-jobs/mediaAutoSaveGate.ts';
import type { MentionResult } from '../../../supabase/functions/process-share-link/resolver/nameDrivenResolver.ts';
import type { VenueMention } from '../../../supabase/functions/process-share-jobs/mediaMentions.ts';

const taxonomy = { version: 1 as const, taxonomyCompatibility: true, literalSourceStreet: false };
const street = { version: 1 as const, taxonomyCompatibility: false, literalSourceStreet: true };
const both = { version: 1 as const, taxonomyCompatibility: true, literalSourceStreet: true };
function evaluateAdaptiveNormalSpecificity(input: Parameters<typeof adaptiveSpecificity>[0], config?: Parameters<typeof adaptiveSpecificity>[1], source?: AdaptiveSpecificitySource) {
  const observed = source ?? { metadataDescription: input.evidence.places.flatMap((p) => p.explicitEvidence.filter((e) => e.source === 'caption').map((e) => e.value)).join('\n'), transcript: [], ocr: [], ocrExtracted: false };
  return adaptiveSpecificity(input, config, observed);
}
const makePlace = (overrides: Record<string, unknown> = {}) => ({ name: 'Silver Lantern Cafe', category: 'cafe',
  address: null, city: 'Westhaven', region: 'North Coast', country: 'Testland', role: 'primary', confidence: .99,
  explicitEvidence: [{ source: 'caption', value: 'Silver Lantern Cafe, Westhaven', timestampSeconds: 0 }], ...overrides });
const evidence = (places: Record<string, unknown>[], rest: Record<string, unknown> = {}) => MediaPlaceEvidence.parse({ places, ...rest });
function natural(category = 'hiking_trail', observed = 'natural_water', name = 'Copper Finch Trail') {
  return { evidence: evidence([makePlace({ name, category, sceneSignature: { environmentType: observed },
    explicitEvidence: [{ source: 'caption', value: `A visit to ${name}.`, timestampSeconds: 0 }] })]) };
}
const source = (text: string, id = 'caption', kind: LiteralSourceText['kind'] = 'caption'): LiteralSourceText => ({ id, kind, text });
function prepared(text = 'Silver Lantern Cafe at 42 Rue des Lanternes, Westhaven.', address: string | null = '42 Rue des Lanternes') {
  const groundedEvidence = evidence([makePlace({ address, explicitEvidence: [{ source: 'caption', value: text, timestampSeconds: 0 }] })]);
  const input = prepareMediaResolverInput({ platform: 'unknown', groundedEvidence,
    sourceMetadata: parseMediaSourceMetadata({ description: text }) });
  return { prepared: input, groundedEvidence, sources: [source(text)] };
}

test('strict independent ablation flags default to unchanged baseline', () => {
  assert.deepEqual(parseAdaptiveRecognitionConfig(), BASELINE_ADAPTIVE_CONFIG);
  for (const bad of [null, {}, { ...taxonomy, unknown: true }, { ...taxonomy, taxonomyCompatibility: 1 }, { ...taxonomy, version: 2 }])
    assert.throws(() => parseAdaptiveRecognitionConfig(bad), /invalid_adaptive/);
  const input = natural(), original = structuredClone(input);
  assert.deepEqual(evaluateAdaptiveNormalSpecificity(input).specificity, evaluateNormalResultSpecificity(input));
  assert.deepEqual(evaluateAdaptiveNormalSpecificity(input, street).specificity, evaluateNormalResultSpecificity(input));
  assert.deepEqual(input, original);
  const args = prepared(), result = applyLiteralSourceStreetEvidence({ ...args, config: taxonomy });
  assert.equal(result.input, args.prepared); assert.equal(result.trace.enabled, false);
});

test('bounded natural category compatibility does not rewrite evidence', () => {
  for (const [category, environment, name] of [
    ['hiking_trail', 'natural_water', 'Copper Finch Trail'], ['beach', 'natural_land', 'Amber Cove Beach'],
    ['waterfall', 'natural_land', 'Glasswing Falls'], ['lake', 'natural_land', 'Stillwater Lake Pool'],
  ]) {
    const input = natural(category, environment, name), original = structuredClone(input);
    assert.equal(evaluateNormalResultSpecificity(input).specific, false);
    const result = evaluateAdaptiveNormalSpecificity(input, taxonomy);
    assert.equal(result.specificity.specific, true, name); assert.equal(result.trace.changed, true);
    assert.equal(result.trace.adjustments[0]?.observed, environment); assert.deepEqual(input, original);
  }
});

test('taxonomy keeps technical, broad geography, generic, parent and incomplete-multi refusals', () => {
  const cases = [
    { ...natural(), recognitionFailureClass: 'model_provider_failure' as const },
    natural('beach', 'natural_land', 'Westhaven'),
    natural('hiking_trail', 'natural_water', 'a hiking trail'),
    natural('hiking_trail', 'natural_water', 'Cedar National Park'),
    { ...natural(), terminalDecision: 'needs_help' },
  ];
  for (const input of cases) assert.equal(evaluateAdaptiveNormalSpecificity(input, taxonomy).specificity.specific, false);
  const multi = natural();
  multi.evidence.multipleIntentionalPlaces = true;
  multi.evidence.partialPlaces.push({ nameHint: 'another stop', category: null, categoryConfidence: 0, categoryEvidenceTags: [], addressHint: null,
    city: null, region: null, country: null, role: 'secondary', confidence: .2,
    explicitEvidence: [{ source: 'frame', value: 'a second different setting', timestampSeconds: 3 }], validationErrors: ['missing_name'] });
  assert.equal(evaluateAdaptiveNormalSpecificity(multi, taxonomy).specificity.rejectionReason, 'INCOMPLETE_MULTI_PLACE');
});

test('taxonomy requires literal natural identity, never confidence or a model prior', () => {
  for (const update of [
    { explicitEvidence: [{ source: 'frame', value: 'looks like Copper Finch Trail' }] },
    { identityEvidenceKind: 'model_prior' }, { role: 'passing_mention' },
    { explicitEvidence: [{ source: 'caption', value: 'Sponsored by Copper Finch Trail' }] },
    { name: 'Jordan Vale', explicitEvidence: [{ source: 'caption', value: 'Filmed by Jordan Vale' }] },
    { name: 'Nimbus Gear', explicitEvidence: [{ source: 'caption', value: 'Using Nimbus Gear' }] },
  ]) {
    const base = natural().evidence.places[0]!;
    const input = { evidence: evidence([{ ...base, ...update }]) };
    assert.equal(evaluateAdaptiveNormalSpecificity(input, taxonomy).specificity.specific, false);
  }
  assert.equal(evaluateAdaptiveNormalSpecificity(natural('cafe', 'natural_water', 'Copper Finch Cafe'), taxonomy).specificity.specific, false);
  const input = natural(); input.evidence.places.push(...natural('hotel', 'natural_water', 'Silver Hotel').evidence.places);
  assert.equal(evaluateAdaptiveNormalSpecificity(input, taxonomy).specificity.specific, false);
});

test('street parser preserves raw offsets and conservative language variants', () => {
  const sources = [source('Silver Lantern Cafe at #42 Bd des Lanternes, Westhaven.'),
    source('Visit 88 Willow Street in Westhaven.', 'speech', 'transcript'),
    source('Casa Verde, 17 Calle de la Luna, Puerto Claro.', 'ocr', 'ocr')];
  const spans = extractLiteralStreetSpans(sources);
  assert.deepEqual(spans.map((s) => s.raw), ['#42 Bd des Lanternes', '88 Willow Street', '17 Calle de la Luna']);
  for (const span of spans) assert.equal(sources.find((s) => s.id === span.sourceId)!.text.slice(span.start, span.end), span.raw);
  assert.deepEqual(extractLiteralStreetSpans([source('Top 5 cafes, 2026 memories, 12 miles away, phone 5551234567')]), []);
  assert.throws(() => extractLiteralStreetSpans([source('42 Elm Street'), source('42 Elm Street')]), /invalid_literal/);
});

test('literal street propagates to query while identity, flags and legacy address lanes stay unchanged', () => {
  const args = prepared(), original = structuredClone(args), result = applyLiteralSourceStreetEvidence({ ...args, config: street });
  assert.equal(result.trace.hints.length, 1);
  const mention = result.input.mediaMentions.mentions[0]!;
  assert.equal(appendLiteralStreetToQuery('Silver Lantern Cafe Westhaven Testland', mention, street), 'Silver Lantern Cafe Westhaven Testland 42 Rue des Lanternes');
  assert.equal(appendLiteralStreetToQuery('base', mention), 'base');
  assert.equal(appendLiteralStreetToQuery('base 42 Rue des Lanternes', mention, street), 'base 42 Rue des Lanternes');
  const { adaptiveSourceStreet: ignored, ...identity } = mention as AdaptiveStreetMention;
  assert.deepEqual(identity, args.prepared.mediaMentions.mentions[0]);
  assert.equal(result.input.mediaEvidence, args.prepared.mediaEvidence);
  assert.deepEqual(args, original);
});

test('address cannot come from rendered model text and conflicting model house numbers stay blocked', () => {
  const modeled = prepared('Silver Lantern Cafe in Westhaven.', '142 Rue des Lanternes');
  assert.equal(applyLiteralSourceStreetEvidence({ ...modeled, config: street }).trace.hints.length, 0);
  const conflict = prepared('Silver Lantern Cafe at 42 Rue des Lanternes, Westhaven.', '142 Rue des Lanternes');
  const result = applyLiteralSourceStreetEvidence({ ...conflict, config: street });
  assert.equal(result.trace.hints.length, 0); assert.ok(result.trace.rejected.some((r) => r.reason === 'model_address_conflicts_with_literal_source'));
  const noName = prepared(); noName.sources = [source('Visit 42 Rue des Lanternes, Westhaven.')];
  assert.equal(applyLiteralSourceStreetEvidence({ ...noName, config: street }).trace.hints.length, 0);
});

test('multiple, negated, old, creator and sponsorship addresses never create a branch hint', () => {
  for (const text of [
    'Silver Lantern Cafe at 42 Rue des Lanternes; also at 84 Rue des Lanternes.',
    'Silver Lantern Cafe is not at 42 Rue des Lanternes.',
    'Silver Lantern Cafe old address 42 Rue des Lanternes.',
    'Filmed by Silver Lantern Cafe at 42 Rue des Lanternes.',
    'Sponsored by Silver Lantern Cafe at 42 Rue des Lanternes.',
    'Silver Lantern Cafe at 42 Rue des Lanternes is not the place shown.',
  ]) assert.equal(applyLiteralSourceStreetEvidence({ ...prepared(text, null), config: street }).trace.hints.length, 0, text);
});

test('adaptive taxonomy requires observed text, including independently extracted OCR', () => {
  const input = natural();
  assert.equal(adaptiveSpecificity(input, taxonomy).specificity.specific, false);
  assert.equal(adaptiveSpecificity(input, taxonomy, { transcript: [], ocr: [], metadataDescription: 'A quiet afternoon.' }).specificity.specific, false);
  const visible = natural(); visible.evidence.places[0]!.explicitEvidence[0]!.source = 'visible_text';
  assert.equal(adaptiveSpecificity(visible, taxonomy, { transcript: [], ocr: [], ocrExtracted: false }).specificity.specific, false);
  assert.equal(adaptiveSpecificity(visible, taxonomy, { transcript: [], ocr: [{ text: 'A visit to Copper Finch Trail.', timestampSeconds: 0, confidence: 1 }], ocrExtracted: true }).specificity.specific, true);
});

test('optional street source limits are a conservative no-op and another venue address does not bind', () => {
  const args = prepared(), tooLong = applyLiteralSourceStreetEvidence({ ...args, sources: [source('x'.repeat(40_001))], config: street });
  assert.equal(tooLong.input, args.prepared); assert.equal(tooLong.trace.rejected[0]?.reason, 'literal_source_bounds_or_shape_invalid');
  const other = prepared(); other.sources = [source('Silver Lantern Cafe is shown.\nAlso try Golden Sparrow Bakery at 84 Rue des Lanternes.')];
  assert.equal(applyLiteralSourceStreetEvidence({ ...other, config: street }).trace.hints.length, 0);
});

test('live Automatic Deep evaluator seam preserves default and can skip only intended escalation', async () => {
  const normal = natural(), observed: AnalyzeInput = { platform: 'native', canonicalUrl: 'synthetic://no-network', frames: [], transcript: [], ocr: [],
    metadataDescription: 'A visit to Copper Finch Trail.', signal: new AbortController().signal };
  const cfg = { automaticDeepRecognitionEnabled: true, vayrinFrameBudget: 2, maxSelectedFrames: 2, vayrinFrameStrategy: 'diverse' } as WorkerConfig;
  const model: ModelProvider = { name: 'synthetic', analyze: async () => ({ provider: 'synthetic', promptVersion: 'synthetic', ...normal }) };
  let requests = 0;
  const stop = async () => { requests++; throw new Error('synthetic_deep_requested'); };
  const defaultModel = withAutomaticDeepRecognition(model, cfg, stop);
  await assert.rejects(() => defaultModel.analyze(observed), /synthetic_deep_requested/);
  const disabled = withAutomaticDeepRecognition(model, cfg, stop, { evaluateSpecificity: (output, input) => adaptiveSpecificity(output, BASELINE_ADAPTIVE_CONFIG, input).specificity });
  await assert.rejects(() => disabled.analyze(observed), /synthetic_deep_requested/);
  const enabled = withAutomaticDeepRecognition(model, cfg, stop, { evaluateSpecificity: (output, input) => adaptiveSpecificity(output, taxonomy, input).specificity });
  const result = await enabled.analyze(observed);
  assert.equal(requests, 2); assert.equal(result.automaticDeep?.invoked, false); assert.deepEqual(result.evidence, normal.evidence);
});

test('query extension is suffix-only and reaches existing resolver without modifying decisions', async () => {
  const args = prepared(), adapted = applyLiteralSourceStreetEvidence({ ...args, config: street }), mention = adapted.input.mediaMentions.mentions[0]!;
  const geo = { city: null, region: null, country: null };
  assert.equal(extendMentionQuery('base', mention, geo), 'base');
  for (const bad of ['replace', 'base\ninjected', 'base ' + 'x'.repeat(161)]) assert.equal(extendMentionQuery('base', mention, geo, () => bad), 'base');
  const queries: string[] = [];
  const run = (queryExtension?: Parameters<typeof extendMentionQuery>[3]) => resolveVenueMentions({ mentions: [mention], geoContext: geo, platform: 'unknown',
    env: { googlePlacesKey: 'synthetic' } as never, deps: { search: async (query) => { queries.push(query); return { ok: true, results: [], apiPath: 'places_new', fallbackUsed: false }; }, geocode: async () => null,
      globalRequestLimit: 1, queryExtension } });
  const a = await run(), baselineQuery = queries[0]!; queries.length = 0;
  const b = await run((query, m) => appendLiteralStreetToQuery(query, m, street));
  assert.equal(queries[0], baselineQuery + ' 42 Rue des Lanternes');
  assert.equal(a.mentionResults[0]?.outcome, b.mentionResults[0]?.outcome);
  assert.equal(a.requestCount, b.requestCount);
});

test('person brand geography prior and creator-only constraints survive address option', () => {
  for (const role of ['PERSON_CREATOR', 'BRAND', 'PRODUCT', 'EVENT_TOUR', 'AMBIGUOUS'] as const) {
    const args = prepared(); args.prepared.mediaEvidence.placeNameRole = role;
    assert.equal(applyLiteralSourceStreetEvidence({ ...args, config: street }).trace.hints.length, 0);
  }
  for (const update of [{ identityEvidenceKind: 'model_prior' }, { creatorHandleEvidenceOnly: true }, { resolutionMode: 'geographic' }, { category: 'beach' }] as const) {
    const args = prepared(); Object.assign(args.prepared.mediaMentions.mentions[0]!, update);
    assert.equal(applyLiteralSourceStreetEvidence({ ...args, config: street }).trace.hints.length, 0);
  }
});

test('multi-place addresses bind by local literal name and do not merge branches', () => {
  const text = 'Silver Lantern Cafe at 42 Rue des Lanternes; Golden Sparrow Bakery at 88 Willow Street.';
  const groundedEvidence = evidence([makePlace(), makePlace({ name: 'Golden Sparrow Bakery', category: 'bakery',
    explicitEvidence: [{ source: 'caption', value: text, timestampSeconds: 5 }] })], { multipleIntentionalPlaces: true });
  groundedEvidence.places[0]!.explicitEvidence = [{ source: 'caption', value: text, timestampSeconds: 0 }];
  const input = prepareMediaResolverInput({ platform: 'unknown', groundedEvidence, sourceMetadata: parseMediaSourceMetadata({ description: text }) });
  const result = applyLiteralSourceStreetEvidence({ prepared: input, groundedEvidence, sources: [source(text)], config: street });
  assert.equal(result.trace.hints.length, 2); assert.equal(result.input.mediaMentions.mentions.length, 2);
  assert.deepEqual(result.trace.hints.map((h) => h.hint.street), ['42 Rue des Lanternes', '88 Willow Street']);
});

test('street hints do not alter branch ambiguity gate decisions', () => {
  const args = prepared(), adapted = applyLiteralSourceStreetEvidence({ ...args, config: both });
  const original = args.prepared.mediaMentions.mentions[0]!;
  const changed = adapted.input.mediaMentions.mentions[0]!;
  const candidates = [1, 2].map((n) => ({ googlePlaceId: `synthetic-${n}`, name: 'Silver Lantern Cafe', formattedAddress: `${n} Different Road`,
    confidenceScore: .99, types: ['cafe'], evidence: ['media_name_mention'], reasons: ['strong_name_match'] }));
  const result: MentionResult = { mentionId: original.id, displayName: original.displayName, query: 'synthetic', outcome: 'ambiguous_candidates', candidates,
    scoring: candidates.map((c) => ({ googlePlaceId: c.googlePlaceId, name: c.name, rawScore: 80, normalizedScore: .99, reasons: ['strong_name_match'], rejected: false, rejectionReason: null })) };
  const gate = (mention: VenueMention) => evaluateMediaAutoSave({ mention, result, allResults: [result] });
  assert.deepEqual(gate(changed), gate(original)); assert.equal(gate(changed).eligible, false);
});
