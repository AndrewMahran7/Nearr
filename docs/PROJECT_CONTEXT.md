# Nearr — Project Context

> Last updated: 2026-05-02
> Source of truth: current codebase

Start here before changing product code. This file is the top-level reality check for what Nearr is, what is actually shipping, and what is still partial, disabled, deferred, or just scaffolding.

## What Nearr is

Nearr is a mobile app for saving places you discover online, seeing them on a personal map, and optionally getting reminded when you are nearby.

Core loop:

- See a place online
- Want to try it
- Save it
- See it on your map
- Get reminded nearby
- Go

Supported save entry points in the current app:

- Manual search
- Paste link in the host app
- Android system share sheet
- iOS share extension / host-app handoff

## Status legend

- `shipping`: built in the app and intended for beta use now
- `partial`: built, but depends on environment or lacks full real-device verification
- `disabled`: code/scaffolding exists but is intentionally off
- `deferred`: not part of the current beta promise
- `scaffolding`: code or docs exist, but not a real shipped feature yet

## Stack

- Expo SDK 51, React Native 0.74, Expo Router 3.5, TypeScript 5.3
- Supabase Auth + Postgres + RLS
- Supabase Edge Functions for server-side share processing
- Google Places + react-native-maps
- expo-location + expo-notifications + expo-task-manager
- expo-share-extension for iOS share target
- Local Expo module `nearr-shared-auth` for App Group JWT bridging

## Current feature state

| Area | Status | Reality |
| --- | --- | --- |
| Supabase magic-link auth | shipping | Auth uses Supabase magic links. Redirects are handled through `/auth-callback` and `handleAuthDeepLink`. |
| `/auth-callback` route | shipping | [app/auth-callback.tsx](../app/auth-callback.tsx) exists specifically to avoid Expo Router unmatched-route failures during auth callbacks. |
| `dev@nearr.test` password login | shipping | Password login is available for that exact email in all builds, not just `__DEV__`. |
| Home dashboard | shipping | Dark/orange UI, activation card under 3 saves, recent saves, nearby section, save CTAs. |
| Manual save | shipping | Search, choose, radius selection, save, then redirect to focused map. |
| Paste-link save | shipping | Host-app share screen parses a URL, searches Places, saves, then redirects to focused map. |
| Android share intent | shipping | `ACTION_SEND text/plain` is rewritten into `nearr://share?url=...` and flows into the host-app share route. |
| iOS share extension target | partial | Enabled in config and compiled via `expo-share-extension`, but end-to-end silent save still depends on native build setup, App Group wiring, auth token bridge, and deployed Edge Function. |
| `process-share-link` Edge Function | partial | Code exists and is usable, but deployment and secrets are environment-specific. Do not describe it as universally live. |
| Save success → focused map | shipping | Manual save, host-app share save, and duplicate-save routing all use `savedPlaceId` to open the map focused on that saved place. |
| Map `?savedPlaceId=` focus | shipping | The map selects the saved place, frames its zone, highlights marker/radius, and opens the bottom card once. |
| Map dismissal behavior | shipping | Selected-place card can be dismissed by swipe down, map tap, or the X button. |
| Marker callouts | shipping | Native marker callouts are intentionally not used for the UX; custom marker views and an in-app preview card are used instead. |
| Map stability/perf fixes | shipping | Map logging is throttled and sync paths are coalesced to reduce event spam and idle memory pressure. |
| Places tab filters | shipping | Filters: All, Recent, Nearby, Instagram, TikTok, Reminders on. |
| Place detail screen | shipping | Get directions, view original post/link, nearby reminder toggle, collapsed reminder settings, note, and low-emphasis remove. |
| Notification permission setup | shipping | App shows setup reminders, can request notifications, and can send a test notification from Settings. |
| Background proximity checks | shipping | Background location task plus one-shot foreground checks are implemented. Requires native build and real permissions. |
| OS geofencing | shipping for beta testing | `NEARR_GEOFENCE_TASK` exists, syncs up to 20 saved places, and complements the background location watch rather than replacing it. |
| Legal scaffolding | partial | Terms/privacy content, profile columns, modal, and settings display exist. Acceptance is currently disabled for beta via `LEGAL_ACCEPTANCE_REQUIRED = false`. |
| Demo Mode | shipping | Full seeded mock mode. |
| Map Preview Mode | shipping | Real map with seeded data and no location prompt. |
| Local UI Mode | disabled | Legacy fake-session mode is intentionally hard-disabled. |
| Transcription | scaffolding | Placeholder-only. No real transcription provider is wired into runtime. |

## Auth reality

