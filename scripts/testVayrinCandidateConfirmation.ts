import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  candidateEvidenceLabel,
  confirmationMode,
  confirmationPrompt,
  isBroadCandidate,
} from '../lib/vayrinCandidateConfirmation';
import {
  buildVayrinCandidateFixtureJob,
  VAYRIN_CANDIDATE_FIXTURES,
} from '../lib/vayrinCandidateFixtures';
import { selectPlaceImageUri } from '../lib/placeImageSource';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const asyncDetail = read('app/share-jobs/[jobId].tsx');
const syncShare = read('app/share.tsx');
const card = read('components/CandidateConfirmationCard.tsx');
const image = read('components/PlaceImage.tsx');
const presentation = read('lib/vayrinPresentation.ts');
const saveService = read('services/shareJobCandidateSave.ts');

const exact = {
  googlePlaceId: 'stari-most',
  name: 'Stari Most',
  formattedAddress: 'Mostar, Bosnia & Herzegovina',
  types: ['tourist_attraction', 'point_of_interest'],
};
const broad = {
  googlePlaceId: 'supai',
  name: 'Supai',
  formattedAddress: 'Arizona, United States',
  types: ['locality', 'political'],
};

assert.equal(confirmationMode([exact]), 'single');
assert.equal(confirmationPrompt('single'), 'Is this the place?');
assert.equal(confirmationMode([exact, { ...exact, googlePlaceId: 'mission-bay' }]), 'multiple');
assert.equal(confirmationPrompt('multiple'), 'Which one is it?');
assert.equal(confirmationMode([]), 'none');
assert.equal(confirmationPrompt('none'), "Couldn't pin this one down.");
assert.equal(isBroadCandidate(broad), true);
assert.equal(confirmationMode([broad]), 'broad');
assert.equal(confirmationPrompt('broad'), 'Is it around here?');
assert.equal(isBroadCandidate(exact), false);
assert.equal(candidateEvidenceLabel([3, 8]), 'Seen around 0:03');

assert.ok(VAYRIN_CANDIDATE_FIXTURES.length >= 12, 'all requested deterministic states exist');
for (const id of [
  'vayrin-confirm-stari-most',
  'vayrin-confirm-san-diego',
  'vayrin-confirm-supai',
  'vayrin-confirm-photo',
  'vayrin-confirm-frame',
  'vayrin-confirm-neutral',
  'vayrin-confirm-three',
  'vayrin-confirm-long-name',
  'vayrin-confirm-long-locality',
  'vayrin-confirm-duplicate',
  'vayrin-confirm-none',
  'vayrin-confirm-multi-place',
]) {
  assert.ok(VAYRIN_CANDIDATE_FIXTURES.some((fixture) => fixture.id === id), `fixture ${id}`);
}
assert.equal(buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-confirm-stari-most')).kind, 'confirm');
assert.equal(buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-confirm-san-diego')).kind, 'picker');
assert.equal(buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-confirm-none')).kind, 'manual');
assert.equal(buildShareJobDetailState(buildVayrinCandidateFixtureJob('vayrin-confirm-multi-place')).kind, 'multi');

assert.equal(
  selectPlaceImageUri('cached.jpg', ['places.jpg'], {}, { preferPlacePhoto: true, fallbackSourceUri: 'frame.jpg' }),
  'places.jpg',
);
assert.equal(
  selectPlaceImageUri('cached.jpg', ['places.jpg'], { 'places.jpg': true }, { preferPlacePhoto: true, fallbackSourceUri: 'frame.jpg' }),
  'cached.jpg',
);
assert.equal(
  selectPlaceImageUri(null, ['places.jpg'], { 'places.jpg': true }, { preferPlacePhoto: true, fallbackSourceUri: 'frame.jpg' }),
  'frame.jpg',
);
assert.equal(
  selectPlaceImageUri(null, ['places.jpg'], { 'places.jpg': true, 'frame.jpg': true }, { preferPlacePhoto: true, fallbackSourceUri: 'frame.jpg' }),
  null,
);

assert.match(asyncDetail, /candidateSaveLabel/);
assert.match(syncShare, /candidateSaveLabel/);
assert.match(syncShare, /confirmationPrompt\(syncCandidateMode\)/, 'sync broad candidates use the broad-region prompt');
assert.match(asyncDetail, /confirmationCandidates\.map/);
assert.match(card, /selectable/);
assert.match(card, /accessibilityRole=\{selectionRole\}/);
assert.match(card, /accessibilityState=\{\{ checked: selected \}\}/);
assert.match(card, /AREA MATCH/);
assert.match(asyncDetail, /See places in this area/);
assert.match(asyncDetail, /Search for the place/);
assert.match(asyncDetail, /None of these/);
assert.match(asyncDetail, /View original post/);
assert.match(syncShare, /View original post/);
assert.doesNotMatch(`${asyncDetail}\n${syncShare}\n${presentation}`, /Possible lead|Not verified yet/i);
assert.match(image, /PHOTO_RESOLUTION_TIMEOUT_MS/);
assert.match(image, /fallbackSourceUri/);
assert.match(image, /onError=/);
assert.doesNotMatch(card, /disabled=.*(?:photo|image)/i, 'image state never blocks candidate selection');
assert.match(asyncDetail, /vayrin_confirmation_viewed/);
assert.match(asyncDetail, /vayrin_candidate_saved/);
assert.match(asyncDetail, /vayrin_none_selected/);
assert.match(asyncDetail, /vayrin_manual_search_started/);
assert.match(asyncDetail, /handleSaveBatch/, 'genuine multi-place behavior remains separate');
assert.match(saveService, /sourceUrl: args\.sourceUrl/);
assert.match(saveService, /sourceType: shareJobSourceType\(args\.platform\)/);
assert.match(saveService, /aiNote: args\.aiNote/);
assert.match(saveService, /if \(result\.saved\) dependencies\.cache\(result\.saved\)/, 'duplicates refresh source enrichment');

console.log('PASS Vayrin candidate confirmation modes, images, save linkage, fixtures, and accessibility');
