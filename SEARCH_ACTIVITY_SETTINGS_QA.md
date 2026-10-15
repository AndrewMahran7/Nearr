# Search, Activity and Settings QA — October 15 Fieldnotes

Baseline: `f51dfdb75dcdee3e02ceb848875e2cea46632d42`. Implementation worktree: `C:\Users\andre\Desktop\Nearr\.tmp\fieldnotes-oct15-polish`. This audit preserves the approved Fieldnotes appearance and all auth, transfer, splash and backend behavior.

## Findings and decisions

| Finding | Verdict / severity | Evidence and root cause | Implementation / validation |
| --- | --- | --- | --- |
| Failed discovery cannot retry the same query | Confirmed, high | `MapPlaceSearchDropdown` previously skipped `q === lastQuery`; its failure text had no Retry and the keyboard had no submit callback. Real component test against the preserved baseline fails because no Retry exists. | Explicit 44pt Try again action and keyboard retry invoke the same query. Auto-search still avoids repeating a successful query. Real hook/provider-promise regression passes. |
| Old results selectable while query changes | Confirmed, medium | Provider results survived a changed query during debounce and the next request. A tap could save a result from the previous search. | Invalidate pending responses on meaningful text changes and show results only for the current trimmed query. Tests resolve responses out of order and verify no stale row can appear. |
| Manual-save failure loses search context | Confirmed, medium | Map integration closed search before persistence; a failure left the user on the map with only an alert. | Map owner closes on success/duplicate, keeps query/results on failure. Search component adds one pending-save lock, spinner and accessible busy/disabled state. Rapid repeated taps dispatch exactly one save. |
| Saved search selection obscures the map immediately | Confirmed, medium | The map integration selected the saved row and forced the expanded detail surface. | Map owner retains compact selection and uses the viewport camera transaction. Search forwards the exact saved identity, dismisses keyboard, and labels the row “Show saved place … on map.” Search close preserves the existing map route. |
| Saved search and discovery mixed together | Dismissed | Existing explicit Your places / Find somewhere new tabs already separated local saved name/city/note lookup from provider discovery. | Preserved. Offline saved search starts zero provider calls. No-results guidance remains. |
| Activity empty-state spacing | Confirmed source-level redundancy, low | Empty compact Activity repeated “Finding your places / From your posts. Into your world.” above “You're all caught up”; the introductory block took scarce height in a 46% sheet. | Omit finding intro only when there are no items; reduce empty content top padding from 24 to 12 and horizontal padding from 24 to 16. Keep Activity header, caught-up identity and Back to your map. Existing small-screen/large-type expanded sheet policy remains. Native comparison is recorded in the central visual report. |
| Activity source thumbnail disappears before/without candidates | Confirmed, medium | Queue rows read only first candidate `sourceFrameUrl`; detail already used `extraction_payload.sourceFrameUrl`. Processing/failed jobs with a known receipt frame but no candidate therefore lost it. | `activitySourceFrameUri` prefers candidate evidence, falls back to known extraction frame. No fetch or fabricated imagery. Four lifecycle-state tests, blank/missing data and candidate priority pass; image remains explicitly “From the original post.” |
| Activity backend status / fake progress | Dismissed | Sections are driven by actual queued/processing_metadata, needs_help/failed and saved outcomes; stalled processing has honest background copy and an escape action. | Preserved authoritative status, retry/open detail routing, multi-place and completed navigation. No percentages introduced. Existing share-jobs-ui and queue-interaction contracts pass. |
| Fieldnotes Light Settings dark flash | Not reproduced as an ordinary navigation defect | Settings, Screen, root content and tabs headers use the same ThemeProvider palette. Default is Light; no Settings-local dark constant exists. Existing explicit Dark/System preferences are supported. | Do not force a theme or mask the screen. Separately fix the demonstrable hydration race below. Android visual proof and physical-iPhone limitations are distinguished in the central report. |
| Slow theme read overwrites a newer Light selection | Confirmed by real provider test, medium | AsyncStorage initial read checked only unmount. Stored Dark could arrive after the user selected Light and override that newer choice. Baseline real-provider test fails `dark !== light`. | Revision guard keeps a newer explicit choice. Existing stored Dark, System changes, invalid stored values and storage failure all pass. No startup/root/splash code changes. |
| Development controls visible in Development Settings | Expected, not a Production leak | Build info is explicitly non-production; standalone QA and both reset operations already require explicit Development app/backend plus exact Nearr-Dev project. | Preserve useful tools. Production, preview, undeclared environment and wrong backend cannot invoke reset; deep-link route redirects. |
| Testing section gated only by `__DEV__` | Confirmed environment inconsistency, low | The old test section disappears in a Development OTA but can appear in a Production-config debug bundle. | Use the verified Development boundary already used by resets. Notification and onboarding-preview handlers repeat the boundary before side effects. Passive build info retains existing non-production gate. |
| Small Search/Activity metadata and clipped accessible text | Confirmed source-level polish, low | Address/status/source metadata used 12pt caption; titles/locality were truncated at all font scales. | Use semantic 13pt metadata. Search identity/address/note and Activity row title/locality/meta stop truncating at fontScale >= 1.5; row heights remain content driven. Search tests cover 1, 1.5 and 2.2. |
| Weak search feedback | Confirmed, low | Header/clear/scope controls had no pressed styling and manual-save rows gave no pending indication. | Add restrained themed pressed states, one saving spinner and accessible busy state. No repeated haptic or new motion; successful save feedback remains owned by existing map persistence path. |

