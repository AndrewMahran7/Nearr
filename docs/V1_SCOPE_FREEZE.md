# Nearr V1 — Scope Freeze (2026-04-26)

> **Purpose:** lock the V1 surface area before the bug sweep so we don't
> accidentally invent new work mid-fix. This document is the source of truth
> for what V1 is. Anything not listed under "In V1" is **out of scope** until
> after TestFlight.

---

## In V1 (must work)

### Authentication
- Magic-link sign-in (Supabase) via [app/(auth)/sign-in.tsx](../app/(auth)/sign-in.tsx).
- Deep-link round-trip on `nearr://` so the email link returns the user to
  the app authenticated. ([lib/authDeepLink.ts](../lib/authDeepLink.ts) +
  wiring in [app/_layout.tsx](../app/_layout.tsx)).
- Sign out from Settings.

### Data model (Supabase)
- `profiles`, `places`, `saved_places`, `notification_events` per
  [supabase/migrations/20260426000001_init_schema.sql](../supabase/migrations/20260426000001_init_schema.sql).
- RLS enabled; `handle_new_user` trigger creates a `profiles` row on signup.
- All reads/writes go through the `services/` facade — no direct Supabase
  calls from screens.

### Saving places
- Manual flow: search via Google Places → confirm → choose radius
  (Default / Miles / Minutes) → save. ([app/add-place.tsx](../app/add-place.tsx))
- Share-link flow: paste a TikTok / Instagram / generic URL → public
  OpenGraph metadata extraction → preview → hand off to manual confirmation
  with `q`, `source_url`, `source_type` prefilled.
  ([app/share.tsx](../app/share.tsx) + [lib/shareParser.ts](../lib/shareParser.ts))
- Duplicate save (PG `23505`) handled with a friendly "Already saved" alert.

### Browsing saved places
- Home tab dashboard with greeting, CTAs, and saved-places list.
  ([app/(tabs)/home.tsx](../app/(tabs)/home.tsx))
- Places tab pure list. ([app/(tabs)/places.tsx](../app/(tabs)/places.tsx))
- Detail / edit screen with notify toggle, radius edit, notes, remove.
  ([app/place/[id].tsx](../app/place/[id].tsx))
- Pull-to-refresh and on-focus refresh on all list views.

### Map
- Saved places as markers on `react-native-maps`.
- Foreground location permission state machine (pending / granted / denied).
- `fitToSuppliedMarkers` on first load; in-app preview card on marker tap;
  FAB → save place. ([app/(tabs)/map.tsx](../app/(tabs)/map.tsx))

### Settings
- Default radius (value + miles/minutes pills).
- Master `notifications_enabled` toggle.
- `nearby_notifications_enabled` toggle (auto-disabled when master is off).
- Quiet hours toggle + HH:MM start/end with validation.
- Save button persists to `profiles`; on save, starts/stops the proximity
  watch. ([app/(tabs)/settings.tsx](../app/(tabs)/settings.tsx))

### Nearby notifications (best-effort foreground/background)
- Permission helpers (`ensureNotificationPermission`,
  `ensureForegroundLocationPermission`, `ensureBackgroundLocationPermission`).
- Background watch via `Location.startLocationUpdatesAsync` + a
  `TaskManager`-defined `LOCATION_TASK`.
  ([lib/notifications.ts](../lib/notifications.ts))
- One-shot foreground check on session start and on every
  `AppState` → `active` transition. ([app/_layout.tsx](../app/_layout.tsx))
- 1-hour per-place cooldown enforced via in-memory map AND
  `saved_places.last_notified_at`.
- Quiet hours respected (handles wrap-past-midnight).
- Local notification fired; `notification_events` audit row inserted with
  `event_type='nearby'`.

### Design system
- `components/{Button,Card,EmptyState,Input,Screen,SavedPlaceCard}.tsx`
  used consistently across all screens.
- Tokens in `constants/{colors,spacing,typography}.ts`.
- Sign-in includes onboarding copy: *"Save places once. Nearr reminds you
  when you're nearby."*

---

## Deferred to V2 (do not start)

- Real OS-level geofencing (`Location.startGeofencingAsync`) with
  entered/exited transitions. V1 only emits `'nearby'` events.
