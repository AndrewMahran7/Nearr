import assert from 'node:assert/strict';

import {
  CORRECTION_COPY,
  correctionInitialQuery,
  correctionRejectionMessage,
  planWrongPlaceCorrection,
  type CorrectionContext,
  type CorrectionPlace,
} from '../lib/wrongPlaceCorrection';

const owner = 'user-a';
const context: CorrectionContext = {
  savedPlaceId: 'sp-1',
  ownerUserId: owner,
  actingUserId: owner,
  currentGooglePlaceId: 'gp-wrong',
  userNote: 'Get the birria burrito',
  sourceType: 'instagram',
  sourceUrl: 'https://www.instagram.com/reel/ABC/',
  ruleVersion: 'media-autosave-2026-08-04.v3',
};

const replacement: CorrectionPlace = {
  googlePlaceId: 'gp-right',
  name: 'Los de Juarez Burritos',
  formattedAddress: '1101 W Lincoln Ave, Anaheim, CA 92805, USA',
  latitude: 33.83,
  longitude: -117.93,
};

const at = new Date('2026-08-12T17:00:00.000Z');

// ---- only owner can correct ------------------------------------------------
{
  const plan = planWrongPlaceCorrection(
    { ...context, actingUserId: 'user-b' },
    replacement,
    at,
  );
  assert.equal(plan.ok, false);
  assert.equal(plan.ok === false && plan.reason, 'not_owner');
  assert.equal(correctionRejectionMessage('not_owner'), CORRECTION_COPY.notOwner);
}
{
  const plan = planWrongPlaceCorrection({ ...context, actingUserId: '' }, replacement, at);
  assert.equal(plan.ok, false, 'a signed-out actor cannot correct');
}

// ---- replacement keeps source context and the user note --------------------
const plan = planWrongPlaceCorrection(context, replacement, at);
assert.equal(plan.ok, true);
if (plan.ok) {
  assert.equal(plan.preserved.userNote, 'Get the birria burrito', 'the note survives');
  assert.equal(plan.preserved.sourceType, 'instagram');
  assert.equal(plan.preserved.sourceUrl, 'https://www.instagram.com/reel/ABC/');

  // ---- provider ID changes -------------------------------------------------
  assert.equal(plan.replacement.googlePlaceId, 'gp-right');
  assert.notEqual(plan.replacement.googlePlaceId, context.currentGooglePlaceId);

  // ---- coordinates update --------------------------------------------------
  assert.equal(plan.replacement.latitude, 33.83);
  assert.equal(plan.replacement.longitude, -117.93);
  assert.equal(plan.replacement.formattedAddress, replacement.formattedAddress);

  // ---- no duplicate --------------------------------------------------------
  assert.equal(plan.savedPlaceId, 'sp-1', 'the existing row is updated in place');

  // ---- cache invalidates ---------------------------------------------------
  assert.ok(plan.invalidate.includes('saved_places'));
  assert.ok(plan.invalidate.includes('map_markers'), 'the marker moves immediately');
  assert.ok(plan.invalidate.includes('place_rich_details'), 'stale photos are dropped');

  // ---- feedback is product data, not hidden reasoning ----------------------
  assert.deepEqual(plan.feedback, {
    originalGooglePlaceId: 'gp-wrong',
    correctedGooglePlaceId: 'gp-right',
    ruleVersion: 'media-autosave-2026-08-04.v3',
    correctedAt: '2026-08-12T17:00:00.000Z',
  });
  const keys = Object.keys(plan.feedback).join(',');
  assert.ok(!/reason|thought|chain|prompt/i.test(keys), 'no chain-of-thought is stored');
}

// ---- refuse a no-op or unusable replacement --------------------------------
{
  const samePlace = planWrongPlaceCorrection(context, { ...replacement, googlePlaceId: 'gp-wrong' }, at);
  assert.equal(samePlace.ok === false && samePlace.reason, 'same_place');
}
for (const bad of [
  null,
  { ...replacement, googlePlaceId: '  ' },
  { ...replacement, name: '' },
  { ...replacement, latitude: null },
  { ...replacement, longitude: null },
  { ...replacement, latitude: 999 },
]) {
  const rejected = planWrongPlaceCorrection(context, bad as CorrectionPlace | null, at);
  assert.equal(rejected.ok, false, `rejects ${JSON.stringify(bad)}`);
  assert.equal(rejected.ok === false && rejected.reason, 'invalid_replacement');
}

// ---- the correction search runs automatically from AI context --------------
assert.equal(
  correctionInitialQuery({ extractedName: 'Los de Juarez', locality: 'Anaheim, CA' }),
  'Los de Juarez Anaheim, CA',
);
assert.equal(
  correctionInitialQuery({ extractedName: null, currentName: 'Some Saved Place' }),
  'Some Saved Place',
  'falls back to the saved name',
);
assert.equal(correctionInitialQuery({}), '', 'no context means no automatic search');

// The action must not compete with the primary place actions.
assert.equal(CORRECTION_COPY.action, 'Wrong place?');

console.log('PASS wrong-place correction ownership, preservation, replacement, and feedback');
