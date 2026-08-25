import assert from 'node:assert/strict';
import {
  clearMapGroupFocusRequest,
  createMapGroupFocusRequest,
  decideMapGroupFit,
  getMapGroupFocusRequest,
  mapGroupEdgePadding,
  resolveMapGroupPlaces,
} from '../lib/mapGroupFocus';
import { planShareSaveCompletion, type SharePlaceSaveOutcome } from '../lib/shareJobResult';

const outcome = (
  candidateId: string,
  status: SharePlaceSaveOutcome['status'],
  savedPlaceId: string | null,
): SharePlaceSaveOutcome => status === 'failed'
  ? {
      logicalPlaceId: `mention-${candidateId}`,
      candidateId,
      status,
      savedPlaceId: null,
    }
  : {
      logicalPlaceId: `mention-${candidateId}`,
      candidateId,
      status,
      savedPlaceId: savedPlaceId ?? (() => { throw new Error('Successful fixture needs an id.'); })(),
    };

for (const count of [0, 1, 2, 5, 8, 12]) {
  const outcomes = Array.from({ length: count }, (_, index) =>
    outcome(`candidate-${index}`, 'saved', `saved-${index}`),
  );
  const plan = planShareSaveCompletion(outcomes);
  assert.equal(plan.createdSavedPlaceIds.length, count);
  assert.equal(plan.destination, count === 0 ? 'none' : count === 1 ? 'single' : 'group');
}

const partialPlan = planShareSaveCompletion([
  outcome('created-a', 'saved', 'saved-a'),
  outcome('duplicate-b', 'duplicate', 'saved-existing'),
  outcome('failed-c', 'failed', null),
  outcome('created-a-copy', 'saved', 'saved-a'),
]);
assert.deepEqual(partialPlan.createdSavedPlaceIds, ['saved-a']);
assert.deepEqual(partialPlan.duplicateSavedPlaceIds, ['saved-existing']);
assert.deepEqual(partialPlan.successfulCandidateIds, ['created-a', 'duplicate-b', 'created-a-copy']);
assert.deepEqual(partialPlan.failedCandidateIds, ['failed-c']);
assert.equal(partialPlan.destination, 'single');

assert.throws(
  () => outcome('duplicate-without-id', 'duplicate', null),
  /Successful fixture needs an id/,
);

const request = createMapGroupFocusRequest({
  savedPlaceIds: ['saved-a', 'saved-b', 'saved-a', '  ', 'missing'],
  source: 'share_job_saved',
  failedCount: 2,
});
assert.ok(request);
assert.deepEqual(request.savedPlaceIds, ['saved-a', 'saved-b', 'missing']);
assert.equal(request.failedCount, 2);
assert.deepEqual(getMapGroupFocusRequest(request.id), request);

const places = [
  { id: 'saved-a', place: { latitude: 33, longitude: -117 } },
  { id: 'saved-b', place: { latitude: 33, longitude: -117 } },
  { id: 'saved-c', place: { latitude: null, longitude: -118 } },
];
const resolved = resolveMapGroupPlaces(places, ['saved-b', 'saved-c', 'missing', 'saved-a']);
assert.deepEqual(resolved.places.map((place) => place.id), ['saved-b', 'saved-c', 'saved-a']);
assert.deepEqual(resolved.coordinatePlaces.map((place) => place.id), ['saved-b', 'saved-a']);
assert.deepEqual(resolved.missingIds, ['missing']);
assert.deepEqual(resolved.missingCoordinateIds, ['saved-c']);

assert.deepEqual(
  mapGroupEdgePadding({ topChromeHeight: 140, bottomOverlayHeight: 172 }),
  { top: 164, right: 48, bottom: 196, left: 48 },
);
assert.equal(decideMapGroupFit({ requestId: 'g1', handledRequestId: null, mapReady: false, layoutHeight: 700, waitingForPlaces: false }), 'wait');
assert.equal(decideMapGroupFit({ requestId: 'g1', handledRequestId: null, mapReady: true, layoutHeight: 0, waitingForPlaces: false }), 'wait');
assert.equal(decideMapGroupFit({ requestId: 'g1', handledRequestId: null, mapReady: true, layoutHeight: 700, waitingForPlaces: true }), 'wait');
assert.equal(decideMapGroupFit({ requestId: 'g1', handledRequestId: null, mapReady: true, layoutHeight: 700, waitingForPlaces: false }), 'fit');
assert.equal(decideMapGroupFit({ requestId: 'g1', handledRequestId: 'g1', mapReady: true, layoutHeight: 700, waitingForPlaces: false }), 'ignore');

const evictionRequests = Array.from({ length: 9 }, (_, index) =>
  createMapGroupFocusRequest({ savedPlaceIds: [`eviction-${index}`], source: 'development_preview' }),
);
assert.equal(getMapGroupFocusRequest(evictionRequests[0]!.id), null, 'old requests are bounded and evicted');
assert.ok(getMapGroupFocusRequest(evictionRequests[8]!.id), 'new request replaces old context');
clearMapGroupFocusRequest(request.id);
assert.equal(getMapGroupFocusRequest(request.id), null);

console.log('PASS authoritative multi-save and map-group focus contracts');