- iOS share extension (Swift/Info.plist scaffolds exist under
  [native/share-extension/](../native/share-extension/) and
  [plugins/withShareExtension.js](../plugins/withShareExtension.js) is a
  no-op placeholder — see [docs/IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md)).
  V1 ships with **paste-link only** on iOS.
- True drive-time radius via a routing API. V1 uses a 25-mph fixed
  approximation in `minutesToMeters`.
- `og:image` thumbnails on share preview / saved place cards.
- Social features (sharing places between users, public lists, follows).
- Categories, tags, custom lists, search across saved places.
- Push notifications (server-driven). V1 is local notifications only.
- Profile editing beyond defaults (name, avatar).
- Per-day quiet-hours schedules (V1 is a single daily window).
- Background-task health UI / "last checked at" indicator.
- Unit/integration test suite (none today; manual testing only).
- App Group `UserDefaults` JS bridge for the share extension fallback.

---

## Partially built — decisions

| Item | Decision | Rationale |
| --- | --- | --- |
| iOS share extension scaffold (`native/share-extension/`, `plugins/withShareExtension.js`) | **Keep on disk, do NOT register the plugin in `app.json`.** | Files are inert without registration; documented honestly in `IOS_SHARE_EXTENSION.md`. Removing them would discard work that the V2 plugin will reuse. |
| Android `SEND` intent filter in `app.json` | **Keep enabled.** | Already works in EAS dev/prod builds; no Expo Go regression. Fully wired into the existing `/share` screen. |
| `services/notifications.ts` `ProximityDecision` type export | **Keep.** | Pure helper used by `decideProximity`; small, no runtime cost. |
| Share-link `og:description` fallback for `buildQuery` | **Keep.** | Already shipping; provides a useful query when title is generic. |
| Legacy `hooks/usePlaces` (referenced in earlier scaffold) | **Verify removal.** No screens import it after Tasks 7–11. If a stray import remains, delete the file in the bug sweep. |
| `app/index.tsx` redirect logic | **Keep as-is.** Not flagged in any task. |
| Home "Nearby alerts are off" hint | **Keep.** Newly added in Task 13; depends only on profile fields that already exist. |
| `notification_events.event_type = 'nearby'` only | **Keep.** `'entered'`/`'exited'`/`'silenced'` exist in the CHECK constraint but are V2. |

### Things to verify are NOT half-wired (bug-sweep checklist seeds)
- No screen still imports `usePlaces` (the legacy hook).
- No screen calls Supabase directly (everything goes through `services/`).
- `services/places.ts` vs `services/placesService.ts` — confirm only one is
  the active facade; if `services/places.ts` is the old shim, delete or
  inline.
- `app.json` `extra.googlePlacesKey` and the new
  `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` env path both resolve correctly in
  `services/placesService.ts.resolveApiKey()`.
- `expo-notifications` plugin is registered (it is, in `app.json`).

---

## Risks for app review / TestFlight

These don't necessarily block V1 but need a deliberate decision before
submitting builds.

1. **Background location justification (iOS).**
   `NSLocationAlwaysAndWhenInUseUsageDescription` is set, but App Review
   rejects vague "background location" use cases. The user-facing copy in
   `app.json` should clearly state: *"Nearr uses your location in the
   background to notify you when you are near places you've saved."* —
   already in place. Verify on the next build that the rationale shown to
   the user matches and that we never request background without prior
   foreground grant.
2. **Background tasks in Expo Go don't work.**
   We must distribute a TestFlight build via EAS, not a `expo start`
   tunnel. Document this in the test plan.
3. **Google Maps API keys.**
   `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` ships in the JS bundle (Expo public
   env). Restrict the key in Google Cloud Console to:
   - HTTP referrer = none (mobile)
   - Android: package + SHA-1 of the EAS signing key
   - iOS: bundle ID `com.nearr.app`
   - APIs: only Places + Maps SDK
   Without these restrictions, leaking the key from the JS bundle is a
   real risk.
4. **Supabase anon key.**
   Same story — public-by-design but requires RLS to be airtight. Verify
   no policy was loosened during development; the migration's policies are
   the source of truth.
