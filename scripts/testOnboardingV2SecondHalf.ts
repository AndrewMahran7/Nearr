import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  beginOnboardingSecondHalf,
  beginPermanentAccountLink,
  completeOnboardingSecondHalf,
  completePermanentAccountLink,
  continueOnboardingAfterAuth,
  continueOnboardingToAccount,
  continueOnboardingToLocationEducation,
  continueOnboardingToNearbyValue,
  createInitialOnboardingV2State,
  decodeOnboardingV2State,
  encodeOnboardingV2State,
  failOnboardingAuth,
  isOnboardingV2InProgressState,
  recordOnboardingBackgroundLocationResult,
  recordOnboardingForegroundLocationResult,
  recordOnboardingNotificationResult,
  showOnboardingActivationChallenge,
  startOnboardingAuth,
  type OnboardingTransition,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  canRunOnboardingV2SecondHalf,
  interestExample,
  isSignedInOnboardingV2Continuation,
  normalizeOnboardingPermission,
  painPointValueCopy,
  personalizedActivationCopy,
  platformLaunchUrl,
} from '../lib/onboardingV2SecondHalfCore';
import { expectedOnboardingV2Route } from '../lib/onboardingV2RoutingCore';

const at = (second: number) => `2026-09-10T10:00:${String(second).padStart(2, '0')}.000Z`;
const save = {
  kind: 'tutorial' as const,
  contentId: 'rrKmN3zZ0lM',
  sourceUrl: 'https://www.youtube.com/watch?v=rrKmN3zZ0lM',
  normalizedSourceUrl: 'https://www.youtube.com/watch?v=rrKmN3zZ0lM',
  contentIdentity: { platform: 'youtube' as const, contentId: 'rrkmn3zz0lm' },
  savedPlaceId: 'anonymous-saved-place',
  completedAt: at(1),
};
const result = {
  jobId: 'job', savedPlaceId: save.savedPlaceId,
  fixtureId: '1c19f2d2-a020-4508-9fe3-ef9ef8bb052a', fixtureRevision: 7,
  fixtureRole: 'primary' as const, resolutionSource: 'tutorial_fixture' as const,
  sourceUrl: save.sourceUrl,
  place: { googlePlaceId: 'ChIJHxRxLN2p6DgRMd2q59otvqI', name: 'Attabad Lake', formattedAddress: 'Hunza Valley, Pakistan', latitude: 36.31, longitude: 74.87, primaryType: 'tourist_attraction', typeLabel: 'Tourist attraction', photoUrl: null, photoUrls: [] },
};
const initial: OnboardingV2State = {
  ...createInitialOnboardingV2State(at(0)),
  cohort: 'new_user_v2', stage: 'first_magic_moment_complete', startedAt: at(0),
  preferredPlatform: 'instagram', selectedPlatforms: ['instagram', 'youtube'],
  interest: 'outdoors', selectedInterests: ['outdoors', 'travel'], painPoint: 'cannot_find_place',
  firstMagicMomentCompletedAt: at(1), phase1CompletedAt: at(1), tutorialSave: save,
  tutorialResult: result, funnelSessionId: '11111111-1111-4111-8111-111111111111',
  identityLifecycle: 'anonymous_active', anonymousUserId: 'anonymous-user', boundUserId: 'anonymous-user',
};
const step = (state: OnboardingV2State, reducer: (state: OnboardingV2State, now: string) => OnboardingTransition, second: number) => reducer(state, at(second)).state;

assert.equal(canRunOnboardingV2SecondHalf({ appEnv: 'development', backendEnv: 'development', appEnvWasDefaulted: false, backendEnvWasDefaulted: false, supabaseProjectRef: 'qnfxnmvxpjzfydgudtvs' }), true);
assert.equal(canRunOnboardingV2SecondHalf({ appEnv: 'production', backendEnv: 'production', appEnvWasDefaulted: false, backendEnvWasDefaulted: false, supabaseProjectRef: 'rlqvxdwtetxsqxhqztkw' }), false);
assert.equal(normalizeOnboardingPermission({ status: 'granted', canAskAgain: false }), 'granted');
assert.equal(normalizeOnboardingPermission({ status: 'denied', canAskAgain: true }), 'denied');
assert.equal(normalizeOnboardingPermission({ status: 'denied', canAskAgain: false }), 'restricted');
assert.equal(normalizeOnboardingPermission({ status: 'granted', provisional: true }), 'provisional');
assert.match(painPointValueCopy('cannot_find_place'), /actual place/);
assert.match(interestExample(['outdoors']), /viewpoints/);
assert.match(personalizedActivationCopy({ platform: 'instagram', interest: 'outdoors' }), /outdoor spot/);
assert.equal(platformLaunchUrl('youtube'), 'https://www.youtube.com/shorts/');