- The sign-in screen is [app/(auth)/sign-in.tsx](../app/(auth)/sign-in.tsx).
- Normal auth path is email magic link via `sendMagicLink()` in [services/auth.ts](../services/auth.ts).
- `Linking.createURL('auth-callback')` is used to build the callback URL.
- Callback parsing and session exchange live in [lib/authDeepLink.ts](../lib/authDeepLink.ts).
- [app/_layout.tsx](../app/_layout.tsx) handles both cold-start and warm-start deep links and routes to home when auth succeeds.
- [app/auth-callback.tsx](../app/auth-callback.tsx) is a real file-backed route that shows a loading state while the session resolves.
- `dev@nearr.test` switches the sign-in form to password mode and calls `signInWithPassword()` in all builds.

## Save and share reality

### Manual save

- Screen: [app/add-place.tsx](../app/add-place.tsx)
- Flow: search Places -> choose result -> select reminder radius -> save -> redirect to `/(tabs)/map?savedPlaceId=<id>`

### Host-app link/share save

- Screen: [app/share.tsx](../app/share.tsx)
- Handles pasted links and incoming `?url=` deep links.
- Parses metadata, runs the place extraction pipeline, resolves candidates, saves, and routes to focused map.
- Duplicate saves still route to the existing saved place when its `savedPlaceId` is available.

### Android share intent

- Plugin: [plugins/withAndroidShareIntent.js](../plugins/withAndroidShareIntent.js)
- Shipping path: Android `ACTION_SEND` text intents are converted into `nearr://share?url=…`.

### iOS share extension

- Root: [ShareExtension.tsx](../ShareExtension.tsx)
- Config plugin entry is present in [app.json](../app.json).
- Current behavior is environment-dependent:
  - If the Edge Function URL and App Group auth token are available, the extension can attempt a silent server-side save.
  - On `ambiguous`, `failed_requires_app`, missing token, missing endpoint, or other failure, it hands off to the host app.
  - On `saved`, it now opens the host app directly to the focused map route when `savedPlaceId` is returned.
- End-to-end silent save is still `partial` until verified on a real native build with deployed backend.

## Map reality

- Screen: [app/(tabs)/map.tsx](../app/(tabs)/map.tsx)
- Uses custom markers and in-app preview card, not sticky native callouts.
- Focus flow is driven by `savedPlaceId` in the route params.
- Selected place state opens the bottom preview card and highlights the relevant radius bubble and marker.
- Dismiss paths:
  - swipe down on the card
  - tap the X button
  - tap the map background
- User-location centering does not immediately override a deep-linked place focus.
- Map fallback behavior exists for denied/unavailable location without blocking the screen.

## Notifications and geofencing reality

- Notification code: [lib/notifications.ts](../lib/notifications.ts)
- Public exports: [services/notifications.ts](../services/notifications.ts)
- Geofencing code: [lib/geofencing.ts](../lib/geofencing.ts)
- Root layout imports both task modules so tasks register on app startup.

Current behavior:

- Notification permissions can be requested from setup UI and Settings.
- Test notifications can be sent from Settings.
- One-shot proximity checks run on sign-in and app foreground.
- Background location watch remains active as a fallback path.
- OS geofences are also synced when possible.
- Geofences are limited to 20 saved places and use `NEARR_GEOFENCE_TASK`.
- Cooldown and count-limit logic live in app code, not DB constraints.
- Notification action categories are registered, but some action handlers are still TODOs.

Practical limits:

- Real background behavior requires a native build, not Expo Go.
- iOS geofencing/background location testing requires a real device.
- Android emulator behavior is not a substitute for real-device validation.

## Legal and business reality

- Legal constants live in [constants/legal.ts](../constants/legal.ts).
- Terms/privacy content and legal acceptance columns exist.
- Acceptance modal and profile writes are implemented.
- `LEGAL_ACCEPTANCE_REQUIRED = false`, so legal acceptance is intentionally disabled for the current beta.
- Settings still surfaces current legal version and acceptance status.
- External infrastructure such as Supabase custom SMTP with Resend is operationally relevant but configured outside this repo.

## Config and environment reality

- `app.json` contains the Expo config and plugin list.
- Native map keys are injected through [app.config.js](../app.config.js) from environment variables.
- The repo no longer hardcodes a Google Maps key in [app.json](../app.json).
- Supabase config is read from `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_ANON_KEY`, with [app.config.js](../app.config.js) also copying them into `extra` as runtime fallback.

## Current beta caveats

- iOS share extension silent save should still be treated as partially verified until a fresh native build is tested on-device.
- `process-share-link` code exists, but deployment, secrets, and function URL are environment-specific.
- Transcription is not a shipping feature.
- Legal acceptance is intentionally off for beta even though the scaffolding exists.

## Recommended doc reading order

1. [ARCHITECTURE.md](ARCHITECTURE.md)
2. [ENVIRONMENT.md](ENVIRONMENT.md)
3. [DATABASE.md](DATABASE.md)
4. [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md)
5. [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md)
6. [V1_SCOPE_FREEZE.md](V1_SCOPE_FREEZE.md)
7. [NEXT_STEPS.md](NEXT_STEPS.md)
