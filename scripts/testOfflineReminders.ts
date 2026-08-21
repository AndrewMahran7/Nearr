/**
 * scripts/testOfflineReminders.ts
 *
 * The phone must be able to answer "am I near a saved place?" on its own.
 *
 * Nearr's proximity detection and notification delivery were always
 * device-local, but the DECISION between them read four Supabase tables. With
 * no network the first read failed and the OS wake-up was thrown away: the
 * geofence fired, the app woke, and nothing happened.
 *
 * These tests pin the two pieces that close that gap — the durable reminder
 * snapshot and the selection policy that decides which places the OS gets to
 * monitor — plus the platform cap that bounds the whole promise.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testOfflineReminders.ts
 */
import assert from 'node:assert/strict';

import { milesToMeters } from '../lib/geo';
import {
  getNearbyNotificationRadiusMeters,
  NEARBY_RADIUS_MILES,
} from '../lib/nearbyEligibility';
import {
  MAX_MONITORED_REGIONS,
  MIN_REGION_RADIUS_M,
  MAX_REGION_RADIUS_M,
  clampRegionRadius,
  dedupeBySavedPlaceId,
  isMonitorEligible,
  rankForMonitoring,
  selectMonitoredPlaces,
} from '../lib/reminderSelection';
import {
  applyLedger,
  clearReminderSnapshot,
  isValidReminderPlace,
  readActiveReminderSnapshot,
  readActiveReminderUserId,
  readReminderSnapshot,
  recordLocalNotification,
  setReminderSnapshotStore,
  writeReminderSnapshot,
  type ReminderEligiblePlace,
  type ReminderSnapshotStore,
} from '../lib/reminderSnapshot';

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class MemoryStore implements ReminderSnapshotStore {
  values = new Map<string, string>();
  failWrites = false;

  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async setItem(key: string, value: string): Promise<void> {
    if (this.failWrites) throw new Error('disk full');
    this.values.set(key, value);
  }
  async multiRemove(keys: string[]): Promise<void> {
    for (const key of keys) this.values.delete(key);
  }
}

let seq = 0;
function place(
  overrides: Partial<ReminderEligiblePlace> & {
    id: string;
    latitude?: number;
    longitude?: number;
  },
): ReminderEligiblePlace {
  const { latitude = 40, longitude = -74, ...rest } = overrides;
  seq += 1;
  return {
    place_id: `place-${rest.id}`,
    radius_value: null,
    radius_unit: null,
    notifications_enabled: true,
    last_notified_at: null,
    notification_count: 0,
    created_at: `2026-01-${String(seq).padStart(2, '0')}T00:00:00.000Z`,
    place: {
      id: `p-${rest.id}`,
      google_place_id: `g-${rest.id}`,
      name: `Place ${rest.id}`,
      formatted_address: '1 Main St',
      latitude,
      longitude,
    },
    ...rest,
  };
}

