# Nearr — Project Context

> Last updated: 2026-04-27
> Source of truth: Codebase (not assumptions)

> Handoff entry point. New chat / new dev: start here, then read
> [ARCHITECTURE.md](ARCHITECTURE.md), [ENVIRONMENT.md](ENVIRONMENT.md),
> [DATABASE.md](DATABASE.md), [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md),
> [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md),
> [V1_SCOPE_FREEZE.md](V1_SCOPE_FREEZE.md), [NEXT_STEPS.md](NEXT_STEPS.md).

## What Nearr is

Mobile app that lets a user save real-world places (especially restaurants
discovered on TikTok / Instagram), pins them on a map, and notifies them
when they're physically nearby. Saves can be manual, paste-link, or
share-sheet driven.

## Tech stack (as actually configured)

- Expo SDK ~51 + React Native 0.74.5 + Expo Router ~3.5 + TypeScript ~5.3
- Supabase (Postgres + Auth + RLS) via `@supabase/supabase-js` ^2.45
- Supabase Edge Functions (Deno) for the server-side share pipeline
- Auth: Supabase magic link (email OTP) over `nearr://auth-callback`,
  plus a dev-only password sign-in for the `dev@nearr.test` test user
- Maps: `react-native-maps` 1.14 (Google provider)
- Places: Google Places Web Service (Text Search + Details), called from
  the client and mirrored server-side in the Edge Function
- Location / notifications: `expo-location` ~17, `expo-notifications` ~0.28,
  `expo-task-manager` ~11.8
- Storage: `@react-native-async-storage/async-storage` (Supabase session)
- iOS share extension: `expo-share-extension` ^1.10.7 (active, registered)
- Android share intent: in-repo config plugin
  [withAndroidShareIntent](../plugins/withAndroidShareIntent.js) patches
  `MainActivity.kt` to convert `ACTION_SEND` into a `nearr://share` deep
  link
- Local Expo Module
  [nearr-shared-auth](../modules/nearr-shared-auth/index.ts) bridges the
  Supabase access token through the App Group `UserDefaults` to the iOS
  share extension
- AI extraction: Gemini 1.5 Flash, server-side only — same logic ported
  into [aiExtractPlace.ts](../lib/aiExtractPlace.ts) (Node-only) and
  inlined in the Edge Function

## Current real-world feature state

Status legend: **shipping** = works end-to-end on device; **partial** =
works with caveats noted; **scaffold** = present but inert / not used.

