# Nearr 1.7 stalled-session recovery

Recovered on 2026-10-26 PT without resetting, cleaning, or discarding any work.

## Recovered Git state

- Primary checkout: `C:\Users\andre\Desktop\Nearr`, branch `integrate/safe-development-baseline`, HEAD `88c73e45a74b87fc121f98666b4a68755…` at initial inspection.
- Unified worktree: `C:\Users\andre\Desktop\Nearr\.tmp\nearr-global-integration-recovered`.
- Branch: `integration/nearr-global-fieldnotes-monetization`.
- Recovered HEAD and upstream: `8bcd0bdb6fa4973da66ba77672592593511e97c0`.
- The unified worktree was clean and already pushed at recovery start.
- The previous session had safely checkpointed its formerly dirty work in:
  - `9277673aeb0f2b5561ee25867bff8dd873f788b9` — Android QA regression fixes.
  - `8bcd0bdb6fa4973da66ba77672592593511e97c0` — Android emulator evidence and release report.
- No active worktree was removed or pruned. Multiple older worktree registrations are prunable, but cleanup was intentionally not attempted.

## Preserved stalled-session changes

Commit `9277673` contains the recovered application changes: corrected live localization keys, bounded native permission calls, authenticated Settings language selection, localized Settings descriptions/accessibility labels, offline recovery routing, and their focused tests. Commit `8bcd0bd` contains the real Pixel 8a screenshots and final-report updates. Neither checkpoint was replaced or rewritten.

One additional live mojibake source key was found during recovery in `app/feedback.tsx` (`Thanks â€” ...`). It was changed to the existing canonical localized key (`Thanks — ...`) and covered by `scripts/testLocalization.ts`.

German, French, and Italian catalogs each still contain 51 dead duplicate keys with U+FFFD. Correct canonical equivalents exist and current source does not reference the dead keys. They were not mechanically purged in this checkpoint; the catalog audit should be tightened before claiming that every extra catalog key is clean.

## Permission/reminder fix review

The reminder implementation remains fail-closed:

- Every native notification/location permission read or prompt has a 10-second boundary.
- Per-call timers are cleared in `finally`.
- Denial or timeout returns before `updateSavedPlace`.
- Cache and UI state update only after permissions are granted and database persistence succeeds.
- `reminderBusy` resets in `finally`, permitting a retry.
- The losing promise in `Promise.race` remains observed, so a late native rejection does not cause an unhandled rejection or mutate reminder state.

Expo's native permission promise cannot be physically aborted; cancellation is logical. Because multiple calls are independently bounded, the complete sequence can exceed ten seconds even though no individual call is unbounded.

## Android process and runtime recovery

- Emulator ownership was verified before action: `emulator.exe` PID 88792 launched `Pixel_8a`; child `qemu-system-x86_64.exe` PID 26300.
- ADB server ownership was verified: `adb.exe` PID 46184 listening only on `127.0.0.1:5037`.
- Metro was not running at recovery start; nothing was listening on port 8081.
- The surviving Java process was the worktree-scoped Gradle 8.8 daemon and retained `-Djava.io.tmpdir=C:/Users/andre/Desktop/Nearr/.tmp/nearr-global-integration-recovered/android/.gradle-java-tmp`.
- No unrelated processes were terminated.
- Device: Google Play Pixel 8a AVD, Android 16 / API 36, x86_64.
- Installed app: `com.nearr.app`, version `1.7.0`, `targetSdk=34`, freshly installed 2026-10-26 10:15:51 PT.

The first cold launch correctly exposed that this is a Development build: without Metro it remained at the Expo splash. Metro was restarted from the recovered worktree on `127.0.0.1:8081`, the bundle completed (2,061 modules), and the app reported the Nearr-Dev Supabase identity. The one-time Expo developer-menu explanation was dismissed. It did not reproduce the prior black-frame symptom.

A subsequent force-stop/reopen reached `com.nearr.app/.MainActivity`, restored the eligibility screen, and produced no fatal exception, ANR, or React Native error in the captured log window. The emulator currently has no restored Supabase user token (`INITIAL_SESSION hasToken=false`); no Production identity was used.

New recovery evidence:

- `android-emulator/26-force-close-reopen.png` and `26-force-close-reopen-12s.png` — bounded no-Metro Development splash evidence.
- `android-emulator/27-metro-recovered.png` — real app plus one-time Expo developer overlay.
- `android-emulator/28-dev-menu-dismissed.png` and `29-dev-menu-closed.png` — overlay recovery and native eligibility UI.
- `android-emulator/30-force-close-reopen-pass.png` — final cold reopen pass.
- Matching XML accessibility dumps are stored beside each image.

