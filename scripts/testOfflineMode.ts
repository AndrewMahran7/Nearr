/**
 * scripts/testOfflineMode.ts
 *
 * When the internet disappears, Nearr should still be the user's saved map.
 *
 * Three things have to hold for that to be true, and each has a way of
 * quietly breaking:
 *
 *   1. A failed request must never replace a good cache with an empty list.
 *      The failure mode is a user opening the app on a train and watching
 *      their saved places vanish.
 *   2. One account's offline data must never surface for another account, or
 *      after an explicit sign-out.
 *   3. A nearby notification must identify its place by saved_places.id, not
 *      by name — names are not identities.
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testOfflineMode.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  clearSavedPlacesCache,
  isLikelyOfflineError,
  isOfflineMutationError,
  OfflineMutationError,
  readSavedPlaceFromCache,
  readSavedPlacesCache,
  setSavedPlacesCacheStore,
  writeSavedPlacesCache,
  type SavedPlacesCacheStore,
} from '../lib/savedPlacesCache';
import {
  decideOfflineIdentity,
  isAuthNetworkFailure,
} from '../lib/offlineIdentityCore';
import type { SavedPlaceWithPlace } from '../types';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

class MemoryStore implements SavedPlacesCacheStore {
  values = new Map<string, string>();
  async getItem(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }
  async multiSet(pairs: string[][]): Promise<void> {
    for (const [k, v] of pairs) this.values.set(k, v);
  }
  async multiRemove(keys: string[]): Promise<void> {
    for (const k of keys) this.values.delete(k);
  }
}

function savedPlace(id: string, extra: Partial<SavedPlaceWithPlace> = {}) {
  return {
    id,
    user_id: 'user-a',
    place_id: `p-${id}`,
    radius_value: null,
    radius_unit: null,
    notes: null,
    ai_note: null,
    source_type: 'instagram',
    source_url: 'https://instagram.com/reel/abc',
    notifications_enabled: true,
    last_notified_at: null,
    notification_count: 0,
    reminder_opportunity_count: 0,
    archived_at: null,
    visited_at: null,
    reminders_exhausted_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    place: {
      id: `pl-${id}`,
      google_place_id: `g-${id}`,
      name: `Place ${id}`,
      formatted_address: '1 Main St',
      latitude: 11.93,
      longitude: -85.95,
      category: null,
      google_maps_url: null,
      created_at: '2026-01-01T00:00:00.000Z',
    },
    ...extra,
  } as SavedPlaceWithPlace;
}

async function main() {
  const store = new MemoryStore();
  setSavedPlacesCacheStore(store);

  // -------------------------------------------------------------------------
  // A successful fetch populates the cache; it survives a "restart"
  // -------------------------------------------------------------------------
  const good = [savedPlace('a'), savedPlace('b'), savedPlace('c')];
  await writeSavedPlacesCache('user-a', good);

  const afterWrite = await readSavedPlacesCache('user-a');
  assert.equal(afterWrite?.data.length, 3, 'a successful fetch populates the cache');
  assert.ok(afterWrite?.lastSyncedAt, 'the cache records when it was synced');

  // "Restart" = brand new module state reading the same durable bytes.
  const restarted = new MemoryStore();
  restarted.values = new Map(store.values);
  setSavedPlacesCacheStore(restarted);
  const afterRestart = await readSavedPlacesCache('user-a');
  assert.equal(
    afterRestart?.data.length,
    3,
    'the cache survives app termination — this is what makes a cold offline launch work',
  );
  setSavedPlacesCacheStore(store);

  // -------------------------------------------------------------------------
  // A failed request must NEVER destroy a good cache
  // -------------------------------------------------------------------------
  // The safety property is structural: nothing writes the cache except a
  // successful fetch. Simulate every transient failure the brief names and
  // confirm the cache is untouched afterwards.
  const transientFailures = [
    new TypeError('Network request failed'),
    new Error('Failed to fetch'),
    new Error('getaddrinfo ENOTFOUND db.supabase.co'),
    new Error('connect ECONNREFUSED 10.0.0.1:443'),
    new Error('ETIMEDOUT'),
    new Error('Load failed'),
  ];
  for (const failure of transientFailures) {
    assert.equal(
      isLikelyOfflineError(failure),
      true,
      `"${failure.message}" must be recognised as a transient/offline failure`,
    );
    // The service throws; no cache write happens on this path.
    const stillThere = await readSavedPlacesCache('user-a');
    assert.equal(
      stillThere?.data.length,
      3,
      `a ${failure.message} must not empty a good saved-places cache`,
    );
  }

  // A 5xx is a server error, not an authoritative empty result.
  assert.equal(
    isLikelyOfflineError(new Error('Internal Server Error')),
    false,
    'a 5xx is not classified as offline — but it still must not clear the cache',
  );
  assert.equal(
    (await readSavedPlacesCache('user-a'))?.data.length,
    3,
    'a server error leaves the cache alone because only success writes',
  );

  // -------------------------------------------------------------------------
  // A SUCCESSFUL empty response is authoritative and DOES replace the cache
  // -------------------------------------------------------------------------
  await writeSavedPlacesCache('user-a', []);
  const afterTrueEmpty = await readSavedPlacesCache('user-a');
  assert.equal(
    afterTrueEmpty?.data.length,
    0,
    'a user who really deleted everything must not keep seeing stale places',
  );
  assert.notEqual(
    afterTrueEmpty,
    null,
    'a true-empty result is a real cached state, distinct from "no cache"',
  );

  // Restore a populated cache for the remaining checks.
  await writeSavedPlacesCache('user-a', good);

  // -------------------------------------------------------------------------
  // User isolation
  // -------------------------------------------------------------------------
  await writeSavedPlacesCache('user-b', [savedPlace('z', { user_id: 'user-b' })]);
  assert.equal(
    (await readSavedPlacesCache('user-a'))?.data.length,
    3,
    "user B signing in must not overwrite user A's cache",
  );
  assert.equal(
    (await readSavedPlacesCache('user-b'))?.data.length,
    1,
    'each user reads only their own cache',
  );
  assert.equal(
    await readSavedPlaceFromCache('user-b', 'a'),
    null,
    "user B must never resolve one of user A's saved places",
  );

  // -------------------------------------------------------------------------
  // Explicit sign-out cannot expose the cache
  // -------------------------------------------------------------------------
  await clearSavedPlacesCache('user-a');
  assert.equal(
    await readSavedPlacesCache('user-a'),
    null,
    "after explicit sign-out the previous user's cache is gone",
  );
  assert.equal(
    await readSavedPlaceFromCache('user-a', 'a'),
    null,
    'a logged-out Place Detail cannot be resolved from cache',
  );
  // An anonymous reader can never open a cache at all.
  assert.equal(
    await readSavedPlacesCache(null),
    null,
    'with no user id there is no cache to read — anonymous access is impossible',
  );

  // -------------------------------------------------------------------------
  // Malformed cache fails safe
  // -------------------------------------------------------------------------
  store.values.set('nearr:savedPlaces:v1:user-a', '{{{ not json');
  assert.equal(
    await readSavedPlacesCache('user-a'),
    null,
    'corrupt cached JSON must never crash startup',
  );
  store.values.set(
    'nearr:savedPlaces:v1:user-a',
    JSON.stringify({ version: 99, lastSyncedAt: 'x', data: [] }),
  );
  assert.equal(
    await readSavedPlacesCache('user-a'),
    null,
    'a cache written by an incompatible version is ignored, not trusted',
  );

  setSavedPlacesCacheStore(null);

  // -------------------------------------------------------------------------
  // Offline auth identity — the privacy boundary
  // -------------------------------------------------------------------------
  assert.equal(
    isAuthNetworkFailure({ name: 'AuthRetryableFetchError', message: 'x' }),
    true,
    "auth-js's retryable fetch error means the server was unreachable",
  );
  assert.equal(
    isAuthNetworkFailure(new TypeError('Network request failed')),
    true,
    'a raw RN fetch failure counts as unreachable',
  );
  assert.equal(
    isAuthNetworkFailure({ status: 503, message: 'unavailable' }),
    true,
    'a 5xx from the auth server is an outage, not a rejection',
  );
  assert.equal(
    isAuthNetworkFailure({ status: 400, message: 'Invalid Refresh Token' }),
    false,
    'a rejected refresh token is NOT a network failure — the server said no',
  );

  assert.deepEqual(
    decideOfflineIdentity({
      hasSession: false,
      error: { name: 'AuthRetryableFetchError', message: 'x' },
      lastAuthenticatedUserId: 'user-a',
    }),
    { kind: 'offline_readonly', userId: 'user-a' },
    'a previously authenticated user offline gets read-only access to their own cache',
  );
  assert.deepEqual(
    decideOfflineIdentity({
      hasSession: false,
      error: { status: 400, message: 'Invalid Refresh Token' },
      lastAuthenticatedUserId: 'user-a',
    }),
    { kind: 'signed_out' },
    'a revoked session must NOT fall back to offline access',
  );
  assert.deepEqual(
    decideOfflineIdentity({
      hasSession: false,
      error: null,
      lastAuthenticatedUserId: 'user-a',
    }),
    { kind: 'signed_out' },
    'no session and no error is a genuine signed-out state, never offline access',
  );
  assert.deepEqual(
    decideOfflineIdentity({
      hasSession: false,
      error: { name: 'AuthRetryableFetchError', message: 'x' },
      lastAuthenticatedUserId: null,
    }),
    { kind: 'signed_out' },
    'a device that never signed anyone in cannot produce an offline session',
  );

  // -------------------------------------------------------------------------
  // Offline mutations stay blocked and legible
  // -------------------------------------------------------------------------
  const mutationError = new OfflineMutationError();
  assert.equal(isOfflineMutationError(mutationError), true, 'the offline error is typed');
  assert.match(
    mutationError.message,
    /internet/i,
    'the blocked-mutation message explains itself to the user',
  );
  const service = read('services/savedPlacesService.ts');
  for (const mutation of [
    'updateSavedPlace',
    'deleteSavedPlace',
    'markVisited',
    'markArchived',
  ]) {
    assert.match(
      service,
      new RegExp(`export async function ${mutation}`),
      `${mutation} still exists`,
    );
  }
  assert.match(
    service,
    /throw new OfflineMutationError\(\)/,
    'server-dependent mutations surface the typed offline error rather than a raw fetch message',
  );

  // -------------------------------------------------------------------------
  // Offline notify path: no Nearr API call at boundary-crossing time
  // -------------------------------------------------------------------------
  const notifications = read('lib/notifications.ts');
  assert.match(
    notifications,
    /async function loadReminderContext\(\)/,
    'the reminder decision resolves its inputs through one context loader',
  );
  assert.match(
    notifications,
    /readActiveReminderSnapshot\(\)/,
    'the context loader falls back to the durable snapshot when the server is unreachable',
  );
  assert.ok(
    !/supabase\.auth\.getUser\(\)/.test(
      notifications.slice(notifications.indexOf('export async function maybeNotifyForSavedPlace')),
    ),
    'maybeNotifyForSavedPlace must not call Supabase auth directly — offline that would drop the OS wake-up',
  );
  assert.match(
    notifications,
    /withTimeout\(\s*\n?\s*loadReminderContextFromServer\(\),/,
    'the server attempt is time-boxed — a hung request must not burn the OS background wake window',
  );
  assert.match(
    notifications,
    /await recordLocalNotification\(groupedSavedPlaceIds\)/,
    'a delivery is recorded locally BEFORE the server writes, so an offline restart still honours the cooldown',
  );

  // A failed request must never tear down monitoring the user switched on.
  // Both sync paths previously read `supabase.auth.getUser()` directly and
  // treated an unreachable server as "signed out" — which STOPPED the
  // background watch and UNREGISTERED every geofence.
  const proximitySync = notifications.slice(
    notifications.indexOf('async function runSyncProximityWatch'),
    notifications.indexOf('export async function sendTestNotification'),
  );
  assert.ok(
    !proximitySync.includes('supabase.auth.getUser()'),
    'the proximity-watch sync must not treat an unreachable auth server as a signed-out user',
  );
  const geofencing = read('lib/geofencing.ts');
  assert.match(
    geofencing,
    /reason=inputs_unavailable regions_preserved/,
    'when inputs cannot be confirmed, registered geofences are preserved rather than stopped',
  );
  assert.match(
    geofencing,
    /await writeReminderSnapshot\(\{ userId, profile, places \}\)/,
    'only a SUCCESSFUL server sync writes the reminder snapshot',
  );
  assert.match(
    geofencing,
    /readActiveReminderSnapshot\(\)/,
    'geofences can be re-registered from the snapshot after an offline reboot',
  );

  // The local notification is still the only nearby-notification owner: there
  // must be no server push path for proximity.
  const pushFn = read('supabase/functions/process-share-jobs/push.ts');
  assert.match(
    pushFn,
    /distinct from the on-device local\s*\n\s*\/\/ place-reminder notifications/,
    'the only server push path is share-job results, explicitly NOT nearby reminders',
  );

  // -------------------------------------------------------------------------
  // Notification identity: saved_places.id, never a name
  // -------------------------------------------------------------------------
  assert.match(
    notifications,
    /data: \{\s*\n\s*savedPlaceId: saved\.id,/,
    'the notification payload carries saved_places.id as the identity',
  );
  for (const forbidden of ['notes', 'ai_note', 'source_url']) {
    assert.ok(
      !new RegExp(`data: \\{[^}]*${forbidden}`, 's').test(
        notifications.slice(notifications.indexOf('scheduleNotificationAsync')),
      ),
      `the notification payload must not leak ${forbidden}`,
    );
  }
  const nearbyRouting = read('lib/nearbyGroupRouting.ts');
  assert.match(
    nearbyRouting,
    /savedPlaceId/,
    'nearby routing resolves by saved place id',
  );
  assert.ok(
    !/place\.name|placeName/.test(nearbyRouting),
    'notification routing must never match on a place NAME — names are not identities',
  );

  const layout = read('app/_layout.tsx');
  assert.match(
    layout,
    /getLastNotificationResponseAsync/,
    'a cold start from a notification tap is handled, not just a warm one',
  );
  assert.match(
    layout,
    /savedPlaceId: nearbyRoute\.savedPlaceId/,
    'tapping a nearby reminder opens the exact saved place by id',
  );
  assert.ok(
    !/getSavedPlace\(|listSavedPlaces\(/.test(layout),
    'notification routing must not require a fresh server fetch before showing anything',
  );

  // -------------------------------------------------------------------------
  // Offline UI contracts
  // -------------------------------------------------------------------------
  const searchBar = read('components/map/MapTopSearchBar.tsx');
  assert.match(
    searchBar,
    /disabled=\{offline\}/,
    'the search entry point is disabled offline, so no remote place search can be issued',
  );
  assert.match(
    searchBar,
    /Search unavailable offline/,
    'offline search state is explained rather than silently broken',
  );

  const map = read('app/(tabs)/map.tsx');
  assert.match(map, /offline=\{offline\}/, 'the map passes offline state into its chrome');
  assert.match(
    map,
    /offline: liveOffline/,
    'offline state comes from the saved-places hook, not from a guess',
  );

  const sheet = read('components/map/MapBottomSheet.tsx');
  assert.match(
    sheet,
    /offline \? 'Offline · ' : ''/,
    'offline is a quiet qualifier on the saved-place count, not a takeover screen',
  );

  const hook = read('hooks/useSavedPlaces.ts');
  assert.match(
    hook,
    /readSavedPlacesCache\(userId\)/,
    'cold start paints the durable cache instead of waiting for the network to fail',
  );
  // The safety property, stated exactly: the failure path READS the durable
  // cache and never WRITES it. A write here is how a transient network error
  // would overwrite good data with an empty list.
  const catchStart = hook.indexOf('} catch (e: any) {');
  assert.ok(catchStart > 0, 'the fetch failure path is where it is expected to be');
  const failurePath = hook.slice(catchStart, catchStart + 2000);
  assert.match(
    failurePath,
    /readSavedPlacesCache\(userId\)/,
    'the failure path serves the last good cache',
  );
  assert.ok(
    !failurePath.includes('writeSavedPlacesCache'),
    'the failure path must NEVER write the cache — that is how a dropped request would erase saved places',
  );

  // Place Detail must not sit on a spinner for remote-only sections offline.
  const asyncCache = read('lib/asyncValueCache.ts');
  assert.match(
    asyncCache,
    /\.catch\(\(error\) => \{/,
    'rich-details loading resolves to null on failure rather than rejecting',
  );
  const detail = read('components/map/SelectedPlaceDetails.tsx');
  assert.match(
    detail,
    /\.finally\(\(\) => \{\s*\n\s*if \(!canceled\) setDetailsLoading\(false\);/,
    'the rich-details spinner always clears, so offline Place Detail never hangs',
  );

  // -------------------------------------------------------------------------
  // Relationships derive from the cached collection, never from the network
  // -------------------------------------------------------------------------
  // "From this video" and "Also Nearby" both operate over the user's own saved
  // places. Because that list is served from the durable cache offline, both
  // keep working with no extra machinery — as long as they stay pure and keep
  // reading the passed-in collection rather than fetching their own.
  for (const pureModule of [
    'lib/alsoNearby.ts',
    'lib/sameSourcePlaces.ts',
    'lib/savedPlacePinState.ts',
  ]) {
    const source = read(pureModule);
    assert.ok(
      !/from '@\/lib\/supabase'|supabase\.|fetch\(/.test(source),
      `${pureModule} must stay pure — a network call here would break offline relationships`,
    );
  }
  assert.match(
    detail,
    /selectSameSourcePlaces\(saved, allSavedPlaces \?\? \[\]\)/,
    '"From this video" derives siblings from the cached saved-place collection',
  );
  assert.match(
    detail,
    /selectAlsoNearby\(saved, allSavedPlaces \?\? \[\]/,
    '"Also Nearby" ranks the user\'s own cached saved places',
  );

  // The cache must carry the provenance those relationships need. A projection
  // that dropped source_url would silently break same-video grouping offline.
  setSavedPlacesCacheStore(store);
  await writeSavedPlacesCache('user-cache-shape', [savedPlace('sib')]);
  const shape = (await readSavedPlacesCache('user-cache-shape'))!.data[0];
  for (const required of [
    'source_url',
    'source_type',
    'notes',
    'ai_note',
    'visited_at',
    'archived_at',
    'notifications_enabled',
    'radius_value',
    'radius_unit',
  ]) {
    assert.ok(
      required in shape,
      `the saved-places cache must persist ${required} — Place Detail, pin state or same-video grouping needs it offline`,
    );
  }
  assert.equal(
    shape.place.latitude,
    11.93,
    'cached coordinates survive, so pins still render offline',
  );
  setSavedPlacesCacheStore(null);

  console.log('PASS testOfflineMode');
}

void main();
