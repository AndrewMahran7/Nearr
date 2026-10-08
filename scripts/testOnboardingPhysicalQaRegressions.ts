import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  beginOnboardingRealPractice,
  completeOnboardingSecondHalf,
  createInitialOnboardingV2State,
  deferOnboardingPractice,
  isOnboardingPracticeJobMatch,
  markOnboardingPracticeWaitingForShare,
  openExternalStarter,
  reconcileOnboardingPracticeJob,
  type OnboardingPracticeJobObservation,
  type OnboardingTutorialResult,
  type OnboardingV2State,
} from '../lib/onboardingV2Core';
import {
  ONBOARDING_PHASE2_PRACTICE,
  onboardingPhase2PracticeFixture,
} from '../lib/onboardingPhase2Practice';
import {
  resolveMapChromeDecision,
  shouldShowLocalTutorialPlace,
  shouldShowOnboardingStarterFilters,
} from '../lib/onboardingV2MapPresentation';
import { mapFilterOptions } from '../lib/mapVisibility';
import {
  realSavedPlaceIds,
  requireRealSavedPlaceId,
  savedPlaceUuidOrNull,
} from '../lib/savedPlaceIdentity';
import {
  isOnboardingTransferNetworkError,
  onboardingTransferErrorCopy,
} from '../lib/onboardingTransferErrors';
import { requiresAnonymousTransferPreparation } from '../lib/onboardingAuthIntentCore';
import type { SavedPlaceWithPlace } from '../types';

const root = path.resolve(__dirname, '..');
const at = (second: number) => `2026-09-28T18:49:${String(second).padStart(2, '0')}.000Z`;
const realId = '123e4567-e89b-42d3-a456-426614174000';
const syntheticId = 'onboarding-scripted-save:onboarding-place-hydra-old-town';

const tutorialResult: OnboardingTutorialResult = {
  jobId: 'onboarding-scripted-job',
  savedPlaceId: syntheticId,
  fixtureId: 'onboarding-place-hydra-old-town',
  fixtureRevision: 1,
  fixtureRole: 'primary',
  resolutionSource: 'onboarding_scripted',
  sourceUrl: 'onboarding://hydra-old-town',
  place: {
    googlePlaceId: 'onboarding-place-hydra-old-town', name: 'Hydra Old Town',
    formattedAddress: 'Hydra, Greece', latitude: 37.349, longitude: 23.466,
    primaryType: 'tourist_attraction', typeLabel: 'Historic district', photoUrl: null, photoUrls: [],
  },
};

function phase2Base(): OnboardingV2State {
  return {
    ...createInitialOnboardingV2State(at(0), 'install-qa'),
    cohort: 'new_user_v2',
    stage: 'phase2_intro',
    identityLifecycle: 'anonymous_active',
    anonymousUserId: 'anonymous-user',
    boundUserId: 'anonymous-user',
    funnelSessionId: '223e4567-e89b-42d3-a456-426614174000',
    tutorialResult,
    tutorialFixture: onboardingPhase2PracticeFixture(at(0)),
    tutorialSave: {
      kind: 'tutorial', contentId: 'hydra', sourceUrl: tutorialResult.sourceUrl,
      normalizedSourceUrl: 'onboarding://hydra-old-town', contentIdentity: null,
      savedPlaceId: syntheticId, completedAt: at(0),
    },
    firstMagicMomentCompletedAt: at(0),
    phase1CompletedAt: at(0),
  };
}

function guided(): OnboardingV2State {
  const fixture = onboardingPhase2PracticeFixture(at(1));
  const begun = beginOnboardingRealPractice(phase2Base(), at(1), fixture, {
    name: ONBOARDING_PHASE2_PRACTICE.expectedPlaceName,
  }).state;
  const opened = openExternalStarter(begun, {
    contentId: fixture.contentId,
    sourceUrl: fixture.canonicalUrl,
  }, at(2)).state;
  return markOnboardingPracticeWaitingForShare(opened, at(3)).state;
}

function job(status: string, overrides: Partial<OnboardingPracticeJobObservation> = {}): OnboardingPracticeJobObservation {
  return {
    jobId: '323e4567-e89b-42d3-a456-426614174000',
    clientRequestId: 'ios-share-request-qa',
    sourceUrl: ONBOARDING_PHASE2_PRACTICE.canonicalUrl,
    status,
    savedPlaceId: null,
    failureReason: null,
    observedAt: at(4),
    ...overrides,
  };
}

