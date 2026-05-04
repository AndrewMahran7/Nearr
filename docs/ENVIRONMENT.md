# Nearr — Environment Setup

> Last updated: 2026-05-02
> Source of truth: current codebase plus required external setup

This document covers the env vars, Supabase setup, native-build requirements, and current beta caveats.

## Prerequisites

- Node 18+
- npm 9+
- Xcode 15+ for iOS native builds
- Android Studio + JDK 17 for Android native builds
- `eas-cli`
- Supabase CLI
- Supabase project
- Google Cloud project with Maps SDK for iOS, Maps SDK for Android, Places API, **and Geocoding API** enabled

## Local install

```sh
npm install
cp .env.example .env
```

Then fill in the required client env values and run:

```sh
npm run start
```

Expo Go is fine for basic UI work. Native share targets, background location, and geofencing require a native build.

## Client env vars

Required for the app to talk to Supabase and Google Places:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`

Used by iOS share extension / silent-save path when deployed:

- `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL`

Optional dev flags:

- `EXPO_PUBLIC_DEMO_MODE`
- `EXPO_PUBLIC_MAP_PREVIEW_MODE`

Optional native per-platform overrides read by [app.config.js](../app.config.js):

- `GOOGLE_MAPS_IOS_KEY`
- `GOOGLE_MAPS_ANDROID_KEY`

## Server / Edge Function secrets

For `process-share-link`:

- `GOOGLE_PLACES_KEY` required
- `GEMINI_API_KEY` optional

Provided by Supabase runtime when deployed:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

## Supabase Auth redirect URLs

The app handles both normal and triple-slash callback shapes. Configure Supabase Auth to allow:

- `nearr://auth-callback`
- `nearr:///auth-callback`
- `exp://*/--/auth-callback`

Why both custom-scheme variants matter:

- `services/auth.ts` uses `Linking.createURL('auth-callback')`
- `lib/authDeepLink.ts` explicitly supports both `nearr://auth-callback` and `nearr:///auth-callback`

## Supabase setup

1. Create the project.
2. Put the URL and anon key into `.env` / EAS env.
3. Apply migrations:

   ```sh
   supabase login
   supabase link --project-ref <ref>
   supabase db push
   ```

4. Create the dedicated test account manually in Supabase Auth if you want password login for `dev@nearr.test`.
5. If using the Edge Function:

   ```sh
   supabase secrets set GOOGLE_PLACES_KEY="..."
   supabase secrets set GEMINI_API_KEY="..."
   supabase functions deploy process-share-link
   ```

6. Set `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` to the deployed function URL in local env and EAS env.

## Email / SMTP

Nearr uses Supabase magic links. Custom SMTP and any Resend setup are external operational configuration, not code-level configuration in this repo.

Docs should treat SMTP/Resend as:

- required for production-quality email delivery
- configured in Supabase/Auth infrastructure
- not represented as a committed app secret in this repo

## Google Maps / Places keys

Current code reality:

- The repo does not hardcode a Google Maps key in [app.json](../app.json).
- [app.config.js](../app.config.js) injects iOS and Android map keys from env.
- `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` is also copied into Expo `extra` as fallback runtime config.

Recommended setup:

- client key restricted to app bundle/package and Maps/Places/**Geocoding** APIs
- separate server key for `GOOGLE_PLACES_KEY` if you want stricter server-side separation; that server key must also have **Geocoding API** enabled

Why Geocoding API matters: the share-save flow's address-first verification gate (`verifyPlaceAtAddress` in [services/placesService.ts](../services/placesService.ts) and `verifyPlaceAtAddressServer` in [supabase/functions/process-share-link/index.ts](../supabase/functions/process-share-link/index.ts)) calls `https://maps.googleapis.com/maps/api/geocode/json` to resolve a literal street address found in the share to a rooftop coordinate before it is allowed to silent-save. If Geocoding is not enabled on the key, every address-bearing share falls back to the candidate picker (safe, but worse UX).

## EAS builds

Useful commands:

```sh
eas build --profile development --platform ios
eas build --profile development --platform android
eas build --profile preview --platform ios
eas build --profile preview --platform android
```

Environment reminder:

- `EXPO_PUBLIC_*` vars must be present in the EAS build environment at build time
- do not assume local `.env` is automatically available to EAS workers

## iOS share extension requirements

The share extension is enabled in [app.json](../app.json), but it depends on native setup.

Required:

- real native build
- App Group configured on both host app and extension
- `nearr-shared-auth` module correctly linked into the build
- `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` if you want silent-save attempts
- valid host-app Supabase session so the access token can be bridged into the App Group

If those are missing, the extension should still fall back to opening the host app share flow.

## Android share intent requirements

Android share entry depends on the patched native activity produced by the config plugin. Test in a native build, not just Expo Go.

## Native rebuild required after manifest changes

Any change to Android permissions or Expo config plugins in [app.json](../app.json) requires a new native Android build. Restarting Expo or reloading JS is not enough because the manifest and foreground-service declarations are compiled into the native app.

This matters for Nearr's nearby reminders: background location watch and OS geofencing should be validated only on a fresh Android dev/preview/prod build after changing location or notification permissions.

## Background location and geofencing limits

Current code supports both background proximity watch and OS geofencing, but there are hard platform limits:

- Expo Go is not sufficient for background location tasks
- geofencing must be tested on a real device
- iOS needs Always Location
- Android needs background location permission
- geofences are capped at 20 saved places in current code

## Current beta caveats

- iOS share extension silent-save is still an environment-sensitive feature and should be treated as partially verified until retested on a fresh native build.
- Edge Function code existing in the repo does not mean your current environment has it deployed.
