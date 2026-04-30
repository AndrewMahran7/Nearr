# Nearr — Environment Setup

> Last updated: 2026-04-27
> Source of truth: Codebase (not assumptions)

## Prerequisites

- Node 18+ and npm 9+
- Xcode 15+ (iOS dev / share extension)
- Android Studio + JDK 17 (Android dev)
- `eas-cli` (`npm i -g eas-cli`) for dev/prod builds
- Supabase CLI (`brew install supabase/tap/supabase`) for migrations + Edge Functions
- A Supabase project (free tier is fine)
- A Google Cloud project with the **Maps SDK for Android**, **Maps SDK
  for iOS**, **Places API** (the legacy v1 Web Service one) all
  enabled, and a billing account attached
- Optional: a **Gemini API key** if you want server-side AI extraction
  to actually run

## Install

```sh
git clone <repo>
cd Nearr
npm install
cp .env.example .env
# Fill in EXPO_PUBLIC_* values, then:
npx expo start
```

Expo Go works for the basic UI loop. Anything that needs background
location, the iOS share extension, or the Android share intent requires
an EAS dev build.

## Environment variables

All client values are `EXPO_PUBLIC_*` so they get inlined into the JS
bundle. Server / script values are NOT prefixed and live in either
`supabase secrets`, EAS secret env, or local CLI shell only.

| Var | Where | Required | Purpose |
| --- | --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | client | yes | Supabase REST URL |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | client | yes | Supabase anon key |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | client | yes | iOS + Android map tiles + Places search from device |
| `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` | client | recommended | URL of the deployed `process-share-link` Edge Function. If unset, the iOS share extension always falls back to opening the host app. |
| `EXPO_PUBLIC_DEMO_MODE` | client | no | `true` → mock everything (no network) |
| `EXPO_PUBLIC_MAP_PREVIEW_MODE` | client | no | `true` → real auth + real map, seeded data, no location prompt |
| `GOOGLE_MAPS_IOS_KEY` / `GOOGLE_MAPS_ANDROID_KEY` | native build | no | Optional per-platform overrides read by `app.config.js`. Falls back to `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` when unset. |
| `GEMINI_API_KEY` | Edge Function secret | optional | Server-side place extraction via Gemini 1.5 Flash. If missing, function falls back to a deterministic heuristic. |
| `GOOGLE_PLACES_KEY` | Edge Function secret | yes (for the function) | Server-side Google Places Text Search |
| `SUPABASE_URL` | Edge Function secret | auto | Provided by `supabase functions deploy` |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function secret | auto | Provided by `supabase functions deploy` |
| `TRANSCRIPTION_PROVIDER` | Edge Function / script | no | `placeholder` (default, no-op), `soscripted` (paid API), or `self_hosted` (our FastAPI service in [transcription-service/](../transcription-service/)). |
| `SELF_HOSTED_TRANSCRIPTION_URL` | Edge Function / script | iff `self_hosted` | Base URL of the FastAPI service. Bare host or `/transcribe` both work. |
| `TRANSCRIPTION_SERVICE_API_KEY` | Edge Function / script + service | iff `self_hosted` | Shared `x-api-key` between the Edge Function and the FastAPI service. Must match on both sides. |
| `SOSCRIPTED_API_KEY` | Edge Function / script | iff `soscripted` | Bearer token for the SoScripted API. |

### Deprecated / legacy aliases

| Var | Replaced by | Status |
| --- | --- | --- |
| `EXPO_PUBLIC_GOOGLE_PLACES_KEY` | `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | Still read as a fallback by `services/placesService.ts` and the Edge Function. New setups should use the canonical name. |
| `TRANSCRIPTION_API_KEY` | `SOSCRIPTED_API_KEY` / `TRANSCRIPTION_SERVICE_API_KEY` | Read only by the placeholder provider (no real effect). Don't set in new configs. |

> **`app.json` audit.** A Google Maps API key is currently hard-coded
> into `expo.ios.config.googleMapsApiKey` /
> `expo.android.config.googleMaps.apiKey`. Rotate it in Google Cloud
> before TestFlight, replace the inline value with
> `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` (or move the entire
> file to `app.config.ts`), and treat the leaked key as compromised.

## Supabase setup

1. Create the project, copy the URL + anon key into `.env`.
2. Apply migrations:

   ```sh
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   ```

   This runs [20260426000001_init_schema.sql](../supabase/migrations/20260426000001_init_schema.sql)
   and provisions the four tables, RLS policies, and triggers documented
   in [DATABASE.md](DATABASE.md).
3. Auth → URL configuration:
   - Site URL: `nearr://auth-callback`
   - Additional redirect URLs: `exp://*/--/auth-callback`,
     `nearr://auth-callback`, plus any preview deep link you use.
