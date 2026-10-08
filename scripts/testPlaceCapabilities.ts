import assert from 'node:assert/strict';

import { placeCapabilities } from '../lib/placeCapabilities';
import {
  SavedPlaceCapabilityError,
  requireRealSavedPlaceId,
} from '../lib/savedPlaceIdentity';
import { OFFLINE_ONBOARDING_FIXTURES } from '../onboarding/fixtures/offlineOnboardingFixtures';

const madYolks = OFFLINE_ONBOARDING_FIXTURES.find((fixture) => fixture.assetKey === 'mad_yolks');
assert.ok(madYolks);

const tutorial = placeCapabilities({
  id: `onboarding-scripted-save:${madYolks.id}`,
  source_url: madYolks.provenance.sourceUrl,
  place: {
    id: madYolks.place.id,
    google_place_id: madYolks.place.id,
  },
});
assert.equal(tutorial.kind, 'tutorial_local_place');
assert.equal(tutorial.isServerAddressable, false);
assert.equal(tutorial.canOpenDirections, true);
assert.equal(tutorial.canWatchSource, true);
assert.equal(tutorial.canShare, true);
for (const serverAction of [
  tutorial.canEdit,
  tutorial.canDelete,
  tutorial.canSetReminder,
  tutorial.canMarkVisited,
  tutorial.canReportWrongPlace,
  tutorial.canTransfer,
  tutorial.canSync,
]) {
  assert.equal(serverAction, false, 'tutorial rows never expose server-backed mutations');
}

const serverId = '619d591d-3da2-4c25-91de-f7db63af2265';
const server = placeCapabilities({ id: serverId, source_url: 'https://www.instagram.com/p/example/' });
assert.equal(server.kind, 'server_saved_place');
assert.equal(server.canEdit, true);
assert.equal(server.canSetReminder, true);
assert.equal(requireRealSavedPlaceId(serverId, 'edit'), serverId);

assert.throws(
  () => requireRealSavedPlaceId(`onboarding-scripted-save:${madYolks.id}`, 'edit'),
  (error) => error instanceof SavedPlaceCapabilityError &&
    error.code === 'local_saved_place_not_server_addressable' &&
    /stored only on this device/i.test(error.message),
);

console.log('PASS centralized place capability boundary for tutorial-local and server-backed places');