| Feature | Status | Notes |
| --- | --- | --- |
| Magic-link sign-in | shipping | [sign-in.tsx](../app/(auth)/sign-in.tsx) + [authDeepLink.ts](../lib/authDeepLink.ts) (implicit + PKCE). |
| Dev-only password sign-in for `dev@nearr.test` | shipping | `__DEV__`-only; surfaces a password input + "Sign in as developer" button when that exact email is typed. The Supabase user must be created manually. |
| Home dashboard | shipping | [home.tsx](../app/(tabs)/home.tsx). Greeting, "Save a place" / "Save from link" CTAs, list, "Nearby alerts off" hint, pull-to-refresh, focus refresh. |
| Manual place save | shipping | [add-place.tsx](../app/add-place.tsx). Debounced live search (300 ms after 3+ chars), best-effort foreground-location bias, confirmation card with Default / Miles / Minutes radius. |
| Paste-link save | shipping | [share.tsx](../app/share.tsx) auto-runs the full pipeline on `?url=` deep link. |
| AI place extraction in share flow | partial | [aiExtractPlace.ts](../lib/aiExtractPlace.ts) requires `GEMINI_API_KEY`, which is intentionally **not** in the mobile bundle. In RN it always falls back to the local heuristic in [placeExtractor.ts](../lib/placeExtractor.ts). Real AI runs only inside the Edge Function. |
| Address-only / franchise resolution | shipping | When Places returns a street address or many same-named candidates, [placesService.ts](../services/placesService.ts) re-queries against the location context (e.g. text after `📍`) extracted from the caption and ranks by proximity. |
| One-tap auto-save in share flow | shipping | When exactly one strong candidate comes back, the share screen saves immediately with the profile-default radius, alerts the user, and routes to `/(tabs)/map`. |
| Saved-place picker (ambiguous share) | shipping | Multi-candidate UI on the share screen. |
| iOS Share Extension ("Save to Nearr") | partial | Wired via `expo-share-extension`. The extension extracts the URL and POSTs to `process-share-link` if `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` is set AND the App Group JWT is present. Otherwise it hands off via `nearr://share?url=…`. End-to-end silent save has not been verified on a real device in this checkout. |
| Android system share sheet | shipping | `ACTION_SEND text/plain` rewritten to `nearr://share?url=…` in `MainActivity.kt` (cold + warm start). |
| Supabase Edge Function `process-share-link` | shipping (code) / unverified (deploy) | [process-share-link/index.ts](../supabase/functions/process-share-link/index.ts). Auth via Bearer token, public OG fetch, Gemini extraction, Google Places search, address/locality filter, idempotent save. Returns one of `saved` / `ambiguous` / `failed_requires_app` / `open_app`. Whether it is actually deployed to a Supabase project is a per-environment concern. |
| Map | shipping | [map.tsx](../app/(tabs)/map.tsx). Markers, per-place radius bubbles via `<Circle>`, zone-aware `fitToCoordinates`, permission state machine (`pending` / `granted` / `denied` / `unavailable`), in-app preview card, "Show on map" deep link via `?savedPlaceId=`. |
| Saved-place detail / edit / delete | shipping | [place/[id].tsx](../app/place/[id].tsx). |
| Settings | shipping | Default radius, master + nearby toggles, quiet hours (HH:MM text inputs, no time picker), sign-out. |
| Nearby notifications | partial | Polled `Location.startLocationUpdatesAsync` + a TaskManager task. Per-place 1 h cooldown, quiet hours, `notification_events` audit. Background only works in EAS dev/prod builds, never Expo Go. **Not** OS-level geofencing. |
| Demo Mode (dev-only) | shipping | `EXPO_PUBLIC_DEMO_MODE=true` mocks Supabase / Places / Maps / location / notifications. Triple-guarded on `__DEV__`. |
| Map Preview Mode (dev-only) | shipping | `EXPO_PUBLIC_MAP_PREVIEW_MODE=true` keeps the real `MapView` but uses seeded data and skips the location prompt. Triple-guarded on `__DEV__`. |
| Local UI Mode (legacy fake-local session) | disabled | UI entry point removed; `ALLOW_LOCAL_UI_MODE = false` in [useAuth.ts](../hooks/useAuth.ts) hard-disables it; `clearDevAuth()` runs on every cold start. |
| Transcription fallback (audio → text) | scaffold | [lib/transcription/](../lib/transcription/) only ships a `placeholder` provider that returns `status='unavailable'`. No real provider integrated; nothing is transcribed at runtime. |
| Eval harness | shipping (script) | [scripts/evalShareExtraction.ts](../scripts/evalShareExtraction.ts) replays fixtures through the AI extractor. Outputs to [logs/share-extraction-eval-*.json](../logs/). |

## Folder structure (as it actually is)

```
app/                          Expo Router screens
  _layout.tsx                 Root stack + AuthGate + deep links + AppState proximity
  index.tsx                   <Redirect href="/(tabs)/home" />
  (auth)/sign-in.tsx          Magic link + dev password (when email == dev@nearr.test)
  (tabs)/                     home / map / places / settings
  add-place.tsx               Modal: Google Places search → confirm → save
  share.tsx                   Modal: paste-link / share-extension target
  place/[id].tsx              Saved-place detail / edit / delete
ShareExtension.tsx            Root component for the iOS share-extension target
index.share.js                Entry point for the iOS share-extension bundle
metro.config.js               Registers `share.js` as a source ext
components/                   Button, Card, EmptyState, Input, Screen,
                              SavedPlaceCard, DemoModeBanner, DevModeBanner,
                              MapFallbackList
constants/                    colors, spacing, typography
hooks/                        useAuth, usePlacesSearch, useSavedPlaces
lib/                          Integrations + pure helpers (no React)
  supabase.ts                 Client + writes access token into App Group
  authDeepLink.ts             Magic-link callback (implicit + PKCE)
  geo.ts                      Haversine + miles/minutes ↔ meters
  notifications.ts            Background task + proximity decision logic
  shareParser.ts              OG / Twitter / <title> extraction
  placeExtractor.ts           Local deterministic place-name heuristic
  aiExtractPlace.ts           Gemini-backed extractor (server / script only)
  externalMaps.ts             Build Google / Apple Maps URLs
  mapPreview.ts               Map Preview Mode flag + seeded region
  demoMode.ts / demoData.ts   Demo Mode flag + seed catalog
  devAuth.ts                  Legacy Local UI Mode (now disabled)
  sharedAuth.ts               JS wrapper over modules/nearr-shared-auth
  transcription/              Placeholder transcription dispatcher
modules/nearr-shared-auth/    Local Expo Module: App Group UserDefaults bridge
services/                     Thin façade over lib/Supabase for screens
  auth.ts                     sendMagicLink, signInWithPassword, signOut
  notifications.ts            Public proximity API
  placesService.ts            Google Places search + details + ranking
  profileService.ts           profiles row read/update
  savedPlacesService.ts       saved_places + places upsert/list/get/update/delete
  demo/                       Demo Mode mocks for the above
plugins/
  withAndroidShareIntent.js   Patches MainActivity.kt for ACTION_SEND
  withShareExtension.js       NO-OP placeholder (do NOT enable; superseded
                              by expo-share-extension)
native/share-extension/       DEAD scaffold (uses obsolete App Group
                              `group.com.nearr.app`); not compiled
ios/NearrShareExtension/      Generated by `expo prebuild` (App Group =
                              `group.com.nearr.ios`)
android/                      Generated by `expo prebuild`
supabase/
  schema.sql                  DEPRECATED — do not run
  migrations/
    20260426000001_init_schema.sql   Source of truth
  functions/process-share-link/index.ts
                              Server-side share pipeline (Deno Edge Function)
scripts/                      evalShareExtraction.ts, testProcessShareLink.ts
docs/                         This handoff bundle
logs/                         Eval logs + per-day build logs
```

