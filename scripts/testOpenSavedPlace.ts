/**
 * scripts/testOpenSavedPlace.ts
 *
 * Regression tests for the already-saved "View place" crash/no-op.
 *
 * These exercise the REAL functions the confirmation screen, the notification
 * handler, and the map deep-link focus all use — routeShareJobNotification
 * (routing), resolveOpenSavedPlaceRoute (the canonical navigation helper), and
 * findSavedPlaceForOpen (the map's saved-place resolver) — chained end to end,
 * so "View place" is proven to OPEN THE EXISTING PLACE, not merely avoid the
 * error boundary. The decisive block resolves an already-saved notification all
 * the way to the saved_places row, including the google_place_id fallback and
 * the missing-place recovery.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testOpenSavedPlace.ts
 */

import { routeShareJobNotification } from '../lib/shareJobRouting';
import {
  findSavedPlaceForOpen,
  isOpenExistingPlaceSource,
  openSavedPlaceMessage,
  resolveOpenSavedPlaceRoute,
  shouldExpandSavedPlaceDetails,
  validId,
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

type SP = { id: string; place: { google_place_id: string | null } };
const savedList: SP[] = [
  { id: 'sp1', place: { google_place_id: 'gp1' } },
  { id: 'sp2', place: { google_place_id: null } },
  { id: 'sp3', place: { google_place_id: 'gp3' } },
];

// --- validId ---------------------------------------------------------------
check('validId accepts a normal id', validId('sp1') === 'sp1');
check('validId trims', validId('  sp1  ') === 'sp1');
check('validId rejects empty', validId('') === null);
check('validId rejects whitespace', validId('   ') === null);
check('validId rejects undefined', validId(undefined) === null);
check('validId rejects an array (route param quirk)', validId(['sp1'] as unknown) === null);
check('validId rejects a number', validId(123 as unknown) === null);

// --- resolveOpenSavedPlaceRoute (the canonical navigation helper) -----------
const r1 = resolveOpenSavedPlaceRoute({ savedPlaceId: 'sp1', source: 'share_job_completed' });
check('route targets the map tab', r1.pathname === '/(tabs)/map');
check('View place uses saved_places.id', r1.params.savedPlaceId === 'sp1');
check('route stamps the source', r1.params.placeSource === 'share_job_completed');

const r2 = resolveOpenSavedPlaceRoute({
  savedPlaceId: 'sp1',
  googlePlaceId: 'gp1',
  source: 'share_job_already_saved',
});
check('route carries the google_place_id fallback', r2.params.savedPlaceGoogleId === 'gp1');

const r3 = resolveOpenSavedPlaceRoute({ googlePlaceId: 'gp3', source: 'notification' });
check('route works with only a google_place_id', r3.params.savedPlaceGoogleId === 'gp3' && !('savedPlaceId' in r3.params));

const r4 = resolveOpenSavedPlaceRoute({ source: 'share_job_saved' });
check('route with no ids falls back to the bare map (no crash)', r4.pathname === '/(tabs)/map' && !('savedPlaceId' in r4.params) && !('savedPlaceGoogleId' in r4.params));

const r5 = resolveOpenSavedPlaceRoute({ savedPlaceId: '   ', googlePlaceId: '', source: 'notification' });
check('route drops malformed/empty ids', !('savedPlaceId' in r5.params) && !('savedPlaceGoogleId' in r5.params));

// --- findSavedPlaceForOpen (the map's resolver) ----------------------------
check('resolves by saved_places.id', findSavedPlaceForOpen(savedList, { savedPlaceId: 'sp3' })?.id === 'sp3');
check('falls back to google_place_id when id absent', findSavedPlaceForOpen(savedList, { savedPlaceId: 'gone', googlePlaceId: 'gp1' })?.id === 'sp1');
check('id wins over google_place_id when both resolve', findSavedPlaceForOpen(savedList, { savedPlaceId: 'sp3', googlePlaceId: 'gp1' })?.id === 'sp3');
check('returns null when neither matches (→ local recovery)', findSavedPlaceForOpen(savedList, { savedPlaceId: 'gone', googlePlaceId: 'nope' }) === null);
check('null list is safe', findSavedPlaceForOpen(null, { savedPlaceId: 'sp1' }) === null);
check('empty list is safe', findSavedPlaceForOpen([], { savedPlaceId: 'sp1' }) === null);
check('missing ids resolve to null', findSavedPlaceForOpen(savedList, {}) === null);

// --- isOpenExistingPlaceSource ---------------------------------------------
check('share_job_already_saved is an open-existing source', isOpenExistingPlaceSource('share_job_already_saved'));
check('notification is an open-existing source', isOpenExistingPlaceSource('notification'));
check('reminder-ish source is NOT', !isOpenExistingPlaceSource('nearby'));
check('undefined source is NOT', !isOpenExistingPlaceSource(undefined));
check('already-saved source gets completion feedback', openSavedPlaceMessage('share_job_already_saved') === 'Already on your map');
check('new share save gets completion feedback', openSavedPlaceMessage('share_job_saved') === 'Saved to your map');
check('notification does not show duplicate feedback', openSavedPlaceMessage('notification') === null);
check('manual save opens full details', shouldExpandSavedPlaceDetails('share_job_saved'));
check('already-saved confirmation opens full details', shouldExpandSavedPlaceDetails('share_job_already_saved'));
check('notification leaves details collapsed', !shouldExpandSavedPlaceDetails('notification'));

// --- DECISIVE end-to-end: already-saved notification opens the place --------
function openFromAlreadySavedNotification(
  payload: Record<string, unknown>,
  places: SP[],
): { opened: SP | null; navigatedTo: string } {
  const route = routeShareJobNotification(payload);
  if (!route || route.kind !== 'saved_place') {
    // Non-saved-place outcome → the map (never a crash).
    return { opened: null, navigatedTo: '/(tabs)/map' };
  }
  const target = resolveOpenSavedPlaceRoute({
    savedPlaceId: route.savedPlaceId,
    googlePlaceId: route.googlePlaceId,
    source: 'notification',
  });
  const opened = findSavedPlaceForOpen(places, {
    savedPlaceId: target.params.savedPlaceId,
    googlePlaceId: target.params.savedPlaceGoogleId,
  });
  return { opened, navigatedTo: target.pathname };
}

// New payload (savedPlaceId + googlePlaceId) → opens the exact row.
const e1 = openFromAlreadySavedNotification(
  { type: 'share_job_completed', outcome: 'already_saved', jobId: 'j1', savedPlaceId: 'sp1', googlePlaceId: 'gp1' },
  savedList,
);
check('already-saved notification navigates to the map', e1.navigatedTo === '/(tabs)/map');
check('already-saved notification OPENS the existing saved place', e1.opened?.id === 'sp1');

// Stale saved_places id, but the google_place_id still identifies the row.
const e2 = openFromAlreadySavedNotification(
  { type: 'share_job_completed', outcome: 'already_saved', savedPlaceId: 'stale-id', googlePlaceId: 'gp3' },
  savedList,
);
check('stale saved id still opens the place via google_place_id fallback', e2.opened?.id === 'sp3');

// Backward-compatible OLD payload (no googlePlaceId) → opens by id.
const e3 = openFromAlreadySavedNotification(
  { type: 'share_job_completed', outcome: 'already_saved', savedPlaceId: 'sp2' },
  savedList,
);
check('old payload (no googlePlaceId) still opens by saved_places.id', e3.opened?.id === 'sp2');

// Place deleted after the notification → resolves to null → local recovery.
const e4 = openFromAlreadySavedNotification(
  { type: 'share_job_completed', outcome: 'already_saved', savedPlaceId: 'deleted', googlePlaceId: 'also-deleted' },
  savedList,
);
check('deleted place resolves to null (map + friendly recovery, no crash)', e4.opened === null && e4.navigatedTo === '/(tabs)/map');

// Malformed payload (missing savedPlaceId) → map, never a crash.
const e5 = openFromAlreadySavedNotification(
  { type: 'share_job_completed', outcome: 'already_saved' },
  savedList,
);
check('malformed already-saved payload falls back to the map', e5.navigatedTo === '/(tabs)/map' && e5.opened === null);

if (failures > 0) {
  console.error(`\n${failures} open-saved-place test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll open-saved-place tests passed');
