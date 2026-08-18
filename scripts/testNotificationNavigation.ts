/**
 * scripts/testNotificationNavigation.ts
 *
 * Regression tests for the invariant:
 *
 *   A notification tap OWNS the next visible UI state. Clear transient UI, go
 *   to the map, and open the EXACT notification destination.
 *
 * These exercise the real decision functions the root layout and the map both
 * use — `resolveNotificationDestination`, `createNotificationOpenIntent`,
 * `claimUiForNotification`, `planNotificationNavigation`, the pending-intent
 * slot, and the `openSavedPlace` request ledger the map consumes — chained
 * through a tiny fake app so ORDERING ("the reset is issued before the
 * destination opens") is proven, not assumed.
 *
 * React Navigation itself is deliberately NOT mocked: the plan is the whole
 * contract with the router, and a state/intent test says more about the bug
 * than a stubbed navigator would.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testNotificationNavigation.ts
 */

import {
  claimUiForNotification,
  createNotificationOpenIntent,
  getNotificationUiClaim,
  isNearbyReminderPayload,
  nearbyCountFromPayload,
  notificationOwnsVisibleSurface,
  notificationRouteLabel,
  peekPendingNotificationNavigation,
  planNotificationNavigation,
  resetNotificationNavigationState,
  resolveNotificationDestination,
  setPendingNotificationNavigation,
  subscribeToNotificationUiClaim,
  takePendingNotificationNavigation,
  type NotificationDestination,
  type NotificationNavigationPlan,
} from '../lib/notificationNavigation';
import {
  findSavedPlaceForOpen,
  isOpenSavedPlaceRequestHandled,
  markOpenSavedPlaceRequestHandled,
  resetOpenSavedPlaceRequests,
} from '../lib/openSavedPlace';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// The real payload shapes Nearr schedules/receives today.
const nearbySingle = { savedPlaceId: 'sp-a', placeId: 'place-a', nearbyCount: 1, groupedSavedPlaceIds: ['sp-a'] };
const nearbyGroup = {
  savedPlaceId: 'sp-a',
  placeId: 'place-a',
  nearbyCount: 3,
  groupedSavedPlaceIds: ['sp-a', 'sp-b', 'sp-c'],
};
const shareCompleted = { type: 'share_job_completed', outcome: 'completed', savedPlaceId: 'sp-b', googlePlaceId: 'gp-b' };
const shareNeedsHelp = { type: 'share_job_needs_help', outcome: 'needs_help', jobId: 'job-1' };

function tap(data: Record<string, unknown>, isDefaultTap = true) {
  return resolveNotificationDestination({ isDefaultTap, data });
}

// ---------------------------------------------------------------------------
// 1. Payload -> destination. Exact saved place id preserved; nothing invented.
// ---------------------------------------------------------------------------

const dSingle = tap(nearbySingle);
check('nearby single resolves to an exact saved place', dSingle.kind === 'saved_place');
check(
  'nearby single preserves saved_places.id verbatim',
  dSingle.kind === 'saved_place' && dSingle.savedPlaceId === 'sp-a',
);
check('nearby single is flagged as a reminder', dSingle.kind === 'saved_place' && dSingle.reminder === true);

const dShare = tap(shareCompleted);
check(
  'completed share resolves to the exact saved place by saved_places.id',
  dShare.kind === 'saved_place' && dShare.savedPlaceId === 'sp-b',
);
check(
  'google_place_id rides along ONLY as the documented fallback',
  dShare.kind === 'saved_place' && dShare.googlePlaceId === 'gp-b',
);
check('a share-job open is not a nearby reminder', dShare.kind === 'saved_place' && dShare.reminder === false);

const dGroup = tap(nearbyGroup);
check('a grouped nearby notification opens the GROUP, not one place', dGroup.kind === 'nearby_group');
check(
  'the group is exactly the places the notification named',
  dGroup.kind === 'nearby_group' && dGroup.savedPlaceIds.join(',') === 'sp-a,sp-b,sp-c',
);

check('needs_help still routes to the queue item', tap(shareNeedsHelp).kind === 'queue_item');
check('an action-button tap is never a navigation', tap(nearbySingle, false).kind === 'none');
check('an empty payload navigates nowhere', tap({}).kind === 'none');
check('a payload with no ids at all navigates nowhere', tap({ title: 'hello' }).kind === 'none');

