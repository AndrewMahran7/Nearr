# Final validation

The complete available offline regression inventory was exercised. **The required prebuild chain, full worker suite and targeted recognition checks pass. The repository is not globally green: 11 additional legacy suites fail identically on the starting commit.** No assertions were weakened to hide them. Twelve live/remote suite keys were excluded because they require external execution or shared state and are not part of this zero-paid-spend local qualification.

| Command / boundary | Final result |
|---|---|
| `npm run test:prebuild` including automatic npm hooks | PASS; full chain, includes root typecheck and 140 expanded test keys |
| `npm --prefix services/media-worker run typecheck` | PASS |
| `npm --prefix services/media-worker run build` | PASS |
| `npm --prefix services/media-worker test` | 704 tests: 697 pass, 7 opt-in skips, 0 fail; FFmpeg 9.0.1 |
| `node scripts/recognition-eval/run-regression-checks.mjs --log-name regression-final` | 23/23 commands PASS |
| Same runner with `--inventory artifacts/recognition-optimization-2026-10-08/offline-suite-inventory.json` | 85 commands: 74 pass, 11 inherited failures |
| `node node_modules/ts-node/dist/bin.js -P scripts/tsconfig.json scripts/testOnboardingV2MagicRender.ts` | PASS; explicitly covers the leaf skipped after a legacy wrapper's first failure |
| `npm run test:recognition-evaluation` | 20/20 PASS |
| `npm run eval:recognition -- --variant winner --compare artifacts/recognition-optimization-2026-10-08/runs/baseline_repaired/scores.json` | 31/31 observations, 0 invalid/unavailable, 0 changed decisions |
| `node node_modules/ts-node/dist/bin.js -P scripts/tsconfig.json scripts/recognitionOptimizationSafetyReplay.ts --out .tmp/safety-final-replay.json` | 33/33 synthetic controls; 7 direct historical Production differences |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testRecognitionTerminalFenceDatabase.ps1` | PASS on isolated local PostgreSQL 18 |
| `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/testMediaClaimAtomicDatabase.ps1` | PASS, including note/source provenance and rollback |
| `node node_modules/ts-node/dist/bin.js -P scripts/tsconfig.json scripts/testMediaGalleryClaimRace.ts` | PASS; stale gallery upload cannot replace current referenced bytes/pointer |
| Worker evidence persistence race + app/server path lifecycle checks | PASS; included in worker and focused contract runs |
| Frame parity integration on FFmpeg 7.1 and 9.0.1 | 2/2 each; valid hashes and unchanged static/CFR/VFR evidence assertions |
| `python scripts/recognition-eval/assemble-report-data.py` | 62 recognition rows, 682 usage rows; immutable baseline copy preserved |
| `git diff --check` | PASS |

The 23 supplemental suites cover geography/state, entity role, exact identity, cache/quarantine/migrations, Wrong Place, Google cost contracts, named-lead recovery, automatic completion, multi-place presentation, deterministic recognition, deployment/worktree guards, place capabilities/photos and notification delivery. Their exact commands and results are recorded in `evidence/final-regression-results.json`.

`offline-suite-inventory.json` accounts for all 288 root test keys through prebuild dependencies/hooks, worker aliases, the additional launch commands, nested leaves, redundant wrappers and explicit live exclusions. `evidence/offline-additional-results.json` preserves all 85 outcomes. The independent baseline comparison records the 11 reproduced failures and their log hashes; they are not relabeled as passes. Source-level assertions are not hosted end-to-end proofs.

The inherited same-place-moment failure received additional safety review. Its fixture has explicit readable `CENOTE 7 BOCAS` signage. Historical commit `8736e2a` intentionally replaced a requirement for explicit city/region text with the exact-source-name/signage path. Read-only controls produce `source_named` with that sign and `none` when it is removed; a unique canonical candidate can save, while two candidates or upstream REVIEW escalate. It is therefore a mismatch with the old helper expectation, not evidence that the finalizer rejected the save anyway. The mocked canonical result cannot prove the real venue correct. The failing assertion remains visible and unchanged; the new branch does not introduce that behavior. Other inherited failures concern removed monetization screens, changed UI/source expectations, and additional candidate projection fields. See `offline-inherited-failure-classification.json` for each exact failure and baseline reproduction.

## Failures found and resolved during integration

- Missing local nonsecret Development project-ref fixture caused early environment-contract failures; the isolated `.env.local` fixture was supplied, without credentials or live writes.
- An import above the pre-existing Deno `@ts-nocheck` boundary caused root typecheck errors; the import was moved below it, preserving the repository's established boundary.
- Source contract tests expected an AI-note update and source argument in the old Edge location. They now assert equivalent same-source, nonempty-input, empty-destination and user-note protections inside the atomic SQL path. Actual PostgreSQL behavior tests were added.
- FFmpeg 9 removed `-vsync`; batched hashing initially returned unavailable hashes, safely retaining frames but failing parity/dedup assertions. The equivalent `-fps_mode passthrough` option passes both 7.1 and 9.0.1. Original held-out results were not overwritten or retuned.
- Review found old storage uploads could overwrite newer bytes despite database guards. Claim-specific evidence directories and content-addressed gallery images now preserve current evidence; executable mocked races verify this.

## Limits

Live worker flags were disabled for final execution. No actual API, push-notification, user token, Production cache or real-user save test was run. The Docker CLI is present but its Linux daemon is unavailable, so the floating apt FFmpeg version in a rebuilt container is not certified here. Development container/load qualification remains necessary. PostgreSQL tests use isolated schema fixtures plus the actual relevant migration functions; attachment internals are a deterministic transaction probe. They are not a concurrent hosted database stress test.
