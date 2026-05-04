# Nearr — Manual Testing Checklist

> Last updated: 2026-05-03
> Source of truth: current codebase

This is the current beta checklist. Use it before TestFlight or Play Internal builds. Because this is a docs-only update, treat every item below as a manual or device verification task.

## 0. Setup

- [ ] `.env` or EAS env includes current Supabase and Google Maps values
- [ ] `supabase db push` applied all migrations
- [ ] After any Android manifest / permission change in [app.json](../app.json), install a fresh native Android build before testing background reminders or geofencing
- [ ] Native build installed on a real iPhone and a real Android device for notification/share/geofencing tests
- [ ] `EXPO_PUBLIC_DEMO_MODE` and `EXPO_PUBLIC_MAP_PREVIEW_MODE` are off for production-flow testing
- [ ] If testing silent iOS extension save: `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` points to a deployed function and the host app is signed in

## 1. Auth

- [ ] Sign-in screen loads normally
- [ ] Magic link arrives and opens the app on `/auth-callback`
- [ ] Auth callback no longer shows an Expo Router unmatched-route screen
- [ ] Successful auth lands on Home
- [ ] App restart keeps the session
- [ ] Sign out returns to the sign-in screen
- [ ] Typing `dev@nearr.test` switches the UI into password-login mode
- [ ] Correct password signs in successfully in the current build

## 2. Save flows

### Manual save

- [ ] Manual search returns candidates
- [ ] Save with Default/Miles/Minutes works
- [ ] Successful manual save redirects to Map focused on the saved place
- [ ] Duplicate manual save does not create another row and still focuses the existing saved place when possible

### Link / host-app share save

- [ ] Pasted Instagram link saves successfully
- [ ] Pasted TikTok link saves successfully
- [ ] Successful save redirects to Map focused on the saved place
- [ ] Duplicate save focuses the existing saved place when possible
- [ ] Ambiguous save shows candidate selection instead of failing silently
- [ ] Address-first extraction behaves correctly when a street address is present in the source content
- [ ] `@` handles alone do not cause a wrong silent save
- [ ] Influencer post vs restaurant account distinction behaves correctly on a small real-world sample

### Android share intent

- [ ] Sharing a URL from another Android app opens Nearr and auto-runs the share flow
- [ ] Shared plain text containing a URL still works
- [ ] Shared plain text with no URL does not crash the app

### iOS share extension

- [ ] Nearr appears in the iOS share sheet in a native build
- [ ] With silent-save prerequisites configured, a confident share can save and open the host app at the focused map
- [ ] Without silent-save prerequisites, the extension falls back to the host-app share flow cleanly
- [ ] Missing auth token or missing endpoint does not strand the user in the extension

## 3. Map

- [ ] Opening Map from the tab shows normal map behavior and does not select a random place
- [ ] Save -> focused map route opens the selected-place bottom card
- [ ] Focused save highlights the selected marker/radius and frames the zone
- [ ] Swiping the selected card down dismisses it cleanly
- [ ] Tapping the X dismisses it cleanly
- [ ] Tapping the map background dismisses it cleanly
- [ ] Native marker callouts do not get stuck on-screen
- [ ] View All still works
- [ ] User-location centering still works when there is no targeted `savedPlaceId`
- [ ] Android emulator idle state does not produce the old spinner/log-spam behavior

## 4. Places and detail screens

- [ ] Places filters work: Active (default), Recent, Nearby, Visited, Archived, Instagram, TikTok, Reminders on
- [ ] Active filter is selected on first open of the Places tab
- [ ] Active filter hides rows with `archived_at` or `visited_at` set
- [ ] SavedPlaceCard shows Show on map and View original post/link behavior correctly
- [ ] SavedPlaceCard shows a Visited badge on visited rows and an Archived badge on archived rows
- [ ] Archived filter shows a Restore action that clears `archived_at`
- [ ] Place detail shows Get directions, original post/link, nearby reminder, note, and remove action
- [ ] Place detail “Get directions” path routes into map focus for that saved place
- [ ] Low-emphasis remove flow still works

## 4b. Opportunity flow

- [ ] Tapping the body of a nearby reminder opens `/opportunity/[id]` (warm-start)
- [ ] Tapping the body of a nearby reminder while the app is fully suspended cold-starts into `/opportunity/[id]`
- [ ] Opportunity screen shows `Opportunity N of 3` matching `reminder_opportunity_count`
- [ ] Get directions opens external maps and closes the screen
- [ ] I went here marks the place visited, plays the checkmark animation, and closes
- [ ] Adjust reminder radius routes to the place detail screen
- [ ] Maybe next time on opportunity 3 archives the place and stamps `reminders_exhausted_at`
- [ ] Visited and archived places no longer appear in proximity / geofence eligibility on the next sync
- [ ] Map marker for archived places is subdued and renders without a radius circle

## 5. Notifications and geofencing

- [ ] Setup reminder modal appears when notifications or Always Location are missing
- [ ] Notification permission prompt can be triggered
- [ ] Settings can send a test notification
- [ ] One-shot foreground proximity check still runs on session start / app foreground
- [ ] Background location watch can start in a native build
- [ ] Geofence sync/logging works on a real device when permissions are granted
- [ ] Geofencing respects the 20-region cap behavior
- [ ] Background location fallback still works when geofencing is unavailable
- [ ] Notification action categories register without crashing the app
- [ ] Overlapping saved-place radii produce one grouped notification instead of multiple notifications
- [ ] Grouped-notification copy is sensible for 2-place and 3+-place cases
- [ ] Do not treat grouped reminder behavior as proven until validated on real devices

## 6. Legal and settings

- [ ] Settings shows current legal version/status information
- [ ] Legal Terms and Privacy links open from Settings / modal routes
- [ ] Legal acceptance is currently disabled for beta (`LEGAL_ACCEPTANCE_REQUIRED = false`), so no mandatory blocking legal gate appears during normal beta sign-in

## 7. Performance / reliability

- [ ] App can sit idle on Android emulator without the previous map/event log spam issue
- [ ] Map still renders if location is unavailable
- [ ] No crash on empty map state, denied location state, or unavailable location state

## 8. Real-device-only reminders

These should not be treated as simulator/Expo Go pass criteria:

- iOS share extension
- background location reminders
- OS geofencing
- Always Location behavior
- grouped nearby reminder delivery reliability

## 9. Not in the current build

Do not mark these as regressions unless code lands for them first:

- opportunity screen after notification tap
- visited completion state
- archived reminder state
- Archive / Visited filters