4. (Dev sign-in only.) Create one user via Auth → Users → "Add user"
   with email `dev@nearr.test` and a password you'll remember. The
   sign-in screen exposes a password field for that email when
   `__DEV__` is true.
5. Deploy the Edge Function:

   ```sh
   supabase secrets set \
       GEMINI_API_KEY="…" \
       GOOGLE_PLACES_KEY="…"
   supabase functions deploy process-share-link
   ```

   Copy the function URL into `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL`.

## Google Cloud setup

- Enable: Maps SDK for iOS, Maps SDK for Android, Places API.
- Restrict the **client** key by:
  - Application restrictions → iOS bundle (`com.nearr.ios`) AND Android
    SHA-1 fingerprints from your dev / prod keystore.
  - API restrictions → Maps SDK iOS, Maps SDK Android, Places API.
- The **server** key (`GOOGLE_PLACES_KEY` in Supabase secrets) should
  be a **separate** key restricted to "IP addresses" → Supabase Edge
  runtime egress IPs, and to "Places API" only. Never reuse the client
  key on the server.

## EAS / native builds

1. `eas login`
2. `eas build:configure`
3. Profiles in [eas.json](../eas.json):
   - `development` — internal distribution dev client (background
     location + share extension actually run here)
   - `preview` — internal distribution prod client
   - `production` — store builds
4. iOS-specific:
   - The share extension is generated by `expo-share-extension`. The
     active App Group is `group.com.nearr.ios` (verified in
     [ios/NearrShareExtension/NearrShareExtension.entitlements](../ios/NearrShareExtension/NearrShareExtension.entitlements)).
     The legacy `native/share-extension/` scaffold uses
     `group.com.nearr.app` and is NOT compiled.
   - The local Expo Module `nearr-shared-auth` reads/writes the JWT in
     that App Group's `UserDefaults`.
   - See [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md) for the full
     wiring + verification checklist.
5. Android-specific:
   - [plugins/withAndroidShareIntent.js](../plugins/withAndroidShareIntent.js)
     patches `MainActivity.kt` so `ACTION_SEND` text intents are
     rewritten to `nearr://share?url=…`. After EAS prebuild, verify the
     patched `MainActivity.kt` actually contains the rewrite.

## Demo Mode (`EXPO_PUBLIC_DEMO_MODE=true`)

- Auto-creates a fake `demo-user` session (no Supabase call).
- Replaces all `services/` with the implementations in
  [services/demo/](../services/demo/).
- Replaces `MapView` with [MapFallbackList](../components/MapFallbackList.tsx).
- Persists demo profile + saved places to AsyncStorage so changes stick
  across reloads.
- Settings → Demo Mode → "Simulate notification" fires an in-app
  `Alert` (no real notification permission).
- A red `DemoModeBanner` is visible on every screen.
- A one-shot `console.warn` at startup if `EXPO_PUBLIC_DEMO_MODE=true`
  ships in a non-`__DEV__` build.

## Map Preview Mode (`EXPO_PUBLIC_MAP_PREVIEW_MODE=true`)

- Real `MapView`, real Supabase auth (you must still sign in).
- `placesService.searchPlaces` AND `savedPlacesService.list*` short-circuit
  to the seeded dataset in [services/demo/](../services/demo/).
- Map screen skips the location permission prompt, recenters on the
  seeded region from [lib/mapPreview.ts](../lib/mapPreview.ts), and
  shows a small `Map Preview Mode` badge.
- Demo Mode wins if both flags are set.

## Local UI Mode (DISABLED)

The legacy "fake-session UI mode" entry point was removed.
[hooks/useAuth.ts](../hooks/useAuth.ts) sets
`ALLOW_LOCAL_UI_MODE = false`, so:

- `loadDevAuth()` always returns `false` and clears any stored flag.
- `enableDevAuth()` is a no-op (and warns).
- The Settings toggle for it is gone.
- Use Demo Mode or Map Preview Mode instead.
