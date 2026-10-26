# Age and consent dispatch proof

26 October 2026. Public audience remains 13+ subject to higher regional minimums. Under-13 remains excluded. No region, provider or guardian gate was opened.

| Boundary | Actual evidence | Limitation |
|---|---|---|
| Regional age declarations | Actual migrations in disposable PostgreSQL: 12 suites, 60 age/region combinations; live US adult/13/under13 declarations match expected eligibility states | Local qualification is synthetic, not legal approval |
| Server-authoritative dispatch | Live create-share-job v75 with global-v1 header: five synthetic profiles denied HTTP 403 | Closed region/provider gates prevent a positive path |
| Legacy client | Live public-style process-share-link save without new contract header: HTTP 426 update_required for all five profiles | Intentional compatibility denial, not seamless old-client recognition |
| Forged approval / ownership | Local DB role grants/RLS reject authenticated qualification writes; consent identity tests pass fresh bearer/account-switch/withdrawal guards | Not an external penetration test |
| Guardian authorization | Local DB fixture proves even a qualified adult route denies minors; minor qualification constrained false | Guardian verification is not implemented |
| Withdrawal / claims | Local DB tests prove queued tasks cannot transition after withdrawal; prior full-schema claim evidence retained | Live withdrawn profile is blocked first by region policy; not an isolated consent-cause proof |
| Initial worker denial | Actual runMediaTask with mocked authorization false calls no resolver, transcription, OCR or model | Offline provider counters, not vendor logs |
| Mid-task revocation | New regression: authorization true at entry then false before acquisition. Old code called resolver once; corrected code calls zero providers, checks twice and marks needs_help | Mocked claim, not live active recognition |
| Audio/OCR/model | Source rechecks server RPC before transcription, OCR, regular model and targeted-note initial/repair dispatch | Cannot undo an already-sent request |
| Prohibited fallback | Gemini production-transport test denies before fetch even with key; OpenAI timeout/throttle/cancellation tests do not call Gemini; automatic-deep bypass tested | Offline protocol tests |
| AI notes | Same bounded OpenAI adapter, saved-place-scoped parsing, initial/repair authorization callbacks | Real note generation not executed |
| Worker ingress | Authenticated live processing wake returns HTTP 503 not_ready; disabled config constructs no processing dependencies | Disabled-worker safety, not recognition readiness |

## Narrow implementation change

Commit `9f2b1299824b2f7102fd3443da7d3a888f4d8c94` adds `requireEligibilityBeforeProvider` inside media acquisition, after awaited target/progress work and immediately before resolver dispatch. The new test failed before the change (one unauthorized simulated acquisition) and passed afterward (zero). No UI, localization, consent policy or resolver scoring changed. Full worker suite afterward: **664 tests, 657 pass, 7 skipped, 0 fail**, plus typecheck/build pass.

This narrows a time-of-check gap; it does not guarantee atomic cross-service revocation, cancel in-flight requests, or qualify a processor's internal retries/subprocessors. All gates remain disabled.

## Live evidence and counts

**Final corrected deployment repeat:** receipt `disabled-route-live-proof-eebc76c8-be69-4d21-a8e5-5c69025a4309.json`, 19:55:23–19:55:44 UTC, pins deployment `70fc5c6f-1b8b-4e5c-915e-7c30ccbab360`. Five profiles passed all three ingress checks: modern job 403, modern direct-save 403, legacy 1.4-style direct-save 426. **15 denied share requests**, no jobs/tasks, authenticated wake 503, unchanged release policy; five further synthetic identities deleted with 404 and zero-job/task readbacks. `cleanupComplete=true`. Across all three attempts only 14 task-owned synthetic accounts were created and deleted; no pre-existing accounts removed.

Versioned `disabled-route-live-proof-*.json` receipts distinguish actual requests from mocks. The completed 19:45:50–19:46:08 UTC run tested adult, minor13, under13, withdrawn and legacy14 on the first unified deployment. Ten share requests denied, zero share_jobs/media tasks created, authenticated worker wake denied before claim. Harness inference calls: **0**. Source guards and disabled processing establish no downstream path for these submissions; no independent provider billing/export reconciliation was available, so no provider-wide total is claimed.

All five test users were deleted by exact IDs after verifying this run's ownership marker, followed by auth 404 and zero job/task readbacks. An earlier harness attempt created four users, also deleted/read back; it stopped because it expected 200 instead of the legitimate 204 from the void withdrawal RPC. After both runs: 42 existing auth users, 20 saved places, 66 share jobs, 58 media tasks; zero identities from either run remain. No pre-existing account was deleted.