// A payload shaped like a nearby reminder but with no usable id must fall back
// to the bare map — never to a guessed place.
check('a nearby payload with no usable id falls back to the map', tap({ placeId: 'place-x' }).kind === 'map');

check('payload predicate ignores a lone savedPlaceId', isNearbyReminderPayload({ savedPlaceId: 'sp-a' }) === false);
check('payload predicate accepts a grouped list', isNearbyReminderPayload(nearbyGroup) === true);
check('nearbyCount is read from the payload', nearbyCountFromPayload(nearbyGroup) === 3);
check('nearbyCount falls back to the grouped length', nearbyCountFromPayload({ groupedSavedPlaceIds: ['a', 'b'] }) === 2);
check('nearbyCount is undefined when the payload has none', nearbyCountFromPayload({}) === undefined);

check('breadcrumb label names the group size', notificationRouteLabel(dGroup) === 'nearby_group:3');
check('breadcrumb label names the destination kind', notificationRouteLabel(dShare) === 'saved_place');

// ---------------------------------------------------------------------------
// 2. Intent identity: one tap, one openRequestId — even for the same place.
// ---------------------------------------------------------------------------

resetNotificationNavigationState();
resetOpenSavedPlaceRequests();

const intentA1 = createNotificationOpenIntent(tap(nearbySingle), 'notif-1');
const intentA2 = createNotificationOpenIntent(tap(nearbySingle), 'notif-2');
check('every notification tap mints an openRequestId', !!intentA1.openRequestId && !!intentA2.openRequestId);
check(
  'two taps of the SAME place are two distinct intents',
  intentA1.openRequestId !== intentA2.openRequestId,
  `${intentA1.openRequestId} vs ${intentA2.openRequestId}`,
);
check('the destination place id is identical across both taps', JSON.stringify(intentA1.destination) === JSON.stringify(intentA2.destination));
check('the intent carries notification provenance', intentA1.source === 'notification' && intentA1.notificationId === 'notif-1');

// The map consumes the REQUEST, not the place: the first intent being handled
// must never swallow the second one for the same place.
markOpenSavedPlaceRequestHandled(intentA1.openRequestId);
check('the first intent is consumed', isOpenSavedPlaceRequestHandled(intentA1.openRequestId));
check(
  'the SAME place can be reopened by a second intent',
  !isOpenSavedPlaceRequestHandled(intentA2.openRequestId),
);

// ---------------------------------------------------------------------------
// 3. Navigation plan.
// ---------------------------------------------------------------------------

function planFor(data: Record<string, unknown>, pathname = '/(tabs)/map'): NotificationNavigationPlan {
  const intent = createNotificationOpenIntent(tap(data), 'notif');
  return planNotificationNavigation(intent, {
    pathname,
    createMapGroupRequestId: (ids) => (ids.length > 1 ? `group-${ids.length}` : null),
  });
}

const planSingle = planFor(nearbySingle);
check('a place notification lands on the map tab', planSingle.action !== 'none' && planSingle.pathname === '/(tabs)/map');
check('a place notification dismisses transient routes first', planSingle.action !== 'none' && planSingle.dismissTransient === true);
check(
  'a place notification NAVIGATEs (a push stacked a second tab navigator)',
  planSingle.action === 'navigate',
);
check(
  'the map is handed the canonical saved_places.id',
  planSingle.action !== 'none' && planSingle.params.savedPlaceId === 'sp-a',
);
check(
  'the map is handed the intent id, not a fresh one',
  planSingle.action !== 'none' && !!planSingle.params.openRequestId,
);
check(
  'the map is told the open came from a notification',
  planSingle.action !== 'none' && planSingle.params.placeSource === 'notification',
);
check(
  'a nearby reminder still opens Place Detail expanded',
  planSingle.action !== 'none' && planSingle.params.reminderOpen === 'true' && planSingle.params.reminderSource === 'nearby',
);

