# Nearr — V1 Scope Freeze

> Last updated: 2026-04-27
> Source of truth: Codebase (not assumptions)

> Reality snapshot of what V1 actually is, what's only partially built,
> and what's explicitly deferred. Use this to decide what to test
> before TestFlight / Play Internal and what to communicate as "not in
> V1" so we don't ship a half-feature.

## Shipping in V1

These are end-to-end built and intended to be exercised by the
[testing checklist](TESTING_CHECKLIST.md).

- **Auth**: Supabase magic link, `nearr://auth-callback` deep link
  (implicit + PKCE), persisted session, sign-out with confirmation.
  Plus a `__DEV__`-only password fallback for `dev@nearr.test`.
- **Profiles**: auto-created via `handle_new_user` trigger; defaults
  for radius unit/value, notifications master + nearby toggle, quiet
  hours.
- **Manual save**: Google Places search with foreground-location bias,
  confirm with three radius modes, idempotent
  SELECT-then-INSERT-then-link save with 23505 race recovery.
- **Saved-places list**: Home (recents), Places (full list),
  per-place detail with edit / delete / per-place notification toggle.
- **Map**: `MapView` + Markers + `<Circle>` zone bubbles sized to
  effective radius, `fitToCoordinates` with radius-edge corners,
  marker preview card, "Open in Maps" via lat/lng URLs (not the
  broken `place_id:` query), permission state machine with empty
  states, `?savedPlaceId=` deep link focus.
- **Paste-link share (host app)**: parse → AI/heuristic place query →
  Places search with context geocoding + franchise ranking + address
  resolver → silent save when confident, otherwise candidate chooser,
  with source attribution.
- **Android share intent**: `MainActivity.kt` patched by
  [plugins/withAndroidShareIntent.js](../plugins/withAndroidShareIntent.js)
  rewrites `ACTION_SEND` text to `nearr://share?url=…`; auto-runs the
  pipeline.
- **Proximity notifications**: foreground + background location task,
  per-place + profile-default radius resolution, 1h cooldown, quiet
  hours, deep-link tap → focused map; events written to
  `notification_events` (only `'nearby'` today).
- **Demo Mode** and **Map Preview Mode**: full mock + seeded modes
  with banners + prod-leak warnings.
- **Design system**: shared primitives in `components/`, tokens in
  `constants/`, EmptyState everywhere.
- **Logging**: every service logs entry + failure with a stable tag.

## Partially built — wired but unverified end-to-end

These compile, route, and are reachable from the UI / OS share sheet,
but at least one critical path is unverified or hand-wavy. Treat each
as a release-blocker until checked off in
[TESTING_CHECKLIST.md](TESTING_CHECKLIST.md).

- **iOS Share Extension** via `expo-share-extension` ^1.10.7.
  - Generated target lives in
    [ios/NearrShareExtension/](../ios/NearrShareExtension/).
  - Active App Group is `group.com.nearr.ios`. The legacy
    [native/share-extension/](../native/share-extension/) scaffold uses
    the obsolete `group.com.nearr.app` and is dead code that should be
    deleted before V2.
  - JWT bridge via [modules/nearr-shared-auth/](../modules/nearr-shared-auth/)
    works in theory; needs end-to-end verification on a real device.
  - Silent-save path requires both
    `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` AND a bridged JWT — without
    either, the extension correctly falls back to opening the host
    app.
  - See [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md).
- **`process-share-link` Edge Function**.
  - Code in [supabase/functions/process-share-link/](../supabase/functions/process-share-link/)
    is complete (auth check, OG fetch, AI extract, Places search,
    confidence-gated save, never returns 5xx).
  - Deployment + secrets (`GEMINI_API_KEY`, `GOOGLE_PLACES_KEY`) must
    be set before any of the iOS-extension silent-save flow works.
- **Server-side AI extraction (Gemini 1.5 Flash)**.
  - [lib/aiExtractPlace.ts](../lib/aiExtractPlace.ts) is also imported
    by the host-app share screen, but in the RN bundle there is no
    `GEMINI_API_KEY`, so it deterministically returns a low-confidence
    fallback. The "real" AI path only runs inside the Edge Function.
- **Notification events**.
  - Only `'nearby'` is emitted. The CHECK constraint allows
    `'entered' | 'exited' | 'silenced'` for V2; the code does not
    emit them today, including for quiet-hours suppressions.

## Deferred to V2

- True OS-level **geofencing** (rather than the polled
  `Location.startLocationUpdatesAsync` approximation we ship today).
- **Real transcription**. [lib/transcription/](../lib/transcription/)
  has only a `placeholder` provider; no STT vendor is wired.
- **Photos** on saved places (no `place_photos` table yet; not
  surfaced in UI).
- **Push notifications** via APNs/FCM. We use `expo-notifications`
  local scheduling only.
- **Social** — sharing places, lists, friends, comments.
- **Automated test suite** (no unit / e2e tests yet beyond the share
  extraction eval scripts in [scripts/](../scripts/) and
  [logs/](../logs/)).
- **`profiles.email` sync** when the auth user changes their email is
  not implemented.
- **OAuth** (Apple / Google sign-in).

## Known TestFlight / Play risks before cutting builds

1. **Hard-coded Google Maps API key in [app.json](../app.json)**
   (`expo.ios.config.googleMapsApiKey` and
   `expo.android.config.googleMaps.apiKey`). Rotate the key, replace
   the inline value with `process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
   (consider migrating `app.json` → `app.config.ts`), restrict the
   client key to bundle/SHA-1 + Maps + Places only.
2. **Duplicate entries in `expo.ios.infoPlist.UIBackgroundModes`**
   (`location, fetch, location, fetch`). De-dupe before submission to
   avoid App Store warnings / rejection.
3. **iOS share extension end-to-end never proven on a real device**;
   silent-save path may quietly fall back to host-app handoff even
   when configured. Verify per [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md).
4. **Edge Function deployment status unknown.** The mobile bundle
   refers to `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL`; if that points at
   an undeployed function, every share-extension invocation falls
   through to "open app".
5. **`nearr-shared-auth` native module** must be in the dev/prod
   build's autolinked modules list. Verify after `npx expo prebuild`
   that the iOS Pods include it.
6. **Background location** requires a dev/prod build, not Expo Go.
   Don't ship a beta where a tester only has Expo Go and expects
   notifications to fire.
7. **Local UI Mode** is intentionally disabled
   (`ALLOW_LOCAL_UI_MODE = false`); confirm there is no leftover
   Settings entry that toggles it on.