let state = step(initial, beginOnboardingSecondHalf, 2);
assert.equal(state.stage, 'why_nearr');
assert.equal(isOnboardingV2InProgressState(state), true);
state = step(state, continueOnboardingToNearbyValue, 3);
state = step(state, continueOnboardingToLocationEducation, 4);
assert.equal(state.stage, 'location_education');
state = recordOnboardingForegroundLocationResult(state, 'granted', at(5)).state;
assert.equal(state.stage, 'notification_education', 'onboarding requests foreground location only');
assert.equal(state.locationBackgroundResult, 'skipped');
state = recordOnboardingNotificationResult(state, 'provisional', at(7)).state;
assert.equal(state.stage, 'account_required', 'growing-map value is merged into final activation');
state = startOnboardingAuth(state, 'google', at(9)).state;
const cancelledAuth = failOnboardingAuth(state, 'google', 'cancelled', at(10));
assert.equal(cancelledAuth.state.stage, 'account_required', 'auth cancellation preserves the retryable screen');
assert.equal(cancelledAuth.state.authLastResult, 'cancelled');
state = startOnboardingAuth(cancelledAuth.state, 'google', at(10)).state;
state = step(state, beginPermanentAccountLink, 10);
const auth = completePermanentAccountLink(state, { permanentUserId: 'new-permanent-user', destinationWasEstablished: false, tutorialSavedPlaceId: save.savedPlaceId }, at(11));
assert.equal(auth.state.stage, 'auth_success');
assert.equal(auth.state.tutorialSave?.savedPlaceId, save.savedPlaceId, 'in-place/new-account link preserves the same saved row');
assert.equal(auth.events.some((event) => event.name === 'onboarding_auth_completed'), true);
state = step(auth.state, continueOnboardingAfterAuth, 12);
state = step(state, showOnboardingActivationChallenge, 13);
assert.equal(state.stage, 'activation_challenge');
assert.equal(isSignedInOnboardingV2Continuation(state.stage), true);
assert.equal(expectedOnboardingV2Route(state.stage), '/(onboarding)');
const completed = completeOnboardingSecondHalf(state, 'explore_map', at(14));
assert.equal(completed.state.stage, 'onboarding_complete');
assert.equal(completed.state.behavioralCompletedAt, at(14));
assert.equal(completed.state.tutorialSave?.savedPlaceId, save.savedPlaceId);
assert.equal(completed.events.some((event) => event.name === 'onboarding_v2_completed'), true);
assert.equal(completed.events.find((event) => event.name === 'onboarding_v2_completed')?.properties?.time_to_map, 14_000);
assert.equal(isOnboardingV2InProgressState(completed.state), false);
assert.equal(expectedOnboardingV2Route(completed.state.stage), '/(tabs)/map');
const restored = decodeOnboardingV2State(encodeOnboardingV2State(completed.state));
assert.equal(restored?.stage, 'onboarding_complete', 'second-half completion survives process restart');
assert.equal(restored?.activationChoice, 'explore_map');
assert.equal(restored?.tutorialSave?.savedPlaceId, save.savedPlaceId);

let denied = step(initial, beginOnboardingSecondHalf, 20);
denied = step(denied, continueOnboardingToNearbyValue, 21);
denied = step(denied, continueOnboardingToLocationEducation, 22);
denied = recordOnboardingForegroundLocationResult(denied, 'restricted', at(23)).state;
assert.equal(denied.stage, 'notification_education', 'location refusal does not block');
denied = recordOnboardingNotificationResult(denied, 'skipped', at(24)).state;
assert.equal(denied.stage, 'account_required', 'notification refusal does not block');

const established = completePermanentAccountLink(
  { ...state, stage: 'account_required', identityLifecycle: 'permanent_account_linking', tutorialSave: save },
  { permanentUserId: 'existing-user', destinationWasEstablished: true, tutorialSavedPlaceId: 'existing-deduped-place' },
  at(30),
);
assert.equal(established.state.stage, 'auth_success', 'an existing account continues the second half');
assert.equal(established.state.tutorialSave?.savedPlaceId, 'existing-deduped-place', 'existing canonical place is reused rather than duplicated');

const root = process.cwd();
const ui = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2SecondHalf.tsx'), 'utf8');
const account = readFileSync(join(root, 'app/(onboarding)/account.tsx'), 'utf8');
const routing = readFileSync(join(root, 'lib/postAuthRouting.ts'), 'utf8');
const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260822000001_anonymous_onboarding_v2.sql'), 'utf8');
assert.match(ui, /requestOnboardingForegroundLocation/);
assert.doesNotMatch(ui, /requestOnboardingBackgroundLocation/);
assert.match(ui, /requestOnboardingNotifications/);
assert.match(ui, /Foreground access only during onboarding/);
assert.match(ui, /Share a post straight to Nearr/);
assert.match(ui, /Explore my map/);
assert.match(account, /recordOnboardingV2AuthFailed/);
assert.match(account, /assets\/icon\.png/);
assert.match(account, /More options/);
assert.match(routing, /continueOnboardingV2/);
assert.match(layout, /signedInSecondHalfContinuation/);
assert.match(layout, /onboardingV2CompletedAt/);
assert.match(settings, /Linking\.openSettings\(\)/, 'permission refusal has a durable recovery path in Settings');
assert.match(migration, /where user_id = v_destination and place_id = v_place_id/);
assert.match(migration, /delete from public\.saved_places where id = v_source_saved/);
assert.match(migration, /update public\.saved_places set user_id = v_destination/);

console.log('PASS Onboarding V2 second-half value, permissions, auth transfer, activation, completion, and Development guards');
