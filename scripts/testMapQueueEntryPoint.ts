/**
 * scripts/testMapQueueEntryPoint.ts
 *
 * The Queue must be reachable from the map. Always.
 *
 * TWO separate bugs made it disappear, and the first fix only addressed the
 * lesser one:
 *
 *   1. Placement. <ShareQueueButton /> was the third child of the map's
 *      `topChrome`, which is gated on `shouldShowMapControls` so the search bar
 *      and chips clear an open place. The Queue rode along and vanished with
 *      them whenever the detail sheet was up.
 *
 *   2. THE ACTUAL REASON IT WAS NEVER ON SCREEN. The component's own first line
 *      was `if (!isAsyncShareJobsEnabled()) return null;`. That flag resolves
 *      from `EXPO_PUBLIC_ASYNC_SHARE_JOBS_ENABLED` at BUNDLE time, falling back
 *      to `extra.asyncShareJobsEnabled` — which app.config.js sets from the
 *      same env var. Neither `.env` nor `.env.local` defines it, so any bundle
 *      built from this checkout resolves it to FALSE and the component returned
 *      null before layout ever ran. Repositioning an unmounted node changed
 *      nothing, which is exactly why the first fix passed its tests and still
 *      failed on the device.
 *
 * Visibility now follows `canReachShareQueue` (lib/shareQueueAccess.ts) — a
 * property of the USER, not of the rollout. Section 2 below is the guard that
 * would have caught bug 2.
 *
 * These are render/logic contracts, not runtime proof: they read the source and
 * exercise the pure predicate. They cannot demonstrate physical visibility.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMapQueueEntryPoint.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHARE_JOBS_ROUTE } from '../lib/shareRoutes';
import { canReachShareQueue } from '../lib/shareQueueAccess';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

const map = read('app/(tabs)/map.tsx');
const button = read('components/map/ShareQueueButton.tsx');

// ---------------------------------------------------------------------------
// 1. The entry point exists and is wired to the real queue route
// ---------------------------------------------------------------------------
{
  assert.ok(map.includes('<ShareQueueButton />'), 'the map still renders the Queue button');
  assert.ok(map.includes("ShareQueueButton,"), 'and still imports it');
  assert.ok(
    button.includes(`router.push('${SHARE_JOBS_ROUTE}')`),
    'tapping it opens the existing queue route — not a new screen',
  );
  assert.ok(button.includes('useActiveQueueCount'), 'the pending-count badge is intact');
  assert.ok(
    button.includes('accessibilityLabel'),
    'and it is still announced to VoiceOver',
  );
}

// ---------------------------------------------------------------------------
// 2. THE REAL BUG: the button must not self-hide on a bundle-time rollout flag
// ---------------------------------------------------------------------------
{
  // Not imported and not called. (Naming it in a comment explaining the bug is
  // fine — that is the point of the comment.)
  assert.ok(
    !/from '@\/lib\/featureFlags'/.test(button),
    'the Queue button must NOT import the rollout flag module',
  );
  assert.ok(
    !/^\s*if \(!isAsyncShareJobsEnabled\(\)\) return null;/m.test(button),
    'the Queue button must NOT self-hide on the async-share rollout flag — that ' +
      'flag is inlined at bundle time and is why the button was never on screen',
  );
  assert.ok(button.includes('canReachShareQueue'), 'it follows user reachability instead');

  // The predicate itself. A normal signed-in account always reaches its queue,
  // whatever the rollout flag happens to be in this bundle.
  const real = { signedIn: true, isDevSession: false, isDemoMode: false };
  assert.equal(canReachShareQueue(real), true, 'a signed-in real account reaches the queue');
  assert.equal(canReachShareQueue({ ...real, signedIn: false }), false, 'signed out cannot');
  assert.equal(canReachShareQueue({ ...real, isDevSession: true }), false, 'dev session has no rows');
  assert.equal(canReachShareQueue({ ...real, isDemoMode: true }), false, 'demo mode never fetches');

  // Nothing in the reachability module may reach for the flag or the env.
  const access = read('lib/shareQueueAccess.ts');
  assert.ok(
    !/^import /m.test(access),
    'reachability is a pure user predicate with no imports at all',
  );
  const accessCode = access.slice(access.lastIndexOf('*/') + 2);
  assert.ok(
    !/isAsyncShareJobsEnabled|process\.env|Constants/.test(accessCode),
    'and never consults a build-time constant',
  );

  // The hook that feeds the badge AND the queue screen uses the same predicate,
  // so the entry point can never be offered when the screen behind it is dead,
  // and can never vanish while there is still something to read.
  const hook = read('hooks/useShareJobs.ts');
  assert.ok(hook.includes('canReachShareQueue'), 'useShareJobs shares the predicate');
  assert.ok(
    !hook.includes('isAsyncShareJobsEnabled'),
    'reading your own jobs is not gated on the rollout',
  );

  // ...but CREATING jobs still is. This fix must not have switched on the
  // async share write path as a side effect.
  for (const writePath of ['app/share.tsx', 'ShareExtension.tsx']) {
    assert.ok(
      read(writePath).includes('isAsyncShareJobsEnabled()'),
      `${writePath} still gates the async share write path on the rollout flag`,
    );
  }
}

