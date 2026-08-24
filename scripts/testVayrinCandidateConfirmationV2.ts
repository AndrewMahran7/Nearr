import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_VISIBLE_CANDIDATES,
  candidateSaveLabel,
  classifyCanonicalCandidate,
  classifyUnresolvedText,
  isLikelyTitleLikePhrase,
  reviewSelectionMode,
  toggleCandidateSelection,
  visibleCandidateShortlist,
  type CandidateConfirmationPlace,
  type VayrinResultType,
} from '../lib/vayrinCandidateConfirmation';
import {
  buildVayrinCandidateFixtureJob,
  getVayrinCandidateFixture,
  VAYRIN_CANDIDATE_FIXTURES,
} from '../lib/vayrinCandidateFixtures';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { mapShareJobToVayrinPresentation } from '../lib/vayrinPresentation';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const asyncDetail = read('app/share-jobs/[jobId].tsx');
const syncShare = read('app/share.tsx');
const queue = read('app/share-jobs/index.tsx');
const card = read('components/CandidateConfirmationCard.tsx');

const resultTypes: VayrinResultType[] = [
  'EXACT_PLACE', 'RESOLVED_POI', 'BROAD_AREA', 'RAW_NAME', 'TEXTUAL_LEAD',
  'UNRESOLVED_QUERY', 'MULTI_PLACE', 'ALTERNATIVE_CANDIDATE', 'MANUAL_SEARCH_RESULT',
];
assert.equal(new Set(resultTypes).size, 9, 'the complete result taxonomy remains explicit');

const exact = (id: string, name = `Place ${id}`): CandidateConfirmationPlace => ({
  googlePlaceId: id,
  name,
  formattedAddress: `${id} Main St, San Diego`,
  types: ['point_of_interest'],
});
const broad: CandidateConfirmationPlace = {
  googlePlaceId: 'area-1', name: 'San Diego', formattedAddress: 'California', types: ['locality'],
};

assert.equal(MAX_VISIBLE_CANDIDATES, 3);
assert.deepEqual(visibleCandidateShortlist([exact('1'), exact('2'), exact('3'), exact('4'), exact('5')]).map((c) => c.googlePlaceId), ['1', '2', '3']);
assert.equal(visibleCandidateShortlist([exact('1'), { ...exact('1'), name: 'Alias' }]).length, 1, 'provider-id duplicates collapse');
assert.equal(visibleCandidateShortlist([exact('1'), { ...exact('1'), googlePlaceId: 'alias' }]).length, 1, 'normalized identity aliases collapse');
assert.equal(visibleCandidateShortlist([broad, exact('1')]).some((c) => c.googlePlaceId === broad.googlePlaceId), false, 'generic areas do not compete with an exact POI');
assert.equal(visibleCandidateShortlist([{ ...exact('weak'), matchScore: 0.12 }, exact('strong')]).some((c) => c.googlePlaceId === 'weak'), false, 'weak ranked candidates are not promoted');

assert.equal(classifyCanonicalCandidate(exact('1')), 'RESOLVED_POI');
assert.equal(classifyCanonicalCandidate(exact('1'), 'exact'), 'EXACT_PLACE');
assert.equal(classifyCanonicalCandidate(broad), 'BROAD_AREA');
assert.equal(classifyCanonicalCandidate(exact('1'), 'manual'), 'MANUAL_SEARCH_RESULT');
assert.equal(classifyCanonicalCandidate(exact('1'), 'alternative'), 'ALTERNATIVE_CANDIDATE');
assert.equal(classifyUnresolvedText('Worlds Most Dangerous Waterfall Hole', 'identity'), 'TEXTUAL_LEAD');
assert.equal(classifyUnresolvedText('Stari Most', 'identity'), 'RAW_NAME');
assert.equal(classifyUnresolvedText('some search', 'query'), 'UNRESOLVED_QUERY');
assert.equal(isLikelyTitleLikePhrase('Worlds Most Dangerous Waterfall Hole'), true);
for (const phrase of [
  'Top 10 hidden beaches you need to visit',
  'The craziest secret waterfall ever',
  'Most beautiful places you must see',
]) assert.equal(isLikelyTitleLikePhrase(phrase), true, phrase);
for (const name of ['Stari Most', 'Worlds End State Park', 'Museum of Modern Art']) {
  assert.equal(isLikelyTitleLikePhrase(name), false, name);
}

