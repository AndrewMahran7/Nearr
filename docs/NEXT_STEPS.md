# Nearr — Next Steps

> What to build (and what *not* to build) after the V1 bug sweep is done.
> This file is meant to survive a chat handoff — read it together with
> [V1_SCOPE_FREEZE.md](V1_SCOPE_FREEZE.md) and
> [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md).

## Status as of 2026-04-26

- V1 code is **scope-frozen** (Task 14).
- V1 bug sweep complete (Task 15) — typecheck clean, no orphans, two real
  rendering bugs fixed.
- Manual end-to-end QA on a real device is the next gate. Run the full
  [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md). Do not start V2 work until
  every P0 item passes.

---

## Immediately next (pre-TestFlight)

These are completion tasks for V1, not new features. Do them in order.

### 1. Run TESTING_CHECKLIST.md end-to-end on a real device
- iOS first (TestFlight is the target), then Android sanity.
- Background notifications **require an EAS dev build**, not Expo Go.
- Capture any failure as a logged issue under "Known bugs/TODOs" in
  [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md). Fix only what blocks ship.

### 2. Audit Supabase config against the schema
- Confirm RLS is on for all four tables.
- Confirm the `handle_new_user` trigger actually creates a `profiles` row
  for new signups (sign up a throwaway email and verify in the dashboard).
- Confirm the magic-link redirect allow-list includes both `nearr://*` and
  the LAN `exp://` URL you actually use.
- Confirm the `places` table is **shared** (any authenticated user can
  insert) — multiple users saving the same restaurant should NOT create
  duplicate `places` rows.

### 3. Lock down Google Maps Platform
- Restrict the production key by bundle ID / package + SHA-1 (see
  [ENVIRONMENT.md](ENVIRONMENT.md) §5).
- Set a daily quota cap to avoid runaway costs.
- Confirm Places API + Maps SDK iOS + Maps SDK Android are the only
  enabled APIs on the key.

### 4. Cut an EAS dev build
- Add `eas.json` with a `development` profile.
- Build for iOS (and Android if you have a tester). This is the build that
  will validate background notifications.

### 5. TestFlight readiness
- Update `app.json` `version` and bump build number.
- Write App Store Connect copy describing why the app uses background
  location ("notify the user when they are physically nearby a place they
  saved"). Apple **will** ask.
- Review [V1_SCOPE_FREEZE.md](V1_SCOPE_FREEZE.md) "Risks for app review"
  section and address each one.

---

## V2 candidates (do not start until V1 ships)

Ordered by ROI for the actual product.

### A. Real OS-level geofencing
- Replace the polled `Location.startLocationUpdatesAsync` loop with
  `Location.startGeofencingAsync` + `LocationGeofencingEventType` regions.
- Emits real `entered` / `exited` transitions instead of V1's `'nearby'` ticks.
- Requires capping `saved_places` per user to stay under the OS region limit
  (iOS: 20 simultaneous geofences, Android: 100). Add a "limit reached"
  state in `add-place` save.
- `notification_events.event_type` already supports `'entered'`/`'exited'`.

### B. iOS share extension activation
- Scaffold already at [native/share-extension/](../native/share-extension/).
- Register the config plugin via `@bacons/xcode` or `expo-share-extension`.
- App Group bridge (`group.com.nearr.app`) so the extension can hand off
  the URL via `UserDefaults` + a `nearr://share?url=...` deep link.
- Full TODO in [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md).

### C. Place photos
- Add `photos` field to the Google Places `Details` request.
- Cache photo URLs on the canonical `places` row.
- Show on `SavedPlaceCard`, place detail, and map preview card.

### D. List filtering and search
- Filter saved places by `source_type` (manual / tiktok / instagram / link).
- Free-text search across `places.name` + `saved_places.notes`.
- Sort modes (newest / nearest / alphabetical).

### E. Drive-time radius (real)
- Replace the 25 mph fixed approximation in `lib/geo.ts:minutesToMeters`
  with a Google Distance Matrix or Mapbox Directions call.
- Cache results per place to avoid quota burn.

### F. Push notifications (server-driven)
- Move proximity decisioning to a Supabase Edge Function or external worker
  using user-reported location pings.
- Lets the server batch and deduplicate alerts; lets the app stop running
  background tasks. Big battery win.
- Requires implementing Apple/Google push tokens in the client and an
  `expo-notifications` push pipeline server-side.

### G. Profile editing
- Display name, avatar, account deletion.
- Wire a "Delete my account" path that cascades through the foreign keys
  already declared in the migration.

### H. Per-day quiet hours
- Currently a single daily window. Extend to per-weekday schedules.
- Schema-compatible: turn `quiet_hours_*` into a JSONB `quiet_hours` array.

### I. Tests
- Pure functions first: `lib/geo`, `lib/shareParser:buildQuery`,
  `lib/notifications:effectiveRadiusMeters` and `inQuietHours` and
  `decideProximity`. These are the highest-ROI test targets.
- Then: Supabase service layer with a test project + recorded fixtures.
- React component tests can wait until there are tests for the logic that
  actually breaks.

### J. App Group `UserDefaults` JS bridge
- Companion to V2-B. Lets the share extension persist the last-shared URL
  even when the host app is fully killed.

---

## What NOT to build yet

If a request comes in for any of these before V1 is live on TestFlight,
push back:

- ❌ **Social features** (sharing places between users, public lists, follows,
  comments, ratings). Not in V1, no schema for it, and adds review risk.
- ❌ **Categories / tags / custom lists.** V1 sorts newest-first. That's it.
- ❌ **Photos / og:image thumbnails.** Decided in scope freeze. Wait for V2-C.
- ❌ **Background-task health UI** ("last checked at" badges). Diagnostic noise
  until we have user reports of background-tick problems.
- ❌ **Native iOS share extension activation.** Scaffold exists; activating it
  without a verified EAS pipeline silently breaks `expo run:ios`. V2-B.
- ❌ **Server-driven push.** Local notifications cover V1. V2-F.
- ❌ **A test framework.** Manual checklist is the V1 contract. V2-I.
- ❌ **A second auth provider.** Magic-link is enough for V1.
- ❌ **Web build.** `expo start --web` is a dev convenience, not a target.
- ❌ **Refactoring "for cleanliness".** V1 was scope-frozen for a reason.
  Touch only what the bug sweep or QA flags.

---

## How to onboard a new chat / developer

1. Read [PROJECT_CONTEXT.md](PROJECT_CONTEXT.md) — what Nearr is, V1 goals,
   feature list, prompt history.
2. Read [ARCHITECTURE.md](ARCHITECTURE.md) — folder layout + each subsystem's
   data flow.
3. Read [ENVIRONMENT.md](ENVIRONMENT.md) — get the app running.
4. Read [DATABASE.md](DATABASE.md) — schema + RLS reference.
5. Read [V1_SCOPE_FREEZE.md](V1_SCOPE_FREEZE.md) — what V1 is and isn't.
6. Read this file — what's next.
7. Run [TESTING_CHECKLIST.md](TESTING_CHECKLIST.md) on a real device before
   touching code.

The full chronological build log lives at
[../logs/claude_runs/2026-04-26_nearr_build_log.md](../logs/claude_runs/2026-04-26_nearr_build_log.md).
Each entry has Files modified / deleted / created, key decisions,
assumptions, commands run, and known issues.