async function main() {
  // -------------------------------------------------------------------------
  // Platform cap
  // -------------------------------------------------------------------------
  // Apple: "Core Location prevents any single app from monitoring more than
  // 20 conditions of any type simultaneously." The product cannot promise
  // that an unbounded number of saved places will each wake the app.
  assert.equal(
    MAX_MONITORED_REGIONS,
    20,
    'the monitored-region cap must match the documented iOS limit of 20',
  );

  // -------------------------------------------------------------------------
  // Eligibility
  // -------------------------------------------------------------------------
  assert.equal(
    isMonitorEligible(place({ id: 'ok' })),
    true,
    'a notifications-on place with real coordinates is eligible',
  );
  assert.equal(
    isMonitorEligible(place({ id: 'off', notifications_enabled: false })),
    false,
    'reminders switched off means the OS never monitors the place',
  );
  assert.equal(
    isMonitorEligible(place({ id: 'nan', latitude: Number.NaN })),
    false,
    'a NaN coordinate must be excluded before it reaches startGeofencingAsync',
  );
  assert.equal(
    isMonitorEligible(place({ id: 'range', latitude: 91 })),
    false,
    'an out-of-range latitude is excluded',
  );
  assert.equal(
    isMonitorEligible(place({ id: 'null-island', latitude: 0, longitude: 0 })),
    false,
    '(0,0) is a failed geocode, not a place the user saved',
  );

  // -------------------------------------------------------------------------
  // Dedupe
  // -------------------------------------------------------------------------
  const duped = dedupeBySavedPlaceId([
    place({ id: 'a' }),
    place({ id: 'a' }),
    place({ id: 'b' }),
  ]);
  assert.deepEqual(
    duped.map((row) => row.id),
    ['a', 'b'],
    'one saved_places.id registers exactly one region',
  );

  // -------------------------------------------------------------------------
  // Ranking: nearest first, with a total order
  // -------------------------------------------------------------------------
  const here = { latitude: 40, longitude: -74 };
  const far = place({ id: 'far', latitude: 41, longitude: -74 });
  const near = place({ id: 'near', latitude: 40.001, longitude: -74 });
  const mid = place({ id: 'mid', latitude: 40.1, longitude: -74 });
  assert.deepEqual(
    rankForMonitoring([far, mid, near], here).map((r) => r.id),
    ['near', 'mid', 'far'],
    'the nearest eligible places are monitored first',
  );

  // Identical coordinates must still produce a stable, repeatable order.
  const tieA = { ...place({ id: 'tie-a' }), created_at: '2026-05-01T00:00:00.000Z' };
  const tieB = { ...place({ id: 'tie-b' }), created_at: '2026-05-02T00:00:00.000Z' };
  const firstRun = rankForMonitoring([tieA, tieB], here).map((r) => r.id);
  const secondRun = rankForMonitoring([tieB, tieA], here).map((r) => r.id);
  assert.deepEqual(
    firstRun,
    secondRun,
    'ties break deterministically, so repeated syncs do not thrash registrations',
  );
  assert.deepEqual(firstRun, ['tie-b', 'tie-a'], 'newest wins a distance tie');

  // With no known location we fall back to newest-first.
  assert.deepEqual(
    rankForMonitoring([tieA, tieB], null).map((r) => r.id),
    ['tie-b', 'tie-a'],
    'without a location fix, ordering falls back to most recently saved',
  );

  // -------------------------------------------------------------------------
  // Under the cap: monitor everything, no ranking judgement applied
  // -------------------------------------------------------------------------
  const few = Array.from({ length: 5 }, (_, i) => place({ id: `few-${i}` }));
  const underCap = selectMonitoredPlaces(few, here);
  assert.equal(underCap.selected.length, 5, 'every eligible place fits under the cap');
  assert.equal(underCap.skipped, 0, 'nothing is skipped under the cap');
  assert.equal(underCap.capped, false, 'under the cap is not reported as capped');

  // -------------------------------------------------------------------------
  // Over the cap: nearest N, and honestly reported as a subset
  // -------------------------------------------------------------------------
  const many = Array.from({ length: 50 }, (_, i) =>
    // i=0 is furthest, i=49 is nearest.
    place({ id: `many-${i}`, latitude: 40 + (50 - i) * 0.01, longitude: -74 }),
  );
  const overCap = selectMonitoredPlaces(many, here);
  assert.equal(
    overCap.selected.length,
    MAX_MONITORED_REGIONS,
    'never register more regions than the platform allows',
  );
  assert.equal(overCap.eligible, 50, 'the eligible count reports the true total');
  assert.equal(overCap.skipped, 30, 'the skipped count is explicit, not hidden');
  assert.equal(overCap.capped, true, 'exceeding the cap is reported');
  assert.equal(
    overCap.selected[0].id,
    'many-49',
    'the nearest eligible place is monitored when the cap forces a subset',
  );
  assert.ok(
    !overCap.selected.some((row) => row.id === 'many-0'),
    'the furthest places are the ones dropped',
  );

  // Disabled places never consume one of the 20 slots.
  const mixed = [
    ...Array.from({ length: 25 }, (_, i) =>
      place({ id: `on-${i}`, latitude: 40 + i * 0.01 }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      place({ id: `off-${i}`, notifications_enabled: false, latitude: 40.0001 }),
    ),
  ];
  const mixedSelection = selectMonitoredPlaces(mixed, here);
  assert.equal(mixedSelection.eligible, 25, 'disabled places are not eligible');
  assert.ok(
    !mixedSelection.selected.some((row) => row.id.startsWith('off-')),
    'a disabled reminder never takes a monitoring slot from an enabled one',
  );

  // -------------------------------------------------------------------------
  // Radius: the user's configured value is preserved, only the region clamps
  // -------------------------------------------------------------------------
  assert.equal(clampRegionRadius(800), 800, 'a workable radius passes through unchanged');
  assert.equal(
    clampRegionRadius(10),
    MIN_REGION_RADIUS_M,
    'a tiny radius is raised to the smallest reliably monitored region',
  );
  assert.equal(
    clampRegionRadius(40_000),
    MAX_REGION_RADIUS_M,
    'a city-sized radius is capped for the REGION only',
  );
  assert.equal(clampRegionRadius(Number.NaN), MIN_REGION_RADIUS_M, 'NaN is handled');
  assert.equal(clampRegionRadius(-5), MIN_REGION_RADIUS_M, 'a negative radius is handled');

  const custom = place({ id: 'custom', radius_value: 3, radius_unit: 'miles' });
  assert.equal(
    custom.radius_value,
    3,
    "clamping the region must never rewrite the user's configured radius",
  );

  // -------------------------------------------------------------------------
  // Native geofence registration reflects the adaptive category radius.
  //
  // lib/geofencing.ts registers each region with
  // `clampRegionRadius(effectiveRadiusMeters(s))`, and
  // `effectiveRadiusMeters`'s no-override branch is a direct passthrough to
  // `getNearbyNotificationRadiusMeters` (see lib/notifications.ts). This
  // reproduces that exact composition using the two real, pure functions —
  // lib/notifications.ts itself cannot be imported under plain ts-node (a
  // transitive Expo/RN dependency breaks Node's module loader), which is why
  // this proves the composition here instead of importing that file.
  //
  // MAX_REGION_RADIUS_M is derived FROM NEARBY_RADIUS_MILES (see
  // lib/reminderSelection.ts) specifically so this can never silently regress:
  // a native region must never be smaller than the SAME place's in-app
  // proximity check and map circle.
  // -------------------------------------------------------------------------
  assert.equal(
    MAX_REGION_RADIUS_M,
    milesToMeters(Math.max(...Object.values(NEARBY_RADIUS_MILES))),
    'the region-radius ceiling is derived from the adaptive category radii, not a stale hardcoded number',
  );

  const registeredRegionRadius = (category: string) =>
    clampRegionRadius(getNearbyNotificationRadiusMeters(category));

  assert.equal(
    Math.round(registeredRegionRadius('restaurant')),
    Math.round(milesToMeters(3)),
    'a restaurant registers a ~3 mi native region',
  );
  assert.equal(
    Math.round(registeredRegionRadius('shopping')),
    Math.round(milesToMeters(4)),
    'an everyday-bucket place registers its full ~4 mi native region, not truncated',
  );
  assert.equal(
    Math.round(registeredRegionRadius('park')),
    Math.round(milesToMeters(6)),
    'a park registers a ~6 mi native region',
  );
  assert.equal(
    Math.round(registeredRegionRadius('hiking_trail')),
    Math.round(milesToMeters(10)),
    'a hiking trail registers a ~10 mi native region, not clamped down to ~3 mi',
  );

  // Nothing above the ceiling ever reaches the OS.
  for (const category of ['restaurant', 'shopping', 'park', 'hiking_trail']) {
    assert.ok(
      registeredRegionRadius(category) <= MAX_REGION_RADIUS_M,
      `${category} region radius must never exceed the platform-safe ceiling`,
    );
  }

  // -------------------------------------------------------------------------
  // Snapshot: write / read round trip
  // -------------------------------------------------------------------------
  const store = new MemoryStore();
  setReminderSnapshotStore(store);

  const userA = 'user-a';
  const userB = 'user-b';
  const profileA = {
    id: userA,
    email: null,
    default_radius_value: 2,
    default_radius_unit: 'miles' as const,
    notifications_enabled: true,
    nearby_notifications_enabled: true,
    quiet_hours_enabled: false,
    quiet_hours_start: null,
    quiet_hours_end: null,
    terms_accepted_at: null,
    privacy_accepted_at: null,
    legal_version: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };

  await writeReminderSnapshot({
    userId: userA,
    profile: profileA,
    places: [place({ id: 'a1' }), place({ id: 'a2' })],
  });

  const readA = await readReminderSnapshot(userA);
  assert.ok(readA, 'a written snapshot reads back');
  assert.equal(readA.places.length, 2, 'both places survive the round trip');
  assert.ok(
    readA.profile && !('default_radius_value' in readA.profile) && !('default_radius_unit' in readA.profile),
    'legacy profile radius fields are not exposed by the reminder snapshot',
  );
  assert.equal(
    await readActiveReminderUserId(),
    userA,
    'writing a snapshot records who this device holds reminders for',
  );

  // The snapshot must carry ONLY reminder fields — never notes or provenance.
  const rawA = JSON.parse(store.values.get('nearr:reminderSnapshot:v3:user-a')!);
  assert.ok(
    !('default_radius_value' in rawA.profile) && !('default_radius_unit' in rawA.profile),
    'new reminder snapshots do not persist the legacy profile radius',
  );
  const serialisedPlace = rawA.places[0];
  for (const forbidden of ['notes', 'ai_note', 'source_url', 'source_type']) {
    assert.ok(
      !(forbidden in serialisedPlace),
      `the reminder snapshot must not persist ${forbidden} — that is product data, not a reminder input`,
    );
  }

  // Upgrade-style read: an existing v3 snapshot may still contain the old
  // fields. Read-and-ignore is deliberately non-mutating and idempotent.
  const legacySnapshot = JSON.stringify({
    ...rawA,
    profile: {
      ...rawA.profile,
      default_radius_value: 99,
      default_radius_unit: 'miles',
    },
  });
  store.values.set('nearr:reminderSnapshot:v3:user-a', legacySnapshot);
  const legacyReadA = await readReminderSnapshot(userA);
  const legacyReadAgain = await readReminderSnapshot(userA);
  assert.ok(
    legacyReadA?.profile && !('default_radius_value' in legacyReadA.profile),
    'an old local reminder-distance value is ignored safely',
  );
  assert.deepEqual(legacyReadAgain, legacyReadA, 'repeated legacy reads are idempotent');
  assert.equal(
    store.values.get('nearr:reminderSnapshot:v3:user-a'),
    legacySnapshot,
    'read-and-ignore does not repeatedly mutate AsyncStorage',
  );

  // -------------------------------------------------------------------------
  // User isolation
  // -------------------------------------------------------------------------
  await writeReminderSnapshot({
    userId: userB,
    profile: { ...profileA, id: userB },
    places: [place({ id: 'b1' })],
  });
  const readAAgain = await readReminderSnapshot(userA);
  assert.deepEqual(
    readAAgain?.places.map((p) => p.id),
    ['a1', 'a2'],
    "user B's sync must not touch user A's snapshot",
  );
  assert.equal(
    (await readReminderSnapshot(userB))?.places.length,
    1,
    'each user reads only their own reminder snapshot',
  );
  assert.equal(
    await readActiveReminderUserId(),
    userB,
    'the active pointer follows the most recent sync',
  );

  // -------------------------------------------------------------------------
  // Offline cooldown ledger
  // -------------------------------------------------------------------------
  setReminderSnapshotStore(store);
  await writeReminderSnapshot({
    userId: userA,
    profile: profileA,
    places: [place({ id: 'a1' }), place({ id: 'a2' })],
  });
  // (writeReminderSnapshot moved the active pointer back to user A)
  const notifiedAt = Date.parse('2026-08-17T12:00:00.000Z');
  await recordLocalNotification(['a1'], notifiedAt);

  const afterLedger = await readReminderSnapshot(userA);
  const a1 = afterLedger!.places.find((p) => p.id === 'a1')!;
  const a2 = afterLedger!.places.find((p) => p.id === 'a2')!;
  assert.equal(
    a1.last_notified_at,
    new Date(notifiedAt).toISOString(),
    'an offline delivery is recorded locally so a restart still honours the cooldown',
  );
  assert.equal(a1.notification_count, 1, 'the local ledger raises the notification count');
  assert.equal(
    a2.last_notified_at,
    null,
    'recording a delivery for one place must not touch another',
  );

  // A later successful sync brings server rows that are BEHIND the local
  // ledger. The merge must keep the more conservative local value.
  await writeReminderSnapshot({
    userId: userA,
    profile: profileA,
    places: [place({ id: 'a1' }), place({ id: 'a2' })], // server: never notified
  });
  const afterResync = await readReminderSnapshot(userA);
  const a1Resynced = afterResync!.places.find((p) => p.id === 'a1')!;
  assert.equal(
    a1Resynced.last_notified_at,
    new Date(notifiedAt).toISOString(),
    'a resync must not forget an offline delivery the server never heard about',
  );

  // The merge takes the MAX, so a NEWER server value wins.
  const serverNewer = Date.parse('2026-08-18T12:00:00.000Z');
  const merged = applyLedger(
    [place({ id: 'x', last_notified_at: new Date(serverNewer).toISOString() })],
    { x: { at: notifiedAt, count: 1 } },
  );
  assert.equal(
    merged[0].last_notified_at,
    new Date(serverNewer).toISOString(),
    'the newer of server and local wins, so the ledger can only suppress',
  );

  // -------------------------------------------------------------------------
  // Malformed data fails safe
  // -------------------------------------------------------------------------
  assert.equal(isValidReminderPlace(null), false, 'null is not a place');
  assert.equal(isValidReminderPlace({}), false, 'an empty object is not a place');
  assert.equal(
    isValidReminderPlace({ id: 'x', notifications_enabled: true }),
    false,
    'a place with no coordinates is rejected',
  );

  store.values.set('nearr:reminderSnapshot:v3:user-a', '{not json at all');
  assert.equal(
    await readReminderSnapshot(userA),
    null,
    'corrupt JSON reads as "no snapshot" rather than crashing a background task',
  );

  store.values.set(
    'nearr:reminderSnapshot:v3:user-a',
    JSON.stringify({ version: 3, userId: userA, syncedAt: 'x', places: 'nope', ledger: {} }),
  );
  assert.equal(
    await readReminderSnapshot(userA),
    null,
    'a structurally wrong snapshot is ignored, not trusted',
  );

  // A snapshot from an older schema version is ignored rather than migrated.
  store.values.set(
    'nearr:reminderSnapshot:v3:user-a',
    JSON.stringify({ version: 2, userId: userA, syncedAt: 'x', places: [], ledger: {} }),
  );
  assert.equal(
    await readReminderSnapshot(userA),
    null,
    'an old schema version is safely ignored',
  );

  // One bad row must not destroy the good ones.
  await writeReminderSnapshot({
    userId: userA,
    profile: profileA,
    places: [
      place({ id: 'good-1' }),
      { ...place({ id: 'bad' }), place: null } as unknown as ReminderEligiblePlace,
      place({ id: 'good-2' }),
    ],
  });
  const survivors = await readReminderSnapshot(userA);
  assert.deepEqual(
    survivors?.places.map((p) => p.id),
    ['good-1', 'good-2'],
    'a single malformed place is skipped and never costs the user their other reminders',
  );

  // -------------------------------------------------------------------------
  // Sign-out makes the snapshot unreachable
  // -------------------------------------------------------------------------
  await clearReminderSnapshot(userA);
  assert.equal(
    await readActiveReminderUserId(),
    null,
    'clearing forgets which user this device held reminders for',
  );
  assert.equal(
    await readActiveReminderSnapshot(),
    null,
    'after sign-out an OS geofence event finds no snapshot and cannot notify',
  );
  assert.equal(
    await readReminderSnapshot(userA),
    null,
    "the signed-out user's snapshot is gone, not merely hidden",
  );

  // A failing store must never throw out of a background task.
  const failing = new MemoryStore();
  failing.failWrites = true;
  setReminderSnapshotStore(failing);
  await writeReminderSnapshot({ userId: userA, profile: profileA, places: [place({ id: 'z' })] });
  await recordLocalNotification(['z']);

  setReminderSnapshotStore(null);
  console.log('PASS testOfflineReminders');
}

void main();
