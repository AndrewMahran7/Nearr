# Nearr — Manual Testing Checklist

> Last updated: 2026-04-27
> Source of truth: Codebase (not assumptions)

> Run before every TestFlight / Play Internal cut. **Background
> location, the iOS share extension, and the Android share intent only
> work in EAS dev/prod builds.** Expo Go is fine for the rest.

## 0. Setup

- [ ] `.env` populated per [ENVIRONMENT.md](ENVIRONMENT.md).
- [ ] `supabase db push` applied; tables + RLS visible in dashboard.
- [ ] Edge Function `process-share-link` deployed; secrets set;
      `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` set.
- [ ] `npx expo prebuild --clean` succeeds; generated
      `ios/NearrShareExtension/NearrShareExtension.entitlements`
      contains App Group `group.com.nearr.ios`.
- [ ] EAS dev build installed on a real iOS device AND a real Android
      device. (Simulators are OK for everything except background
      location and the iOS share extension.)
- [ ] `EXPO_PUBLIC_DEMO_MODE` and `EXPO_PUBLIC_MAP_PREVIEW_MODE` are
      both unset for production-flow testing.

## 1. Auth

- [ ] Sign-in screen renders email field, button label "Send magic
      link", validation error on empty / malformed email.
- [ ] Magic link arrives within ~30 s, opens the app via
      `nearr://auth-callback`, lands on `/(tabs)/home`.
- [ ] Restart the app → still signed in (Supabase session restored
      from AsyncStorage).
- [ ] Settings → Sign out → confirmation dialog → returns to
      `/(auth)/sign-in`.
- [ ] **Dev sign-in.** With `__DEV__` (Expo Go or dev build), type
      `dev@nearr.test`. Form swaps to a password field + "Sign in as
      developer" button. Wrong password → friendly error. Correct
      password → real session, normal home screen.

## 2. Manual save

- [ ] FAB on Home opens `/add-place`.
- [ ] Typing "blu" shows a hint; typing 3+ chars debounces ~300 ms and
      returns Google Places candidates.
- [ ] Foreground location, when granted, biases results to nearby
      matches; when denied, search still works (no prompt is forced).
- [ ] Picking a candidate shows the confirm card with three radius
      modes: Default, Miles, Minutes.
- [ ] "Use default" saves with NULL radius_value/unit (verify in
      Supabase).
- [ ] Saving with Miles=0 or Minutes=-1 → blocked with validation
      error, no DB write.
- [ ] After save, app routes to Home and the new card appears at top.
- [ ] Saving the same place twice does NOT create a duplicate
      `saved_places` row — instead source / notes / radius are updated
      in place.

## 3. Paste-link share (host app)

- [ ] Tabs → Map / Home → FAB or Settings → "Add from link" opens
      `/share`.
- [ ] Paste an Instagram reel URL. Expected: parse → AI/heuristic
      query → Places search → either silent save (alert + route to
      `/(tabs)/map`) OR a candidate chooser.
- [ ] Paste a TikTok URL. Same expectation.
- [ ] Paste a YouTube short URL with a clear venue in the title.
- [ ] Paste a non-share URL (e.g. random news article). Expected:
      `'failed'` phase with manual search fallback that actually
      finds places when you type into it.
- [ ] Paste a URL whose page returns a 4xx/5xx (`metadataFailed=true`).
      Expected: parser still produces a `suggestedQuery` from the URL
      path; UI ends up in `'failed'` phase with helpful copy.
- [ ] Source attribution: the saved row's `source_type` /
      `source_url` reflect the platform (instagram / tiktok /
      youtube / web / etc.).
- [ ] Address-resolver path: paste a TikTok caption that's mostly an
      address ("123 Main St, Austin, TX"). Expected: top result is a
      business near that address, not the raw geocode.
- [ ] Franchise path: paste a known chain URL with a city in the
      caption. Expected: the picked branch is in / near that city,
      not the closest one to the device.

## 4. iOS Share Extension (REAL DEVICE, EAS dev build)

- [ ] In Safari: share an instagram.com / tiktok.com / google.com/maps
      URL → "Save to Nearr" appears in the share sheet.
- [ ] First run: tapping it shows the extension UI; if a session JWT
      has been bridged, **silent-save** message appears within ~6 s
      and dismisses; otherwise the extension hands off to the host
      app's `/share` and the URL is processed there.
- [ ] In the Instagram or TikTok native app: share a reel/post →
      "Save to Nearr" → same outcomes.
- [ ] Sign out in the host app, then trigger the share extension →
      it MUST hand off to the host app (no silent save with stale
      token).
- [ ] Sign in again → JWT is re-published to the App Group; next
      share-extension invocation can silent-save again.
- [ ] If `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` is unset OR the Edge
      Function returns `open_app`: extension still successfully
      hands off to host app.

