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
- [ ] When `GEMINI_API_KEY` is configured server-side: backend agent's safety gate clears auto-save for fixtures with explicit caption venue + address (`manasiri-caption-explicit-venue`, `address-first-strongest`, `old-fishermans-grotto-tagged-handle-profile-fetch-success`) and refuses for ambiguous / mismatched / blocked / generic fixtures
- [ ] When `GEMINI_API_KEY` is NOT configured: legacy fallback path still works on host (parseShare → heuristic → AI/no-op → pipeline → picker), and the share flow never crashes

### Eval scripts (run after share-flow changes)

```powershell
# Legacy heuristic baseline (must stay at 31/48 + 18/18 auto-save assertions)
npx ts-node -P scripts/tsconfig.json scripts/evalShareExtraction.ts

# Backend agent shadow eval (requires GEMINI_API_KEY for behavior fixtures
# to score; without the key all 13 fixtures fail with gemini_key_missing,
# which is expected and matches the Stage-3 baseline)
npx ts-node -P scripts/tsconfig.json scripts/evalShareAgentShadow.ts
```

Behavior fixtures use these assertion fields (Stage 4): `expectedSafetyDecision`, `expectedUserFacingDecision`, `expectedSafeToAutoSave`, `expectedEvidenceContains`, `expectedPlaceNameContains`, `forbiddenPlaceNameContains`, `mustCallTool`, `mustNotCallTool`, `expectMustNotAutoSave`. Avoid asserting exact query strings — the agent's free-form reasoning makes those brittle.

### Stage 5 — beta release readiness (run before tagging a beta build)

Prompt + safety:

- [ ] Eval log banner shows the expected `promptVersion` (`prod-2026-05-04.v2` or newer)
- [ ] Safety gate confirmation: at least one fixture demonstrates each blocker — `profile_fetch_blocked`, `weak_generic_text`, `handle_context_unverified`, `display_name_only`, `weak_places_match`, `ambiguous_candidates`, `address_mismatch`, `candidate_name_mismatch`
- [ ] No fixture auto-saves when `forbiddenPlaceNameContains` would have been hit (poster name / influencer name)

Reliability + fallback (manually exercise each):

- [ ] Edge Function timeout (simulate by pointing `EXPO_PUBLIC_PROCESS_SHARE_LINK_URL` at an unreachable host) → host falls back to legacy heuristic + AI pipeline, never spins forever
- [ ] Gemini timeout (drop `GEMINI_API_KEY` server-side) → agent returns `failed` with `gemini_key_missing`; UI shows manual fallback
- [ ] Places error / no candidates → `userFacingDecision === 'manual_fallback'` and the user sees the manual search box
- [ ] Profile fetch blocked / `http_429` → safety reason `profile_fetch_blocked`; never auto-save
- [ ] Malformed AI JSON (`gemini_failed_or_unparseable`) → graceful `failed`, no crash
- [ ] Auth/session missing → host renders sign-in path; share flow never hangs

Tool-call guardrails:

- [ ] No `[agent]` log line contains a Bearer token, Supabase service-role key, Gemini key, or full raw HTML body
- [ ] Agent `toolCalls` count never exceeds the documented cap (24)
- [ ] No client-side scraping is attempted (`fetchProfileBio` / `fetchPostMetadata` only run server-side)
- [ ] No profile cache exists — `fetchProfileBio` is best-effort live every call

Debug panel (dev build only):

- [ ] Toggle `Show debug` shows: `runId`, `promptVersion`, `modelUsed`, per-tool calls with statuses, blocked/rate-limited summary line, AI reasoning, evidence, candidates with `matchScore`, safety decision, final status
- [ ] Normal users (production build) only see `saved` / `choose a place` / `search manually` / `failed` UI; no debug toggle visible

Eval / reporting:

- [ ] `npx ts-node -P scripts/tsconfig.json scripts/evalShareAgentShadow.ts` prints `promptVersion=...` banner
- [ ] When fixtures fail, the `failure_buckets=` line summarizes counts per category
- [ ] JSON report at `logs/share-agent-shadow-eval-<date>.json` includes `promptVersion` and `summary.failureBuckets`

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

