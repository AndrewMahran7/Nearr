import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  beginOnboardingSecondHalf,
  beginPermanentAccountLink,
  cancelPermanentAccountLink,
  completeOnboardingSecondHalf,
  completePermanentAccountLink,
  continueOnboardingAfterAuth,
  continueOnboardingAfterMakingNearrYours,
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
  requestOnboardingMapBackup,
  selectOnboardingDesiredValue,
  selectOnboardingPainPoint,
  showOnboardingActivationChallenge,
  startOnboardingAuth,
  type OnboardingTransition,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  canRunOnboardingV2SecondHalf,
  classifyReminderInitialization,
  desiredValueCopy,
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
  interest: 'outdoors', selectedInterests: ['outdoors', 'travel'], painPoint: 'cannot_find_place', desiredValue: 'organize_map',
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
assert.equal(state.stage, 'why_nearr', 'post-reveal momentum bypasses the two legacy questionnaires');
assert.equal(isOnboardingV2InProgressState(state), true);
assert.match(desiredValueCopy(state.desiredValue), /one personal map/);
const nearbyView = continueOnboardingToNearbyValue(state, at(5));
state = nearbyView.state;
assert.equal(nearbyView.events.some((event) => event.name === 'onboarding_nearby_value_viewed'), true);
state = step(state, continueOnboardingToLocationEducation, 6);
assert.equal(state.stage, 'location_education');
state = recordOnboardingForegroundLocationResult(state, 'granted', at(7)).state;
assert.equal(state.stage, 'location_background_education', 'foreground permission is followed by a separate background explanation');
assert.equal(state.locationBackgroundResult, null);
state = recordOnboardingBackgroundLocationResult(state, 'granted', at(8)).state;
assert.equal(state.stage, 'notification_education');
const notification = recordOnboardingNotificationResult(state, 'provisional', at(8));
state = notification.state;
assert.equal(state.stage, 'making_nearr_yours', 'permissions lead to a branded setup handoff, not auth');
assert.equal(notification.events.some((event) => event.name === 'onboarding_making_nearr_yours_viewed'), true);
const mapReady = continueOnboardingAfterMakingNearrYours(state, at(9));
state = mapReady.state;
assert.equal(state.stage, 'personalized_activation');
assert.equal(mapReady.events.some((event) => event.name === 'onboarding_map_ready_viewed'), true);
state = step(state, showOnboardingActivationChallenge, 10);
assert.equal(state.stage, 'activation_challenge');
assert.equal(expectedOnboardingV2Route(state.stage), '/(onboarding)');
const completed = completeOnboardingSecondHalf(state, 'explore_map', at(11));
assert.equal(completed.state.stage, 'onboarding_complete');
assert.equal(completed.state.identityLifecycle, 'anonymous_active', 'permanent auth is not required before map entry');
assert.equal(completed.state.behavioralCompletedAt, at(11));
assert.equal(completed.state.tutorialSave?.savedPlaceId, save.savedPlaceId);
assert.equal(completed.events.some((event) => event.name === 'onboarding_v2_completed'), true);
assert.equal(completed.events.find((event) => event.name === 'onboarding_v2_completed')?.properties?.time_to_map, 11_000);
assert.equal(isOnboardingV2InProgressState(completed.state), false);
assert.equal(expectedOnboardingV2Route(completed.state.stage), '/(tabs)/map');
const restored = decodeOnboardingV2State(encodeOnboardingV2State(completed.state));
assert.equal(restored?.stage, 'onboarding_complete', 'second-half completion survives process restart');
assert.equal(restored?.activationChoice, 'explore_map');
assert.equal(restored?.desiredValue, 'organize_map');
assert.equal(restored?.tutorialSave?.savedPlaceId, save.savedPlaceId);

let denied = step(initial, beginOnboardingSecondHalf, 20);
denied = step(denied, continueOnboardingToNearbyValue, 23);
denied = step(denied, continueOnboardingToLocationEducation, 24);
denied = recordOnboardingForegroundLocationResult(denied, 'restricted', at(25)).state;
assert.equal(denied.stage, 'notification_education', 'location refusal does not block');
denied = recordOnboardingNotificationResult(denied, 'skipped', at(26)).state;
assert.equal(denied.stage, 'making_nearr_yours', 'notification refusal does not block');

const backupRequested = requestOnboardingMapBackup(completed.state, at(27));
assert.equal(backupRequested.state.stage, 'account_required', 'auth is available later as an explicit map backup action');
const backupCancelled = cancelPermanentAccountLink(backupRequested.state, at(28));
assert.equal(backupCancelled.state.stage, 'onboarding_complete', 'backing out of optional auth returns to the map');
const established = completePermanentAccountLink(
  beginPermanentAccountLink(backupRequested.state, at(28)).state,
  { permanentUserId: 'existing-user', destinationWasEstablished: true, tutorialSavedPlaceId: 'existing-deduped-place' },
  at(30),
);
assert.equal(established.state.stage, 'onboarding_complete', 'later account conversion returns to the completed map');
assert.equal(established.state.tutorialSave?.savedPlaceId, 'existing-deduped-place', 'existing canonical place is reused rather than duplicated');
assert.equal(established.events.some((event) => event.name === 'onboarding_map_backup_completed'), true);

