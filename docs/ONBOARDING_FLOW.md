# Nearr — First-Run / Onboarding Flow

> Last updated: 2026-05-26
> Owner: Stage 0 stabilization
> Scope: cold-start UX from fresh install through first saved place.

This document is the source of truth for what a brand-new Nearr user is
supposed to see, where the state lives, and what we now do when something
goes wrong. It exists because a TestFlight user installed the app and
stalled: the "How Nearr Works" instructions never appeared, and there was
no fallback to explain what the app does.

## 1. Cold-start sequence

1. `app/_layout.tsx` mounts. `ThemeProvider` → `AppErrorBoundary` →
   `GestureHandlerRootView` → `SafeAreaProvider` → `AuthGate` → expo-router `Stack`.
2. `AuthGate` reads `useAuth()`. `useAuth` calls `supabase.auth.getSession()`
   + `loadDevAuth()` in parallel. **Hard 8s timeout** (`AUTH_INIT_TIMEOUT_MS`)
   forces `loading=false` and `session=null` if either promise hangs, so the
   app can never sit on a blank screen waiting for auth.
3. `app/index.tsx` is just `<Redirect href="/(tabs)/home" />`.
4. While `loading` is true, AuthGate does not navigate. When it resolves:
   - no session → `router.replace('/(auth)/sign-in')`.
   - has session → `router.replace('/(tabs)/home')`.
5. After sign-in (real Supabase session, not demo / Local UI), AuthGate
   triggers up to three onboarding effects in this order:
   1. **Legal acceptance** (only if `LEGAL_ACCEPTANCE_REQUIRED=true`).
   2. **How Nearr Works** modal (`HowNearrWorksModal`).
   3. **Setup reminder** modal (notifications + Always Location).

## 2. Onboarding state flags

