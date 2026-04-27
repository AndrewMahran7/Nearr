# Nearr — Environment Setup

This is everything a fresh developer (or a fresh chat) needs to do to get
the app running locally. Pair with [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)
for the verification steps.

## 1. Prerequisites

- Node 18+ and npm.
- Expo CLI (via `npx expo`, no global install needed).
- A real iOS or Android device for notifications + map testing. Simulator/emulator
  is fine for everything else.
- Optional but recommended: Supabase CLI (`supabase`) for migration runs.

## 2. Install

```powershell
git clone <repo>
cd Nearr
npm install
```

`npm run typecheck` should exit 0 on a clean checkout.

## 3. Environment variables

Copy `.env.example` to `.env` at the repo root and fill in:

```
EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-jwt>

# One Google Maps Platform key with both Places Web Service AND Maps SDK enabled.
# Used by services/placesService for Text Search + Details.
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<key>

# Native Maps SDK keys (referenced from app.json ios.config / android.config).
# Can be the same key as above if it allows both iOS + Android bundle IDs.
GOOGLE_MAPS_IOS_KEY=<key>
GOOGLE_MAPS_ANDROID_KEY=<key>
```

### Env-var precedence

`lib/supabase.ts` and `services/placesService.ts` both prefer `EXPO_PUBLIC_*`
(inlined at build time by Expo) and fall back to `app.json` `extra.*`:

| key | primary | fallback |
| --- | --- | --- |
| Supabase URL | `EXPO_PUBLIC_SUPABASE_URL` | `extra.supabaseUrl` |
| Supabase anon key | `EXPO_PUBLIC_SUPABASE_ANON_KEY` | `extra.supabaseAnonKey` |
| Google key | `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | `EXPO_PUBLIC_GOOGLE_PLACES_KEY` (legacy) → `extra.googlePlacesKey` |
| iOS Maps SDK | `app.json` `ios.config.googleMapsApiKey` (`$GOOGLE_MAPS_IOS_KEY`) | — |
| Android Maps SDK | `app.json` `android.config.googleMaps.apiKey` (`$GOOGLE_MAPS_ANDROID_KEY`) | — |

If both primary and fallback are missing the app boots but logs:

```
[supabase] Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.
```

…and `searchPlaces` throws `PlacesError('MISSING_API_KEY', …)` which
`/add-place` shows as a friendly error.

After editing `.env`, restart Metro with `npx expo start --clear`.

## 4. Supabase setup

### One-time project setup (Supabase dashboard)

- **Auth → Providers → Email:** enable *Magic Link*.
- **Auth → URL Configuration → Redirect URLs:** allow-list
  - `nearr://auth-callback`
  - `nearr://*`
  - `exp://127.0.0.1:8081/--/auth-callback` (Expo Go local)
  - `exp://192.168.*.*:8081/--/auth-callback` (LAN dev — replace with your IP)
- **Site URL:** `nearr://auth-callback`.

### Apply the migration

```powershell
# Preferred (keeps history):
supabase db push

# Or paste supabase/migrations/20260426000001_init_schema.sql into the SQL editor.
```

The migration creates `profiles`, `places`, `saved_places`,
`notification_events`, RLS policies on all four, the `set_updated_at`
trigger, and the `handle_new_user` trigger that auto-creates a `profiles`
row on signup. Full schema reference: [DATABASE.md](DATABASE.md).

The legacy `supabase/schema.sql` is **deprecated**; do not run it.

## 5. Google Maps Platform setup

In the Google Cloud console for the project that owns the API key:

- **APIs to enable:**
  - Places API (used by `services/placesService`)
  - Maps SDK for iOS
  - Maps SDK for Android
- **Key restrictions** (recommended for production, optional for dev):
  - Application restrictions → iOS apps → bundle ID `com.nearr.app`.
  - Application restrictions → Android apps → package `com.nearr.app` + SHA-1.
  - API restrictions → Places API + Maps SDK iOS + Maps SDK Android only.

The same key can be used for all three Expo references; restrict by bundle/package
rather than splitting keys.

## 6. Native build (when needed)

The following V1 features **do not work in Expo Go** and require an EAS dev build:

- Background location updates (proximity watch ticks while the app is backgrounded).
- Full notifications behavior (foreground notifications work in Expo Go; some
  background scheduling does not).
- Native share-intent reception on iOS (the scaffolded share extension; not
  registered in V1 anyway — see [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md)).

To produce a dev build:

```powershell
npx eas build --profile development --platform ios     # or android
```

Configure `eas.json` per Expo's docs; not committed at the V1 cut.

## 7. Daily commands

```powershell
npm install                          # one-time
npm run start                        # expo start (Metro)
npm run typecheck                    # tsc --noEmit (must exit 0)
npx expo start --clear               # after .env / app.json changes
npx expo start --tunnel              # if Expo Go can't reach your LAN
```

Android local dev only: `android/local.properties` should point at the
Android SDK (`sdk.dir=...`). Not committed; per-machine.

## 8. Sanity checklist before you test

- [ ] `.env` populated with both Supabase keys + Google key.
- [ ] Supabase migration applied (the four tables visible in the dashboard).
- [ ] Redirect URLs allow-listed.
- [ ] `npm run typecheck` exits 0.
- [ ] `npm run start` boots without `[supabase] Missing …` warnings.
- [ ] Real device available for the notifications + map sections of
      [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md).

## Demo Mode (dev-only)

