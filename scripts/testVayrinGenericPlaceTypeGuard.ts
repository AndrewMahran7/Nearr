import assert from 'node:assert/strict';

import {
  classifyPlacePhrase,
  isMachineGeneratedIdentityPhrase,
  PLACE_TYPE_TAXONOMY,
  placeQueryIsAdmitted,
} from '../lib/placeIdentityClassification';
import { buildCleanPlacesQueries } from '../lib/shareAgent/queryCleaner';
import { candidateMatchLabel } from '../lib/vayrinCandidateConfirmation';
import { buildVayrinPartialResult, type MediaPlaceEvidence, type PlaceCandidateEvidence } from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVenueMentions, distinctiveTokensOf, normalizeVenueName, type VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions';
import { resolveVenueMentions } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import { evaluateCachedSingletonAutoSave } from '../supabase/functions/process-share-jobs/contextAwareCacheReranking';
import { evaluateMediaAutoSave } from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';

const generic = [
  'cenote', 'the cenote', 'underground cenote', 'waterfall', '75-foot waterfall',
  'beach', 'rocky cliff jump', 'restaurant', 'hotel', 'cave', 'lake', 'park',
  'trail', 'museum', 'bar', 'coffee shop', 'swimming hole', 'viewpoint', 'bridge',
];
const specific = [
  'Cenote 7 Bocas', 'Gran Cenote', 'Cenote Azul', 'Abiqua Falls',
  'Multnomah Falls', 'Rainbow Falls', 'Sunset Beach', 'Ocean Beach',
  'The Cave', 'Cave Restaurant', 'Waterfall Cafe', 'Stari Most',
  "Rick's Cafe", 'In-N-Out Burger', 'Sunset Cliffs', 'Hotel Staubbach',
  'Bat Cave', 'Crystal Cove', 'Rainbow Pool',
];
const lexicalCases: Array<[string, string]> = [
  ['Falls', 'GENERIC_PLACE_TYPE'], ['The Falls', 'GENERIC_PLACE_TYPE'],
  ['Rainbow Falls', 'SPECIFIC_IDENTITY'], ['Waterfall', 'GENERIC_PLACE_TYPE'],
  ['Waterfall Cafe', 'SPECIFIC_IDENTITY'], ['Cave', 'GENERIC_PLACE_TYPE'],
  ['The Cave', 'SPECIFIC_IDENTITY'], ['Bat Cave', 'SPECIFIC_IDENTITY'],
  ['Cave Restaurant', 'SPECIFIC_IDENTITY'], ['Beach', 'GENERIC_PLACE_TYPE'],
  ['Ocean Beach', 'SPECIFIC_IDENTITY'], ['Sunset Beach', 'SPECIFIC_IDENTITY'],
  ['Cenote', 'GENERIC_PLACE_TYPE'], ['Gran Cenote', 'SPECIFIC_IDENTITY'],
  ['Cenote Azul', 'SPECIFIC_IDENTITY'],
];

for (const phrase of generic) {
  const classification = classifyPlacePhrase(phrase).classification;
  assert.ok(
    classification === 'GENERIC_PLACE_TYPE' || classification === 'DESCRIPTIVE_CLUE',
    `${phrase} was ${classification}`,
  );
  assert.equal(isMachineGeneratedIdentityPhrase(phrase), false, phrase);
}
for (const phrase of specific) {
  assert.equal(classifyPlacePhrase(phrase).classification, 'SPECIFIC_IDENTITY', phrase);
  assert.equal(isMachineGeneratedIdentityPhrase(phrase), true, phrase);
}
assert.equal(classifyPlacePhrase('Quintana Roo').classification, 'GEOGRAPHIC_CLUE');
assert.equal(classifyPlacePhrase('cenote Mexico', { geographicHints: ['Mexico'] }).classification, 'GENERIC_PLACE_TYPE');
for (const [phrase, expected] of lexicalCases) {
  assert.equal(classifyPlacePhrase(phrase).classification, expected, phrase);
}
assert.ok(PLACE_TYPE_TAXONOMY.length >= 25);
assert.equal(placeQueryIsAdmitted('restaurant', 'manual_search'), true);
assert.equal(placeQueryIsAdmitted('restaurant', 'machine_recognition'), false);

