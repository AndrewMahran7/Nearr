/**
 * scripts/testMapQueueEntryPoint.ts
 *
 * The Queue must be reachable from the map. Always.
 *
 * What went wrong: <ShareQueueButton /> was the third child of the map's
 * `topChrome` block, and that whole block is gated on `shouldShowMapControls`
 * (`!selected || !previewExpanded`) so the search bar and filter chips get out
 * of the way of an open place. The Queue rode along and vanished with them.
 * That was survivable while the expanded detail was a small floating card; once
 * it became a real sheet people sit in, pending shares were simply unreachable
 * without first closing the place — which is what the user hit.
 *
 * These are render contracts, not behaviour tests: they read the source and
 * fail if the entry point is deleted, re-nested under the selection gate, or
 * quietly disconnected from the queue route.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testMapQueueEntryPoint.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { SHARE_JOBS_ROUTE } from '../lib/shareRoutes';

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
    button.includes('isAsyncShareJobsEnabled'),
    'still flag-gated: zero footprint when async share jobs are off',
  );
  assert.ok(
    button.includes('accessibilityLabel'),
    'and it is still announced to VoiceOver',
  );
}

// ---------------------------------------------------------------------------
// 2. THE REGRESSION: it must not be gated on the selected-place state
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
// 3. Position is preserved — this is a restoration, not a redesign
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
  assert.ok(map.includes('QUEUE_PILL_CLEARANCE'), 'its layout clearance is still reserved');
  assert.match(
    map,
    /TOP_CHROME_BASE_CLEARANCE \+ \(asyncShareUiEnabled \? QUEUE_PILL_CLEARANCE : 0\)/,
    'clearance still follows the feature flag',
  );
}

// ---------------------------------------------------------------------------
// 4. Reachable, not merely rendered: it must never sit under the open sheet
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
      mapArea - Math.round(Math.min(Math.max(mapArea * 0.72, 380), mapArea - 150));

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
// 5. The queue experience behind it is untouched
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
