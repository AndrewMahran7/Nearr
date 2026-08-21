import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  decideNotificationRouterOperation,
  notificationShellReady,
  NotificationTapQueue,
  resolveNotificationDestination,
  type NotificationDestination,
} from '../lib/notificationTapRouting';

const resolve = (data: Record<string, unknown>): NotificationDestination =>
  resolveNotificationDestination({ data, isDefaultTap: true }).destination;
const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');

// A. Single nearby -> canonical saved-place/map focus.
assert.deepEqual(
  resolve({ savedPlaceId: 'sp-near', placeId: 'place-near' }),
  { kind: 'saved_place', savedPlaceId: 'sp-near', reminder: true },
);

// B. Nearby group -> grouped nearby view, preserving exact delivered ids.
assert.deepEqual(
  resolve({
    savedPlaceId: 'sp-a',
    placeId: 'place-a',
    nearbyCount: 3,
    groupedSavedPlaceIds: ['sp-a', 'sp-b', 'sp-c'],
  }),
  { kind: 'nearby_group', savedPlaceIds: ['sp-a', 'sp-b', 'sp-c'] },
);

// C. Auto-saved/already-saved result -> saved place.
assert.deepEqual(
  resolve({
    type: 'share_job_completed',
    outcome: 'already_saved',
    jobId: 'job-auto',
    savedPlaceId: 'sp-auto',
    googlePlaceId: 'gp-auto',
  }),
  {
    kind: 'saved_place',
    savedPlaceId: 'sp-auto',
    googlePlaceId: 'gp-auto',
    reminder: false,
  },
);

// D/E/G. Every actionable result uses the existing job review/detail route.
for (const reviewMode of ['single', 'candidate_picker', 'multi', 'manual']) {
  assert.deepEqual(
    resolve({ type: 'share_job_needs_help', jobId: `job-${reviewMode}`, reviewMode }),
    { kind: 'share_job', jobId: `job-${reviewMode}` },
  );
}

// F. Partial multi result must review unresolved slots, not jump to saved ids.
assert.deepEqual(
  resolve({
    type: 'share_job_needs_help',
    outcome: 'mixed',
    jobId: 'job-partial',
    savedPlaceIds: ['sp-1', 'sp-2'],
    reviewCount: 2,
  }),
  { kind: 'share_job', jobId: 'job-partial' },
);

// Completed multi-place result frames all saved places on the map.
assert.deepEqual(
  resolve({
    type: 'share_job_completed',
    outcome: 'completed',
    jobId: 'job-multi',
    savedPlaceId: 'sp-1',
    savedPlaceIds: ['sp-1', 'sp-2', 'sp-2'],
  }),
  { kind: 'saved_group', savedPlaceIds: ['sp-1', 'sp-2'] },
);

// H. Deleted saved-place data is resolved locally by the canonical map owner.
const mapSource = read('app/(tabs)/map.tsx');
assert.match(mapSource, /decision === 'missing'/);
assert.match(mapSource, /This place is no longer available\./);

// I. Missing job id -> queue; the detail itself handles deleted/archived rows.
const missingJob = resolveNotificationDestination({
  data: { type: 'share_job_needs_help' },
  isDefaultTap: true,
});
assert.deepEqual(missingJob.destination, { kind: 'share_queue' });
assert.equal(missingJob.fallbackReason, 'missing_share_job_id');
const detailSource = read('app/share-jobs/[jobId].tsx');
assert.match(detailSource, /This save is no longer available\./);
assert.match(detailSource, /This item is no longer in your queue\./);

// J/K. Same response twice -> one intent; distinct request ids remain routable.
const queue = new NotificationTapQueue();
const response = {
  notificationId: 'request-1',
  actionIdentifier: 'default',
  isDefaultTap: true,
  data: { type: 'share_job_needs_help', jobId: 'job-1' },
  origin: 'cold' as const,
};
assert.equal(queue.capture(response).status, 'accepted');
assert.equal(queue.capture(response).status, 'duplicate');
assert.equal(queue.capture({ ...response, notificationId: 'request-2' }).status, 'accepted');
assert.equal(queue.drain(true).length, 2);