## 7a. Visual / theme (Stage 0)

See [docs/UI_THEME_NOTES.md](./UI_THEME_NOTES.md). Toggle the OS color
scheme to Light at least once during this pass — Nearr should still
render as dark mode (resolved theme is locked).

- [ ] Sign-in tagline (“Save places once…”) and bullets are clearly readable on dark background (no white-on-white)
- [ ] Sign-in input placeholder visible
- [ ] Setup checklist items in Settings have readable titles + bodies
- [ ] Home empty state title, body, and both CTAs are readable
- [ ] Saved place cards: title, address, meta, actions all readable
- [ ] Place detail screen: title, address, notes, radius labels readable
- [ ] Map selected-place bottom card: text and CTAs readable
- [ ] Share flow (modal): header, search input, candidate rows readable
- [ ] Settings: section labels and captions readable; Appearance section shows the “dark-mode only for now” note
- [ ] Inputs: placeholder text visible; entered text high-contrast
- [ ] Disabled buttons: still legible, clearly distinct from enabled state
- [ ] Error states (Home / Places when offline): error title in red, body readable, Try Again button visible

## 7b. First-run / onboarding (Stage 0)

See [docs/ONBOARDING_FLOW.md](./ONBOARDING_FLOW.md) for the full audit.

- [ ] Fresh install + signed-out first open: lands on `/(auth)/sign-in` with the value-prop bullets visible
- [ ] Fresh install + signed-in first open (magic link OR test password): "How Nearr Works" modal appears automatically
- [ ] Reinstall: "How Nearr Works" modal appears again (per-user AsyncStorage seen flag is gone)
- [ ] Clear AsyncStorage / app data: "How Nearr Works" modal appears
- [ ] Signed-in with no saved places: Home empty state shows "Save from link" and "How Nearr Works" CTAs
- [ ] Signed-in with no saved places: Places tab empty state explains how to save (CTAs to manual + link)
- [ ] Denied location permission: app stays usable, Map renders fallback region, no crash
- [ ] Denied notifications: app stays usable, SetupReminderModal + SetupChecklist surface "Open Settings"
- [ ] First launch with airplane mode: after ~8s app routes to sign-in (log: `[onboarding] stuck_state_recovered auth_init_timeout`) instead of hanging
- [ ] First save from a shared link (Instagram/TikTok) completes and shows up on Home
- [ ] First manual save completes and shows up on Home
- [ ] Settings → "How Nearr works" row re-opens the modal at any time
- [ ] Settings → Setup Nearr → "Add Nearr to Share Favorites" exposes the 6-step iOS instructions
- [ ] Log line `[onboarding] setup_checklist_shown` appears when Settings is opened
- [ ] Log line `[onboarding] first_run_detected` (or `instructions_fallback_shown`) appears once per fresh sign-in

## 7c. Read-only offline saved places (Stage 0)

> Full spec + manual QA: [docs/OFFLINE_SAVED_PLACES.md](./OFFLINE_SAVED_PLACES.md)

- [ ] **Online warm-up.** Sign in online, open Home and Places, scroll the list, open at least one place detail
- [ ] **Cache write.** Confirm log line `[offline] saved_places_cache_write count=<n>` appears after the first successful load
- [ ] **Offline relaunch.** Enable airplane mode, kill and relaunch the app. Home and Places render the cached rows
- [ ] **OfflineBanner.** Banner reading `You're offline` appears above Home and Places lists with a `Last synced …` subline
- [ ] **Map markers / fallback list** populate from the cached rows while offline
- [ ] **Place detail offline.** Tapping a cached saved-place opens the detail screen without a network error
- [ ] **Blocked mutations.** While offline try Edit, Delete, Mark visited, Archive, and Unarchive — each surfaces alert text `Internet required to update saved places.`
- [ ] **Log line** `[offline] network_action_blocked action=<…>` appears for each blocked attempt
- [ ] **Reconnect.** Disable airplane mode and pull-to-refresh. Banner disappears, `lastSyncedAt` updates, and a mutation succeeds
- [ ] **Cold-cache empty state.** Fresh install in airplane mode shows the "You're offline" empty state with the friendly explanation (not a raw fetch error)

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