See [IOS_SHARE_EXTENSION.md](IOS_SHARE_EXTENSION.md) for verification
details if any of the above fails.

## 5. Android share sheet (REAL DEVICE, EAS dev build)

- [ ] Share a TikTok URL from Chrome → "Nearr" appears in the share
      sheet.
- [ ] Tapping it cold-starts the app, lands on `/share`, and the
      pasted URL pre-populates and auto-runs.
- [ ] Repeat from inside the TikTok app (warm start): same flow via
      `onNewIntent`.
- [ ] Share plain text containing a URL ("check this out
      https://… cool right") → URL is extracted and used.
- [ ] Share plain text containing NO URL → app opens to `/share`
      with empty state; no crash.

## 6. Map

- [ ] Granting location shows the user dot + zone bubbles for every
      saved place.
- [ ] Each place's circle radius matches its effective radius
      (per-place > profile default > 1 mile fallback).
- [ ] `fitToCoordinates` includes the radius edges (no clipped
      circles on first load).
- [ ] Marker tap → preview card with name / address / "Open in Maps"
      / "View details". FAB hides while preview is shown.
- [ ] "Open in Maps" launches Google Maps (or Apple Maps fallback) at
      the place's lat/lng — **NOT** as `place_id:` query.
- [ ] Denying location → empty state with re-request and
      open-settings affordances; FAB still works.
- [ ] Stuck / no-fix emulator → after ~6 s the screen falls through
      to fallback rendering instead of spinning.
- [ ] Deep link `nearr://(tabs)/map?savedPlaceId=<uuid>` (or tapping
      a notification) animates to that place once and stops.

## 7. Notifications (proximity)

- [ ] Settings → enable notifications → enable nearby notifications
      → grant foreground + background location prompts as they appear.
- [ ] On iOS, after granting "Always", visit a saved place at walking
      pace; an `Alert` may take several minutes due to OS coalescing.
- [ ] Quiet-hours window: enter a saved-place radius during quiet
      hours → no notification (and no `notification_events` row).
- [ ] Re-entering the same radius within 1 hour → no second
      notification (cooldown).
- [ ] Per-place toggle off → no notification for that place even when
      proximity matches.
- [ ] Tapping a delivered notification opens the app to
      `/(tabs)/map?savedPlaceId=<uuid>` and focuses the place.
- [ ] On AppState → 'active' (and on session start), a one-shot
      proximity check runs without spamming notifications.

## 8. Place detail

- [ ] Tapping a card on Home / Places opens `/place/[id]`.
- [ ] Edit notes / radius unit / radius value → save → reflected in
      list immediately (no stale list).
- [ ] Toggle per-place notifications off → reflected in row and
      respected by proximity check.
- [ ] Delete → confirmation → row gone from Home, Places, Map.
- [ ] Open in Maps from detail screen works the same as from the map
      preview.

## 9. Settings

- [ ] Profile defaults: change unit + value → reflected immediately
      and on next "Use default" save.
- [ ] Notifications master toggle off → "nearby" toggle disabled and
      the proximity task is stopped.
- [ ] Quiet hours: invalid times rejected; valid times persisted and
      respected by `inQuietHours`.
- [ ] Sign out always works, including under Demo Mode (it bypasses
      the real call).

## 10. Demo Mode (`EXPO_PUBLIC_DEMO_MODE=true`)

- [ ] App launches straight into Home as `demo-user` (no sign-in
      screen).
- [ ] Red `DemoModeBanner` visible on all tabs.
- [ ] Map renders [MapFallbackList](../components/MapFallbackList.tsx),
      not `MapView`.
- [ ] Saving / editing / deleting places persists across reload
      (AsyncStorage) within Demo Mode.
- [ ] Settings → "Simulate notification" fires an `Alert`.
- [ ] No real network requests (verify with Charles / browser dev
      tools).
- [ ] On a non-`__DEV__` build: a one-shot `console.warn` appears at
      startup.

## 11. Map Preview Mode (`EXPO_PUBLIC_MAP_PREVIEW_MODE=true`)

- [ ] Real sign-in screen still required.
- [ ] After sign-in, Home / Places show the seeded dataset.
- [ ] Map shows the real `MapView` recentered on the seeded region
      with a `Map Preview Mode` badge; no location prompt.
- [ ] Saving from `/add-place` returns to a no-op (still seeded
      dataset).
- [ ] Demo Mode flag wins when both are set.

## 12. Smoke

- [ ] `npx tsc --noEmit` passes.
- [ ] App boots cold to Home in < 3 s on a midrange device.
- [ ] No `[serviceName] action failed` errors during a basic flow
      (manual save → list → map → detail → delete → sign out).
- [ ] No `console.warn` about `EXPO_PUBLIC_DEMO_MODE` /
      `EXPO_PUBLIC_MAP_PREVIEW_MODE` shipping in a release build.
