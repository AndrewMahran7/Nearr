/**
 * scripts/testNearbyGroupRouting.ts
 *
 * A grouped nearby reminder must open the EXACT places it named. The payload
 * already carries them (lib/notifications.ts schedules groupedSavedPlaceIds),
 * so this covers the routing contract, the historical-group guarantee, and
 * backward compatibility with pre-grouping notifications.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  MAX_GROUPED_PLACES,
  decodeGroupedSavedPlaceIds,
  encodeGroupedSavedPlaceIds,
  groupedOpportunityTitle,
  normalizeGroupedSavedPlaceIds,
  routeNearbyReminder,
} from '../lib/nearbyGroupRouting';

// --- 2. Two or more places route to the grouped screen ----------------------
{
  const route = routeNearbyReminder({ savedPlaceId: 'a', groupedSavedPlaceIds: ['a', 'b', 'c', 'd'] });
  assert.equal(route.kind, 'group');
  assert.deepEqual(route.kind === 'group' && route.savedPlaceIds, ['a', 'b', 'c', 'd']);
  assert.equal(routeNearbyReminder({ groupedSavedPlaceIds: ['x', 'y'] }).kind, 'group');
}

// --- 3/4. One place, and old pre-grouping payloads, use the single flow -----
{
  const single = routeNearbyReminder({ savedPlaceId: 'a', groupedSavedPlaceIds: ['a'] });
  assert.deepEqual(single, { kind: 'single', savedPlaceId: 'a' });
  // An old notification carries only savedPlaceId — must not crash or group.
  assert.deepEqual(routeNearbyReminder({ savedPlaceId: 'legacy' }), {
    kind: 'single',
    savedPlaceId: 'legacy',
  });
  assert.deepEqual(routeNearbyReminder({ savedPlaceId: 'legacy', groupedSavedPlaceIds: undefined }), {
    kind: 'single',
    savedPlaceId: 'legacy',
  });
}

// --- 7/8/13. Dedupe, malformed entries, and nothing usable ------------------
{
  const dedup = routeNearbyReminder({ savedPlaceId: 'a', groupedSavedPlaceIds: ['a', 'a', 'b', 'b'] });
  assert.deepEqual(dedup.kind === 'group' && dedup.savedPlaceIds, ['a', 'b']);
  // The trigger place leads, even when the array lists it later.
  const ordered = routeNearbyReminder({ savedPlaceId: 'c', groupedSavedPlaceIds: ['a', 'b', 'c'] });
  assert.deepEqual(ordered.kind === 'group' && ordered.savedPlaceIds, ['c', 'a', 'b']);
  // Malformed entries are dropped, never rendered.
  assert.deepEqual(
    normalizeGroupedSavedPlaceIds([null, 42, '', '   ', 'ok', {}, undefined]),
    ['ok'],
  );
  // Nothing usable falls back to the map rather than a broken screen.
  assert.deepEqual(routeNearbyReminder({}), { kind: 'map' });
  assert.deepEqual(routeNearbyReminder({ savedPlaceId: '  ' }), { kind: 'map' });
  assert.deepEqual(routeNearbyReminder({ groupedSavedPlaceIds: 'not-an-array' }), { kind: 'map' });
  assert.doesNotThrow(() => routeNearbyReminder(null as never));
}

// --- 3 (10 places) + bounded transport --------------------------------------
{
  const many = Array.from({ length: 25 }, (_, i) => `id-${i}`);
  const ids = normalizeGroupedSavedPlaceIds(many);
  assert.equal(ids.length, MAX_GROUPED_PLACES, 'the group is bounded');
  // Round-trip through the compact route param: ids only, never objects.
  const encoded = encodeGroupedSavedPlaceIds(['a', 'b', 'c']);
  assert.equal(encoded, 'a,b,c');
  assert.doesNotMatch(encoded, /[{}[\]"]/, 'no serialized records in the URL');
  assert.deepEqual(decodeGroupedSavedPlaceIds(encoded), ['a', 'b', 'c']);
  assert.deepEqual(decodeGroupedSavedPlaceIds('a,,  ,b'), ['a', 'b'], 'blank segments dropped');
  assert.deepEqual(decodeGroupedSavedPlaceIds(undefined), []);
  assert.deepEqual(decodeGroupedSavedPlaceIds(['a', 'a']), ['a']);
}

// --- 10. Header reflects what actually survived -----------------------------
{
  assert.equal(groupedOpportunityTitle(4), '4 places nearby');
  assert.equal(groupedOpportunityTitle(2), '2 places nearby');
  assert.equal(groupedOpportunityTitle(1), '1 place nearby');
  assert.equal(groupedOpportunityTitle(0), 'Nothing nearby right now');
}

// --- 1. The notification already carries the exact group --------------------
const notifications = readFileSync(join(process.cwd(), 'lib/notifications.ts'), 'utf8');
assert.match(
  notifications,
  /data: \{[\s\S]{0,220}groupedSavedPlaceIds,/,
  'delivery schedules the exact member ids — no new payload contract needed',
);
// Delivery is the opportunity; it is where counts advance.
assert.match(notifications, /notification_count: \(grouped\.notification_count \?\? 0\) \+ 1/);

// --- 5/6. Cold + warm taps go through one routing decision ------------------
const resolver = readFileSync(join(process.cwd(), 'lib/notificationTapRouting.ts'), 'utf8');
const controller = readFileSync(join(process.cwd(), 'components/NotificationTapController.tsx'), 'utf8');
assert.match(resolver, /const route = routeNearbyReminder\(data\)/);
assert.match(controller, /pathname: '\/opportunity\/group'/);
assert.match(controller, /params: \{ ids: encodeGroupedSavedPlaceIds\(destination\.savedPlaceIds\) \}/);
// The single-place path is unchanged for 1-place and legacy payloads.
assert.match(resolver, /route\.kind === 'single'/);
assert.match(controller, /destination\.reminder[\s\S]{0,500}reminderSource: 'nearby'/);

// --- 11/12/18. The screen views the group; it never mutates or re-derives ---
const screen = readFileSync(join(process.cwd(), 'app/opportunity/group.tsx'), 'utf8');
// Assert against the CODE, not the file header (which names these concepts
// precisely because the screen must not touch them).
const screenCode = screen.slice(screen.indexOf('*/') + 2);
assert.match(screenCode, /decodeGroupedSavedPlaceIds\(ids\)/, 'ids come from the notification');
assert.doesNotMatch(
  screenCode,
  /checkProximity|nearbyPlaces|useNearbyPlaces|distanceMeters|getCurrentPosition/,
  'the group is never rebuilt from current proximity',
);
assert.doesNotMatch(
  screenCode,
  /reminder_opportunity_count|markVisited|markArchived|updateSavedPlace|notification_count/,
  'opening or closing the group mutates nothing',
);
// 17. Reads go through the RLS-scoped service.
assert.match(screenCode, /getSavedPlace\(id\)/);
// 9. A place deleted since delivery is dropped, not fatal.
assert.match(screenCode, /if \(result\.status !== 'fulfilled' \|\| !result\.value\?\.place\) continue;/);
// 13/14. Cards enter the ONE canonical saved-place detail (Place Detail V2) by
// exact saved_places.id, pushed so Back still returns to the group. The old
// single-place opportunity screen is retired, so members no longer route there.
assert.match(screenCode, /resolveOpenSavedPlaceRoute\(\{[\s\S]{0,120}savedPlaceId: saved\.id/);
assert.match(screenCode, /router\.push\(\{[\s\S]{0,160}pathname: target\.pathname/);
assert.doesNotMatch(screenCode, /pathname: '\/opportunity\/\[id\]'/, 'not into the retired screen');
{
  // Scoped to member selection: opening a member must PUSH so Back returns to
  // the group. (Other handlers on this screen may legitimately replace.)
  const start = screenCode.indexOf('function openPlace(');
  const body = screenCode.slice(start, screenCode.indexOf('\n  }', start));
  assert.ok(body.includes('router.push('), 'a member is pushed');
  assert.ok(!body.includes('router.replace('), 'never destroys group context');
}
// 15/16. Visited state is per place and only reflected, never applied here.
assert.match(screenCode, /const visited = !!saved\.visited_at/);
// No save-selection semantics leak in from the extraction flow.
assert.doesNotMatch(screenCode, /checkbox|Save selected|candidate|confidence/i);
// Analytics carry a count only — no coordinates.
assert.match(screenCode, /trackEvent\('grouped_opportunity_opened', \{ count: places\.length \}\)/);
assert.doesNotMatch(screenCode, /latitude|longitude/, 'never logs or renders coordinates');

console.log('PASS grouped nearby routing, historical group integrity, and legacy compatibility');