Path alias `@/*` maps to repo root.

## Subsystem summary

Diagrams in [ARCHITECTURE.md](ARCHITECTURE.md). One-liner each:

- **Auth.** `services/auth.sendMagicLink` → email link → `nearr://auth-callback`
  → `app/_layout.tsx` calls `handleAuthDeepLink` (handles implicit
  `#access_token` AND PKCE `?code=`) → `setSession` /
  `exchangeCodeForSession`. Dev shortcut for `dev@nearr.test`:
  `signInWithPassword` (real Supabase user, real RLS).
- **Manual save.** `usePlacesSearch` → `searchPlaces` → confirm →
  `saveSavedPlace`: SELECT-then-INSERT on `places` (RLS denies UPDATE on
  the shared table), INSERT on `saved_places` with `23505` recovery that
  refreshes source/notes/radius.
- **Share-link (host app).** `parseShare` (public OG / Twitter / `<title>`,
  8 s timeout) → `extractPlaceQueryFromShareMetadata` (local heuristic) +
  `extractPlaceAI` (no-op without server key) → `searchPlaces` with
  caption-derived location bias → if 1 strong candidate, silent save +
  navigate to map; otherwise picker; address/locality results trigger a
  business resolver near the geocoded context.
- **Share-link (iOS extension).** Pull first URL from share payload, POST
  to `process-share-link` if `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` is set
  and a JWT is in the App Group. Otherwise hand off via
  `nearr://share?url=…`. The fallback path is what ships today.
- **Share-link (Android).** `withAndroidShareIntent` patches
  `MainActivity` to rewrite `ACTION_SEND text/plain` into
  `nearr://share?url=…`; the host app's `/share` screen does the rest.
- **Notifications.** Polled `startLocationUpdatesAsync` → TaskManager task
  → `checkProximity` → effective radius (per-place > profile default >
  1 mile) → quiet hours → 1 h cooldown (memory + `last_notified_at`) →
  local notification + `notification_events` row. One-shot foreground
  check on session start and on `AppState 'active'`.
- **Map.** Markers + per-place `<Circle>` zone bubbles. `fitToCoordinates`
  uses zone-bounding corners (markers + radius edges). `?savedPlaceId=`
  deep link focuses the matching place. Preview card overlays; FAB hides
  while card is shown.

## Database schema

Migration: [20260426000001_init_schema.sql](../supabase/migrations/20260426000001_init_schema.sql).
Full reference: [DATABASE.md](DATABASE.md). Tables:

- `profiles` (1:1 with `auth.users`) — defaults + notification prefs.
  Auto-created by `handle_new_user` trigger.
- `places` — canonical Google Places records. **Shared** across users
  (any authenticated user can SELECT + INSERT, no UPDATE/DELETE).
  Deduped by `google_place_id`.
- `saved_places` — per-user "I want to go here" with overrides
  (`radius_value`, `radius_unit`, `notes`, `notifications_enabled`,
  `last_notified_at`, `source_type`, `source_url`). Unique on
  `(user_id, place_id)`.