Set `EXPO_PUBLIC_DEMO_MODE=true` in your local `.env` to run Nearr without any external services configured (no Supabase, no Google Places, no Google Maps SDK, no real location, no real notifications).

- Triple-guarded: `isDemoMode()` only returns true when `__DEV__` is also true. Production builds ignore the flag (and log a one-shot warning if it leaks).
- Auto-creates a fake session for `demo-user` / `demo@nearr.local`.
- Profile and saved places are persisted to AsyncStorage under `nearr.demo.profile` and `nearr.demo.savedPlaces`.
- Place search returns matches from a static catalog in `lib/demoData.ts` (Santa Cruz / OC / LA).
- Share parser skips the network fetch and synthesizes a title from the URL path.
- Map screen renders a list fallback (`MapFallbackList`) instead of `MapView`.
- Notifications `startProximityWatch` / `stopProximityWatch` are no-ops; use Settings ? Demo Mode ? Simulate nearby notification to fire an in-app `Alert`.
- Settings ? Demo Mode also exposes Reset demo data, which restores seeded profile + places.


## Map Preview Mode (dev-only)

Set `EXPO_PUBLIC_MAP_PREVIEW_MODE=true` in your local `.env` to polish the real `react-native-maps` UI without Supabase, Google Places, or real device location.

- Triple-guarded on `__DEV__` (`isMapPreviewMode()` returns false in production, with a one-shot warning if the env var leaks).
- Auto-creates a fake session for `map-preview-user` / `map-preview@nearr.local`.
- Saved-places reads return the seeded demo dataset (same source as Demo Mode).
- Place search short-circuits to the local catalog.
- Map renders the real `MapView` centered on a fixed Santa Cruz region (`MAP_PREVIEW_REGION` in `lib/mapPreview.ts`); the location permission prompt is skipped.
- A small `Map Preview Mode` badge appears at the top of the map screen.
- Marker preview cards behave exactly like production.
- Demo Mode and Map Preview Mode are separate switches. If both are set, Demo Mode wins (renders the list fallback instead of MapView).


## Recommended dev auth flow (real test user)

For day-to-day development, do NOT use the legacy local fake user (now
labelled "Local UI Mode"). It has no Supabase session, so RLS rejects every
read and write � Settings, saved_places, profiles, and notifications cannot
be exercised.

Instead, sign in with a real test email:

1. Add yourself (or a dedicated test address) to your Supabase project's
   allowed users.
2. On the Sign-In screen, enter the test email and tap "Send magic link".
3. Open the email on the same device/emulator and tap the link � the deep
   link routes back into the app and creates a real session.
4. Verify a row exists in public.profiles with your uth.users.id. If
   it doesn't, the trigger that mirrors auth -> profiles is misconfigured;
   fix that before doing anything else.
5. From here, normal flows work end-to-end:
   - Save a place (writes to places + saved_places).
   - Open Settings (reads/writes profiles.default_radius_*,
     
otifications_enabled, quiet hours).
   - Foreground-only notifications fire from the proximity watcher.

### About the legacy "Local UI Mode" (formerly "Dev Mode")

- The sign-in screen no longer shows a button to enter Local UI Mode.
- The flag still exists in lib/devAuth.ts for offline UI testing only.
- When active, the DevModeBanner reads "Local UI Mode cannot test
  Supabase reads/writes" and the Settings screen offers an Exit button.
- Do not use service-role keys in the client. Do not disable RLS.
- Demo Mode (EXPO_PUBLIC_DEMO_MODE) and Map Preview Mode
  (EXPO_PUBLIC_MAP_PREVIEW_MODE) are independent and remain available
  for UX-only testing.

## Dev-only password sign-in for the test user

To exercise real Supabase reads/writes (profiles, saved_places, settings,
RLS, notifications) without round-tripping a magic-link email on every
reload, the sign-in screen has a hard-coded **dev-only** email/password
shortcut:

- Email: `dev@nearr.test`
- Password: `devpass123`

### How it works

- When `__DEV__ === true` AND the email field equals `dev@nearr.test`
  (case-insensitive, trimmed), the sign-in screen swaps the magic-link
  button for a `secureTextEntry` password input and a
  **"Sign in as developer"** button.
- That button calls `signInWithPassword(email, password)` in
  `services/auth.ts`, which is a thin wrapper over
  `supabase.auth.signInWithPassword`.
- A successful sign-in produces a real Supabase session — RLS,
  `profiles`, `saved_places`, `notification_events`, and the proximity
  watcher all behave exactly as they do for a magic-link user.
- In production builds (`__DEV__ === false`), the email behaves like
  any other address and the magic-link flow is shown. The password
  input is never rendered.

### One-time Supabase setup (manual)

The client never creates users. Create the test user manually:

1. Supabase dashboard → **Authentication → Users → Add user → Create new
   user**.
2. Email: `dev@nearr.test`
3. Password: `devpass123`
4. Tick **Auto Confirm User** so the email-confirmation step is skipped.
5. Save. The `handle_new_user` trigger inserts a matching row into
   `public.profiles` automatically.

### What this is NOT

- Not a service-role bypass — the client still uses the anon key.
- Not an RLS exception — the user is a normal `auth.users` row, subject
  to the same `auth.uid() = user_id` policies.
- Not persisted in any client-side storage other than the standard
  Supabase session in AsyncStorage. The password itself is never stored
  by the app.
- Not auto-login — the user must type the email and password each cold
  start until Supabase's session refresh kicks in.
- Not a replacement for Demo Mode or Map Preview Mode. Those remain
  separate, UX-only switches.