const planShare = planFor(shareCompleted);
check(
  'a completed share opens the exact saved place, not the queue',
  planShare.action === 'navigate' && planShare.params.savedPlaceId === 'sp-b',
);
check(
  'the google_place_id fallback survives into the route',
  planShare.action !== 'none' && planShare.params.savedPlaceGoogleId === 'gp-b',
);
check(
  'a share-job open is NOT labelled a nearby reminder',
  planShare.action !== 'none' && planShare.params.reminderOpen === undefined,
);

const planGroup = planFor(nearbyGroup);
check('a grouped notification opens the grouped screen', planGroup.action !== 'none' && planGroup.pathname === '/opportunity/group');
check(
  'the grouped screen still receives exactly the notified ids',
  planGroup.action !== 'none' && planGroup.params.ids === 'sp-a,sp-b,sp-c',
);
check('the grouped screen also clears transient routes beneath it', planGroup.action !== 'none' && planGroup.dismissTransient === true);
check(
  'two taps of the same group are distinct navigations',
  planFor(nearbyGroup).action !== 'none' &&
    (planFor(nearbyGroup) as { params: Record<string, string> }).params.openRequestId !==
      (planGroup as { params: Record<string, string> }).params.openRequestId,
);

const planSavedGroup = planFor({ type: 'share_job_completed', savedPlaceIds: ['sp-a', 'sp-b'] });
check(
  'a multi-place share frames the group on the map',
  planSavedGroup.action === 'navigate' && planSavedGroup.params.mapGroupId === 'group-2',
);

const planQueueItem = planFor(shareNeedsHelp);
check('a queue item still PUSHES so Back returns to the queue', planQueueItem.action === 'push');
check('a queue item does NOT tear down the queue underneath it', planQueueItem.action !== 'none' && planQueueItem.dismissTransient === false);
check(
  'a queue item replaces itself when another queue detail is open',
  planFor(shareNeedsHelp, '/share-jobs/job-9').action === 'replace',
);

check('an action-button tap produces no navigation at all', planFor(nearbySingle, '/(tabs)/map') && planNotificationNavigation(createNotificationOpenIntent({ kind: 'none' })).action === 'none');

check(
  'map-landing destinations own the visible surface',
  notificationOwnsVisibleSurface({ kind: 'saved_place', savedPlaceId: 'x', reminder: false }) &&
    notificationOwnsVisibleSurface({ kind: 'nearby_group', savedPlaceIds: ['a', 'b'] }) &&
    notificationOwnsVisibleSurface({ kind: 'map' }),
);
check(
  'queue destinations deliberately do not',
  !notificationOwnsVisibleSurface({ kind: 'queue_item', jobId: 'j' }) &&
    !notificationOwnsVisibleSurface({ kind: 'queue_root' }),
);

// ---------------------------------------------------------------------------
// 4. Ordering + ownership, through a fake app.
//
// The fake holds exactly the transient surfaces the real app can have open when
// a notification arrives, plus the persistent state that must survive.
// ---------------------------------------------------------------------------

type FakeApp = {
  // transient
  queueOpen: boolean;
  queueDetailJobId: string | null;
  searchOpen: boolean;
  searchQuery: string;
  openPlaceId: string | null;
  detailExpanded: boolean;
  groupedOpportunityOpen: boolean;
  route: string;
  routeParams: Record<string, string>;
  // persistent — must be untouched
  savedPlaces: { id: string; place: { google_place_id: string | null } }[];
  offlineCache: string[];
  theme: string;
  filter: string;
  searchHistory: string[];
  signedIn: boolean;
  // trace
  log: string[];
};

function makeApp(overrides: Partial<FakeApp> = {}): FakeApp {
  return {
    queueOpen: false,
    queueDetailJobId: null,
    searchOpen: false,
    searchQuery: '',
    openPlaceId: null,
    detailExpanded: false,
    groupedOpportunityOpen: false,
    route: '/(tabs)/map',
    routeParams: {},
    savedPlaces: [
      { id: 'sp-a', place: { google_place_id: 'gp-a' } },
      { id: 'sp-b', place: { google_place_id: 'gp-b' } },
      { id: 'sp-c', place: { google_place_id: 'gp-c' } },
    ],
    offlineCache: ['sp-a', 'sp-b', 'sp-c'],
    theme: 'dark',
    filter: 'food',
    searchHistory: ['ramen'],
    signedIn: true,
    log: [],
    ...overrides,
  };
}