// ---------------------------------------------------------------------------
// 3. Placement: it must not be gated on the selected-place state
// ---------------------------------------------------------------------------
{
  // The Queue lives in its own overlay. Isolate the JSX conditional that
  // decides whether it RENDERS — selection state may influence where it sits
  // (section 4), but never whether it exists.
  const queueIndex = map.indexOf('<ShareQueueButton />');
  assert.ok(queueIndex > -1);
  const openBrace = map.lastIndexOf('{!', queueIndex);
  const renderGate = map.slice(openBrace, map.indexOf('\n', openBrace));

  assert.equal(
    renderGate.trim(),
    '{!searchVisible ? (',
    'the only thing that may hide the Queue is the full-screen search dropdown',
  );
  assert.ok(
    !/shouldShowMapControls|previewExpanded|selected/.test(renderGate),
    'the Queue must NOT be hidden along with the selection-gated top chrome',
  );
  assert.ok(map.includes('styles.queueChrome'), 'it has its own positioned overlay');

  // The search bar and filter chips keep the original contract — this fix does
  // not drag the rest of the chrome over an open sheet.
  const chromeIndex = map.indexOf('<MapTopSearchBar');
  const chromeBlock = map.slice(Math.max(0, chromeIndex - 300), chromeIndex);
  assert.ok(
    chromeBlock.includes('shouldShowMapControls'),
    'search + filters still yield to an expanded place, as they did before',
  );
  assert.ok(
    map.indexOf('shouldShowMapControls = !selected || !previewExpanded') > -1,
    'the original gate itself is unchanged',
  );
}

// ---------------------------------------------------------------------------
// 4. Position is preserved — this is a restoration, not a redesign
// ---------------------------------------------------------------------------
{
  // Same coordinates it occupied as the third child of `topChrome`:
  // top inset + gap + search bar (50) + gap + filter row (38), left-aligned.
  assert.match(
    map,
    /queueChrome: \{[\s\S]{0,220}top: insetTop \+ Spacing\.md \+ 50 \+ Spacing\.sm \+ 38,[\s\S]{0,80}left: Spacing\.lg,/,
    'the pill lands exactly where it used to',
  );
  // The clearance reserved for it is still accounted for, so nothing below
  // (View All / preview pills) creeps up underneath it.
  // Its row is reserved unconditionally now. Two different predicates deciding
  // whether the same 34pt exists is how something else ends up sitting in it.
  assert.match(
    map,
    /const topChromeClearance = TOP_CHROME_BASE_CLEARANCE \+ QUEUE_PILL_CLEARANCE;/,
    'the clearance no longer follows a flag the pill does not follow either',
  );
  assert.ok(
    !map.includes('asyncShareUiEnabled'),
    'and the map no longer branches on the rollout flag at all',
  );
}

// ---------------------------------------------------------------------------
// 5. Reachable, not merely rendered: it must never sit under the open sheet
// ---------------------------------------------------------------------------
{
  assert.match(map, /queueChromeRaised: \{[\s\S]{0,140}top: insetTop,/, 'a sheet-up placement exists');
  assert.match(map, /!shouldShowMapControls && styles\.queueChromeRaised/, 'applied when the sheet is up');

  // Both placements, against the real geometry, on every supported device.
  // `expandedSheetHeight` mirrors app/(tabs)/map.tsx.
  const TAB_BAR = 83;
  const PILL_HEIGHT = 44;
  const PILL_MARGIN = 8; // ShareQueueButton's own marginTop
  const devices = [
    { name: 'iPhone SE', height: 667, inset: 20 },
    { name: 'iPhone 13 mini', height: 812, inset: 50 },
    { name: 'iPhone 14', height: 844, inset: 47 },
    { name: 'iPhone 15 Pro Max', height: 932, inset: 59 },
  ];

  for (const device of devices) {
    const safeTop = Math.max(device.inset, 24);
    const mapArea = device.height - TAB_BAR;
    const sheetTop =
      mapArea - Math.max(380, Math.round(mapArea - (safeTop + PILL_MARGIN + PILL_HEIGHT + 12)));

    // Sheet up → raised placement, in the row the hidden search bar vacated.
    const raisedBottom = safeTop + PILL_MARGIN + PILL_HEIGHT;
    assert.ok(
      raisedBottom < sheetTop,
      `${device.name}: raised Queue pill (ends ${raisedBottom}pt) clears the sheet (starts ${sheetTop}pt)`,
    );

    // Sheet down → the original slot, which has the whole map to itself.
    const restingBottom = safeTop + 12 + 50 + 8 + 38 + PILL_MARGIN + PILL_HEIGHT;
    assert.ok(restingBottom < mapArea, `${device.name}: resting Queue pill is on screen`);
  }
}

// ---------------------------------------------------------------------------
// 6. The queue experience behind it is untouched
// ---------------------------------------------------------------------------
{
  const queueScreen = read('app/share-jobs/index.tsx');
  const detailScreen = read('app/share-jobs/[jobId].tsx');

  assert.ok(queueScreen.includes('<ShareJobsSheet'), 'the queue sheet is unchanged');
  assert.ok(queueScreen.includes('Your queue'), 'and keeps its title');
  // Exact-place navigation out of the queue (82eac44) still goes through the
  // validated contract, by canonical saved_places.id.
  assert.ok(
    detailScreen.includes('resolveOpenSavedPlaceRoute') ||
      queueScreen.includes('resolveOpenSavedPlaceRoute'),
    'queue → saved place still mints a per-navigation open request',
  );
}

console.log('PASS map queue entry point: present, ungated by selection, same position, same route');