// L. Cold capture never gates root render; only draining waits for auth/route.
const coldQueue = new NotificationTapQueue();
assert.equal(coldQueue.capture(response).status, 'accepted');
assert.deepEqual(coldQueue.drain(false), []);
assert.equal(coldQueue.pendingCount(), 1);
assert.equal(notificationShellReady({ authReady: false, pathname: '/map', rootSegment: '(tabs)' }), false);
assert.equal(notificationShellReady({ authReady: true, pathname: '/', rootSegment: null }), false);
assert.equal(notificationShellReady({ authReady: true, pathname: '/account', rootSegment: '(onboarding)' }), false);
assert.equal(notificationShellReady({ authReady: true, pathname: '/map', rootSegment: '(tabs)' }), true);
assert.equal(coldQueue.drain(true).length, 1);

// M. Already-open non-param destinations do not create redundant routes.
assert.deepEqual(decideNotificationRouterOperation({ kind: 'map' }, '/(tabs)/map'), {
  action: 'none',
  reason: 'destination_already_open',
});
assert.deepEqual(
  decideNotificationRouterOperation({ kind: 'share_job', jobId: 'same' }, '/share-jobs/same'),
  { action: 'none', reason: 'destination_already_open' },
);
assert.deepEqual(
  decideNotificationRouterOperation({ kind: 'share_job', jobId: 'next' }, '/share-jobs/current'),
  { action: 'replace', reason: 'switch_share_job_detail' },
);

// N. Copy is irrelevant: only structured `content.data` reaches the resolver.
const structured = { type: 'share_job_needs_help', jobId: 'copy-proof', reviewMode: 'single' };
assert.deepEqual(resolve(structured), resolve({ ...structured }));
const controllerSource = read('components/NotificationTapController.tsx');
assert.match(controllerSource, /request\.content\.data/);
assert.doesNotMatch(controllerSource, /content\.(?:title|body)/);

// O. Already-issued unversioned payloads remain supported.
const legacyShare = resolveNotificationDestination({
  data: { type: 'share_job_completed', jobId: 'old', savedPlaceId: 'old-sp' },
  isDefaultTap: true,
});
assert.equal(legacyShare.payloadVersion, 'unversioned');
assert.deepEqual(legacyShare.destination, {
  kind: 'saved_place',
  savedPlaceId: 'old-sp',
  reminder: false,
});
assert.deepEqual(resolve({ savedPlaceId: 'legacy-near', placeId: 'legacy-place' }), {
  kind: 'saved_place',
  savedPlaceId: 'legacy-near',
  reminder: true,
});

// Invalid structured data and unknown/technical types stay on rendered UI.
assert.deepEqual(resolve(null as unknown as Record<string, unknown>), { kind: 'none' });
assert.deepEqual(resolve({ type: 'share_job_failed', jobId: 'failed' }), { kind: 'none' });

// Action taps remain non-navigation mutations and retain only safe ids.
assert.deepEqual(
  resolveNotificationDestination({
    data: { savedPlaceId: 'sp-action', placeId: 'p-action' },
    isDefaultTap: false,
    actionIdentifier: 'reset_count',
  }).destination,
  {
    kind: 'action',
    actionIdentifier: 'reset_count',
    savedPlaceId: 'sp-action',
    placeId: 'p-action',
  },
);

// Structural black-screen guard: response APIs/state are outside RootLayout.
const root = read('app/_layout.tsx');
assert.doesNotMatch(root, /getLastNotificationResponseAsync|addNotificationResponseReceivedListener/);
assert.doesNotMatch(root, /useRootNavigationState|lastNotificationResponse|pendingNotification/);
assert.match(root, /<NotificationTapController authReady=/);
assert.match(controllerSource, /clearLastNotificationResponseAsync/);
assert.doesNotMatch(controllerSource, /dismissAll|useRootNavigationState|resetRoot/);

console.log('PASS centralized notification tap routing, startup safety, stale fallback, and exactly-once delivery');