/**
 * One notification tap, wired the way the app wires it:
 *   root layout: resolve -> mint intent -> claim UI -> park -> flush
 *   map screen:  subscribe to the claim and drop its own transient UI
 * `navigationReady` false models a cold start, where the flush must NOT happen
 * yet and the intent must NOT be lost.
 */
function tapNotification(
  app: FakeApp,
  data: Record<string, unknown>,
  opts: { navigationReady?: boolean; isDefaultTap?: boolean } = {},
) {
  const navigationReady = opts.navigationReady !== false;

  // --- the map's subscription (mirrors app/(tabs)/map.tsx) ---
  const unsubscribe = subscribeToNotificationUiClaim(() => {
    app.log.push('map_transient_reset');
    app.searchOpen = false;
    app.searchQuery = '';
    app.openPlaceId = null;
    app.detailExpanded = false;
  });

  try {
    const destination = resolveNotificationDestination({
      isDefaultTap: opts.isDefaultTap !== false,
      data,
    });
    if (destination.kind === 'none') return null;

    const intent = createNotificationOpenIntent(destination, 'notif');
    claimUiForNotification(intent);
    setPendingNotificationNavigation(intent);
    if (navigationReady) flush(app);
    return intent;
  } finally {
    unsubscribe();
  }
}

/** The root layout's flush: dismiss transient routes, then land. */
function flush(app: FakeApp) {
  const intent = takePendingNotificationNavigation();
  if (!intent) return;
  const plan = planNotificationNavigation(intent, {
    pathname: app.route,
    createMapGroupRequestId: (ids) => (ids.length > 1 ? `group-${ids.length}` : null),
  });
  if (plan.action === 'none') return;

  if (plan.dismissTransient) {
    app.log.push('routes_dismissed');
    app.queueOpen = false;
    app.queueDetailJobId = null;
    app.groupedOpportunityOpen = false;
  }
  app.log.push(`navigate:${plan.pathname}`);
  app.route = plan.pathname;
  app.routeParams = plan.params;

  // The map's focus effect: resolve by saved_places.id first, google id second.
  if (plan.pathname === '/(tabs)/map' && plan.params.savedPlaceId) {
    const target = findSavedPlaceForOpen(app.savedPlaces, {
      savedPlaceId: plan.params.savedPlaceId,
      googlePlaceId: plan.params.savedPlaceGoogleId,
    });
    if (target) {
      app.openPlaceId = target.id;
      app.detailExpanded = true;
      app.log.push(`opened:${target.id}`);
    } else {
      app.log.push('missing_place_recovery');
    }
    markOpenSavedPlaceRequestHandled(plan.params.openRequestId);
  }
  if (plan.pathname === '/opportunity/group') app.groupedOpportunityOpen = true;
  if (plan.pathname === '/share-jobs/[jobId]') app.queueDetailJobId = plan.params.jobId ?? null;
}

// --- Queue open ------------------------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
let app = makeApp({ queueOpen: true, route: '/share-jobs' });
tapNotification(app, nearbySingle);
check('Queue open: the queue is gone', app.queueOpen === false);
check('Queue open: the map is visible', app.route === '/(tabs)/map');
check('Queue open: the exact notified place is open', app.openPlaceId === 'sp-a');
check(
  'Queue open: the reset is issued BEFORE the destination opens',
  app.log.indexOf('map_transient_reset') < app.log.indexOf('opened:sp-a') &&
    app.log.indexOf('routes_dismissed') < app.log.indexOf('opened:sp-a'),
  app.log.join(' -> '),
);

// --- Queue place detail open ----------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ queueOpen: true, queueDetailJobId: 'job-9', route: '/share-jobs/job-9' });
tapNotification(app, nearbySingle);
check('Queue detail open: the queue detail is gone', app.queueDetailJobId === null && app.queueOpen === false);
check('Queue detail open: the exact place opens on the map', app.route === '/(tabs)/map' && app.openPlaceId === 'sp-a');