assert.deepEqual(toggleCandidateSelection([], 'a', 'multiple'), ['a']);
assert.deepEqual(toggleCandidateSelection(['a'], 'a', 'multiple'), []);
assert.deepEqual(toggleCandidateSelection(['a'], 'b', 'multiple'), ['a', 'b']);
assert.deepEqual(toggleCandidateSelection(['a'], 'b', 'exclusive'), ['b']);
assert.equal(reviewSelectionMode([{ candidates: [exact('a'), exact('b')], identityHypotheses: [{}, {}] }]), 'exclusive');
assert.equal(reviewSelectionMode([{ candidates: [exact('a'), exact('b')] }]), 'multiple');
assert.equal(candidateSaveLabel(1), 'Save this place');
assert.equal(candidateSaveLabel(2), 'Save 2 places');
assert.equal(candidateSaveLabel(3), 'Save 3 places');

for (const id of [
  'vayrin-confirm-stari-most', 'vayrin-confirm-san-diego', 'vayrin-confirm-sunset-three',
  'vayrin-confirm-five-internal', 'vayrin-confirm-raw-waterfall', 'vayrin-confirm-raw-zero',
  'vayrin-confirm-raw-two',
]) assert.ok(VAYRIN_CANDIDATE_FIXTURES.some((fixture) => fixture.id === id), id);
assert.equal(getVayrinCandidateFixture('vayrin-confirm-five-internal')?.candidates.length, 5);
assert.equal(visibleCandidateShortlist(getVayrinCandidateFixture('vayrin-confirm-five-internal')!.candidates).length, 3);
assert.equal(getVayrinCandidateFixture('vayrin-confirm-raw-zero')?.manualResults?.length, 0);
assert.equal(getVayrinCandidateFixture('vayrin-confirm-raw-two')?.manualResults?.length, 2);

const rawJob = buildVayrinCandidateFixtureJob('vayrin-confirm-raw-waterfall');
const rawDetail = buildShareJobDetailState(rawJob);
assert.equal(rawDetail.kind, 'manual');
const rawPresentation = mapShareJobToVayrinPresentation(rawDetail, rawJob);
assert.equal(rawPresentation.leads[0]?.resultType, 'TEXTUAL_LEAD');

const rawNotification = composeShareCompletionNotification({
  jobId: 'raw', status: 'needs_help', strongestLead: { name: 'Worlds Most Dangerous Waterfall Hole', evidenceKind: 'observable' }, observableLeadCount: 1,
});
assert.doesNotMatch(`${rawNotification.title} ${rawNotification.body}`, /Worlds Most Dangerous Waterfall Hole/);
const resolvedNotification = composeShareCompletionNotification({ jobId: 'resolved', status: 'needs_help', candidateCount: 1, strongestCandidateName: 'Stari Most' });
assert.equal(resolvedNotification.title, 'Vayrin found a possible place');

assert.match(card, /height=\{compact \? 88 : 184\}/);
assert.match(card, /accessibilityRole=\{selectionRole\}/);
assert.match(asyncDetail, /selectionRole="checkbox"/);
assert.match(asyncDetail, /visibleCandidateShortlist/);
assert.match(asyncDetail, /candidate_count_internal/);
assert.match(asyncDetail, /candidate_count_shown/);
assert.match(asyncDetail, /candidate_count_selected/);
assert.match(asyncDetail, /vayrin_raw_name_resolution_attempt/);
assert.match(asyncDetail, /vayrin_raw_name_resolution_success/);
assert.match(asyncDetail, /vayrin_raw_name_resolution_failure/);
assert.match(asyncDetail, /Couldn&apos;t find an exact place\./);
assert.match(asyncDetail, /stickySaveBar/);
assert.match(syncShare, /candidateSaveLabel/);
assert.match(syncShare, /visibleCandidateShortlist/);
assert.doesNotMatch(`${asyncDetail}\n${syncShare}\n${queue}`, /Possible lead|Not verified yet|Name found|NAME FOUND/i);

console.log('PASS Vayrin candidate resolution, compact capped shortlist, raw search, multi-select, sticky CTA, and truthful copy V2');