let count = 0;
function test(name: string, run: () => void) {
  run();
  count += 1;
  console.log(`PASS ${count}: ${name}`);
}

// Phase 2 — tests 1–10.
test('expected durable job leaves Open practice video state', () => {
  const observation = job('queued');
  const next = reconcileOnboardingPracticeJob(guided(), observation, at(5)).state;
  assert.equal(next.realPracticeSession?.status, 'SHARE_RECEIVED');
  assert.equal(next.realPracticeSession?.shareJobId, observation.jobId);
  assert.equal(reconcileOnboardingPracticeJob(next, observation, at(6)).changed, false);
});
test('processing job exposes real processing state', () => {
  assert.equal(reconcileOnboardingPracticeJob(guided(), job('processing_metadata'), at(5)).state.realPracticeSession?.status, 'PROCESSING');
});
test('needs-review job exposes review state', () => {
  assert.equal(reconcileOnboardingPracticeJob(guided(), job('needs_help'), at(5)).state.realPracticeSession?.status, 'NEEDS_REVIEW');
});
test('completed review resolves guided practice', () => {
  const review = reconcileOnboardingPracticeJob(guided(), job('needs_help'), at(5)).state;
  const resolved = reconcileOnboardingPracticeJob(review, job('completed', { savedPlaceId: realId }), at(6)).state;
  assert.equal(resolved.realPracticeSession?.status, 'RESOLVED');
  assert.equal(resolved.realPracticeSession?.completionReason, 'resolved');
});
test('directly completed job resolves guided practice', () => {
  const resolved = reconcileOnboardingPracticeJob(guided(), job('completed', { savedPlaceId: realId }), at(6)).state;
  assert.equal(resolved.independentSaves[0]?.savedPlaceId, realId);
});
test('failed job exposes retryable real failure', () => {
  const failed = reconcileOnboardingPracticeJob(guided(), job('failed', { failureReason: 'media_unavailable' }), at(6)).state;
  assert.equal(failed.realPracticeSession?.status, 'FAILED');
  assert.equal(failed.realPracticeSession?.failureReason, 'media_unavailable');
});
test('return without share remains waiting', () => {
  assert.equal(guided().realPracticeSession?.status, 'WAITING_FOR_SHARE');
});
test('unrelated share cannot bind guided practice', () => {
  const unrelated = job('completed', { jobId: '423e4567-e89b-42d3-a456-426614174000', sourceUrl: 'https://www.instagram.com/p/OTHERPOST/' });
  assert.equal(isOnboardingPracticeJobMatch(guided().realPracticeSession, unrelated), false);
  assert.equal(reconcileOnboardingPracticeJob(guided(), unrelated, at(6)).changed, false);
});
test('explicit later records declined completion reason', () => {
  const deferred = deferOnboardingPractice(guided(), at(7)).state;
  assert.equal(deferred.realPracticeSession?.status, 'DECLINED');
  assert.equal(deferred.realPracticeSession?.completionReason, 'declined');
});
test('active guided job blocks silent graduation', () => {
  const active = { ...guided(), stage: 'activation_challenge' as const };
  assert.equal(completeOnboardingSecondHalf(active, 'explore_map', at(8)).changed, false);
});

