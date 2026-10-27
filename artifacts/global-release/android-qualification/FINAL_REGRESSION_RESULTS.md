# Final regression results

Authoritative machine receipts: `ten/results.json` and `full/results.json`, including exact source SHA, timestamps, exit code and per-entrypoint duration. Original ten were reproduced with exit 1 before edits (`baseline/results.json`); no entrypoint removed/skipped. Later native discoveries strengthened the original entrypoints.

Final outcome: **10/10 original failures pass; 30/30 original matrix pass, zero failures.** Full matrix completed 2026-10-27T22:01:48.757Z at `44c58209ba93ff1a49d3e8c96b4bc2430db96145`. Every row below is PASS (exit 0); the receipt retains per-entrypoint timing.

Final product source: `4c424d9`; final test-contract source: `44c5820` (plus documentation/verifier-only delivery commits). The full matrix is unchanged in membership. A prior full pass at 90735e9 was rerun after session-recovery and splash fixes. The 4c424d9 run found one additional stale signed-out source expectation in testOnboardingDemoCopy.ts:389. It now asserts the exact route helper and both fresh-user tutorial/returning-user account outcomes; no test removed. Use the latest 44c5820 JSON, not either earlier run, as acceptance evidence.

| Original entrypoint | Final acceptance |
| --- | --- |
| test:prebuild | PASS |
| test:safe-development | PASS |
| test:birthday-onboarding | PASS |
| test:onboarding-native-contract | PASS |
| test:localization | PASS |
| test:native-localization | PASS |
| test:global-eligibility-db | PASS |
| test:global-monetization | PASS |
| test:global-monetization-db | PASS |
| test:consent-identity | PASS |
| test:recognition-consent | PASS |
| test:privacy-policy | PASS |
| test:onboarding-account-transition | PASS |
| test:create-map-navigation | PASS |
| test:create-map-continue-runtime | PASS |
| test:onboarding-phase2-auth-map-hardening | PASS |
| test:onboarding-v2-phase2 | PASS |
| test:onboarding-v2-physical-runtime | PASS |
| test:onboarding-v2-hands-on-activation | PASS |
| test:onboarding-v2-visual | PASS |
| test:onboarding-1259-regressions | PASS |
| test:fieldnotes-oct15 | PASS |
| test:fieldnotes-oct18 | PASS |
| test:fieldnotes-physical-ui | PASS |
| test:place-detail-ui | PASS |
| test:saved-place-result-ui | PASS |
| test:monetization-token-ux | PASS |
| test:monetization-integration | PASS |
| test:monetization-suspension-contract | PASS |
| test:premium-request-monetization | PASS |

Additional acceptance: standalone TypeScript, git diff --check, native Android build, patch-package reapplication, installed APK hash, three post-splash-fix cold launches, disposable account cleanup. Local PostgreSQL integration suites do not reset cloud databases. Permission fault tests cover 24 cases; splash tests execute the pinned implementation with five native boundary behaviors; disabled Plus executes 30 localized component renders and checks no purchase SDK loads.

## Runtime fixes beyond inherited test repairs

1. Synchronous native permission throws and late responses handled within the deadline race.
2. Expo AV reload teardown JNI guard, with Android runtime bump/new binary.
3. Localized Continue accessibility state recovers from busy.
4. Skipped practice no longer claims a real saved place.
5. Bundled local thumbnails retained in Saved/search, never applied to real IDs.
6. New manual saves start reminders off until explicitly enabled.
7. Saved categories/dates and selected navigation copy follow app locale.
8. Visited prompt/actions remain readable on narrow 160% font.
9. Completed onboarding with revoked session routes to auth, not startup recovery.
10. Splash native void/throw/rejection cannot mask the original application error.

ANR caveat: one notification-broadcast ANR under host resource pressure is retained. Six isolated display changes did not reproduce it. Three final cold launches show zero relevant error lines. This does not establish an unconditional zero-ANR guarantee; release-mode/device follow-up remains appropriate.
