import { test } from 'node:test';
import assert from 'node:assert/strict';

import { emptyEvidence, type MediaPlaceEvidence, type PlaceCandidateEvidence } from '../src/types/evidence.js';
import {
  canonicalizationOutcome,
  classifyHypothesisFirstPath,
  rankIndependentHypotheses,
  VAYRIN_HYPOTHESIS_FIRST_VERSION,
} from '../src/vayrin/hypothesisFirstHardPath.js';
import { estimateVayrinCostUsd, parseVayrinPayload, type VayrinHypothesisRaw } from '../src/vayrin/visualGeolocationClient.js';
import { payloadToEvidence, structuredEntitySemantics } from '../src/vayrin/visualGeolocationProvider.js';
import {
  buildVayrinUserContext,
  VAYRIN_GEOLOCATION_SCHEMA,
  VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT,
} from '../src/vayrin/visualGeolocationPrompt.js';

function place(name: string, overrides: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name, category: 'attraction', address: null, city: null, region: null, country: null,
    coordinates: null, role: 'primary', confidence: 0.9,
    explicitEvidence: [{ timestampSeconds: 0, source: 'caption', value: name }],
    inferredEvidence: [], memoryCue: null, memoryCueEvidence: [],
    ...overrides,
    categoryConfidence: overrides.categoryConfidence ?? 0,
    categoryEvidenceTags: overrides.categoryEvidenceTags ?? [],
  };
}

function evidence(places: PlaceCandidateEvidence[]): MediaPlaceEvidence {
  return { ...emptyEvidence(), places, insufficientEvidence: places.length === 0 };
}

function hypothesis(name: string, overrides: Partial<VayrinHypothesisRaw> = {}): VayrinHypothesisRaw {
  return {
    name, place_type: 'natural feature', city: null, region: null, country: null,
    specificity: 'natural_feature', confidence: 0.8,
    reasoning_summary: 'Distinctive observable geometry.',
    supporting_visual_clues: ['distinctive rock and water geometry'],
    supporting_textual_clues: [], conflicting_clues: [], needs_external_verification: true,
    evidence_basis: 'distinctive_visual_match', ...overrides,
  };
}

function payload(hypotheses: VayrinHypothesisRaw[], overrides: Record<string, unknown> = {}) {
  return parseVayrinPayload({
    scene_category: 'natural water feature', activity: 'swimming',
    source_geography: {
      country: null, region: null, city: null, confidence_class: 'none', evidence_provenance: [],
    },
    identity_clues: [], no_exact_hypothesis: false,
    place_hypotheses: hypotheses, multiple_distinct_places_visible: false,
    additional_place_segments: [], metadata_was_sufficient: false,
    ...overrides,
  })!;
}

test('1 hard/easy routing is deterministic and source-grounded', () => {
  assert.equal(classifyHypothesisFirstPath({ enabled: true, frameCount: 8, evidence: evidence([]) }).eligible, true);
  assert.deepEqual(classifyHypothesisFirstPath({
    enabled: true, frameCount: 8,
    evidence: evidence([place('Dorset Quarry', { address: '1848 VT-30, Dorset, VT' })]),
  }).reason, 'strong_exact_source_identity');
});

test('2 Places candidates are hidden from the independent packet', () => {
  const context = buildVayrinUserContext({
    platform: 'instagram', caption: '#Maui', transcript: '', visibleText: '',
    locationMetadata: 'Maui', retrievedCandidatesJson: null,
  });
  assert.match(context, /deliberately withheld/);
  assert.doesNotMatch(context, /San Francisco Breakfast Club/);
  assert.match(VAYRIN_VISUAL_GEOLOCATION_SYSTEM_PROMPT, /blind to Google Places candidates/);
});

test('3 generic category does not become an exact hypothesis', () => {
  const mapped = payloadToEvidence(payload([hypothesis('Cliff Jumping', { place_type: 'activity' })]));
  assert.equal(mapped.evidence.places.length, 0);
  assert.equal(mapped.evidence.partialPlaces?.[0]?.nameHint, 'Cliff Jumping');
});

