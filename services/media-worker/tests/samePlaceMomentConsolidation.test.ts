import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  consolidatePlaceMoments,
  type GroupingOptions,
} from '../src/pipeline/consolidatePlaceMoments.js';
import type {
  DistinctPlaceSignal,
  MediaPlaceEvidence,
  PlaceCandidateEvidence,
  SceneEnvironmentType,
} from '../src/types/evidence.js';

type Category = NonNullable<PlaceCandidateEvidence['category']>;

type CorpusMoment = {
  name: string;
  category: Category | null;
  timestamps: number[];
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  environment?: SceneEnvironmentType;
  anchors?: string[];
  transitionText?: string;
  distinctSignals?: DistinctPlaceSignal[];
  candidateIds?: string[];
};

type CorpusFixture = {
  id: string;
  class: 'SAME_PLACE' | 'TRUE_MULTI_PLACE' | 'AMBIGUOUS';
  expectedLogicalPlaces: number;
  moments: CorpusMoment[];
};

const corpus = JSON.parse(readFileSync(
  new URL('./fixtures/samePlaceMomentCorpus.json', import.meta.url),
  'utf8',
)) as CorpusFixture[];

function place(moment: CorpusMoment, index: number): PlaceCandidateEvidence {
  return {
    name: moment.name,
    category: moment.category,
    categoryConfidence: 0.88,
    categoryEvidenceTags: [],
    address: moment.address ?? null,
    city: moment.city ?? null,
    region: moment.region ?? null,
    country: moment.country ?? null,
    coordinates: null,
    role: index === 0 ? 'primary' : 'secondary',
    confidence: 0.86,
    identityEvidenceKind: 'observable',
    momentTimestamps: moment.timestamps,
    sceneSignature: {
      environmentType: moment.environment ?? 'unknown',
      setting: moment.environment === 'food_venue' || moment.environment === 'lodging'
        ? 'mixed'
        : 'outdoor',
      visualAnchors: moment.anchors ?? [],
      activity: null,
      regionClue: moment.region ?? null,
    },
    distinctPlaceSignals: moment.distinctSignals ?? [],
    explicitEvidence: [
      ...moment.timestamps.map((timestampSeconds) => ({
        source: 'frame' as const,
        value: `${moment.name} observed at ${timestampSeconds}s`,
        timestampSeconds,
      })),
      ...(moment.transitionText ? [{
        source: 'caption' as const,
        value: moment.transitionText,
        timestampSeconds: moment.timestamps[0] ?? null,
      }] : []),
    ],
    inferredEvidence: [],
    memoryCue: null,
    memoryCueEvidence: [],
  };
}

function replayFixture(fixture: CorpusFixture) {
  const evidence: MediaPlaceEvidence = {
    places: fixture.moments.map(place),
    partialPlaces: [],
    multipleIntentionalPlaces: fixture.moments.length > 1,
    insufficientEvidence: false,
    warnings: [],
  };
  const canonicalCandidateIdsByMoment: Record<string, string[]> = {};
  fixture.moments.forEach((moment, index) => {
    if (moment.candidateIds) canonicalCandidateIdsByMoment[`moment:${index + 1}`] = moment.candidateIds;
  });
  const options: GroupingOptions = { canonicalCandidateIdsByMoment };
  return consolidatePlaceMoments(evidence, options);
}

for (const fixture of corpus) {
  test(`corpus: ${fixture.id}`, () => {
    const result = replayFixture(fixture);
    assert.equal(result.telemetry.raw_moment_count, fixture.moments.length);
    assert.equal(result.telemetry.logical_place_count, fixture.expectedLogicalPlaces);
    assert.equal(
      result.evidence.multipleIntentionalPlaces,
      fixture.expectedLogicalPlaces > 1,
    );
    assert.equal(
      new Set(result.evidence.places.map((item) => item.logicalPlaceId)).size,
      fixture.expectedLogicalPlaces,
    );
    assert.ok(result.telemetry.grouping_reason_codes.length <= 16);
  });
}

test('founder cenote replay consolidates 3 moments into one named identity without losing evidence', () => {
  const fixture = corpus.find((item) => item.id === 'DcetoQJxbt-founder-cenote')!;
  const result = replayFixture(fixture);
  assert.equal(result.evidence.places.length, 1);
  assert.equal(result.evidence.places[0]!.name, 'Cenote 7 Bocas');
  assert.deepEqual(result.evidence.places[0]!.momentTimestamps, [0, 1, 7, 10, 11, 12]);
  assert.deepEqual(
    [...new Set(result.evidence.places[0]!.explicitEvidence.map((item) => item.timestampSeconds))]
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b),
    [0, 1, 7, 10, 11, 12],
  );
  assert.equal(result.telemetry.moments_merged, 2);
  assert.equal(result.telemetry.same_place_confidence_band, 'medium');
});

