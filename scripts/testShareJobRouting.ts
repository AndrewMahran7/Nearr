/**
 * scripts/testShareJobRouting.ts
 *
 * Unit tests for the PURE share-job queue-visibility + notification-routing
 * policy (lib/shareJobRouting.ts). No RN / Deno / IO. Proves the queue hides
 * terminal jobs, the badge agrees with the screen, a delayed realtime event
 * cannot re-add a resolved card, and every notification / stale deep link
 * resolves to a SAFE, outcome-aware route (never a throw).
 *
 * Run: npx ts-node -P scripts/tsconfig.json scripts/testShareJobRouting.ts
 */

import {
  isProcessingStatus,
  isQueueVisibleStatus,
  isTerminalHiddenStatus,
  badgeCountsStatus,
  filterQueueVisible,
  classifyShareJobDetail,
  routeShareJobNotification,
  routeShareJobCard,
  shouldReplaceShareJobDetail,
  type ShareJobRoute,
} from '../lib/shareJobRouting';

let failures = 0;
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) console.log(`PASS ${name}`);
  else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}
function eq(a: ShareJobRoute | null, b: ShareJobRoute | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

// ---- Visibility policy -----------------------------------------------------
check('queued visible', isQueueVisibleStatus('queued'));
check('processing_metadata visible', isQueueVisibleStatus('processing_metadata'));
check('needs_help visible', isQueueVisibleStatus('needs_help'));
check('failed visible (actionable recovery)', isQueueVisibleStatus('failed'));
check('completed hidden', !isQueueVisibleStatus('completed'));
check('cancelled hidden', !isQueueVisibleStatus('cancelled'));
check('unknown status hidden', !isQueueVisibleStatus('something_new'));
check('null status hidden', !isQueueVisibleStatus(null));
check('completed is terminal-hidden', isTerminalHiddenStatus('completed'));
check('cancelled is terminal-hidden', isTerminalHiddenStatus('cancelled'));
check('queued not processing-hidden but is processing', isProcessingStatus('queued'));
check('needs_help not processing', !isProcessingStatus('needs_help'));

// ---- filterQueueVisible: terminal removed; delayed insert cannot re-add ----
const mixed = [
  { id: 'a', status: 'queued' },
  { id: 'b', status: 'needs_help' },
  { id: 'c', status: 'completed' }, // accepted / already-saved
  { id: 'd', status: 'cancelled' }, // denied / dismissed
  { id: 'e', status: 'failed' },
  { id: 'f', status: 'processing_metadata' },
];
const visible = filterQueueVisible(mixed);
check('completed job is hidden', !visible.some((j) => j.id === 'c'));
check('accepted job is hidden (completed)', !visible.some((j) => j.status === 'completed'));
check('denied job is hidden (cancelled)', !visible.some((j) => j.id === 'd'));
check('cancelled job is hidden', !visible.some((j) => j.status === 'cancelled'));
check('queued job remains visible', visible.some((j) => j.id === 'a'));
check('processing job remains visible', visible.some((j) => j.id === 'f'));
check('needs-help job remains visible', visible.some((j) => j.id === 'b'));
check('failed job remains visible (actionable)', visible.some((j) => j.id === 'e'));
check('only 4 of 6 visible', visible.length === 4);
// A terminal realtime transition (needs_help -> completed) removes the card.
const afterTransition = filterQueueVisible(
  visible.map((j) => (j.id === 'b' ? { ...j, status: 'completed' } : j)),
);
check('terminal realtime event removes an existing queue card', !afterTransition.some((j) => j.id === 'b'));
// A delayed insert of an already-terminal job cannot re-add it.
const afterDelayedInsert = filterQueueVisible([...visible, { id: 'c', status: 'completed' }]);
check('delayed insert cannot re-add a terminal card', !afterDelayedInsert.some((j) => j.id === 'c'));

// ---- Badge = every visible current queue job -------------------------------
check('badge counts needs_help', badgeCountsStatus('needs_help'));
check('badge does NOT count completed', !badgeCountsStatus('completed'));
check('badge does NOT count accepted (completed)', !badgeCountsStatus('completed'));
check('badge does NOT count cancelled', !badgeCountsStatus('cancelled'));
check('badge counts processing as current queue work', badgeCountsStatus('processing_metadata'));
check('badge counts recoverable failed jobs', badgeCountsStatus('failed'));
{
  const badge = mixed.filter((j) => badgeCountsStatus(j.status)).length;
  const visibleCurrent = filterQueueVisible(mixed).length;
  check('queue badge equals all visible current jobs', badge === visibleCurrent && badge === 4);
}

// ---- Detail-route classification (stale deep-link safety) ------------------
check('classify queued => processing', classifyShareJobDetail({ status: 'queued' }) === 'processing');
check('classify processing_metadata => processing', classifyShareJobDetail({ status: 'processing_metadata' }) === 'processing');
check('classify needs_help => actionable', classifyShareJobDetail({ status: 'needs_help' }) === 'actionable');
check('classify failed => actionable', classifyShareJobDetail({ status: 'failed' }) === 'actionable');
check('classify completed => completed', classifyShareJobDetail({ status: 'completed' }) === 'completed');
check('classify cancelled => dismissed', classifyShareJobDetail({ status: 'cancelled' }) === 'dismissed');
check('classify unknown terminal => dismissed', classifyShareJobDetail({ status: 'zzz' }) === 'dismissed');
check('classify null => missing', classifyShareJobDetail(null) === 'missing');
check('classify undefined => missing', classifyShareJobDetail(undefined) === 'missing');

// ---- Notification routing matrix -------------------------------------------
check(
  'completed notification opens saved place',
  eq(routeShareJobNotification({ type: 'share_job_completed', savedPlaceId: 'sp1', jobId: 'j1' }), {
    kind: 'saved_place',
    savedPlaceId: 'sp1',
  }),
);
check(
  'already-saved notification opens existing saved place',
  eq(
    routeShareJobNotification({
      type: 'share_job_completed',
      outcome: 'already_saved',
      savedPlaceId: 'sp2',
      jobId: 'j1',
    }),
    { kind: 'saved_place', savedPlaceId: 'sp2' },
  ),
);
check(
  'already-saved notification carries the google_place_id fallback when present',
  eq(
    routeShareJobNotification({
      type: 'share_job_completed',
      outcome: 'already_saved',
      savedPlaceId: 'sp2',
      googlePlaceId: 'gp2',
      jobId: 'j1',
    }),
    { kind: 'saved_place', savedPlaceId: 'sp2', googlePlaceId: 'gp2' },
  ),
);
check(
  'old already-saved payload without googlePlaceId routes byte-identically',
  eq(
    routeShareJobNotification({ type: 'share_job_completed', outcome: 'already_saved', savedPlaceId: 'sp2' }),
    { kind: 'saved_place', savedPlaceId: 'sp2' },
  ),
);
check(
  'completed without saved place falls back to map',
  eq(routeShareJobNotification({ type: 'share_job_completed', jobId: 'j1' }), { kind: 'map' }),
);
check(
  'needs-help notification opens the queue item',
  eq(routeShareJobNotification({ type: 'share_job_needs_help', jobId: 'j9' }), {
    kind: 'queue_item',
    jobId: 'j9',
  }),
);
check(
  'resolved stale notification (needs_help w/o jobId) does not crash -> queue root',
  eq(routeShareJobNotification({ type: 'share_job_needs_help' }), { kind: 'queue_root' }),
);
check(
  'missing job notification does not crash -> queue root',
  eq(routeShareJobNotification({ type: 'share_job_needs_help', jobId: '' }), { kind: 'queue_root' }),
);
check(
  'malformed completed payload (non-string savedPlaceId) -> map, no throw',
  eq(routeShareJobNotification({ type: 'share_job_completed', savedPlaceId: 123 as unknown as string }), {
    kind: 'map',
  }),
);
check(
  'malformed needs_help payload (non-string jobId) -> queue root, no throw',
  eq(routeShareJobNotification({ type: 'share_job_needs_help', jobId: {} as unknown as string }), {
    kind: 'queue_root',
  }),
);
check('non-share-job (nearby reminder) payload => null (falls through)', routeShareJobNotification({ placeId: 'p1', savedPlaceId: 'sp', nearbyCount: 2 }) === null);
check('empty payload => null', routeShareJobNotification({}) === null);
check(
  'completed multi-save notification => saved group',
  eq(routeShareJobNotification({
    type: 'share_job_completed',
    outcome: 'completed',
    savedPlaceId: 'sp1',
    savedPlaceIds: ['sp1', 'sp2', 'sp2'],
  }), { kind: 'saved_group', savedPlaceIds: ['sp1', 'sp2'] }),
);
check(
  'mixed notification => unresolved job, not saved group',
  eq(routeShareJobNotification({
    type: 'share_job_needs_help',
    outcome: 'mixed',
    jobId: 'j-mixed',
    savedPlaceIds: ['sp1', 'sp2'],
  }), { kind: 'queue_item', jobId: 'j-mixed' }),
);
check('null payload => null', routeShareJobNotification(null) === null);
check('undefined payload => null', routeShareJobNotification(undefined) === null);

// ---- Detail replacement policy --------------------------------------------
check('queue root pushes a detail so Back returns to queue', !shouldReplaceShareJobDetail('/share-jobs'));
check('map pushes the first detail', !shouldReplaceShareJobDetail('/(tabs)/map'));
check('detail A is replaced when detail B opens', shouldReplaceShareJobDetail('/share-jobs/job-a'));
check('detail path with trailing slash is replaced', shouldReplaceShareJobDetail('/share-jobs/job-a/'));
check('nested/non-detail routes are not replaced', !shouldReplaceShareJobDetail('/share-jobs/job-a/history'));
check(
  'duplicate notification handling is idempotent (pure: same input => same route)',
  eq(
    routeShareJobNotification({ type: 'share_job_needs_help', jobId: 'x' }),
    routeShareJobNotification({ type: 'share_job_needs_help', jobId: 'x' }),
  ),
);

// ---- Queue-card routing (old deep link to accepted/denied job) -------------
check(
  'old accepted (completed) card opens saved place, not the queue item',
  eq(routeShareJobCard({ id: 'j', status: 'completed', saved_place_id: 'sp' }), {
    kind: 'saved_place',
    savedPlaceId: 'sp',
  }),
);
check(
  'completed card without saved place -> map',
  eq(routeShareJobCard({ id: 'j', status: 'completed', saved_place_id: null }), { kind: 'map' }),
);
check(
  'needs_help card -> queue item',
  eq(routeShareJobCard({ id: 'j1', status: 'needs_help' }), { kind: 'queue_item', jobId: 'j1' }),
);
check(
  'failed card -> queue item (actionable)',
  eq(routeShareJobCard({ id: 'j2', status: 'failed' }), { kind: 'queue_item', jobId: 'j2' }),
);
check(
  'denied (cancelled) card -> queue root, no throw',
  eq(routeShareJobCard({ id: 'j3', status: 'cancelled' }), { kind: 'queue_root' }),
);
check('null card -> queue root, no throw', eq(routeShareJobCard(null), { kind: 'queue_root' }));

console.log(failures === 0 ? '\nALL SHARE JOB ROUTING TESTS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