// Synthetic id/auth — tests 11–20.
test('server UUID projection omits scripted tutorial id', () => {
  assert.equal(savedPlaceUuidOrNull(syntheticId), null);
});
test('tutorial-only backup has a valid empty real-transfer set', () => {
  assert.deepEqual(realSavedPlaceIds([syntheticId]), []);
});
test('tutorial plus real save transfers only the real UUID', () => {
  assert.deepEqual(realSavedPlaceIds([syntheticId, realId]), [realId]);
});
test('established-account sign-in skips transfer preparation', () => {
  assert.equal(requiresAnonymousTransferPreparation('existing_account_sign_in'), false);
});
test('synthetic id is rejected at real saved-place mutation boundary', () => {
  assert.throws(
    () => requireRealSavedPlaceId(syntheticId, 'test'),
    (error: unknown) => error instanceof Error
      && (error as Error & { code?: string }).code === 'local_saved_place_not_server_addressable'
      && /stored only on this device/i.test(error.message),
  );
});
test('scripted id can never become a UUID parameter', () => {
  assert.equal(savedPlaceUuidOrNull(syntheticId), null);
  assert.doesNotMatch(String(savedPlaceUuidOrNull(syntheticId)), /onboarding-scripted-save/);
});
test('transfer migration never inserts a fake saved_places row', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260928000001_onboarding_real_saved_place_transfer.sql'), 'utf8');
  assert.doesNotMatch(sql, /insert\s+into\s+public\.saved_places/i);
});
test('local tutorial fixture remains UI-visible', () => {
  const state = { ...phase2Base(), behavioralCompletedAt: at(9), stage: 'onboarding_complete' as const };
  assert.equal(shouldShowLocalTutorialPlace(state), true);
});
test('real anonymous saves retain a server transfer path', () => {
  const sql = fs.readFileSync(path.join(root, 'supabase/migrations/20260928000001_onboarding_real_saved_place_transfer.sql'), 'utf8');
  assert.match(sql, /update public\.saved_places set user_id = v_destination/);
  assert.match(sql, /where user_id = v_grant\.source_user_id/);
});
test('only actual network failures receive connection copy', () => {
  assert.equal(isOnboardingTransferNetworkError(new TypeError('Network request failed')), true);
  assert.match(onboardingTransferErrorCopy(new TypeError('Network request failed'), 'backup'), /connection/i);
  assert.doesNotMatch(onboardingTransferErrorCopy(new Error('onboarding_session_not_transferable'), 'backup'), /connection/i);
});

// Map runtime — tests 21–30.
const graduated = { ...phase2Base(), behavioralCompletedAt: at(10), onboardingV2CompletedAt: at(10), stage: 'onboarding_complete' as const };
const fixturePlace = {
  id: syntheticId, user_id: 'local', place_id: 'hydra', radius_value: null, radius_unit: null,
  notes: null, ai_note: null, source_type: 'instagram', source_url: tutorialResult.sourceUrl,
  notifications_enabled: false, last_notified_at: null, notification_count: 0,
  reminder_opportunity_count: 0, archived_at: null, visited_at: null, reminders_exhausted_at: null,
  category: 'other', created_at: at(0), updated_at: at(0),
  place: { id: 'hydra', google_place_id: 'hydra', name: 'Hydra Old Town', formatted_address: 'Hydra, Greece', latitude: 37.349, longitude: 23.466, category: 'Historic district', google_type_label: 'Historic district', google_maps_url: null, created_at: at(0) },
} as SavedPlaceWithPlace;
const options = mapFilterOptions(fixturePlace ? [fixturePlace] : [], ['food_drink', 'outdoors']);
const chrome = resolveMapChromeDecision({ phase2MapActive: false, onboardingState: graduated, searchVisible: false, nearbyExplorerActive: false, hasSelectedPlace: false, previewExpanded: false, filterOptionCount: options.length });

test('graduated normal map renders filter row', () => assert.equal(chrome.filterRowRendered, true));
test('All places remains visible', () => assert.equal(options.some((option) => option.label === 'All places'), true));
test('Food & drink remains visible', () => assert.equal(options.some((option) => option.label === 'Food & drink'), true));
test('Outdoors remains visible', () => assert.equal(options.some((option) => option.label === 'Outdoors'), true));
test('normal map Queue eligibility is not suppressed', () => assert.equal(chrome.suppressionReason, 'none'));
test('normal map Settings route contract remains available', () => {
  const layout = fs.readFileSync(path.join(root, 'app/(tabs)/_layout.tsx'), 'utf8');
  assert.match(layout, /name="settings"/);
});
test('graduated onboarding does not own map chrome', () => assert.equal(chrome.onboardingOwnsMap, false));
test('tutorial fixture keeps starter filters without owning map', () => {
  assert.equal(shouldShowOnboardingStarterFilters(graduated), true);
  assert.equal(chrome.onboardingOwnsMap, false);
});
test('active Phase 2 intentionally owns its map presentation', () => {
  const phase2 = resolveMapChromeDecision({ phase2MapActive: true, onboardingState: guided(), searchVisible: false, nearbyExplorerActive: false, hasSelectedPlace: false, previewExpanded: false, filterOptionCount: options.length });
  assert.equal(phase2.onboardingOwnsMap, true);
});
test('Phase 2 end deterministically restores canonical chrome', () => {
  assert.equal(chrome.topChromeRendered, true);
  assert.equal(chrome.filterRowRendered, true);
  assert.equal(chrome.onboardingOwnsMap, false);
});

assert.equal(count, 30);
console.log('Onboarding physical-QA regressions: 30/30 passed.');