test('passing mentions and never-dead-end partial evidence survive without becoming destinations', () => {
  const passing = place({ name: 'Hotel Sakol K\'aax', category: 'hotel', timestamps: [12] }, 1);
  passing.role = 'passing_mention';
  const result = consolidatePlaceMoments({
    places: [place({ name: 'Cenote 7 Bocas', category: 'attraction', timestamps: [12] }, 0), passing],
    partialPlaces: [{
      nameHint: 'Unreadable cenote sign', category: 'attraction', categoryConfidence: 0.5,
      categoryEvidenceTags: [], addressHint: null, city: null, region: 'Quintana Roo', country: 'Mexico',
      role: 'secondary', confidence: 0.4,
      explicitEvidence: [{ source: 'visible_text', value: 'CENOTE', timestampSeconds: 12 }],
      validationErrors: ['fixture'],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  });
  assert.equal(result.telemetry.logical_place_count, 1);
  assert.equal(result.evidence.places.filter((item) => item.role === 'passing_mention').length, 1);
  assert.equal(result.evidence.partialPlaces?.length, 1);
});

test('identity alternatives already sharing a logical id remain one moment and one resolver slot', () => {
  const primary = place({ name: 'Cenote Siete Bocas', category: 'attraction', timestamps: [12] }, 0);
  const alternate = place({ name: 'Seven Mouths Cenote', category: 'attraction', timestamps: [12] }, 1);
  primary.logicalPlaceId = 'source-scene-a';
  primary.hypothesisRank = 0;
  alternate.logicalPlaceId = 'source-scene-a';
  alternate.hypothesisRank = 1;
  const result = consolidatePlaceMoments({
    places: [primary, alternate], partialPlaces: [], multipleIntentionalPlaces: false,
    insufficientEvidence: false, warnings: [],
  });
  assert.equal(result.telemetry.raw_moment_count, 1);
  assert.equal(result.telemetry.logical_place_count, 1);
  assert.equal(result.evidence.places.length, 2);
  assert.equal(new Set(result.evidence.places.map((item) => item.logicalPlaceId)).size, 1);
  assert.deepEqual(result.evidence.places.map((item) => item.hypothesisRank), [0, 1]);
});

test('one outdoor destination is not split by hierarchical region wording', () => {
  const edge = place({
    name: 'Dettifoss', category: 'waterfall', timestamps: [0],
    region: 'Northeast Iceland', country: 'Iceland', environment: 'natural_water',
    anchors: ['broad basalt waterfall', 'dark canyon'],
  }, 0);
  const parkView = place({
    name: 'Vatnajokull National Park', category: 'waterfall', timestamps: [8],
    region: 'Vatnajokull National Park', country: 'Iceland', environment: 'natural_water',
    anchors: ['broad basalt waterfall', 'dark canyon'],
  }, 1);
  const result = consolidatePlaceMoments({
    places: [edge, parkView], partialPlaces: [], multipleIntentionalPlaces: true,
    insufficientEvidence: false, warnings: [],
  });
  assert.equal(result.telemetry.raw_moment_count, 2);
  assert.equal(result.telemetry.logical_place_count, 1);
  assert.equal(result.telemetry.moments_merged, 1);
  assert.ok(!result.telemetry.grouping_reason_codes.includes('different_region'));
});

test('corpus quality and downstream-work benchmark meet the ticket thresholds', () => {
  let sameCorrect = 0;
  let trueMultiCorrect = 0;
  let falseSplits = 0;
  let falseMerges = 0;
  let callsBefore = 0;
  let callsAfter = 0;
  let reviewBefore = 0;
  let reviewAfter = 0;

  for (const fixture of corpus) {
    const logical = replayFixture(fixture).telemetry.logical_place_count;
    callsBefore += fixture.moments.length;
    callsAfter += logical;
    if (fixture.moments.length > 1) reviewBefore += 1;
    if (logical > 1) reviewAfter += 1;
    if (fixture.class === 'SAME_PLACE') {
      if (logical === 1) sameCorrect += 1;
      else falseSplits += 1;
    }
    if (fixture.class === 'TRUE_MULTI_PLACE') {
      if (logical === fixture.expectedLogicalPlaces) trueMultiCorrect += 1;
      else falseMerges += 1;
    }
  }

  const sameTotal = corpus.filter((item) => item.class === 'SAME_PLACE').length;
  const multiTotal = corpus.filter((item) => item.class === 'TRUE_MULTI_PLACE').length;
  const samePlacePrecision = sameCorrect / sameTotal;
  const differentPlaceRecall = trueMultiCorrect / multiTotal;
  assert.ok(samePlacePrecision >= 0.95, `same-place precision ${samePlacePrecision}`);
  assert.ok(differentPlaceRecall >= 0.95, `different-place recall ${differentPlaceRecall}`);
  assert.equal(falseSplits, 0);
  assert.equal(falseMerges, 0);
  assert.ok(callsAfter < callsBefore, `${callsAfter} resolver slots should be fewer than ${callsBefore} moments`);
  assert.ok(reviewAfter < reviewBefore, `${reviewAfter} review cases should be fewer than ${reviewBefore}`);
});
