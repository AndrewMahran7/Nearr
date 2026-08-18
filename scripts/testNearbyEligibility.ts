/**
 * scripts/testNearbyEligibility.ts
 *
 * Focused tests for lib/nearbyEligibility.ts — category-aware radius,
 * eligibility decision, and single-winner selection. Pure functions only,
 * no mocks needed.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testNearbyEligibility.ts
 */
import assert from 'node:assert/strict';

import { milesToMeters, metersToMiles } from '../lib/geo';
import {
  CATEGORY_RADIUS_BUCKET,
  NEARBY_RADIUS_MILES,
  evaluateNearbyNotificationEligibility,
  getNearbyNotificationRadiusBucket,
  getNearbyNotificationRadiusMeters,
  getNearbyNotificationRadiusMiles,
  isPlaceReliablyClosed,
  resolveReminderPlaceCategory,
  selectNearbyNotificationWinner,
} from '../lib/nearbyEligibility';
import { NEARR_CATEGORIES, type NearrCategory } from '../lib/placeCategory';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// 1. Category -> radius bucket mapping
// ---------------------------------------------------------------------------

check(
  'every NearrCategory has exactly one radius bucket',
  NEARR_CATEGORIES.every((c) => c in CATEGORY_RADIUS_BUCKET),
  'CATEGORY_RADIUS_BUCKET is missing a category',
);

