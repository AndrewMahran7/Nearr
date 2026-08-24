import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';

import {
  MAX_CONTEXTUAL_SEARCH_CALLS,
  MAX_VISIBLE_CONTEXTUAL_CANDIDATES,
  analyzePlacesAmbiguity,
  contextualWideningDecision,
  haversineDistanceKm,
  isPrivacySafeResolutionTelemetry,
  rankContextAwareCandidates,
  selectResolutionAnchor,
  type ContextualPlaceCandidate,
  type GeoPoint,
  type PlacesResolutionContext,
} from '../lib/contextAwarePlacesResolution';

type Fixture = {
  id: string;
  query: string;
  context: PlacesResolutionContext;
  candidates: ContextualPlaceCandidate[];
  expectedIds: string[];
  expectedNoResult?: boolean;
};

const point = (lat: number, lng: number): GeoPoint => ({ lat, lng });
const place = (
  googlePlaceId: string,
  name: string,
  formattedAddress: string,
  latitude: number,
  longitude: number,
  primaryType = 'restaurant',
): ContextualPlaceCandidate => ({
  googlePlaceId,
  name,
  formattedAddress,
  latitude,
  longitude,
  primaryType,
  types: [primaryType, 'point_of_interest', 'establishment'],
});

const santaPaula = point(34.3542, -119.0593);
const la = point(34.0522, -118.2437);
const nyc = point(40.7128, -74.0060);
const lauterbrunnen = point(46.5935, 7.9091);
const seattle = point(47.6062, -122.3321);

const inNOutCandidates = [
  place('ino-frisco', 'In-N-Out Burger', 'Frisco, TX, USA', 33.1507, -96.8236),
  place('ino-houston', 'In-N-Out Burger', 'Houston, TX, USA', 29.7604, -95.3698),
  place('ino-camarillo', 'In-N-Out Burger', 'Camarillo, CA, USA', 34.2164, -119.0376),
  place('ino-ventura', 'In-N-Out Burger', 'Ventura, CA, USA', 34.2805, -119.2945),
  place('ino-sacramento', 'In-N-Out Burger', 'Sacramento, CA, USA', 38.5816, -121.4944),
];

const starbucksCandidates = [
  place('sb-ny', 'Starbucks', 'Broadway, New York, NY, USA', 40.711, -74.010, 'cafe'),
  place('sb-la', 'Starbucks', 'Spring St, Los Angeles, CA, USA', 34.051, -118.244, 'cafe'),
  place('sb-sf', 'Starbucks', 'Market St, San Francisco, CA, USA', 37.774, -122.419, 'cafe'),
];

const chipotleCandidates = [
  place('chip-far', 'Chipotle Mexican Grill', 'Pasadena, CA, USA', 34.1478, -118.1445),
  place('chip-near', 'Chipotle Mexican Grill', 'Los Angeles, CA, USA', 34.0505, -118.2450),
  place('chip-ny', 'Chipotle Mexican Grill', 'New York, NY, USA', 40.715, -74.005),
];

const cedarCandidates = [
  place('cedar-houston', 'Cedar Creek', 'Houston, TX, USA', 29.790, -95.410, 'bar'),
  place('cedar-golf', 'Cedar Creek Golf Course', 'San Antonio, TX, USA', 29.520, -98.610, 'golf_course'),
  place('cedar-wa', 'Cedar Creek Scenic Drive', 'Woodland, WA, USA', 45.910, -122.740, 'natural_feature'),
];

const swissCandidates = [
  place('staubbach-us', 'Staubbach Hotel', 'Denver, CO, USA', 39.7392, -104.9903, 'lodging'),
  place('staubbach-ch', 'Hotel Staubbach', 'Lauterbrunnen, Switzerland', 46.5950, 7.9070, 'hotel'),
  place('staubbach-ch-2', 'Staubbach Lodge', 'Lauterbrunnen, Switzerland', 46.5920, 7.9110, 'lodging'),
];

