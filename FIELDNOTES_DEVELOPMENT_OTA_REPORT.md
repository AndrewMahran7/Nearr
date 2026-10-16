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

## Publication

Publication is pending at this source checkpoint. The only authorized command is the existing guarded Development wrapper:

```powershell
npm run dev:update -- -m "Fieldnotes October 15: Show All, visible selected pins, and frontend polish" --non-interactive
```

It passes explicit Development channel/environment and validates the Nearr-Dev backend before publication. QA preview environment flags must be absent from the release process. One final update group will be published for iOS and Android on runtime 1.6.59; this report will then record the returned identifiers and source SHA in a documentation-only commit.

## Production boundary

No Production backend changes. No Production OTA. No App Store submission. No recognition/model-routing changes. No monetization changes. No database or server-notification changes.

See `FIELDNOTES_FOUNDER_RETEST.md` for the practical 10–15 minute physical-iPhone checklist and the actual-worktree LAN commands.