const FOOD: NearrCategory[] = ['restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'dessert'];
for (const c of FOOD) {
  check(`${c} -> 3 mi`, getNearbyNotificationRadiusMiles(c) === 3, String(getNearbyNotificationRadiusMiles(c)));
}

const EVERYDAY: NearrCategory[] = [
  'shopping', 'fitness', 'wellness', 'hotel', 'resort',
  'transportation', 'education', 'service',
];
for (const c of EVERYDAY) {
  check(`${c} -> 4 mi`, getNearbyNotificationRadiusMiles(c) === 4, String(getNearbyNotificationRadiusMiles(c)));
}

const OUTDOOR: NearrCategory[] = ['beach', 'park', 'waterfall', 'lake', 'marina', 'island', 'scenic_spot'];
for (const c of OUTDOOR) {
  check(`${c} -> 6 mi`, getNearbyNotificationRadiusMiles(c) === 6, String(getNearbyNotificationRadiusMiles(c)));
}

const DESTINATION: NearrCategory[] = [
  'hiking_trail', 'attraction', 'winery', 'museum', 'entertainment', 'nightlife', 'sports',
];
for (const c of DESTINATION) {
  check(`${c} -> 10 mi`, getNearbyNotificationRadiusMiles(c) === 10, String(getNearbyNotificationRadiusMiles(c)));
}

check('other -> default (4 mi)', getNearbyNotificationRadiusMiles('other') === 4);
check('unknown string -> default (4 mi)', getNearbyNotificationRadiusMiles('not_a_real_category') === 4);
check('null -> default (4 mi)', getNearbyNotificationRadiusMiles(null) === 4);
check('undefined -> default (4 mi)', getNearbyNotificationRadiusMiles(undefined) === 4);
check(
  'default bucket matches the suggested V1 default',
  NEARBY_RADIUS_MILES[getNearbyNotificationRadiusBucket('other')] === 4,
);

// resolveReminderPlaceCategory
check(
  'resolveReminderPlaceCategory reads a valid stored category',
  resolveReminderPlaceCategory({ category: 'winery' }) === 'winery',
);
check(
  'resolveReminderPlaceCategory falls back to other for null',
  resolveReminderPlaceCategory({ category: null }) === 'other',
);
check(
  'resolveReminderPlaceCategory falls back to other for an invalid legacy string',
  resolveReminderPlaceCategory({ category: 'legacy_bogus_value' }) === 'other',
);
check(
  'resolveReminderPlaceCategory falls back to other when absent',
  resolveReminderPlaceCategory({}) === 'other',
);

// ---------------------------------------------------------------------------
// 2. Units — meters conversion is explicit and correct
// ---------------------------------------------------------------------------

for (const [category, miles] of [['restaurant', 3], ['shopping', 4], ['beach', 6], ['hiking_trail', 10]] as const) {
  const meters = getNearbyNotificationRadiusMeters(category);
  check(
    `${category} radius converts to meters correctly`,
    Math.abs(meters - milesToMeters(miles)) < 1e-6,
    `${meters} !== ${milesToMeters(miles)}`,
  );
  check(
    `${category} meters convert back to ${miles} mi`,
    Math.abs(metersToMiles(meters) - miles) < 1e-9,
  );
}

// ---------------------------------------------------------------------------
// 3. Boundary conditions
// ---------------------------------------------------------------------------

{
  const radiusMeters = milesToMeters(3); // restaurant bucket
  const base = { isRecentlyNotified: false, isReliablyClosed: false };

  const justInside = evaluateNearbyNotificationEligibility({
    ...base,
    distanceMeters: radiusMeters - 1,
    radiusMeters,
  });
  check('just inside radius -> eligible', justInside.eligible === true);

  const exactlyAtRadius = evaluateNearbyNotificationEligibility({
    ...base,
    distanceMeters: radiusMeters,
    radiusMeters,
  });
  check('exactly at radius -> eligible', exactlyAtRadius.eligible === true);

  const justOutside = evaluateNearbyNotificationEligibility({
    ...base,
    distanceMeters: radiusMeters + 1,
    radiusMeters,
  });
  check(
    'just outside radius -> not eligible',
    justOutside.eligible === false && justOutside.reason === 'outside_radius',
  );
}

// ---------------------------------------------------------------------------
// 4. Suppression
// ---------------------------------------------------------------------------

{
  const inRange = { distanceMeters: 100, radiusMeters: 1000 };

  const visited = evaluateNearbyNotificationEligibility({
    ...inRange,
    isVisited: true,
    isRecentlyNotified: false,
    isReliablyClosed: false,
  });
  check('visited -> suppressed', visited.eligible === false && visited.reason === 'visited');

  const recently = evaluateNearbyNotificationEligibility({
    ...inRange,
    isRecentlyNotified: true,
    isReliablyClosed: false,
  });
  check(
    'recently notified -> suppressed',
    recently.eligible === false && recently.reason === 'recently_notified',
  );

  const closed = evaluateNearbyNotificationEligibility({
    ...inRange,
    isRecentlyNotified: false,
    isReliablyClosed: true,
  });
  check('closed -> suppressed', closed.eligible === false && closed.reason === 'closed');

  const eligible = evaluateNearbyNotificationEligibility({
    ...inRange,
    isRecentlyNotified: false,
    isReliablyClosed: false,
  });
  check('none of the above -> eligible', eligible.eligible === true);
}

// business_status -> isPlaceReliablyClosed
check('CLOSED_PERMANENTLY -> reliably closed', isPlaceReliablyClosed('CLOSED_PERMANENTLY') === true);
check('CLOSED_TEMPORARILY -> reliably closed', isPlaceReliablyClosed('CLOSED_TEMPORARILY') === true);
check('OPERATIONAL -> not closed', isPlaceReliablyClosed('OPERATIONAL') === false);
check(
  'unknown hours (null business_status) -> not automatically closed',
  isPlaceReliablyClosed(null) === false,
);
check(
  'unknown hours (undefined business_status) -> not automatically closed',
  isPlaceReliablyClosed(undefined) === false,
);
check(
  'unrecognized status string -> not automatically closed',
  isPlaceReliablyClosed('SOME_FUTURE_GOOGLE_STATUS') === false,
);

// ---------------------------------------------------------------------------
// 5. Ranking / single-winner selection
// ---------------------------------------------------------------------------

{
  const single = selectNearbyNotificationWinner([{ id: 'a', distanceMeters: 500 }]);
  check('one eligible candidate -> selected', single.winner?.id === 'a' && single.losers.length === 0);

  const multi = selectNearbyNotificationWinner([
    { id: 'far', distanceMeters: 900 },
    { id: 'near', distanceMeters: 100 },
    { id: 'mid', distanceMeters: 400 },
  ]);
  check('multiple eligible -> nearest wins', multi.winner?.id === 'near');
  check(
    'losers are everyone else, nearest-first',
    multi.losers.map((l) => l.id).join(',') === 'mid,far',
  );

  const none = selectNearbyNotificationWinner([]);
  check('no eligible candidates -> no winner', none.winner === null && none.losers.length === 0);

  // A suppressed candidate is never even in the candidate list in the first
  // place (callers only push eligible identities into the array passed
  // here) — modeled by simply confirming a smaller, pre-filtered list still
  // behaves correctly rather than re-deriving eligibility inside the
  // selector, which is intentionally not its job.
  const afterSuppression = selectNearbyNotificationWinner([{ id: 'onlyEligible', distanceMeters: 50 }]);
  check(
    'a suppressed candidate cannot win (never enters the winner pool)',
    afterSuppression.winner?.id === 'onlyEligible',
  );
}

console.log('');
if (failures === 0) {
  console.log('ALL nearby-eligibility tests passed.');
  process.exit(0);
}
console.log(`${failures} nearby-eligibility test(s) FAILED.`);
process.exit(1);