| Concern | Storage | Key | Owner |
|---|---|---|---|
| "How Nearr Works" seen | AsyncStorage | `nearr:hasSeenHowItWorks:<userId>` (+ legacy unscoped `nearr:hasSeenHowItWorks`) | [components/HowNearrWorksModal.tsx](../components/HowNearrWorksModal.tsx#L18) |
| Share Favorites checklist done | AsyncStorage | `nearr:setupShareFavDone` | [components/SetupChecklist.tsx](../components/SetupChecklist.tsx#L47) |
| Notification permission | OS | n/a | [services/notifications](../services/notifications.ts) |
| Location permission (Always) | OS | n/a | `getLocationStatus()` in [components/SetupChecklist.tsx](../components/SetupChecklist.tsx#L52) |
| Legal acceptance | Supabase `profiles` row | `terms_accepted_at`, `privacy_accepted_at`, `legal_version` | [services/profileService.ts](../services/profileService.ts#L134) |
| Setup-reminder dismissed | In-memory only | n/a | `setupReminderDismissedThisSession` in [app/_layout.tsx](../app/_layout.tsx#L102) |
| Legacy "Local UI Mode" | AsyncStorage | `nearr.devAuthEnabled` (wiped at every cold start) | [lib/devAuth.ts](../lib/devAuth.ts) |

The intentional design: **only the AsyncStorage "seen" flag and the OS
permissions can hide instructions on a fresh device.** Everything else
re-derives on each launch.

## 3. Setup checklist

`SetupChecklist` (rendered inside `app/(tabs)/settings.tsx`, always
visible) covers three items:

1. **Turn on Notifications** — derives from `getNotificationPermissionState()`.
2. **Turn on Always Location** — derives from
   `Location.getForegroundPermissionsAsync()` + `getBackgroundPermissionsAsync()`.
3. **Add Nearr to Share Favorites** — manual flag stored in AsyncStorage.

It is unconditional in Settings — even after a user dismisses the
`SetupReminderModal`, they can always come back here and re-enable.

## 4. Permission behaviour (do not block core app)

- **Notifications denied**: app fully usable. `SetupReminderModal` and
  the checklist surface a CTA to open Settings.
- **Location denied / when-in-use only**: Map tab still renders; if no
  location we center on the first saved place or fall back to a default
  US-wide view. Home computes "nearby" only when permission is granted
  and degrades silently otherwise.
- **No network on first launch**: auth init times out after 8s
  (`useAuth`); user is routed to sign-in with a banner-free state, and
  can retry magic link when back online.

## 5. Fallback behaviour (what we added in Stage 0)

These were the actual root causes for the reported first-run stall:

1. `hasSeenHowNearrWorks` did one `AsyncStorage.multiGet` with no error
   handling. A throw silently rejected the IIFE in `AuthGate`'s
   onboarding effect and the modal never appeared.
   - **Fix**: try/catch around the read; on error return `false`
     (fail-open). Logged as `[onboarding] instructions_fallback_shown`.
2. `AuthGate`'s onboarding IIFE had no try/catch and no defensive
   fallback. Any throw inside terminated the effect with no UI change.
   - **Fix**: wrap the await; on error still flip the modal visible and
     log `[onboarding] instructions_fallback_shown`.
3. `getLegalAcceptanceStatus` already returned `null` on error, but a
   thrown exception (offline + retry) would have left the legal modal
   permanently hidden AND blocked the HowNearr modal indirectly via the
   `legalAgreementVisible` dep.
   - **Fix**: try/catch and explicitly fail-open (`setLegalAgreementVisible(false)`).
4. `useAuth` had no upper bound on the auth-init promise. A hung
   `getSession()` would have left `loading=true` forever, leaving the
   user on a blank Home/auth gate.
   - **Fix**: 8s safety timeout that forces signed-out state and logs
     `[onboarding] stuck_state_recovered auth_init_timeout`.
5. `markHowNearrWorksSeen` threw uncaught on AsyncStorage failure, which
   could break the dismiss handler.
   - **Fix**: try/catch + warn.

## 6. Telemetry

All Stage 0 onboarding events log to `console`:

- `[onboarding] first_run_detected`
- `[onboarding] instructions_shown`
- `[onboarding] instructions_fallback_shown`
- `[onboarding] dismissed <completed|skipped>`
- `[onboarding] stuck_state_recovered <reason>`
- `[onboarding] setup_checklist_shown`

The pre-existing analytics event `how_nearr_works_shown` is still fired
through `trackEvent` (with `entry_point: 'first_sign_in'` normally or
`'storage_fallback'` when the modal appears via fallback path).

## 7. Known failure modes now handled

| Mode | Before | After |
|---|---|---|
| AsyncStorage throws on first read | HowNearr modal silently never shows | Modal shows; logged as fallback |
| `getLegalAcceptanceStatus` throws | Legal modal hidden; HowNearr blocked | Fail-open, both modals usable |
| `supabase.auth.getSession()` hangs | App stuck on loading/blank | After 8s, routes to sign-in |
| Storage write fails on dismiss | Unhandled rejection | Logged, modal still dismisses |
| Demo mode session | No instructions (intentional, dev-only) | unchanged |

## 8. Manual QA checklist (Stage 0)

Run on a real device. Wipe app between most rows.

- [ ] Fresh install, no sign-in: lands on `/(auth)/sign-in`, instructions
      bullets visible in the tagline.
- [ ] Fresh install, magic-link sign-in: HowNearr modal appears
      automatically before the first time Home renders content.
- [ ] Fresh install, test-account password sign-in: HowNearr modal
      appears.
- [ ] Reinstall: HowNearr modal appears again (per-user AsyncStorage key
      was wiped).
- [ ] Clear AsyncStorage (Settings → Reset app data on Android, or
      delete and reinstall on iOS): HowNearr modal appears.
- [ ] Signed-in, navigate to Settings → "How Nearr works" row reopens
      the modal at any time.
- [ ] Signed-in, no saved places: Home empty state shows
      "Save from link" and "How Nearr Works" CTAs.
- [ ] Signed-in, no saved places: Places tab empty state explains how to
      save a place ("Save a place" and "Save from a link" CTAs).
- [ ] Denied notifications: app fully usable; `SetupReminderModal`
      offers "Open Settings" route; SetupChecklist surfaces it in
      Settings.
- [ ] Denied location: app fully usable; Map still renders with fallback
      region; Home "nearby" section silently absent.
- [ ] First launch with airplane mode on: after ~8s, app routes to
      sign-in. `[onboarding] stuck_state_recovered auth_init_timeout`
      visible in logs.
- [ ] First save via shared link from Instagram / TikTok → Home shows
      the place, activation progress card updates.
- [ ] First save via manual search → same.
- [ ] Share Extension: SetupChecklist "Add Nearr to Share Favorites"
      shows the 6-step instructions; "Mark done" toggles state.

## 9. Out of scope (Stage 0)

- No changes to extraction, ranking, or save pipelines.
- No theme/visual redesign — modal copy and order are unchanged.
- No new auth surface; magic link + test-account password remain the
  only entry points.
- No offline cache; first-launch offline still routes to sign-in (just
  no longer hangs).

## 10. Follow-ups / risks

- `useSavedPlaces` has no upper-bound timeout. If `listSavedPlaces`
  hangs, Home spinner stays. Lower priority than auth because RLS errors
  surface as rejections, not hangs. Track separately.
- `markHowNearrWorksSeen` now swallows storage errors silently. If
  storage stays broken the modal will reappear every launch — annoying
  but not blocking.
- Legacy unscoped key `nearr:hasSeenHowItWorks` can still mark a brand
  new account as "seen" if a previous user on the same device used a
  pre-per-user-key build. Acceptable trade-off; reopen via Settings.
