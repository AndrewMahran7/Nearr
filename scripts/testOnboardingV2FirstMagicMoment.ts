import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bindAnonymousUser,
  beginOnboardingInAppTutorialResolution,
  completeOnboardingInterests,
  completeOnboardingPlatforms,
  confirmOnboardingFirstMagicMoment,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  finishOnboardingFirstMagicMoment,
  launchOnboardingTutorial,
  observeOnboardingTutorialJob,
  observeWrongOnboardingTutorialJob,
  onboardingV2ResumeEligibility,
  receiveOnboardingTutorialFixture,
  retryOnboardingTutorialShare,
  resolveOnboardingTutorialResult,
  selectOnboardingPainPoint,
  showOnboardingCelebration,
  showOnboardingShareInstructions,
  startOnboardingV2,
  tapGetStarted,
  toggleOnboardingInterest,
  toggleOnboardingPlatform,
  type OnboardingTutorialFixture,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  canLoadOnboardingTutorialFixture,
  isShareJobForTutorialFixture,
  parsePublicOnboardingTutorialFixture,
  tutorialResultFromShareJob,
} from '../lib/onboardingTutorialFixtureCore';
import { expectedOnboardingV2Route } from '../lib/onboardingV2RoutingCore';
import { prioritizeOnboardingTutorialFixtures } from '../supabase/functions/get-onboarding-tutorial/selection';
import type { ShareJob } from '../services/shareJobsService';

const fixture: OnboardingTutorialFixture = {
  id: '1c19f2d2-a020-4508-9fe3-ef9ef8bb052a', revision: 7, role: 'primary', platform: 'youtube',
  identityKey: 'v1:youtube:rrKmN3zZ0lM', identityVersion: 1, contentId: 'rrKmN3zZ0lM',
  canonicalUrl: 'https://www.youtube.com/watch?v=rrKmN3zZ0lM',
  launchUrl: 'https://www.youtube.com/watch?v=rrKmN3zZ0lM',
  thumbnailUrl: 'https://i.ytimg.com/vi/rrKmN3zZ0lM/hqdefault.jpg',
  selectedAt: '2026-09-09T12:00:00.000Z',
};
const at = (second: number) => `2026-09-09T12:00:${String(second).padStart(2, '0')}.000Z`;
const apply = (state: OnboardingV2State, reducer: (s: OnboardingV2State, now: string) => { state: OnboardingV2State }, second: number) => reducer(state, at(second)).state;

assert.equal(parsePublicOnboardingTutorialFixture({
  fixtureId: fixture.id, fixtureRevision: fixture.revision, fixtureRole: fixture.role,
  platform: fixture.platform, identityKey: fixture.identityKey, identityVersion: fixture.identityVersion,
  contentId: fixture.contentId, canonicalUrl: fixture.canonicalUrl, launchUrl: fixture.launchUrl,
  thumbnailUrl: fixture.thumbnailUrl, selectedAt: fixture.selectedAt,
})?.id, fixture.id);
assert.equal(parsePublicOnboardingTutorialFixture({ fixtureId: fixture.id, fixtureRevision: 7, fixtureRole: 'primary', platform: 'youtube', identityKey: 'wrong', identityVersion: 1, contentId: fixture.contentId, canonicalUrl: fixture.canonicalUrl, launchUrl: fixture.launchUrl, selectedAt: fixture.selectedAt }), null, 'identity mismatches fail closed');
assert.equal(canLoadOnboardingTutorialFixture({ appEnv: 'development', backendEnv: 'development', appEnvWasDefaulted: false, backendEnvWasDefaulted: false, supabaseProjectRef: 'qnfxnmvxpjzfydgudtvs' }), true);
assert.equal(canLoadOnboardingTutorialFixture({ appEnv: 'production', backendEnv: 'production', appEnvWasDefaulted: false, backendEnvWasDefaulted: false, supabaseProjectRef: 'rlqvxdwtetxsqxhqztkw' }), false);
assert.deepEqual(
  prioritizeOnboardingTutorialFixtures([{ platform: 'instagram', id: 'ig' }, { platform: 'youtube', id: 'yt' }], 'youtube').map((row) => row.id),
  ['yt', 'ig'],
  'a healthy exact-platform fixture wins while preserving the ordered fallback set',
);