Existing screenshots `14-place-detail-fixed.png`, `15-reminder-enabled.png`, `18-settings-dark.png`, `20-settings-large-font.png`, `23-place-more.png`, and `25-show-all-pins.png` were visually re-inspected. The repaired apostrophe renders correctly, the reminder switch is not clipped, the Activity/More surfaces do not overlap, dark/status-bar contrast is readable, the 1.3 font-scale screen remains scrollable, and the map/detail safe areas are intact.

## Demo Mode determination

Demo Mode is a deliberate Development-only QA limitation guarded by `__DEV__`. It renders `MapFallbackList`, and its saved-card/detail routing is not equivalent to the real authenticated Google Map flow. Production behavior was not changed to make Demo Mode mimic authenticated map navigation.

## Temporary QA account and cleanup state

No disposable Development credential is stored in the worktree or current process environment. The recovered emulator session contains no auth token. The committed deployment record reports stable Development preservation counts of 42 auth users, 20 saved places, and 66 share jobs, but there is no separate deletion receipt that proves which prior temporary identity was removed. No account or row was deleted during this recovery because test ownership could not be demonstrated from the retained evidence.

## Current Development service state

- Supabase CLI is authenticated. Live Nearr-Dev `qnfxnmvxpjzfydgudtvs` is `ACTIVE_HEALTHY`; Production `rlqvxdwtetxsqxhqztkw` was read only and remains `ACTIVE_HEALTHY`.
- All 89 local/remote Development migrations match through `20261021000005`.
- Live Development functions remain: `create-share-job` v75, `process-share-link` v88, `process-share-jobs` v144, `plus-api` v1, and `revenuecat-plus-webhook` v1.
- EAS is authenticated as `andrewmahran`. Build `af64b897-32a0-40f7-a690-c802c1920e39` is a finished internal Development build 1.7.0 (69) sourced from `d413814…`; it is not a Store build and does not include the later Android recovery commits.
- No 1.7 App Store/production EAS build exists in the queried history.
- Railway remained unauthenticated at initial recovery inspection. One fresh interactive OAuth session was started; no deployment is permitted unless that exact session completes and live Development context is read back.
- App Store Connect and RevenueCat have no authenticated CLI in this workspace. Their current states remain committed evidence rather than fresh dashboard readback.

## Recognition qualification

Recognition remains disabled. Current authoritative terms do not support the existing Gemini route for an application likely accessed by under-18 users. The existing OpenAI route requires parent/guardian consent for minors plus under-18 safeguards that Nearr does not currently implement. Anthropic is only a possible future route and has no current adapter, account qualification, safeguards, or benchmark in Nearr. Self-hosting currently covers transcription, not multimodal physical-place recognition.

Read-only validation passed for the 11-source tutorial corpus, the 38-check recognition audit preflight, and a one-case dry run. A bounded Development qualification stopped before provider/network work because no disposable Development identity or provider credentials were configured. No provider flag was changed and no live recognition spend occurred.

## Monetization and release gates

Purchases stay disabled. The local Development offering is still `nearr_monetization_v2`, not the intended `nearr_plus_v1`; no correct Apple product mapping, new RevenueCat webhook readback, or sandbox transaction is verified. The Apple Paid Applications Schedule, App Privacy correction, policy approval/publication, qualified recognition provider, physical-iPhone QA, unified Development Railway worker, final Store build, and Production rollback proof remain hard gates.

Production, public distribution, RevenueCat catalog, App Store listing, Supabase Production, and the historical Railway deployment were not changed.

## Verification run during recovery

- `npm run test:localization` — pass (10 locales).
- `npm run typecheck` — pass.
- Source-audit focused runs — pass: place-detail V2, place-detail, offline mode, offline reminders, reminder-distance cleanup (10 checks), permission lifecycle semantic harness, and `git diff --check`.
- Recognition audit — pass: tutorial corpus (5 checks), audit preflight (38 checks), and one-case dry run without provider dispatch.

## Shortest safe path

Complete Railway OAuth and read back the Development service; establish a contractually qualified recognition path for the actual 13+ audience; deploy and benchmark the unified Development worker; have the Apple Account Holder accept the paid agreement; correct App Privacy and configure/test the intended product in sandbox; obtain founder/counsel policy approval; then build and physically test one Store-distribution 1.7 candidate before attaching it to the manual-release App Store version. No public release is authorized by this recovery.