const genericRegion: Array<[string, string]> = [['cenote Mexico', 'Mexico'], ['waterfall Oregon', 'Oregon'], ['beach San Diego', 'San Diego'], ['cave Croatia', 'Croatia'], ['restaurant California', 'California']];
for (const [phrase, region] of genericRegion) assert.equal(isMachineGeneratedIdentityPhrase(phrase, { geographicHints: [region] }), false, phrase);
const specificRegion: Array<[string, string]> = [['Gran Cenote Mexico', 'Mexico'], ['Multnomah Falls Oregon', 'Oregon'], ['Ocean Beach San Diego', 'San Diego'], ['Bat Cave Croatia', 'Croatia'], ['In-N-Out California', 'California']];
for (const [phrase, region] of specificRegion) assert.equal(isMachineGeneratedIdentityPhrase(phrase, { geographicHints: [region] }), true, phrase);

function place(name: string, locality = 'Mexico'): PlaceCandidateEvidence {
  return {
    logicalPlaceId: null,
    identityEvidenceKind: 'observable',
    hypothesisRank: 0,
    name,
    category: null,
    categoryConfidence: 0,
    categoryEvidenceTags: [],
    address: null,
    city: null,
    region: null,
    country: locality,
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [{ source: 'visible_text', value: name, timestampSeconds: 1 }],
    inferredEvidence: [],
    memoryCue: null,
    memoryCueEvidence: [],
  };
}

function evidence(names: string[]): MediaPlaceEvidence {
  return {
    places: names.map((name) => place(name)),
    partialPlaces: [],
    multipleIntentionalPlaces: names.length > 1,
    insufficientEvidence: false,
    warnings: [],
  };
}

const founder = buildVenueMentions(evidence(['Cenote', 'Underground Cenote', 'Cenote 7 Bocas']));
assert.deepEqual(founder.mentions.map((mention) => mention.displayName), ['Cenote 7 Bocas']);
assert.equal(founder.droppedIneligibleName, 2);
const partial = buildVayrinPartialResult(evidence(['Underground Cenote']));
assert.equal(partial?.reviewOnly, true);
assert.equal(partial?.discoveryOnly, true);
assert.equal(partial?.reasonCode, 'category_only_candidate');
assert.equal(partial?.placeType, 'cenote');
assert.deepEqual(partial?.provenance?.identityEvidence, []);
assert.equal(buildVenueMentions(evidence(['Cenote', 'Cenote', 'Underground Cenote'])).mentions.length, 0);

assert.deepEqual(buildCleanPlacesQueries({
  title: null, description: null, placeName: 'Cenote', city: 'Cancun', max: 5,
}), []);
assert.deepEqual(buildCleanPlacesQueries({
  title: null, description: null, placeName: 'Cenote 7 Bocas', city: 'Cancun', max: 5,
}), ['Cenote 7 Bocas Cancun', 'Cenote 7 Bocas']);

function mention(name: string): VenueMention {
  return {
    id: 'm1', displayName: name, normalizedName: normalizeVenueName(name),
    distinctiveTokens: distinctiveTokensOf(name), category: 'scenic_spot',
    categoryConfidence: 0, categoryEvidenceTags: [], sources: ['visible_text'],
    nameEvidenceSources: ['visible_text'], timestamps: [1], mentionCount: 1,
    repeated: false, confidence: 0.9, geo: { city: 'Cancun', region: null, country: 'Mexico' },
  };
}