// --- Search open -----------------------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ searchOpen: true, searchQuery: 'tacos' });
tapNotification(app, nearbySingle);
check('Search open: the search overlay closes', app.searchOpen === false);
check('Search open: the exact place opens', app.openPlaceId === 'sp-a');
check('Search open: persistent search HISTORY is untouched', app.searchHistory.join(',') === 'ramen');

// --- Another place already open -------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ openPlaceId: 'sp-c', detailExpanded: true });
tapNotification(app, { ...nearbySingle, savedPlaceId: 'sp-b', groupedSavedPlaceIds: ['sp-b'] });
check('Existing detail: the old place relinquishes ownership', app.log.includes('map_transient_reset'));
check('Existing detail: only the notified place remains', app.openPlaceId === 'sp-b');
check(
  'Existing detail: the old place is cleared BEFORE the new one opens',
  app.log.indexOf('map_transient_reset') < app.log.indexOf('opened:sp-b'),
  app.log.join(' -> '),
);

// --- Grouped opportunity UI already open ----------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ groupedOpportunityOpen: true, route: '/opportunity/group' });
tapNotification(app, nearbySingle);
check('Grouped UI open: an exact-place notification still wins', app.route === '/(tabs)/map' && app.openPlaceId === 'sp-a');

// --- Persistent state is never touched ------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ queueOpen: true, searchOpen: true, openPlaceId: 'sp-c' });
tapNotification(app, nearbySingle);
check(
  'a transient reset is NOT an app reset',
  app.savedPlaces.length === 3 &&
    app.offlineCache.length === 3 &&
    app.theme === 'dark' &&
    app.filter === 'food' &&
    app.signedIn === true &&
    app.searchHistory.length === 1,
);

// --- Two different notifications, one session ------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp();
tapNotification(app, { savedPlaceId: 'sp-a', placeId: 'p', groupedSavedPlaceIds: ['sp-a'] });
check('notification A opens place A', app.openPlaceId === 'sp-a');
tapNotification(app, { savedPlaceId: 'sp-b', placeId: 'p', groupedSavedPlaceIds: ['sp-b'] });
check('notification B replaces place A with place B', app.openPlaceId === 'sp-b');

// --- The SAME place twice --------------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp();
tapNotification(app, nearbySingle);
const firstRequestId = app.routeParams.openRequestId;
// The user closes the detail themselves.
app.openPlaceId = null;
app.detailExpanded = false;
tapNotification(app, nearbySingle);
check('the same place reopens on a second notification', app.openPlaceId === 'sp-a');
check('...as a NEW navigation intent', app.routeParams.openRequestId !== firstRequestId);
check('...and the old intent stays consumed', isOpenSavedPlaceRequestHandled(firstRequestId));

// --- Cold start ------------------------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ route: '/' });
const coldIntent = tapNotification(app, nearbySingle, { navigationReady: false });
check('cold start: nothing navigates before the navigator is ready', app.route === '/' && app.openPlaceId === null);
check('cold start: the intent is parked, not dropped', peekPendingNotificationNavigation()?.openRequestId === coldIntent?.openRequestId);
// ...the navigator becomes ready.
flush(app);
check('cold start: the parked intent opens the exact place', app.route === '/(tabs)/map' && app.openPlaceId === 'sp-a');
check('cold start: the pending slot is emptied once replayed', peekPendingNotificationNavigation() === null);
check('cold start: replaying again is a no-op, not a second open', (() => {
  const before = app.log.length;
  flush(app);
  return app.log.length === before;
})());

// A parked intent lives at module scope only — a fresh process starts empty.
resetNotificationNavigationState();
check('no notification intent survives into an unrelated launch', peekPendingNotificationNavigation() === null);
check('no stale UI claim survives into an unrelated launch', getNotificationUiClaim() === null);

// --- A later notification supersedes an unflushed one -----------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ route: '/' });
tapNotification(app, { savedPlaceId: 'sp-a', placeId: 'p', groupedSavedPlaceIds: ['sp-a'] }, { navigationReady: false });
tapNotification(app, { savedPlaceId: 'sp-b', placeId: 'p', groupedSavedPlaceIds: ['sp-b'] }, { navigationReady: false });
flush(app);
check('the newest notification wins when two arrive before readiness', app.openPlaceId === 'sp-b');