5. **Notification permission UX on iOS.**
   We currently call `ensureNotificationPermission()` *after* the user
   toggles "Nearby alerts" on in Settings. If they decline, we surface an
   alert. Apple expects pre-permission priming; consider adding a one-line
   "We'll ask iOS for permission" sub-text under the toggle.
6. **TikTok / Instagram OG metadata can rate-limit.**
   `parseShare` may return `metadataFailed = true` from these platforms
   under load. The fallback to manual search is in place, but the *rate
   of failures* will be felt by testers. Acceptable for V1.
7. **The share extension scaffold is inert.**
   If someone enables the no-op plugin in `app.json`, it'll log a warning
   and return the config unchanged. Not a crash, but a footgun. Confirm
   `app.json` does **not** reference `withShareExtension`.
8. **Android background location prompt (Android 12+).**
   Requires a separate "Allow all the time" prompt. We surface it via
   `ensureBackgroundLocationPermission()` but have not verified the UX on
   a real Android 12+ device. Risk of silent permission denial.
9. **Google Places quota.**
   Each text search hits the (billed) Places API. Set a daily cap in
   Google Cloud before TestFlight to avoid bill shock during testing.
10. **Magic-link deep linking on iOS.**
    Universal Links are NOT configured. `nearr://` custom scheme works
    everywhere but looks slightly less polished. Acceptable for V1.

---

## Prioritized "must work" list before TestFlight

Run this top-down. Each item should be smoke-tested on a real device with
an EAS dev or preview build before promoting to TestFlight.

### P0 — Blocks ship
1. **Sign in with magic link end-to-end.**
   Email arrives → opening on the same device puts the user in the app
   authenticated → `profiles` row exists.
2. **Save a place manually end-to-end.**
   Search → tap candidate → confirm → row appears on Home + Places + Map.
3. **Save a place from a TikTok/Instagram/Safari URL.**
   Paste-link flow works; metadata fail falls back to manual search;
   `source_type` and `source_url` persisted on the saved row.
4. **Home / Places / detail load and refresh.**
   Pull-to-refresh, on-focus refresh, delete, edit notes/radius.
5. **Map renders all saved places, recenters on user when permitted,
   shows the denied banner when not.**
6. **Settings persists** all fields and the proximity watch starts/stops
   accordingly.
7. **Sign out** clears the session and replaces to `/(auth)/sign-in`.

### P1 — Should work or we explain it
8. **Foreground "check now" fires** on app open and on AppState 'active';
   a saved place inside the radius produces a local notification within
   ~10 seconds.
9. **Background watch fires** at least once when the user moves
   ~50–100 m. (OS-coalesced; document in the tester guide that cadence
   is not guaranteed.)
10. **`notification_events`** rows appear in Supabase after a
    notification, with correct `distance_meters` and coordinates.
11. **Quiet hours** suppress notifications during the configured window
    (including wrap-past-midnight).
12. **1-hour cooldown** prevents duplicate notifications for the same
    place.

### P2 — Polish, can ship without
13. Empty / error states across all screens use `EmptyState`.
14. Onboarding copy on sign-in renders correctly across small/large
    screens (tested on an SE-class device + a Pro Max-class device).
15. Edge case: extremely long place names or addresses don't break the
    list/map preview cards (numberOfLines is set; verify on an iPhone SE).
16. Offline behavior: reasonable error states, no crashes when the
    Supabase or Places call fails.

---

## Honesty checklist

- [x] V1 features explicitly listed.
- [x] V2 features explicitly listed and *not* started.
- [x] Partial work has a keep/remove/hide decision per item.
- [x] Risks for app review and testing are surfaced with concrete
      mitigations.
- [x] P0/P1/P2 ordering reflects what would actually block a TestFlight
      promotion vs polish that can ship in a follow-up.
- [ ] Bug sweep executed (next task).
- [ ] TestFlight build cut.

## Demo Mode (dev-only, not part of V1 surface)

`EXPO_PUBLIC_DEMO_MODE=true` is a development-only switch for UX testing without external APIs. It does not ship as a user-facing feature and is triple-guarded on `__DEV__` so production builds ignore it. See `docs/ENVIRONMENT.md` for details.
