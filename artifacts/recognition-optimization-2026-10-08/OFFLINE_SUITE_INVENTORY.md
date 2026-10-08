# Offline regression inventory

The accompanying `offline-suite-inventory.json` accounts for all 288 root `test:*` package keys as of this inventory. It is an execution allowlist, **not a pass report**.

- Expanding `test:prebuild`, including npm's automatic pre/post hooks, covers 140 test keys.
- The integration branch's 23 additional suites bring that coverage to 163 keys.
- The full worker `npm test` covers another 14 worker-only aliases.
- The remaining offline work is 85 launch commands, covering five additional nested suites. Nine more package keys are redundant wrappers of covered leaves.
- Twelve live/remote suites are excluded. Their exact names and commands are recorded in the JSON.

The JSON records each remaining command and its SHA-256. Before execution, compare the integration branch's package command with the recorded command. Save actual logs and results separately. The earlier prebuild, 23-suite, worker and typecheck results retain their own status; this inventory does not infer those results.

The full worker test glob also discovers live and remote integration test files. Explicitly set `MEDIA_E2E_TESTS`, `MEDIA_LIVE_TESTS`, `INSTAGRAM_LIVE_TESTS`, and `NATIVE_VIDEO_LIVE_TESTS` to `0` for an offline run. Those gated cases must remain skipped and cannot substantiate end-to-end validation.

The remaining suites were reviewed for direct live calls and shell execution. Provider-facing unit tests replace fetch or inject response/generator functions. Monetization tests use local ledgers and source contracts. Fixtures with `production` in their names do not contact Production. Two local side effects deserve explicit execution notes:

- `test:context-aware-places-resolution` writes `artifacts/context-aware-places-resolution-benchmark.json` in the execution worktree.
- `test:empty-queue` also starts a new PostgreSQL 18 fixture cluster in a GUID-named temporary directory, targets its random local port, and deletes that guarded temporary path afterward. It needs locally installed PostgreSQL binaries and does not target a hosted database.

The allowlist contains no release, deployment, remote proof, live acquisition, or live provider command. Test fixtures and temporary local state do not represent Production saves or token changes.
