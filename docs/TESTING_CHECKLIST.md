# Nearr — V1 Testing Checklist

Manual end-to-end checklist for V1. Run every section on a real device (iOS or
Android) for the notification + map flows; the simulator/emulator is fine for
auth, search, and settings.

> Source of truth for V1 scope: `docs/V1_SCOPE_FREEZE.md`.

---

## 0. Setup

```powershell
# Install dependencies
npm install

# Type-check (must exit 0)
npm run typecheck

# Start Metro / Expo
npm run start
# then press `i` (iOS sim), `a` (Android emu), or scan QR with Expo Go
```

### Required env (`.env` at repo root)

```
EXPO_PUBLIC_SUPABASE_URL=https://<project>.supabase.co
EXPO_PUBLIC_SUPABASE_ANON_KEY=<anon-jwt>
EXPO_PUBLIC_GOOGLE_MAPS_API_KEY=<google-maps-key-with-Places+Maps+SDK>
GOOGLE_MAPS_IOS_KEY=<same-or-ios-restricted-key>
GOOGLE_MAPS_ANDROID_KEY=<same-or-android-restricted-key>
```

If any of the first three are missing the app boots but logs a `[supabase]` /
`MISSING_API_KEY` warning. **Search will fail with a friendly error message
inside `/add-place` if the Google key is missing.**

### Supabase prerequisites

- Migration `supabase/migrations/20260426000001_init_schema.sql` applied.
- Auth → URL Configuration → Redirect URLs includes:
  - `nearr://auth-callback`
  - `exp://*` (or your specific Expo Go dev URL)

---

## 1. Auth (magic link)

- [ ] `/(auth)/sign-in` shows the tagline, three accent-dot bullets, email input.
- [ ] Empty / non-`@` email → `Enter a valid email` alert.
- [ ] Valid email → `Send magic link` button shows spinner → "Check your email…" copy.
- [ ] Email arrives within ~1 minute. Open it on the same device.
- [ ] Deep link routes back into the app and lands on `/(tabs)/home`.
- [ ] In Supabase: a row exists in `profiles` with the new `id` (created by `handle_new_user` trigger).
- [ ] Killing + relaunching the app keeps the session (no sign-in screen).

## 2. Manual save (`/add-place`)

- [ ] FAB on Map and "Save a place" on Home both open `/add-place`.
- [ ] Empty list state shows the "Search for a place" prompt.
- [ ] Searching `joe's pizza brooklyn` returns up to 8 candidates.
- [ ] Network off → `Search failed` empty state with retry.
- [ ] Tap a candidate → confirmation card with name / address / category.
- [ ] Radius modes:
  - [ ] `Default (X miles|minutes)` saves with `radius_value=null, radius_unit=null`.
  - [ ] `Miles` rejects 0 / negative / non-numeric input.
  - [ ] `Minutes` rejects 0 / negative / non-integer-friendly input.
- [ ] On save: row appears in `saved_places` with correct `source_type='manual'`,
      a `places` row exists (upsert by `google_place_id`), and Home/Places/Map all
      show the new card/marker on next focus.
- [ ] Saving the same place twice → friendly "Already saved" alert (no error trace).

## 3. Share-link ingestion (`/share`)

- [ ] Pasting a TikTok URL → `parsing` → preview card shows `TikTok`, title, snippet.
- [ ] `Find this place` hands off to `/add-place` with `q` prefilled, `source_url` and `source_type='tiktok'` attached.
- [ ] Saved row's `source_type` and `source_url` reflect the TikTok URL.
- [ ] Same flow for an Instagram URL → `source_type='instagram'`.
- [ ] Generic `https://` URL with OG tags → `source_type='link'`.
- [ ] URL whose preview can't be fetched → "Couldn't read this link" → `Search manually` still attaches `source_url`.
- [ ] Pasting plain text or `tel:` → "Paste a valid link" alert.

## 4. Map (`/(tabs)/map`)

- [ ] First entry: location permission prompt appears.
  - [ ] Granted: blue user dot, region centered on user, then `fitToSuppliedMarkers` zooms to show all saved places.
  - [ ] Denied: "Location is off" banner with "Open settings" button. Map still renders centered on first saved place (or US fallback).
- [ ] Tapping a marker → preview card with name / address / category and two buttons.
- [ ] `Open in Maps` opens platform Maps via `place.google_maps_url` (or lat/lng fallback).
- [ ] `View details` closes the preview and routes to `/place/<saved_id>`.
- [ ] Tapping empty map dismisses the preview.
- [ ] Returning from `/place/<id>` after deleting → marker is gone (focus refresh).

## 5. Notifications (proximity)

> Test on a real device. Background-location requires a development build, **not** Expo Go.

- [ ] Settings → enable "Notifications" + "Nearby alerts" + Save.
  - [ ] OS notification permission prompt appears.
  - [ ] Granted → `[notifications] proximity watch started` log.
  - [ ] Declined → "Notifications blocked" alert; settings still saved.