## Test evidence

Commands use `npx.cmd` / `npm.cmd` in PowerShell because this environment blocks the `.ps1` shims.

- `npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesSearchRuntime.ts` — PASS. Real React component + real search hook with native hosts/provider promises controlled: same-query retry, stale response protection, exact saved identity, duplicate save lock, failed-save context, no results, no duplicate successful provider call, offline, close, three text scales.
- `npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesSettingsRuntime.ts` — PASS. Real ThemeProvider: hydration race, first-install Light on dark system, persisted Dark, System appearance, invalid value, failed read; Production/deep-link/action guards.
- `npx.cmd ts-node -P scripts/tsconfig.json scripts/testFieldnotesActivityPolish.ts` — PASS. Source frame fallback, malformed/missing evidence, state grouping, source labeling, no provider photo lookup, no fabricated progress, compact empty layout and accessible metadata.
- `npm.cmd run test:share-jobs-ui` — PASS (all 35 checks).
- `npm.cmd run test:queue-interactions` — PASS.
- `npm.cmd run test:onboarding-v2-map-settings` — PASS.
- `npm.cmd run test:app-environment` — PASS.

Both new search/settings runtime suites were also run with `NEARR_QA_SOURCE_ROOT=C:\Users\andre\Desktop\Nearr-worktrees\nearr-1.6-fieldnotes` against the untouched baseline. Search fails on missing retry; Settings fails when late stored Dark overrides explicit Light. This is executable before/after evidence, not a claim of physical-device QA.

## Full prebuild-equivalent validation

`node scripts/runFieldnotesOct15Validation.cjs` runs the exact unique npm commands extracted from `pretest:prebuild` and `test:prebuild` (with each npm lifecycle preserved), plus search/settings runtime regressions, with three workers. It does not run Expo native prebuild, remote proofs, deployments or database commands. The worker boot check is a local unauthenticated 401 probe.

Initial run: 130 passed / 4 failed. One typecheck captured concurrent source edits. Three failures were restricted-environment tooling (EAS resolution, local Deno boot and Node user-info lookup). A four-command retry outside the restricted sandbox passed all four, including typecheck, without modifying test assertions. All 134 commands therefore passed after stabilization/environment repair. The extra Activity regression passed separately.

Per-command exit codes, durations and stdout/stderr are in `artifacts/fieldnotes-oct15/validation/results.json`, `retry-results.json`, and adjacent logs. The central validation report records any later map/photo suites and the final exact source SHA.

## Native visual and physical-QA boundary

Native captures are owned by the main task agent to avoid simultaneous emulator interaction. See `FIELDNOTES_VISUAL_BEFORE_AFTER.md` for matched artifacts, device/platform, visible differences and limitations. These component tests are not screenshots. Final iPhone physical QA remains required, especially search keyboard dismissal, map spatial continuity, Activity compact height and initial Settings navigation.

No backend, database, runtime configuration, native dependency, auth, account-transfer, splash-lifecycle or Production changes were made for this work.