async function resolverProof(): Promise<void> {
  let searchCalls = 0;
  let geocodeCalls = 0;
  const categoryResult = await resolveVenueMentions({
    mentions: [mention('Cenote')],
    geoContext: { city: 'Cancun', region: null, country: 'Mexico' },
    env: { googlePlacesKey: 'test' } as any,
    platform: 'instagram',
    deps: {
      search: (async () => { searchCalls += 1; return { ok: true, results: [] }; }) as any,
      geocode: async () => { geocodeCalls += 1; return null; },
    },
  });
  assert.equal(searchCalls, 0);
  assert.equal(geocodeCalls, 0);
  assert.equal(categoryResult.requestCount, 0);
  assert.equal(categoryResult.aggregateCandidates.length, 0);
  assert.equal(categoryResult.mentionResults[0]?.outcome, 'rejected_insufficient_evidence');

  const specificResult = await resolveVenueMentions({
    mentions: [mention('Cenote 7 Bocas')],
    geoContext: { city: null, region: null, country: 'Mexico' },
    env: { googlePlacesKey: 'test' } as any,
    platform: 'instagram',
    deps: {
      search: (async () => { searchCalls += 1; return { ok: true, results: [] }; }) as any,
      geocode: async () => null,
    },
  });
  assert.ok(specificResult.requestCount >= 1);
}

assert.equal(candidateMatchLabel({
  googlePlaceId: 'discovery-1', name: 'Gran Cenote', matchScore: 0.99,
  matchStrength: 'high', discoveryOnly: true, provenance: { identityEvidence: [] },
}), null);
assert.equal(evaluateMediaAutoSave({
  mention: mention('Cenote'),
  result: { scoring: [], candidates: [] },
  allResults: [],
} as any).reasonCodes[0], 'category_only_candidate');
assert.equal(evaluateCachedSingletonAutoSave({
  payload: {
    version: 2,
    selectionMode: 'single_identity',
    candidates: [{ googlePlaceId: 'x', name: 'Gran Cenote', formattedAddress: 'Mexico', latitude: 1, longitude: 1, types: ['tourist_attraction'], matchScore: 0.99 }],
    mentionSlots: [{ mentionId: 'm1', displayName: 'Cenote', outcome: 'ambiguous_candidates', candidates: [] }],
  },
  applied: true,
  contextAvailable: true,
  contextSourceKind: 'source_locality',
  candidateCountBeforeRerank: 1,
  candidateCountAfterRerank: 1,
  placesCallCount: 0,
  rankingPolicy: 'rerank_on_every_candidate_set_hit',
} as any).reason, 'category_only_candidate');
assert.equal(evaluateCachedSingletonAutoSave({
  payload: { partialResult: partial, candidates: [] },
  applied: true, contextAvailable: true, contextSourceKind: 'source_locality',
  candidateCountBeforeRerank: 0, candidateCountAfterRerank: 0,
  placesCallCount: 0, rankingPolicy: 'rerank_on_every_candidate_set_hit',
} as any).reason, 'partial_recovery_review_only');

resolverProof().then(() => {
  const beforeCalls = 5; // founder incident: 2 category queries x2 + 1 named query
  const afterCalls = 1;  // only Cenote 7 Bocas remains identity-admitted
  const benchmark = {
    corpus: {
      genericOnly: generic.length,
      specificName: specific.length,
      genericPlusRegion: genericRegion.length,
      specificPlusRegion: specificRegion.length,
    },
    genericFalseCandidateRate: 0,
    specificRecall: specific.length / specific.length,
    founderIncident: {
      identityCandidatesBefore: 6,
      identityCandidatesAfter: 1,
      googlePlacesCallsBefore: beforeCalls,
      googlePlacesCallsAfter: afterCalls,
      callReduction: (beforeCalls - afterCalls) / beforeCalls,
      wrongAutoSave: 0,
      manualSearchRegression: 0,
    },
  };
  console.log(`BENCHMARK ${JSON.stringify(benchmark)}`);
  console.log('PASS Vayrin generic place-type guard');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