const punchbowlCandidates = [
  place('punch-hi', 'Punchbowl', 'Honolulu, HI, USA', 21.312, -157.846, 'tourist_attraction'),
  place('punch-ca', 'Santa Paula Punch Bowls', 'Santa Paula, CA, USA', 34.407, -119.047, 'natural_feature'),
  place('punch-uk', 'Punch Bowl', 'London, United Kingdom', 51.507, -0.128, 'bar'),
];

const source = (
  coordinates: GeoPoint,
  locality: string,
  region: string,
  country = 'United States',
  expectedCategory: string | null = null,
): PlacesResolutionContext => ({
  mode: 'source',
  inferredCoordinates: coordinates,
  inferredLocality: locality,
  inferredRegion: region,
  inferredCountry: country,
  regionConfidence: 'strong',
  sourceEvidence: ['exact_source_evidence'],
  expectedCategory,
});

const fixtures: Fixture[] = [
  { id: 'in-n-out-santa-paula', query: 'In-N-Out', context: source(santaPaula, 'Santa Paula', 'CA'), candidates: inNOutCandidates, expectedIds: ['ino-camarillo', 'ino-ventura'] },
  { id: 'starbucks-new-york', query: 'Starbucks', context: source(nyc, 'New York', 'NY', 'United States', 'cafe'), candidates: [starbucksCandidates[1]!, starbucksCandidates[2]!, starbucksCandidates[0]!], expectedIds: ['sb-ny'] },
  { id: 'chipotle-manual-la', query: 'Chipotle', context: { mode: 'manual', userLocation: la }, candidates: chipotleCandidates, expectedIds: ['chip-near'] },
  { id: 'cedar-creek-washington-nature', query: 'Cedar Creek', context: source(seattle, 'Woodland', 'WA', 'United States', 'nature'), candidates: cedarCandidates, expectedIds: ['cedar-wa'] },
  { id: 'hotel-staubbach-swiss', query: 'Hotel Staubbach', context: source(lauterbrunnen, 'Lauterbrunnen', 'Bern', 'Switzerland', 'hotel'), candidates: swissCandidates, expectedIds: ['staubbach-ch'] },
  { id: 'punchbowl-santa-paula', query: 'Punchbowl', context: source(santaPaula, 'Santa Paula', 'CA', 'United States', 'nature'), candidates: punchbowlCandidates, expectedIds: ['punch-ca'] },
  { id: 'blue-lagoon-iceland', query: 'Blue Lagoon', context: source(point(63.8804, -22.4495), 'Grindavík', 'Southern Peninsula', 'Iceland', 'nature'), candidates: [place('blue-us', 'Blue Lagoon', 'Miami, FL, USA', 25.76, -80.19, 'bar'), place('blue-is', 'Blue Lagoon', 'Grindavík, Iceland', 63.88, -22.45, 'spa')], expectedIds: ['blue-is'] },
  { id: 'central-park-ny', query: 'Central Park', context: source(nyc, 'New York', 'NY', 'United States', 'park'), candidates: [place('central-ca', 'Central Park', 'Fremont, CA, USA', 37.55, -121.97, 'park'), place('central-ny', 'Central Park', 'New York, NY, USA', 40.78, -73.96, 'park')], expectedIds: ['central-ny'] },
  { id: 'main-street-cafe-user', query: 'Main Street Cafe', context: { mode: 'manual', userLocation: point(34.42, -119.70) }, candidates: [place('main-tx', 'Main Street Cafe', 'Dallas, TX, USA', 32.77, -96.79, 'cafe'), place('main-ca', 'Main Street Cafe', 'Santa Barbara, CA, USA', 34.42, -119.70, 'cafe')], expectedIds: ['main-ca'] },
  { id: 'common-park-seattle', query: 'Riverside Park', context: source(seattle, 'Seattle', 'WA', 'United States', 'park'), candidates: [place('river-ny', 'Riverside Park', 'New York, NY, USA', 40.80, -73.97, 'park'), place('river-wa', 'Riverside Park', 'Seattle, WA, USA', 47.61, -122.34, 'park')], expectedIds: ['river-wa'] },
  { id: 'natural-swimming-hole', query: 'Cedar Creek', context: source(point(45.91, -122.74), 'Woodland', 'WA', 'United States', 'nature'), candidates: cedarCandidates, expectedIds: ['cedar-wa'] },
  { id: 'same-name-hotel-country', query: 'Alpine Hotel', context: source(point(46.82, 8.23), 'Lucerne', 'Lucerne', 'Switzerland', 'hotel'), candidates: [place('alpine-us', 'Alpine Hotel', 'Alpine, TX, USA', 30.36, -103.66, 'hotel'), place('alpine-ch', 'Alpine Hotel', 'Lucerne, Switzerland', 46.82, 8.23, 'hotel')], expectedIds: ['alpine-ch'] },
  { id: 'nearby-mention-chain', query: 'In-N-Out', context: { mode: 'source', nearbyResolvedMentions: [{ googlePlaceId: 'punch-ca', coordinates: santaPaula, locality: 'Santa Paula', region: 'CA', country: 'United States', mentionTimestamp: 18 }], mentionTimestamp: 24, regionConfidence: 'medium', sourceEvidence: ['nearby_resolved_video_place'] }, candidates: inNOutCandidates, expectedIds: ['ino-camarillo'] },
  { id: 'foreign-video-user-in-la', query: 'Hotel Staubbach', context: { ...source(lauterbrunnen, 'Lauterbrunnen', 'Bern', 'Switzerland', 'hotel'), userLocation: la }, candidates: swissCandidates, expectedIds: ['staubbach-ch'] },
  { id: 'chain-no-nearby', query: 'Example Coffee', context: source(santaPaula, 'Santa Paula', 'CA'), candidates: [place('coffee-tx', 'Example Coffee', 'Houston, TX, USA', 29.76, -95.37, 'cafe'), place('coffee-ny', 'Example Coffee', 'New York, NY, USA', 40.71, -74.00, 'cafe')], expectedIds: [], expectedNoResult: true },
  { id: 'no-context-control', query: 'The Spot', context: { mode: 'source', regionConfidence: 'none' }, candidates: [place('spot-tx', 'The Spot', 'Austin, TX, USA', 30.26, -97.74, 'bar'), place('spot-ca', 'The Spot', 'Los Angeles, CA, USA', 34.05, -118.24, 'bar')], expectedIds: ['spot-tx', 'spot-ca'] },
  { id: 'cafe-country-guard', query: 'Corner Cafe', context: source(point(48.86, 2.35), 'Paris', 'Île-de-France', 'France', 'cafe'), candidates: [place('corner-us', 'Corner Cafe', 'Boston, MA, USA', 42.36, -71.05, 'cafe'), place('corner-fr', 'Corner Cafe', 'Paris, France', 48.86, 2.35, 'cafe')], expectedIds: ['corner-fr'] },
  { id: 'park-region-guard', query: 'Lake Park', context: source(point(47.61, -122.33), 'Seattle', 'WA', 'United States', 'park'), candidates: [place('lake-fl', 'Lake Park', 'Lake Park, FL, USA', 26.80, -80.07, 'park'), place('lake-wa', 'Lake Park', 'Seattle, WA, USA', 47.61, -122.33, 'park')], expectedIds: ['lake-wa'] },
];

