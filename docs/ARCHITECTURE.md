# Nearr — Architecture

> Last updated: 2026-05-03
> Source of truth: current codebase

This document describes the current data and control flow for auth, save flows, extraction, map focus, notifications, geofencing, and sharing.

## App shell

- Root layout: [app/_layout.tsx](../app/_layout.tsx)
- Responsibilities:
  - auth gating between `/(auth)` and `/(tabs)`
  - cold-start and warm-start deep-link handling
  - How Nearr Works modal
  - beta-disabled legal acceptance modal wiring
  - setup reminder modal for notifications / Always Location
  - one-shot proximity checks on session start and app foreground
  - geofence sync on session start and app foreground
  - notification category registration and action handling

## Auth flow

### Magic link

1. User enters email on [app/(auth)/sign-in.tsx](../app/(auth)/sign-in.tsx).
2. [services/auth.ts](../services/auth.ts) calls `sendMagicLink(email)`.
3. `Linking.createURL('auth-callback')` builds the callback URI.
4. User taps the email link.
5. OS opens the app on `/auth-callback`.
6. [app/_layout.tsx](../app/_layout.tsx) and [app/auth-callback.tsx](../app/auth-callback.tsx) both cooperate with [lib/authDeepLink.ts](../lib/authDeepLink.ts) to parse the callback.
7. `handleAuthDeepLink()` handles both implicit tokens and PKCE code exchange.
8. On success, the app routes to `/(tabs)/home`.

### Test password login

1. User types `dev@nearr.test`.
2. Sign-in screen swaps to password mode.
3. `signInWithPassword()` is called.
4. AuthGate routes the resulting real Supabase session into the tabs.

This path is not limited to `__DEV__`; the email gate is the product gate.

## Save flows

### Manual save

1. User opens [app/add-place.tsx](../app/add-place.tsx).
2. `usePlacesSearch()` queries Google Places with best-effort location bias.
3. User selects a candidate and chooses reminder radius mode.
4. [services/savedPlacesService.ts](../services/savedPlacesService.ts) upserts the canonical place and user save.
5. App routes to:

   `/(tabs)/map?savedPlaceId=<saved_place_id>`

6. Map focuses the new saved place.

### Host-app link / share save

1. User pastes a URL or arrives on [app/share.tsx](../app/share.tsx) with `?url=`.
2. `parseShare()` extracts platform/source metadata.
3. The extraction pipeline combines local heuristics plus structured AI evidence when available.
4. Evidence priority is address-first, then explicit place name, then corroborated handle/poster evidence.
5. Poster identity is classified as restaurant vs influencer vs unknown so creator accounts are not treated as venue truth by default.
6. `@` handles are treated as evidence, not truth.
7. `searchPlaces()` runs with post/location bias.
8. Address-like and multi-location results are re-ranked or resolved.
9. App either:
   - auto-saves a confident result, or
   - shows a candidate picker, or
   - falls back to manual search input
10. Save success routes to focused map with `savedPlaceId`.

### Extraction v2 behavior

Current extraction behavior is intentionally conservative:

- address evidence outranks social-handle evidence
- exact restaurant-name verification goes through Places
- influencer posts can still produce a confident save when the restaurant is corroborated elsewhere in the content
- weak or conflicting evidence falls back to candidate selection rather than silent save

Not currently built:

- audio transcription fallback in runtime
- tagged-account profile inspection beyond the immediate extracted metadata

### Android share intent

1. Android `ACTION_SEND text/plain` intent hits the app.
2. [plugins/withAndroidShareIntent.js](../plugins/withAndroidShareIntent.js) rewrites the intent to `nearr://share?url=...`.
3. Expo Router lands on [app/share.tsx](../app/share.tsx).
4. Host-app share flow runs exactly as above.

### iOS share extension

1. Share sheet opens the Nearr extension.
2. [ShareExtension.tsx](../ShareExtension.tsx) extracts the first URL.
3. Extension tries `processSharedUrl(url)`.
4. If `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` is configured and the App Group auth token is present, it POSTs to the Edge Function.
5. Result handling:
   - `saved` -> open host app directly to focused map when `savedPlaceId` exists
   - `ambiguous` -> open host app share flow
   - `failed_requires_app` -> open host app share flow
   - `open_app` or any failure -> open host app share flow

The extension is enabled in config but still treated as partially verified until tested on a real device with correct provisioning and deployed backend.

## Save persistence flow

Save persistence is centralized in [services/savedPlacesService.ts](../services/savedPlacesService.ts).

Behavior:

1. Get current user.
2. Resolve canonical `places` row by `google_place_id` when present.
3. Insert `places` only when missing.
4. Insert `saved_places` for the current user.
5. On duplicate `(user_id, place_id)`, update source/radius/notes instead of failing.
6. Return `savedPlaceId` for both new saves and duplicates when available.
7. Trigger geofence resync after a successful save.

## Save success -> focused map

This is a real shipped flow now.

Entry points using it:

- [app/share.tsx](../app/share.tsx)
- [app/add-place.tsx](../app/add-place.tsx)
- Places and Home “Show on map” actions
- Place detail “Get directions” route into map focus
- iOS share extension `saved` handoff path

Route shape:

- `/(tabs)/map?savedPlaceId=<saved_place_id>`

Fallback behavior:

- If save succeeds but there is no `savedPlaceId`, the app logs
  `[save-flow] saved place id missing; opening map without focus`
  and opens the map without focused selection.

## Map selection flow

Map screen: [app/(tabs)/map.tsx](../app/(tabs)/map.tsx)

Behavior:

1. Map renders custom markers and radius circles.
2. If `savedPlaceId` is present and data is loaded, map finds that saved place.
3. `selectPlace()` sets the selected item and frames its zone with `fitToCoordinates()`.
4. Selected state opens the in-app bottom card.
5. Selected marker/radius gets stronger highlight styling.
6. Deep-link focus sets `didFitRef` so user-location or multi-place fitting does not immediately override it.

Dismiss paths:

- map tap
- swipe down on the card
- X button on the card

Marker callouts:

- The UI uses custom marker views plus a custom preview card.
- Native callouts are not used as the user-facing interaction pattern.
- Dismiss code still calls `hideCallout()` defensively if present.

## Notifications

Primary module: [lib/notifications.ts](../lib/notifications.ts)

Implemented paths:

- notification permission request
- foreground location permission request
- background location permission request
- test notification
- background location task (`LOCATION_TASK`)
- one-shot foreground proximity check
- notification category registration
- notification action handling (some actions still TODO)

Decision inputs:

- profile master notification toggle
- nearby notifications toggle
- per-place notification toggle
- quiet hours
- effective radius (place override -> profile default -> 1 mile)
- 12-hour cooldown
- 3-notification lifetime cap per saved place

Persistence side effects:

- local notification scheduling
- `saved_places.last_notified_at`
- `saved_places.notification_count`
- `saved_places.reminder_opportunity_count` (incremented atomically via the `bump_reminder_opportunity_count` SQL function on every successful delivery, including each member of a grouped notification)
- `notification_events` insert

## Nearby-opportunity flow

When the user taps the body of a nearby reminder (default tap, not an action button), `app/_layout.tsx` routes to `/opportunity/[id]` with the `savedPlaceId` from the notification payload. Cold-start handling uses `Notifications.getLastNotificationResponseAsync()`; warm-start handling uses `Notifications.addNotificationResponseReceivedListener()`.

The opportunity screen (`app/opportunity/[id].tsx`) reads `reminder_opportunity_count` and shows `Opportunity N of 3` with copy that varies by N. Four actions:

1. Get directions — opens external maps via `openExternalMaps`. Tracks `opportunity_get_directions_tapped`.
2. I went here — calls `markVisited`, plays a lightweight checkmark animation built on the existing `Animated` API (no new dependency), then closes. Tracks `opportunity_visited_tapped` and `place_marked_visited`.
3. Adjust reminder radius — routes to `/place/[id]`. Tracks `opportunity_adjust_radius_tapped`.
4. Maybe next time — closes. If `reminder_opportunity_count >= 3` it also calls `markArchived(id, { exhausted: true })`, stamping `reminders_exhausted_at`. Tracks `opportunity_maybe_next_time_tapped` and (when applicable) `opportunity_archived_after_3`.

`markVisited` and `markArchived` both set `notifications_enabled = false` so the next geofence resync drops the region. `unarchive` clears `archived_at` and `reminders_exhausted_at` but does NOT re-enable notifications — the user opts back in from the place detail screen.

The Active filter on the Places tab is the new default; it hides any row with `archived_at` or `visited_at` set. Visited and Archived filters surface those rows; the Archived filter exposes a Restore action on each card. On the map, archived places render their marker at lower opacity with no radius circle to keep the active set visually quiet.

Current grouping behavior:

- When one saved place triggers, the app uses that place's effective radius as the trigger circle.
- Other eligible saved places are grouped into the same notification when their own effective-radius circles intersect that trigger circle.
- Group cooldown is keyed in app memory from the sorted included `saved_place` ids.
- Grouping changes notification copy and persistence updates, but it does not create a separate opportunity route or archive state yet.
- Adaptive ellipse/blob zones are intentionally deferred as future work.

Not yet built:

- notification tap -> dedicated opportunity screen
- visited completion state
- archived reminder exhaustion state
- archive / visited list filters

## Geofencing

Primary module: [lib/geofencing.ts](../lib/geofencing.ts)

Current architecture:

- task name: `NEARR_GEOFENCE_TASK`
- max regions: 20
- active geofences are prioritized from eligible saved places
- geofences are synced on app/session lifecycle and after relevant settings/save changes
- geofences complement the background location watch rather than replacing it

Sync prerequisites:

- signed-in user
- notifications granted
- background location granted
- profile notifications enabled
- profile nearby notifications enabled
- at least one eligible saved place

When a geofence ENTER fires:

1. task parses the saved place id from the region identifier
2. `maybeNotifyForSavedPlace()` runs the same cooldown and eligibility checks used elsewhere
3. notification may be sent

EXIT events do not notify.

## Setup and onboarding overlays

- How Nearr Works modal shows after first real sign-in until dismissed/completed.
- Setup reminder modal appears when notifications or Always Location are still missing.
- Legal agreement modal exists but is gated off in beta because `LEGAL_ACCEPTANCE_REQUIRED` is false.

## Edge Function pipeline

Function: [supabase/functions/process-share-link/index.ts](../supabase/functions/process-share-link/index.ts)

High-level flow:

1. validate request and URL
2. get bearer/access token
3. resolve current user with Supabase auth
4. fetch public metadata
5. run server-side extraction
6. search Google Places server-side
7. choose silent save vs ambiguous vs fallback result
8. save idempotently for the user when confident
9. return `saved`, `ambiguous`, `failed_requires_app`, or `open_app`

Important status distinction:

- the function code is present in-repo
- deployment and secrets are external environment work

## Real-device constraints

- Background location does not work in Expo Go.
- Geofencing should be validated only on real devices.
- iOS share extension requires a native build and correct App Group/provisioning.
- Android share intent requires a native build with the patched MainActivity.
- Grouped-notification delivery is implemented in code, but reminder reliability claims still require native real-device testing.
