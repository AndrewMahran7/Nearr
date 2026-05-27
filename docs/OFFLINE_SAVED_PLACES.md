# Read-only offline saved places (Stage 0)

This document describes the **minimum-viable offline support** Nearr ships
for saved places. It is intentionally read-only: the user can keep
browsing what they already had on this device when the network drops,
but any change (edit/delete/visit/archive/unarchive) is blocked with a
clear message until they reconnect.

## Scope

- **Read-only.** Saved-place lists and individual detail screens are
  populated from a local cache when the network is unavailable.
- **No mutation queue.** Edits, deletes, mark-visited/archived, and
  unarchive throw a friendly `OfflineMutationError` while offline; the
  caller's existing `Alert.alert` surfaces it as
  _"Internet required to update saved places."_
- **No new auth/token caching.** Auth still flows through Supabase as
  normal; cache reads require a live session (we use the existing user
  id to key the cache).
- **No schema changes.** Cache stores the same `SavedPlaceWithPlace`
  rows the app already loads.

## Implementation

| File | Role |
| --- | --- |
| [lib/savedPlacesCache.ts](../lib/savedPlacesCache.ts) | AsyncStorage cache utility (`writeSavedPlacesCache`, `readSavedPlacesCache`, `readSavedPlaceFromCache`, `clearSavedPlacesCache`), `isLikelyOfflineError` sniffer, and `OfflineMutationError`. |
| [hooks/useSavedPlaces.ts](../hooks/useSavedPlaces.ts) | Writes the cache on every successful refresh; on an offline-shaped error falls back to cached rows and surfaces `offline: true` + `lastSyncedAt`. |
| [services/savedPlacesService.ts](../services/savedPlacesService.ts) | `listSavedPlaces` + `getSavedPlace` write/read the cache; mutations (`updateSavedPlace`, `deleteSavedPlace`, `markVisited`, `markArchived`, `unarchive`) wrap their Supabase call in a try/catch and rethrow `OfflineMutationError` when the error looks like an offline failure. |
| [components/OfflineBanner.tsx](../components/OfflineBanner.tsx) | Small banner shown above Home and Places lists when serving cached data. |

### Cache keys

```
nearr:savedPlaces:v1:<userId>               // payload: SavedPlaceWithPlace[]
nearr:savedPlaces:lastSyncedAt:v1:<userId>  // payload: ISO timestamp string
```

The `v1` segment is `CACHE_VERSION`; bump it (and ignore older keys) if
the cached shape ever changes incompatibly.

### Cached fields

The full `SavedPlaceWithPlace` row is cached as-is. Every field on that
type is already a JSON-safe scalar/string/array of scalars, so no
custom (de)serialisation is required.

### Online refresh behaviour

1. `useSavedPlaces` runs `listSavedPlaces` on mount and on user pull-to-refresh.
2. On success the hook resets `offline=false`, sets `lastSyncedAt` to
   "now", and `listSavedPlaces` writes the rows to AsyncStorage in the
   background (`void writeSavedPlacesCache(userId, rows)`).
3. Cache writes are best-effort and never throw into the hook.

### Offline behaviour

1. When the Supabase call rejects with a fetch-shaped error
   (`isLikelyOfflineError`), `useSavedPlaces` reads the cache:
   - If the cache exists, it sets `data` to the cached rows (initial
     load) or keeps the current rows (refresh), sets `offline=true`,
     `lastSyncedAt=<cached>`, and clears `error`.
   - If no cache exists, it falls through to the existing error state
     (`Couldn't load your places`, "Try again" CTA).
2. Detail screens call `getSavedPlace`. When that hits an offline
   error it pulls the row from the cache via
   `readSavedPlaceFromCache(userId, savedPlaceId)`. If the place isn't
   cached, it re-throws and the detail screen shows its existing error
   state.
3. All mutations throw `OfflineMutationError` with the message
   `"Internet required to update saved places."`. Callers already
   alert `err?.message`, so no caller code had to change.

### Blocked actions

| Function | Action label in logs |
| --- | --- |
| `updateSavedPlace` | `update` |
| `deleteSavedPlace` | `delete` |
| `markVisited`      | `mark_visited` |
| `markArchived`     | `mark_archived` |
| `unarchive`        | `unarchive` |

Each blocked attempt logs `[offline] network_action_blocked action=<label>`.

## What is _not_ implemented

- No mutation queue / outbox; offline writes are rejected, not deferred.
- No conflict resolution. Reconnecting just refreshes the cache.
- No cache encryption. The cache contains the same data the user
  already sees in-app and **no** auth tokens, refresh tokens, or
  Supabase keys.
- No sign-out invalidation wired into the auth flow yet
  (`clearSavedPlacesCache` is exported for when we wire it).
- No background sync / periodic warm-up.
- No NetInfo dependency. Offline state is inferred from fetch-shaped
  errors, so it only flips after an actual failed call.
- No banner inside `app/opportunity/[id].tsx`; the existing alert is
  the only offline surface there.
- `markArchived({ exhausted: true })` auto-archive (when reminders run
  out) fails silently offline and is retried on the next online cycle.

## Future work

- Wire `clearSavedPlacesCache(userId)` into sign-out and account-delete.
- Add a lightweight offline write queue (likely starts with
  `markVisited`, which is the lowest-risk write).
- Replace the error-shape sniffer with `@react-native-community/netinfo`
  once we want preemptive UI ("You're offline" before the first
  failure).
- Encrypt the cache (e.g. `expo-secure-store`-wrapped key) once the
  schema starts holding anything sensitive.

## Manual QA checklist

1. Launch the app online with a signed-in account that has saved places.
2. Confirm the Home and Places tabs render normally.
3. Kill and relaunch the app while still online. Confirm everything still loads.
4. Turn airplane mode on.
5. Relaunch the app.
   - Expect: saved places visible, **OfflineBanner** above the list,
     "Last synced …" reflects the previous online sync.
   - Map markers (or list fallback) populate from the cached rows.
6. Open a saved place detail screen.
   - Expect: detail screen opens with cached data.
7. Try to edit/delete/mark visited/archive/unarchive a saved place.
   - Expect: alert reading **"Internet required to update saved places."**
8. Turn airplane mode off and pull-to-refresh.
   - Expect: banner disappears, `lastSyncedAt` updates, mutations work again.
9. Sign out, clear the app from memory, reinstall, and relaunch in
   airplane mode without ever syncing.
   - Expect: existing "Couldn't load your places" empty state with
     copy explaining the device is offline and has no cache.