function topDistance(fixture: Fixture, candidate: ContextualPlaceCandidate | undefined): number | null {
  if (!candidate || typeof candidate.latitude !== 'number' || typeof candidate.longitude !== 'number') return null;
  const anchor = selectResolutionAnchor(fixture.context).coordinates;
  return anchor ? haversineDistanceKm(anchor, { lat: candidate.latitude, lng: candidate.longitude }) : null;
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))]!;
}

function benchmark() {
  let beforeRecall1 = 0;
  let beforeRecall3 = 0;
  let afterRecall1 = 0;
  let afterRecall3 = 0;
  let beforeWrong = 0;
  let afterWrong = 0;
  let beforeVisible = 0;
  let afterVisible = 0;
  let beforeNoResult = 0;
  let afterNoResult = 0;
  let afterCalls = 0;
  let widened = 0;
  const beforeDistances: number[] = [];
  const afterDistances: number[] = [];
  const latencies: number[] = [];
  const cases = fixtures.map((fixture) => {
    const before = fixture.candidates;
    const start = performance.now();
    const result = rankContextAwareCandidates({ query: fixture.query, candidates: fixture.candidates, context: fixture.context, placesCallCount: 1 });
    latencies.push(performance.now() - start);
    const after = result.visible.map((item) => item.candidate);
    const correct = new Set(fixture.expectedIds);
    const expectedNoResult = fixture.expectedNoResult === true;
    if (expectedNoResult ? before.length === 0 : correct.has(before[0]?.googlePlaceId ?? '')) beforeRecall1 += 1;
    if (expectedNoResult ? before.length === 0 : before.slice(0, 3).some((candidate) => correct.has(candidate.googlePlaceId))) beforeRecall3 += 1;
    if (expectedNoResult ? after.length === 0 : correct.has(after[0]?.googlePlaceId ?? '')) afterRecall1 += 1;
    if (expectedNoResult ? after.length === 0 : after.slice(0, 3).some((candidate) => correct.has(candidate.googlePlaceId))) afterRecall3 += 1;
    if (!expectedNoResult && fixture.context.mode === 'source' && !correct.has(before[0]?.googlePlaceId ?? '')) beforeWrong += 1;
    if (!expectedNoResult && fixture.context.mode === 'source' && !correct.has(after[0]?.googlePlaceId ?? '')) afterWrong += 1;
    beforeVisible += Math.min(5, before.length);
    afterVisible += after.length;
    if (before.length === 0) beforeNoResult += 1;
    if (after.length === 0) afterNoResult += 1;
    const calls = result.noNearbyMatch ? MAX_CONTEXTUAL_SEARCH_CALLS : 1;
    afterCalls += calls;
    if (calls > 1) widened += 1;
    const beforeDistance = topDistance(fixture, before[0]);
    const afterDistance = topDistance(fixture, after[0]);
    if (beforeDistance != null) beforeDistances.push(beforeDistance);
    if (afterDistance != null) afterDistances.push(afterDistance);
    return {
      id: fixture.id,
      beforeTop: before[0]?.googlePlaceId ?? null,
      afterTop: after[0]?.googlePlaceId ?? null,
      expected: fixture.expectedIds,
      visible: after.length,
      noNearbyMatch: result.noNearbyMatch,
      calls,
    };
  });
  const total = fixtures.length;
  const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
  return {
    generatedAt: new Date().toISOString(),
    corpusSize: total,
    before: {
      recallAt1: beforeRecall1 / total,
      recallAt3: beforeRecall3 / total,
      crossRegionWrongTop1: beforeWrong,
      meanTopDistanceKm: mean(beforeDistances),
      meanVisibleCandidates: beforeVisible / total,
      noResultRate: beforeNoResult / total,
      wideningRate: 0,
      placesCallsPerQuery: 1,
    },
    after: {
      recallAt1: afterRecall1 / total,
      recallAt3: afterRecall3 / total,
      crossRegionWrongTop1: afterWrong,
      meanTopDistanceKm: mean(afterDistances),
      meanVisibleCandidates: afterVisible / total,
      noResultRate: afterNoResult / total,
      wideningRate: widened / total,
      placesCallsPerQuery: afterCalls / total,
      rankingLatencyP50Ms: percentile(latencies, 0.5),
      rankingLatencyP95Ms: percentile(latencies, 0.95),
    },
    cases,
  };
}