const root = process.cwd();
const ui = readFileSync(join(root, 'components/onboarding/v2/OnboardingV2SecondHalf.tsx'), 'utf8');
const permissions = readFileSync(join(root, 'lib/onboardingV2SecondHalf.ts'), 'utf8');
const account = readFileSync(join(root, 'app/(onboarding)/account.tsx'), 'utf8');
const routing = readFileSync(join(root, 'lib/postAuthRouting.ts'), 'utf8');
const layout = readFileSync(join(root, 'app/_layout.tsx'), 'utf8');
const settings = readFileSync(join(root, 'app/(tabs)/settings.tsx'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20260822000001_anonymous_onboarding_v2.sql'), 'utf8');
assert.match(ui, /requestOnboardingForegroundLocation/);
assert.match(ui, /requestOnboardingBackgroundLocation/);
assert.match(ui, /Get a reminder even when Nearr isn't open/);
assert.match(ui, /Allow Once/);
assert.match(ui, /AppState\.addEventListener/);
assert.match(ui, /Linking\.openSettings/);
assert.match(ui, /requestOnboardingNotifications/);
assert.match(ui, /Background access is explained separately/);
assert.match(permissions, /getBackgroundPermissionsAsync/);
assert.match(permissions, /requestBackgroundPermissionsAsync/);
assert.match(ui, /Your map keeps the place, its original post, and directions together/);
assert.match(ui, /Explore my map/);
assert.match(ui, /MAKING NEARR YOURS/);
assert.match(ui, /No account setup is needed/);
assert.match(account, /recordOnboardingV2AuthFailed/);
assert.match(account, /assets\/icon\.png/);
assert.match(account, /More options/);
assert.match(routing, /continueOnboardingV2/);
assert.match(layout, /signedInSecondHalfContinuation/);
assert.match(layout, /onboardingV2CompletedAt/);
assert.match(settings, /Linking\.openSettings\(\)/, 'permission refusal has a durable recovery path in Settings');
assert.match(settings, /Back up your map/);
assert.match(migration, /where user_id = v_destination and place_id = v_place_id/);
assert.match(migration, /delete from public\.saved_places where id = v_source_saved/);
assert.match(migration, /update public\.saved_places set user_id = v_destination/);

let backgroundDenied = step(initial, beginOnboardingSecondHalf, 31);
backgroundDenied = step(backgroundDenied, continueOnboardingToNearbyValue, 34);
backgroundDenied = step(backgroundDenied, continueOnboardingToLocationEducation, 35);
backgroundDenied = recordOnboardingForegroundLocationResult(backgroundDenied, 'granted', at(36), { requested: false }).state;
const deniedAttempt = recordOnboardingBackgroundLocationResult(backgroundDenied, 'restricted', at(37), { requested: true, advance: false });
backgroundDenied = deniedAttempt.state;
assert.equal(backgroundDenied.stage, 'location_background_education', 'a denied background request stays recoverable');
assert.equal(deniedAttempt.events.some((event) => event.name === 'onboarding_location_permission_requested'), true);
backgroundDenied = recordOnboardingBackgroundLocationResult(backgroundDenied, 'granted', at(38), { requested: false, advance: true }).state;
assert.equal(backgroundDenied.stage, 'notification_education', 'Settings return advances only after verified background access');

assert.equal(classifyReminderInitialization({ backgroundLocation: 'granted', notifications: 'granted', proximity: 'started', geofence: 'started', push: 'fulfilled' }), 'ready');
assert.equal(classifyReminderInitialization({ backgroundLocation: 'granted', notifications: 'granted', proximity: 'started', geofence: 'skipped', push: 'rejected' }), 'partial');
assert.equal(classifyReminderInitialization({ backgroundLocation: 'granted', notifications: 'granted', proximity: 'skipped', geofence: 'stopped', push: 'fulfilled' }), 'pending');
assert.equal(classifyReminderInitialization({ backgroundLocation: 'denied', notifications: 'granted', proximity: 'skipped', geofence: 'stopped', push: 'fulfilled' }), 'not_eligible');
assert.equal(classifyReminderInitialization({ backgroundLocation: 'granted', notifications: 'granted', proximity: 'rejected', geofence: 'rejected', push: 'rejected' }), 'failed');

const legacyPain = selectOnboardingPainPoint({ ...initial, stage: 'pain_point' }, 'saved_and_forgotten', at(39));
assert.equal(legacyPain.state.stage, 'why_nearr', 'a persisted legacy pain question does not stack a second questionnaire');
const legacyDesired = selectOnboardingDesiredValue({ ...initial, stage: 'desired_value' }, 'find_real_places', at(40));
assert.equal(legacyDesired.state.stage, 'why_nearr', 'a persisted desired-value checkpoint remains migratable');

console.log('PASS Onboarding V2 second-half value, permissions, auth transfer, activation, completion, and Development guards');