test('4 Maui source geography is preserved independently', () => {
  const parsed = payload([hypothesis('Moku Nui', { city: 'Kailua', region: 'Hawaii', country: 'United States' })], {
    source_geography: {
      country: 'United States', region: 'Hawaii', city: 'Kailua',
      confidence_class: 'explicit_source_geo', evidence_provenance: ['source_hashtags'],
    },
  });
  const mapped = payloadToEvidence(parsed).evidence.places[0]!;
  assert.equal(mapped.name, 'Moku Nui');
  assert.equal(mapped.geoSupport, 'explicit_source_geo');
  assert.equal(parsed.source_geography.region, 'Hawaii');
});

test('5 Norway is preserved and cross-country conflict is expressible', () => {
  const parsed = payload([hypothesis('Stryn', { country: 'Norway', conflicting_clues: [] })], {
    source_geography: {
      country: 'Norway', region: null, city: null,
      confidence_class: 'explicit_source_geo', evidence_provenance: ['source_caption'],
    },
  });
  assert.equal(parsed.source_geography.country, 'Norway');
  assert.equal(payloadToEvidence(parsed).evidence.places[0]?.country, 'Norway');
});

test('6 person/athlete identity is never treated as a place', () => {
  const mapped = payloadToEvidence(payload([hypothesis('Ken Stornes', { place_type: 'athlete' })]));
  assert.equal(mapped.evidence.places.length, 0);
});

test('7 Tamolitch-type strong visual hypothesis outranks a lexical-provider favorite', () => {
  const tamolitch = hypothesis('Tamolitch Blue Pool', { confidence: 0.82 });
  const chickasaw = hypothesis('Chickasaw National Recreation Area', { confidence: 0.45, evidence_basis: 'contextual_or_memory_prior' });
  const ranked = rankIndependentHypotheses([
    { hypothesis: chickasaw, canonicalScore: 1 },
    { hypothesis: tamolitch, canonicalScore: 0.1 },
  ]);
  assert.equal(ranked[0]?.hypothesis.name, 'Tamolitch Blue Pool');
});

test('8/10 exact Dorset Quarry and Lake Havasu remain EASY', () => {
  for (const exact of [
    place('Dorset Quarry', { address: '1848 VT-30, Dorset, VT' }),
    place('Lake Havasu', { explicitEvidence: [{ timestampSeconds: null, source: 'visible_text', value: 'Lake Havasu' }] }),
  ]) {
    assert.equal(classifyHypothesisFirstPath({ enabled: true, frameCount: 8, evidence: evidence([exact]) }).eligible, false);
  }

  const compactCaption = place('Lake Havasu', {
    explicitEvidence: [{ timestampSeconds: null, source: 'caption', value: '#LakeHavasu #parker' }],
  });
  assert.deepEqual(classifyHypothesisFirstPath({
    enabled: true,
    frameCount: 8,
    evidence: evidence([compactCaption]),
    sourceText: '#LakeHavasu #parker',
  }).reason, 'strong_exact_source_identity');
});

test('8b compound model aliases canonicalize using the primary proposed identity', () => {
  const mapped = payloadToEvidence(payload([
    hypothesis('Dorset Quarry (Norcross-West Marble Quarry)'),
  ])).evidence.places[0]!;
  assert.equal(mapped.name, 'Dorset Quarry');
});

test('8c descriptive quarry-area output remains partial while exact Dorset survives', () => {
  const mapped = payloadToEvidence(payload([
    hypothesis('West Rutland marble quarry area', { confidence: 0.86 }),
    hypothesis('Dorset Marble Quarry', { confidence: 0.72 }),
  ])).evidence;
  assert.deepEqual(mapped.places.map((item) => item.name), ['Dorset Marble Quarry']);
  assert.equal(mapped.partialPlaces?.[0]?.nameHint, 'West Rutland marble quarry area');
});