- [ ] Save a place near your current location with a small radius (e.g. `0.1 miles`).
- [ ] Foreground check: switch the app away and back to foreground. Within ~10s a notification fires for any place currently in radius.
- [ ] Background watch: walk / drive into the radius. Notification fires within a minute or two.
- [ ] `notification_events` row exists: `place_id`, `distance_meters` populated, `created_at` recent.
- [ ] Cooldown: within ~1 hour of firing, re-entering the radius does **not** re-notify (in-memory cooldown + `last_notified_at` check).
- [ ] Quiet hours: enable, set to a window covering "now", save → no notification fires; `notification_events` not inserted.
- [ ] Disabling "Notifications" or "Nearby alerts" → watch stops (`[notifications] proximity watch stopped` log).

## 6. Place detail (`/place/[id]`)

- [ ] Loads the joined `saved_places` + `places` row.
- [ ] Toggling `Notifications` and saving persists `notifications_enabled`.
- [ ] Switching radius modes saves `radius_value`/`radius_unit` correctly.
- [ ] Editing notes saves; empty notes → `null`.
- [ ] `Remove from saved` → confirm dialog → delete + back nav.
- [ ] Source URL link opens the original TikTok/Instagram/web URL when present.
- [ ] Deleted-out-from-under-you state ("This place no longer exists.") shows when `id` is unknown.

## 7. Settings (`/(tabs)/settings`)

- [ ] Loads profile defaults from `profiles`.
- [ ] Radius validation: must be > 0 and finite.
- [ ] Quiet-hours validation: both fields HH:MM (24h), start ≠ end.
- [ ] Saving updates `profiles` row (verify in Supabase).
- [ ] Side effect: when "Notifications" + "Nearby alerts" both ON, `startProximityWatch` runs; otherwise `stopProximityWatch`.
- [ ] Sign-out → confirm → back to `/(auth)/sign-in`. `getSession()` returns null.

## 8. Smoke / regressions

- [ ] No `\u2019` (literal `\u2019`) text rendered in any error state.
- [ ] No console errors on cold start (warnings from missing env vars are expected if `.env` is not set).
- [ ] `npm run typecheck` exits 0.
- [ ] App handles airplane mode gracefully on Home / Map / Settings (visible error states, not crashes).

## 9. Dev Mode (developer convenience, optional)

> `__DEV__`-only shortcut that lets you navigate the app without a Supabase session. Read-only by design — any DB write fails RLS because there is no real JWT. Production builds (`expo export` / EAS production) must NOT show any of these affordances.

- [ ] Sign-in screen (DEV build): "Continue in Dev Mode" secondary button is visible under the magic-link form, with the "Skips Supabase. UI / navigation only — DB writes will fail." fineprint.
- [ ] Tap it → routed to `/(tabs)/home`. Header shows the **Dev Mode** banner with the RLS caption.
- [ ] Map / Places / Settings navigate without errors. Lists are empty (expected — no real `auth.uid()`).
- [ ] Settings shows the **Dev Mode** banner at the top. If no profile row exists for the fake user, a dedicated dev-mode screen appears with banner + "Exit Dev Mode" button instead of a generic load error.
- [ ] Below the Account card (when in dev session), a ghost **Exit Dev Mode** button is visible. Tap → returned to `/(auth)/sign-in`. Banner is gone.
- [ ] Reload the app while dev mode is enabled → still lands on Home with banner (flag persists via AsyncStorage `'nearr.devAuthEnabled'`).
- [ ] AuthGate skips the proximity check when `isDevSession` is true (no location permission prompt fires from `app/_layout.tsx` on launch).
- [ ] Attempting to save a place in dev mode either fails or silently no-ops at the DB layer — expected. Banner explains this.
- [ ] **Production smoke (when an EAS production build is available):** "Continue in Dev Mode" button is absent on sign-in. `enableDevAuth()` would be a no-op. Banners do not render.


## 10. Demo Mode (dev-only)

With `EXPO_PUBLIC_DEMO_MODE=true` in `.env` and Metro restarted:

- [ ] App launches into Home with Demo Mode banner visible (no sign-in required).
- [ ] Saved places list shows ~10 seeded entries across Santa Cruz, OC, and LA.
- [ ] Place search on Add Place returns local catalog matches (try `tacos`, `coffee`, `bbq`, `thrift`).
- [ ] Saving a place adds it to the list and persists across reload.
- [ ] Editing radius / notes / notifications persists across reload.
- [ ] Sharing a TikTok or Instagram URL into Add Place produces a synthesized title and never hits the network.
- [ ] Map tab renders the fallback list with name + address + lat/lng for each place; no native map errors.
- [ ] Settings ? Demo Mode ? Simulate nearby notification fires an `Alert`.
- [ ] Settings ? Demo Mode ? Reset demo data restores the seed.
- [ ] Removing the env var and restarting Metro returns to real-services mode.
- [ ] A production build with the flag set still ignores it (verify the one-shot warning logs).