let state = apply(createInitialOnboardingV2State(at(0)), startOnboardingV2, 1);
state = bindAnonymousUser(state, 'anon-user', '11111111-1111-4111-8111-111111111111', at(2)).state;
state = apply(state, tapGetStarted, 3);
state = toggleOnboardingPlatform(state, 'instagram', at(4)).state;
state = toggleOnboardingPlatform(state, 'youtube', at(5)).state;
state = apply(state, completeOnboardingPlatforms, 6);
assert.deepEqual(state.selectedPlatforms, ['instagram', 'youtube']);
assert.equal(state.preferredPlatform, 'instagram');
state = toggleOnboardingInterest(state, 'outdoors', at(7)).state;
state = toggleOnboardingInterest(state, 'travel', at(8)).state;
state = apply(state, completeOnboardingInterests, 9);
assert.equal(state.stage, 'pain_point');
assert.deepEqual(
  onboardingV2ResumeEligibility(state, {
    userId: state.boundUserId,
    identityExists: true,
    isAnonymous: true,
  }),
  { eligible: true, reason: 'eligible' },
  'the server-fixture flow resumes before a local tutorial content id exists',
);
state = selectOnboardingPainPoint(state, 'saved_and_forgotten', at(10)).state;
state = receiveOnboardingTutorialFixture(state, fixture, at(11)).state;
assert.equal(state.stage, 'tutorial_challenge');
assert.equal(JSON.stringify(state).includes('Attabad'), false, 'place answer is absent before reveal');
state = apply(state, beginOnboardingInAppTutorialResolution, 12);
assert.equal(state.stage, 'tutorial_processing');
assert.match(state.pendingShare?.attemptId ?? '', /^tutorial-in-app:/);
assert.equal(state.pendingShare?.contentIdentity?.contentId, fixture.contentId.toLowerCase());
assert.equal(retryOnboardingTutorialShare(state, at(13)).state.stage, 'tutorial_challenge', 'an in-app job failure retries without routing into the legacy external share lesson');
assert.equal(expectedOnboardingV2Route(state.stage), '/(onboarding)');

const wrongJob = { id: 'wrong-job', source_url: 'https://www.youtube.com/watch?v=abcdefghijk', canonical_url: 'https://www.youtube.com/watch?v=abcdefghijk', recognition_identity_key: 'v1:youtube:abcdefghijk' };
assert.equal(isShareJobForTutorialFixture(wrongJob, fixture), false);
state = observeWrongOnboardingTutorialJob(state, wrongJob.id, at(14)).state;
assert.equal(state.stage, 'tutorial_processing');
assert.equal(state.tutorialSave, null);