// --- Missing / deleted place -----------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ savedPlaces: [{ id: 'sp-z', place: { google_place_id: 'gp-z' } }] });
tapNotification(app, nearbySingle);
check('a deleted place recovers locally instead of hanging', app.log.includes('missing_place_recovery'));
check('a deleted place never opens an unrelated place', app.openPlaceId === null);
check('a deleted place still lands the user on the map', app.route === '/(tabs)/map');
check(
  'a deleted place consumes its request, so it cannot retry forever',
  isOpenSavedPlaceRequestHandled(app.routeParams.openRequestId),
);

// --- Malformed payloads -----------------------------------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ queueOpen: true, openPlaceId: 'sp-c', route: '/share-jobs' });
const nothing = tapNotification(app, { savedPlaceId: '   ' });
check('a payload with no destination navigates nowhere', nothing === null && app.route === '/share-jobs');
check('...and leaves the transient UI it found alone', app.queueOpen === true && app.openPlaceId === 'sp-c');

resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp();
tapNotification(app, { placeId: 'place-only', nearbyCount: 1 });
check('a nearby payload with no saved place id lands on the bare map', app.route === '/(tabs)/map' && app.openPlaceId === null);

// --- Offline: a cached place opens with no network -------------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp();
// `savedPlaces` here stands in for the hydrated offline cache: resolution is a
// pure lookup over the list the map already holds, so it needs no request.
tapNotification(app, nearbySingle);
check('offline: a cached place still resolves by saved_places.id', app.openPlaceId === 'sp-a');

// --- An exploding subscriber cannot block the destination -------------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp();
const unsubBad = subscribeToNotificationUiClaim(() => {
  throw new Error('a screen threw while tidying up');
});
tapNotification(app, nearbySingle);
unsubBad();
check('a throwing subscriber never stops the notification destination', app.openPlaceId === 'sp-a');

// --- The claim is observable by a screen that mounts later ------------------
resetNotificationNavigationState();
const lateIntent = createNotificationOpenIntent(tap(nearbySingle), 'notif-late');
claimUiForNotification(lateIntent);
check('a screen mounting after the claim can still see it', getNotificationUiClaim()?.openRequestId === lateIntent.openRequestId);
check('claims are monotonic', (() => {
  const first = getNotificationUiClaim()?.generation ?? 0;
  claimUiForNotification(createNotificationOpenIntent(tap(nearbySingle), 'notif-later'));
  return (getNotificationUiClaim()?.generation ?? 0) === first + 1;
})());

// --- Grouped product behavior is not quietly turned into a single open -----
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ queueOpen: true, route: '/share-jobs' });
tapNotification(app, nearbyGroup);
check('a grouped notification still opens the group', app.groupedOpportunityOpen === true && app.route === '/opportunity/group');
check('a grouped notification never opens an arbitrary single place', app.openPlaceId === null);
check('a grouped notification still clears the queue beneath it', app.queueOpen === false);

// --- A needs_help notification keeps its queue-first behavior ---------------
resetNotificationNavigationState();
resetOpenSavedPlaceRequests();
app = makeApp({ queueOpen: true, route: '/share-jobs' });
tapNotification(app, shareNeedsHelp);
check('needs_help opens the queue item', app.queueDetailJobId === 'job-1');
check('needs_help does NOT tear the queue down (Back still returns to it)', app.queueOpen === true);

// Type-level guard: every destination kind is plannable.
const allKinds: NotificationDestination[] = [
  { kind: 'saved_place', savedPlaceId: 'x', reminder: false },
  { kind: 'saved_group', savedPlaceIds: ['a', 'b'] },
  { kind: 'nearby_group', savedPlaceIds: ['a', 'b'] },
  { kind: 'queue_item', jobId: 'j' },
  { kind: 'queue_root' },
  { kind: 'map' },
  { kind: 'none' },
];
check(
  'every destination kind produces a plan without throwing',
  allKinds.every((d) => !!planNotificationNavigation(createNotificationOpenIntent(d))),
);

if (failures > 0) {
  console.error(`\n${failures} notification-navigation test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll notification-navigation tests passed');