test('9 natural-feature hypothesis survives canonicalization failure as independent evidence', () => {
  const mapped = payloadToEvidence(payload([hypothesis('Okere Falls', { country: 'New Zealand' })])).evidence.places[0]!;
  assert.equal(canonicalizationOutcome({ candidateCount: 0, verifiedSingle: false, topNameMatchesHypothesis: false }), 'NO_CANONICAL_MATCH');
  assert.equal(mapped.name, 'Okere Falls');
  assert.equal(mapped.hypothesisOrigin, 'independent_multimodal');
});

test('11 natural alias Moku Nui is retained for later canonicalization', () => {
  assert.equal(payloadToEvidence(payload([hypothesis('Moku Nui')])).evidence.places[0]?.name, 'Moku Nui');
});

test('12 no exact hypothesis is a valid structured result and forces no POI', () => {
  const parsed = payload([], { no_exact_hypothesis: true });
  assert.equal(parsed.no_exact_hypothesis, true);
  assert.equal(payloadToEvidence(parsed).evidence.places.length, 0);
  assert.ok((VAYRIN_GEOLOCATION_SCHEMA.properties.place_hypotheses as { maxItems?: number }).maxItems === 3);
});

test('13/14 multi-place stays split while same-scene alternatives stay grouped', () => {
  const first = hypothesis('North Cove');
  const alternative = hypothesis('North Point', { confidence: 0.6 });
  const second = hypothesis('Harbor Beach');
  const parsed = payload([first, alternative], {
    multiple_distinct_places_visible: true,
    additional_place_segments: [{ frame_timestamps_seconds: [12, 18], hypotheses: [second] }],
  });
  const mapped = payloadToEvidence(parsed).evidence;
  assert.equal(mapped.multipleIntentionalPlaces, true);
  assert.deepEqual(mapped.places.map((item) => item.logicalPlaceId), ['vayrin-scene-1', 'vayrin-scene-1', 'vayrin-scene-2']);
});

test('15/16 output is versioned and cost telemetry remains computable', () => {
  assert.match(VAYRIN_HYPOTHESIS_FIRST_VERSION, /core-v4/);
  assert.equal(estimateVayrinCostUsd({
    inputTokens: 10_000, cachedInputTokens: 0, outputTokens: 2_000,
    reasoningTokens: 1_000, totalTokens: 12_000,
  }, { inputPerMillion: 5, cachedInputPerMillion: 0.5, outputPerMillion: 30 }), 0.11);
});

test('entity semantics retain person and activity as blind reasoning context', () => {
  const source = evidence([]);
  source.entityContext = [
    { text: 'Ken Stornes', entityType: 'PERSON', source: 'caption', confidence: 0.99 },
    { text: 'Døds', entityType: 'ACTIVITY', source: 'caption', confidence: 0.99 },
    { text: 'Norway', entityType: 'COUNTRY', source: 'caption', confidence: 0.99 },
  ];
  const semantics = structuredEntitySemantics(source);
  assert.deepEqual(semantics.map((item) => item.entityType), ['PERSON', 'ACTIVITY', 'COUNTRY']);
  const context = buildVayrinUserContext({ entitySemantics: semantics, retrievedCandidatesJson: null });
  assert.match(context, /Ken Stornes/);
  assert.match(context, /ACTIVITY/);
  assert.match(context, /places_candidates: deliberately withheld/);
});

test('17 canonical outcome vocabulary is closed and cannot invent an identity', () => {
  assert.equal(canonicalizationOutcome({ candidateCount: 1, verifiedSingle: true, topNameMatchesHypothesis: true }), 'CANONICAL_EXACT');
  assert.equal(canonicalizationOutcome({ candidateCount: 1, verifiedSingle: false, topNameMatchesHypothesis: false }), 'CANONICAL_NEAR_MATCH');
  assert.equal(canonicalizationOutcome({ candidateCount: 2, verifiedSingle: false, topNameMatchesHypothesis: false }), 'AMBIGUOUS_CANONICAL');
});
