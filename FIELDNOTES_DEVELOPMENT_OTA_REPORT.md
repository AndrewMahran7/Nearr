# Fieldnotes October 15 Development OTA

## Verified release identity

| Item | Value |
| --- | --- |
| Expo project | `@andrewmahran/nearr` |
| Project ID | `2ec7a08a-2078-4232-a244-c9d16fb75ffe` |
| Channel / branch / EAS environment | `development` / `development` / `development` |
| Development channel ID | `01a01c76-1061-7244-81bb-85c3f26841db` |
| App version / native build / runtime | `1.6.59` / `59` / `1.6.59` |
| Existing finished iOS Development build | `74a22771-5998-485b-ac16-f316caf7491d` |
| iOS bundle / Android package | `com.nearr.ios` / `com.nearr.app` |
| Verified source baseline | `f51dfdb75dcdee3e02ceb848875e2cea46632d42` |
| Previous Development update group | `4ab58c67-de91-4cf1-bab2-51d68d16aaea` |
| Active Git branch | `fix/nearr-1.6-oct15-polish` |
| Active worktree | `C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct15-polish` |

The original dirty main workspace and the clean external Fieldnotes worktree were preserved. The isolated branch starts at the verified latest Fieldnotes source, retaining Create Map, authentication, account-transfer and splash fixes.

## Validation before publication

- Exact unique commands from `pretest:prebuild` and `test:prebuild`, plus Search/Settings runtime checks: **134/134 passed**, preserving **144 executions** in the aggregate evidence. Four initial environment/concurrent-source failures passed on retry; there are no unresolved test failures.
- The new `npm run test:fieldnotes-oct15` aggregate passed all 16 constituent suites. Final Settings accessibility styling was followed by another successful Settings runtime check and TypeScript typecheck.
- `git diff --check` passed. No native configuration, dependency version, lockfile, backend or schema changes. A new native build is unnecessary for these JS/TS and QA-artifact changes.
- Actual Android before/after captures, 15 comparison boards, cold-start font scales 1.3/2.0, and debug performance observations are retained under `artifacts/fieldnotes-oct15/`. Invalid/hot-config baseline records are explicitly excluded from matched visual proof.
- Physical iPhone, Apple Maps world limits, VoiceOver, real provider sign-in/transfer and real Share Extension handoff remain founder QA. The named founder video was unavailable; no recording timestamps or physical-device result is invented.

## Published Development update

Status: **FIXED / DEVELOPMENT OTA READY / AWAITING FOUNDER QA**.

Exactly one final Development update group was published successfully with the existing guarded wrapper:

```powershell
npm run dev:update -- -m "Fieldnotes October 15: Show All, visible selected pins, and frontend polish" --non-interactive
```

The wrapper validated `app=development`, `backend=development`, and `Nearr-Dev(qnfx…dtvs)`. The release process and the listed EAS variables had no QA map-preview override. Both platform bundles exported successfully; existing assets were reused, with no new native build.

| Published item | Value |
| --- | --- |
| Published source SHA | `ef26080c7e78689f3aa3c1b7fc5166b647703f4b` |
| Published at | `2026-10-16T00:14:54.648Z` (October 15, 5:14 PM Pacific) |
| Update group | `0cb3a6cb-f50f-4d35-a635-c6b87102ad57` |
| iOS update | `01a1420f-ceb8-7ace-bfa4-f3dfd9c0a04c` |
| Android update | `01a1420f-ceb8-74dc-9338-e9f15526807f` |
| Branch / runtime | `development` / `1.6.59` |
| Message | Fieldnotes October 15: Show All, visible selected pins, and frontend polish |

[EAS update dashboard](https://expo.dev/accounts/andrewmahran/projects/nearr/updates/0cb3a6cb-f50f-4d35-a635-c6b87102ad57). Readback evidence is stored in `artifacts/fieldnotes-oct15/development-ota-verification.json` and `development-channel-verification.json`; it excludes manifests, client configuration values and signed asset URLs.

The publication source was clean and pushed before release. A final documentation-only commit records the OTA identifiers and verification; it does not alter the published application. Final branch HEAD and push/clean status are recorded in the delivery handoff. Application checkpoints are `3f3fc22`, `bdcba91`, `33aa149`, and `19cb9a0`; QA/release-source checkpoint is `ef26080`.

Task-owned Metro servers on 8082/8083 and task-created ADB forwarding were stopped/removed. The pre-existing user Metro on 8081 was preserved. Emulator font scale is restored to 1.0. Use the LAN instructions in the retest report for a new interactive session.

## Production boundary

No Production backend changes. No Production OTA. No App Store submission. No recognition/model-routing changes. No monetization changes. No database or server-notification changes.

See `FIELDNOTES_FOUNDER_RETEST.md` for the practical 10–15 minute physical-iPhone checklist and the actual-worktree LAN commands.