- `notification_events` — append-only audit (`event_type` ∈
  `'nearby' | 'entered' | 'exited' | 'silenced'`; only `'nearby'` is
  emitted today; `'silenced'` is referenced in code but not currently
  inserted).

RLS on all four. Owner-only on profiles / saved_places / notification_events.

## Setup

Walkthrough: [ENVIRONMENT.md](ENVIRONMENT.md). TL;DR:

```powershell
npm install
cp .env.example .env        # then fill in keys
npm run typecheck           # must exit 0
npm run start               # Metro
```

## Known limitations / current reality

These are real and live in production code. Read them before promising
behavior to a tester or reviewer.

- **iOS share extension silent-save is unverified end-to-end.** The
  extension reads the access token from the App Group via
  `nearr-shared-auth`, but the JWT bridge has not been QA'd on a real
  device with a deployed Edge Function in this checkout. The extension
  defaults to `open_app` whenever the token or endpoint is missing, and
  the host-app deep-link flow runs.
- **Background location requires an EAS dev/prod build.** Expo Go does
  not run TaskManager background tasks.
- **Proximity is polled (~60 s / 100 m), not OS geofenced.** iOS
  coalesces background ticks aggressively; the interval is a request,
  not a guarantee. Android 12+ requires a separate background-location
  prompt.
- **`notification_events.event_type`** only ever gets `'nearby'` today;
  `'entered'` / `'exited'` / `'silenced'` exist in the CHECK constraint
  for future use.
- **"Minutes" radii** use a fixed 25 mph approximation in
  [geo.ts](../lib/geo.ts); there is no routing API.
- **Gemini AI extraction does not run on device.** `extractPlaceAI` looks
  for `process.env.GEMINI_API_KEY`, intentionally absent from the mobile
  bundle. In RN it always returns the fallback query at
  `confidence: 'low'`. Real AI extraction happens only in the Edge
  Function.
- **Transcription is a stub.** [lib/transcription/](../lib/transcription/)
  only ships the `placeholder` provider; the dispatcher always returns
  `status='unavailable'`. Despite hooks in the AI prompt for a
  `transcript` field, no audio is transcribed at runtime.
- **Quiet-hours UI is plain HH:MM text inputs**, no time picker.
- **The hand-rolled iOS share-extension scaffold under
  [native/share-extension/](../native/share-extension/) is dead code.**
  It uses the obsolete App Group identifier `group.com.nearr.app` and is
  not compiled. The active extension lives at
  [ios/NearrShareExtension/](../ios/NearrShareExtension/) (generated by
  prebuild) with App Group `group.com.nearr.ios`.
- **`plugins/withShareExtension.js` is a no-op.** Enabling it would log
  a warning. Superseded by `expo-share-extension`.
- **Local UI Mode (legacy fake-local session) is hard-disabled** in
  [useAuth.ts](../hooks/useAuth.ts) and [_layout.tsx](../app/_layout.tsx);
  the AsyncStorage flag is wiped on every cold start.
- **No automated tests.** [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) is
  the V1 contract. The eval harness in
  [evalShareExtraction.ts](../scripts/evalShareExtraction.ts) only covers
  the share-extraction prompt.
- **No retry/backoff on Google Places quota errors.** `OVER_QUERY_LIMIT`
  surfaces directly to the user with a friendly message.
- **`app.json` has a hard-coded Google Maps API key** in
  `ios.config.googleMapsApiKey` and `android.config.googleMaps.apiKey`.
  This is checked in. Rotate before any public release.
- **`UIBackgroundModes`** in `app.json` lists `location` and `fetch`
  twice (duplicate entries) — harmless to iOS but worth cleaning before
  TestFlight.

## What to build next

Full plan in [NEXT_STEPS.md](NEXT_STEPS.md). Headlines:

1. Run [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) end-to-end on a real
   iOS device and a real Android device.
2. Verify the iOS share extension JWT bridge end-to-end (App Group
   provisioned + access token actually written + extension reading it +
   Edge Function deployed).
3. Deploy `process-share-link`, set `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL`,
   and confirm silent-save works for a real shared TikTok / Instagram URL.
4. Rotate and lock down the Google Maps Platform key (bundle/package
   restrictions, daily quota cap).
5. Audit Supabase RLS + redirect URLs against the live project.
6. Cut TestFlight + Play Internal Testing builds.

Do not start V2 features (real geofencing, real transcription, photos,
push, social, automated test suite) until V1 is on TestFlight.
