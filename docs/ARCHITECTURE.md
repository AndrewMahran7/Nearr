# Nearr — Architecture

> Companion to [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md). This file explains
> *how* the V1 code is organized and the data flow through each subsystem.

## Tech stack

- **Framework:** Expo SDK 51 + React Native 0.74 + Expo Router 3 + TypeScript 5.3
- **Backend:** Supabase (Postgres + Auth + RLS)
- **Auth:** Supabase magic-link (email OTP) over `nearr://auth-callback`
- **Maps:** `react-native-maps` (Google provider, native SDK keys per platform)
- **Places:** Google Places Web Service (Text Search + Details)
- **Location / notifications:** `expo-location`, `expo-notifications`, `expo-task-manager`
- **Storage:** `@react-native-async-storage/async-storage` (Supabase session persistence)
- **Path alias:** `@/*` → repo root (`@/components`, `@/lib/supabase`, `@/services/...`)

## Folder structure

```
app/                          Expo Router screens
  _layout.tsx                 Root stack + AuthGate + deep-link + AppState proximity
  index.tsx                   <Redirect href="/(tabs)/home" />
  (auth)/
    _layout.tsx               headerShown: false stack
    sign-in.tsx               Magic-link form + onboarding copy
  (tabs)/
    _layout.tsx               Tabs: home / map / places / settings
    home.tsx                  Dashboard + saved places list
    map.tsx                   react-native-maps + permission state + preview card
    places.tsx                Pure list of saved places
    settings.tsx              Profile + notification + quiet-hours form
  add-place.tsx               Modal: Google Places search → confirm → save
  share.tsx                   Modal: paste URL → OG preview → hand off to add-place
  place/[id].tsx              Saved-place detail / edit / delete

components/                   Design-system primitives (no business logic)
  Button.tsx  Card.tsx  EmptyState.tsx  Input.tsx  Screen.tsx
  SavedPlaceCard.tsx          Domain card (name + address + radius + source + delete)
  index.ts

constants/
  colors.ts  spacing.ts  typography.ts  index.ts

hooks/
  useAuth.ts                  Supabase session subscription
  usePlacesSearch.ts          Google Places search w/ stale-response protection
  useSavedPlaces.ts           List + refresh state for saved_places

lib/                          Integrations + pure helpers (no React)
  supabase.ts                 Supabase client (env precedence + warn)
  authDeepLink.ts             Implicit + PKCE magic-link callback
  geo.ts                      Haversine + miles/minutes ↔ meters
  notifications.ts            Background task + proximity decision logic
  shareParser.ts              OG/Twitter/<title> extraction + buildQuery

services/                     Thin facades over lib/Supabase for screens
  auth.ts                     sendMagicLink, signOut, getCurrentUser
  notifications.ts            Re-export public proximity API
  placesService.ts            Google Places Text Search + Details
  profileService.ts           profiles row read/update
  savedPlacesService.ts       saved_places + places upsert/list/get/update/delete

types/index.ts                Profile / PlaceRow / SavedPlace / SavedPlaceWithPlace
                              / RadiusUnit / SourceType

supabase/
  migrations/
    20260426000001_init_schema.sql   Source of truth for the V1 schema
  schema.sql                  DEPRECATED — pre-normalized prototype, do not run

native/share-extension/       INERT iOS share-extension scaffold (not registered)
plugins/withShareExtension.js NO-OP placeholder

docs/                         This handoff bundle (you are here)
logs/claude_runs/             Per-day build logs
```

## Subsystems

### 1. Auth gate + deep links

```
app/(auth)/sign-in.tsx ── sendMagicLink ──► Supabase
                                                │
   email link tapped on device                  │
                                                ▼
        OS opens nearr://auth-callback#access_token=…&refresh_token=…
                                                │
              app/_layout.tsx ◄─ Linking.getInitialURL / addEventListener('url')
                                                │
                            handleAuthDeepLink (lib/authDeepLink.ts)
                                                │
                supabase.auth.setSession(...) OR exchangeCodeForSession(...)
                                                │
                    onAuthStateChange ► useAuth ► AuthGate ► /(tabs)/home
```

- `services/auth.sendMagicLink` builds the redirect URI with
  `Linking.createURL('auth-callback')` so it works in Expo Go (`exp://...`)
  AND in dev/prod builds (`nearr://auth-callback`).
- `handleAuthDeepLink` supports both implicit (`#access_token=...&refresh_token=...`)
  and PKCE (`?code=...`) callbacks.
- Session persists via `AsyncStorage`; `autoRefreshToken: true`.
- Sign-out lives in **Settings** with a confirmation dialog.

### 2. Manual save flow

```
/add-place ── usePlacesSearch ── searchPlaces ──► Google Places Text Search
                                                          │
                                          PlaceCandidate[] (normalized)
                                                          │
                          user picks one → confirmation card → Save
                                                          │
              saveSavedPlace (services/savedPlacesService.ts):
                1. upsert places by google_place_id
                2. insert saved_places (user_id, place_id, radius, source)
                3. catch PG 23505 → { status: 'duplicate' }
                                                          │
                                       router.replace('/(tabs)/home')
```

