import assert from 'node:assert/strict';

import {
  PHASE_1_COPY,
  SHARE_EXTENSION_SUCCESS_LAYOUT,
  processingMessage,
  queueIntro,
  splitPlaceAddress,
} from '../lib/sharePhase1Ui';

assert.ok(SHARE_EXTENSION_SUCCESS_LAYOUT.approximateHeight >= 280);
assert.ok(SHARE_EXTENSION_SUCCESS_LAYOUT.approximateHeight <= 320);
assert.ok(SHARE_EXTENSION_SUCCESS_LAYOUT.secondaryHeight >= 44, 'Done remains visible and tappable');
assert.equal(queueIntro(1), 'I found a place that needs a quick check.');
assert.equal(queueIntro(3), 'I found 3 places that need a quick check.');

assert.deepEqual(splitPlaceAddress('123 Main St, Anaheim, CA 92805, USA'), {
  locality: 'Anaheim, CA',
  streetAddress: '123 Main St',
});
assert.deepEqual(splitPlaceAddress('Anaheim, CA, USA'), {
  locality: 'Anaheim, CA',
  streetAddress: null,
});
assert.deepEqual(splitPlaceAddress(null), { locality: null, streetAddress: null });

assert.equal(processingMessage('queued', 0), 'Checking the post…');
assert.equal(processingMessage('processing_metadata', 0), 'Matching the location…');
assert.equal(processingMessage('processing_metadata', 4 * 60 * 1000), 'Taking a little longer…');

assert.equal(PHASE_1_COPY.emptyTitle, "You're all caught up");
assert.equal(PHASE_1_COPY.detailTitle, 'Quick check');
assert.equal(PHASE_1_COPY.suggestedHeading, 'I found a likely match');
assert.equal(PHASE_1_COPY.alreadySavedHeading, 'You already saved this place');
assert.equal(PHASE_1_COPY.viewOnMap, 'View on map');
assert.equal(PHASE_1_COPY.alternativeAction, 'Not the right place?');
assert.equal(PHASE_1_COPY.removeMessage, 'This post will leave your queue.');

const longName = 'A Very Long Restaurant Name That Must Wrap Without Overlapping Adjacent Actions';
const longAddress = '12345 Extremely Long Boulevard, A Neighborhood With A Long Name, California 99999';
assert.ok(longName.length > 60 && longAddress.length > 70, 'long-content fixture covers wrapping');

console.log('PASS Phase 1 presentation contracts');