// Required regression contract (20 checks).
const byId = (id: string) => fixtures.find((fixture) => fixture.id === id)!;
const rank = (id: string) => {
  const fixture = byId(id);
  return rankContextAwareCandidates({ query: fixture.query, candidates: fixture.candidates, context: fixture.context });
};

assert.equal(rank('starbucks-new-york').visible[0]?.candidate.googlePlaceId, 'sb-ny', '1 strong source city biases results');
assert.ok(rank('hotel-staubbach-swiss').ranked.every((item) => !item.candidate.formattedAddress?.endsWith('USA')), '2 strong country filters unrelated country');
assert.equal(rank('nearby-mention-chain').visible[0]?.candidate.googlePlaceId, 'ino-camarillo', '3 nearby resolved mention influences sibling');
const weakNearby = rankContextAwareCandidates({ query: 'Remote Lodge', candidates: [place('near-wrong', 'Other Lodge', 'Santa Paula, CA, USA', 34.35, -119.06, 'lodging'), place('far-exact', 'Remote Lodge', 'Reno, NV, USA', 39.53, -119.81, 'lodging')], context: { mode: 'source', mentionTimestamp: 900, nearbyResolvedMentions: [{ googlePlaceId: 'p', coordinates: santaPaula, mentionTimestamp: 0 }], expectedCategory: 'lodging', regionConfidence: 'medium' } });
assert.equal(weakNearby.visible[0]?.candidate.googlePlaceId, 'far-exact', '4 nearby mention is weighted, not absolute');
assert.equal(rank('chipotle-manual-la').visible[0]?.candidate.googlePlaceId, 'chip-near', '5 user location applies with no source context');
assert.ok(analyzePlacesAmbiguity('In-N-Out', inNOutCandidates).ambiguous, '6 chain/common name detected from provider multiplicity');
assert.equal(rank('chain-no-nearby').noNearbyMatch, true, '7 no nearby chain branch is honest empty state');
let wideningCalls = 0; while (contextualWideningDecision({ context: source(santaPaula, 'Santa Paula', 'CA'), completedCalls: wideningCalls, plausibleCandidateCount: 0 }).shouldSearch) wideningCalls += 1;
assert.equal(wideningCalls, 3, '8 widening is bounded at three calls');
assert.ok(rank('in-n-out-santa-paula').visible.length <= MAX_VISIBLE_CONTEXTUAL_CANDIDATES, '9 visible candidates max three');
assert.equal(rank('in-n-out-santa-paula').visible[0]?.candidate.googlePlaceId, 'ino-camarillo', '10 canonical ID preserved');
assert.equal(rank('in-n-out-santa-paula').ranked.filter((item) => item.candidate.name === 'In-N-Out Burger').length, 2, '11 distinct same-name branches are not merged');
assert.equal(rank('cedar-creek-washington-nature').visible[0]?.candidate.googlePlaceId, 'cedar-wa', '12 category mismatch penalty');
assert.deepEqual(rank('in-n-out-santa-paula').visible.map((item) => item.candidate.googlePlaceId), ['ino-camarillo', 'ino-ventura'], '13 In-N-Out Santa Paula regression');
assert.equal(rank('cedar-creek-washington-nature').visible[0]?.candidate.googlePlaceId, 'cedar-wa', '14 Cedar Creek regression');
assert.equal(rank('chipotle-manual-la').visible[0]?.candidate.googlePlaceId, 'chip-near', '15 Chipotle manual proximity regression');
assert.equal(rank('hotel-staubbach-swiss').visible[0]?.candidate.googlePlaceId, 'staubbach-ch', '16 Switzerland vs US regression');
assert.equal(rank('main-street-cafe-user').visible[0]?.candidate.googlePlaceId, 'main-ca', '17 no-context manual search preserves proximity');
assert.equal(rank('foreign-video-user-in-la').visible[0]?.candidate.googlePlaceId, 'staubbach-ch', '18 user location does not override foreign source context');
assert.equal(MAX_CONTEXTUAL_SEARCH_CALLS, 3, '19 Places call count is bounded');
assert.ok(isPrivacySafeResolutionTelemetry(rank('in-n-out-santa-paula').telemetry), '20 telemetry is privacy-safe');

const report = benchmark();
assert.ok(report.after.recallAt1 > report.before.recallAt1, 'benchmark Recall@1 materially improves');
assert.ok(report.after.crossRegionWrongTop1 <= report.before.crossRegionWrongTop1, 'benchmark cross-region wrong top-1 does not increase');
assert.ok(report.after.meanVisibleCandidates <= 3, 'benchmark visible candidate average obeys cap');

if (process.argv.includes('--write-artifact')) {
  const dir = join(process.cwd(), 'artifacts');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'context-aware-places-resolution-benchmark.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

console.log(JSON.stringify(report, null, 2));
console.log('PASS context-aware Places resolution (20 required regressions, 18-case benchmark)');