Radius modes:
- `'default'` → leaves `radius_value`/`radius_unit` NULL (notifier uses profile default)
- `'miles'` → numeric override
- `'minutes'` → numeric override (notifier converts via 25 mph approximation)

### 3. Share-link ingestion

```
/share?url=...
   │
   ├── isLikelyUrl (lib/shareParser.ts) — guard against junk
   │
   ├── parseShare(url):
   │     1. fetch with generic UA + 8s timeout (no auth, no private APIs)
   │     2. extract og:title / twitter:title / <title> + og:description / twitter:description
   │     3. detectSource(host) → 'tiktok' | 'instagram' | 'link'
   │     4. strip platform boilerplate ("on TikTok", "| Instagram", "(@handle) on Instagram", …)
   │     5. buildQuery: title preferred → first sentence of description; strip hashtags + URLs;
   │                    collapse whitespace; cap at 120 chars
   │
   ├── phase = 'preview' if we got a usable suggestedQuery; else 'failed'
   │
   └── continueToCandidates / manualSearch → router.replace('/add-place', {
            q?, source_url, source_type
       })
```

`/add-place` reads the same params, prefills `query`, auto-runs the search,
and stamps `source_type` + `source_url` on the saved row.

### 4. Map

- Single `MapView` with `Marker`s for every saved place.
- Permission state machine: `'pending' | 'granted' | 'denied'`
  - `granted` → show user dot, center on user location.
  - `denied` → "Location is off" banner with `Linking.openSettings()`; map
    centers on first saved place (or US fallback).
- After data loads, calls `fitToSuppliedMarkers(ids, …)` once.
- Marker tap → in-app preview card (NOT the platform callout) with
  `Open in Maps` (uses `place.google_maps_url` or `?query=lat,lng` fallback)
  and `View details` (→ `/place/[id]`).
- FAB hides while a preview card is shown.

### 5. Notifications (proximity)

```
Settings save ─┬─ notifications_enabled && nearby_notifications_enabled
               │       └─► startProximityWatch
               │             ├─ ensureForegroundLocationPermission
               │             ├─ ensureBackgroundLocationPermission
               │             └─ Location.startLocationUpdatesAsync(LOCATION_TASK)
               │
               └─ otherwise
                       └─► stopProximityWatch (Location.stopLocationUpdatesAsync)

LOCATION_TASK (TaskManager.defineTask in lib/notifications.ts side-effect import):
   on each tick → checkProximity(lat, lng):
       ├─ getProfile()
       ├─ early-out if disabled
       ├─ inQuietHours? insert 'silenced' event, skip
       ├─ list saved_places with notifications_enabled = true
       ├─ for each → decideProximity:
       │     effectiveRadiusMeters = perPlace > profile default > 1 mile
       │     distance = haversine(user, place)
       │     within = distance ≤ radius
       ├─ apply 1h cooldown (in-memory + last_notified_at)
       └─ fireNotification:
             ├─ Notifications.scheduleNotificationAsync (local)
             ├─ update saved_places.last_notified_at
             └─ insert notification_events { event_type: 'nearby', distance_meters }

app/_layout.tsx: on session start AND on AppState 'active' →
   checkProximityOnce(): one-shot getCurrentPositionAsync → checkProximity
```

**Limitations of V1 proximity:**
- Polling (~60s / 100m), not OS-level geofencing.
- iOS coalesces background ticks aggressively; intervals are requests, not guarantees.
- Background location requires an EAS dev/prod build — **does not work in Expo Go**.
- Android 12+ requires a separate background-location permission prompt.
- "Minutes" radii use a fixed 25 mph approximation, not a routing API.

### 6. Design system

- Primitives in `components/` are stateless and theme-driven.
- All screens compose primitives + tokens from `constants/`.
- `EmptyState` is the standard loading-error / empty-list / hint card across
  Home, Places, Map (denied), Add-Place search, Settings (load fail).
- `SavedPlaceCard` is the only domain-specific component (used by Home, Places).

## Conventions

- **No direct Supabase calls from screens.** All DB I/O goes through `services/`.
- **No `any` casts at boundaries.** `services/` returns typed rows from
  `types/index.ts`; screens consume those types directly.
- **Expected errors are typed.** `placesService` throws `PlacesError` with a
  stable `code`; the UI branches on that code (see `placesErrorMessage` in
  `app/add-place.tsx`).
- **Logging is loud.** Every service logs `[serviceName] action` on entry and
  `[serviceName] action failed` on error. Notifications service logs every
  proximity decision so behavior is auditable post-hoc.
- **JSX attribute escapes.** Use a JS expression (`title={'\u2019'}`) for any
  attribute containing `\uXXXX` / `\n`. JSX attribute *strings* do not decode
  JS escapes. (See Task 15 fix.)