const job = {
  id: 'tutorial-job', source_url: fixture.canonicalUrl, canonical_url: fixture.canonicalUrl,
  recognition_identity_key: fixture.identityKey, status: 'completed', saved_place_id: 'saved-attabad',
  resolution_source: 'tutorial_fixture', tutorial_fixture_id: fixture.id,
  tutorial_fixture_revision: fixture.revision, tutorial_fixture_role: fixture.role,
  candidate_payload: { candidates: [{ googlePlaceId: 'ChIJHxRxLN2p6DgRMd2q59otvqI', name: 'Attabad Lake', formattedAddress: 'Hunza Valley, Gilgit-Baltistan, Pakistan', latitude: 36.318, longitude: 74.87, types: ['tourist_attraction'], primaryType: 'tourist_attraction', primaryTypeDisplayName: 'Tourist attraction', matchScore: 1, photoUrls: [] }] },
} as unknown as ShareJob;
assert.equal(isShareJobForTutorialFixture(job, fixture), true);
state = observeOnboardingTutorialJob(state, { jobId: job.id, sourceUrl: job.canonical_url! }, at(15)).state;
assert.equal(state.stage, 'tutorial_processing');
const result = tutorialResultFromShareJob(job, fixture);
assert.ok(result);
const rejected = resolveOnboardingTutorialResult(state, { ...result!, fixtureRevision: 8 }, at(16)).state;
assert.equal(rejected.stage, 'tutorial_processing', 'mismatched provenance cannot reveal or complete');
state = resolveOnboardingTutorialResult(state, result!, at(17)).state;
assert.equal(state.stage, 'tutorial_reveal');
assert.equal(state.tutorialResult?.place.name, 'Attabad Lake');
const confirmation = confirmOnboardingFirstMagicMoment(state, at(18));
assert.equal(confirmation.events[0]?.properties?.time_to_first_save, 17_000, 'first-save timing starts at onboarding start');
assert.equal(confirmation.events[0]?.properties?.time_to_magic_moment, 17_000, 'magic-moment timing starts at onboarding start');
state = confirmation.state;
assert.equal(state.stage, 'tutorial_celebration');
assert.equal(state.tutorialSave?.savedPlaceId, 'saved-attabad');
assert.equal(state.firstMagicMomentCompletedAt, at(18));
assert.equal(state.independentSaves.length, 0, 'one save completes this lesson');
state = apply(state, showOnboardingCelebration, 19);
state = apply(state, finishOnboardingFirstMagicMoment, 20);
assert.equal(state.stage, 'first_magic_moment_complete');
assert.equal(decodeOnboardingV2State(encodeOnboardingV2State(state), at(21)).stage, 'first_magic_moment_complete');

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const ui = read('components/onboarding/v2/OnboardingV2PreAuth.tsx');
assert.match(ui, /assets\/icon\.png/);
for (const platform of ['Instagram', 'TikTok', 'Facebook', 'YouTube']) assert.match(ui, new RegExp(platform));
assert.match(ui, /Linking\.openURL/);
assert.match(ui, /hostShareSubmitter\.submit/);
assert.match(ui, /Find this place/);
assert.doesNotMatch(ui, /Show me how|Add to my map/);
assert.match(ui, /<PlaceImage/);
assert.match(ui, /<MapView/);
assert.match(ui, /AccessibilityInfo\.isReduceMotionEnabled/);
assert.doesNotMatch(ui, /ImmersiveGuidedSave|InstagramReelMock|fake social/i);
const endpoint = read('supabase/functions/get-onboarding-tutorial/index.ts');
assert.match(endpoint, /DEVELOPMENT_HOST/);
assert.match(endpoint, /admin\.auth\.getUser/);
assert.match(endpoint, /preferredPlatform/);
assert.doesNotMatch(endpoint.slice(endpoint.indexOf('return json({'), endpoint.lastIndexOf('});')), /placeName|formattedAddress|latitude|longitude/);
const deploy = read('scripts/deployFunctions.mjs');
assert.match(deploy, /DEVELOPMENT_ONLY_FUNCTIONS[\s\S]*'get-onboarding-tutorial'/);
assert.match(ui, /firstMagicDev = canLoadOnboardingTutorialFixture/);
const shareService = read('services/shareJobsService.ts');
const ordinaryColumns = shareService.slice(shareService.indexOf('const JOB_COLUMNS'), shareService.indexOf('const ONBOARDING_JOB_COLUMNS'));
assert.doesNotMatch(ordinaryColumns, /tutorial_fixture_id|resolution_source/, 'ordinary Production queue query stays schema-compatible');

console.log('PASS Onboarding V2 first magic-moment state, fixture, handoff, provenance, UI, accessibility, and Dev guards');
