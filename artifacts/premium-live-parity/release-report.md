# Nearr P0 — Simple Sol Live Parity Reliability

## A. Isolation

- Repo: `C:\Users\andre\Desktop\Nearr`
- Worktree: `C:\Users\andre\Desktop\Nearr-worktrees\simple-sol-live-parity-reliability`
- Branch: `fix/simple-sol-live-parity-reliability`
- Base / starting HEAD: `cb9dd6f8193282009415c8a7cbe40ace779e32bc`
- Final implementation HEAD: `f3853fc7556a58fcbe6941cfd26f0fa94b2351e4`
- Deployed worker source HEAD: `d618b9047ca6b612b44cf511725d44c3bc8f6a80`
- Deployed Edge source HEAD: `566a3a4b11e7552109b1fe1f757fc90357826eb3`
- `origin/main`: `1e0772971cda925227c7f677fc249b9c8e643b4f`
- Original dirty checkout: untouched; seven pre-existing status entries remained.
- Isolated worktree: clean after the evidence commit.

## B. Prior failures

- Batch 1 failed: R02. Live output was Swami's Beach / North Beach / Ocean Beach in California; token consumed.
- Batch 2 failed: R01 and R06. Both ended with no useful result and released tokens despite Sol usage and three Places calls.
- Overlap: none.
- C07: no result in both historical live batches, safely not autosaved.
- Historical artifacts did not persist request, Sol, canonicalization, safety, or rejected hypothesis fingerprints. The precise historical first differing field therefore cannot be claimed after the fact.

## C. First divergence by failed case

| Case | Parity fingerprint | Live fingerprint | First proven divergence |
|---|---|---|---|
| R01 | `20a6122714854b1ebe7aea2fd4833bf28d03c430b5f64aaa9ff64c3b7108c4fe` | `20c98de1da4e63ef0825b0c0691a035c9ea21d79e2ec9b1f7de048cf3fd2b161` | Request → `frames`: timestamps and dimensions matched, independently regenerated JPEG bytes/hashes differed. |
| R02 | `a72443b72aae6a8946ddc769ef519993a0e066af52f95868a9afbe9dc934ec7b` | `de726d440352d74c128fcd20886b3d83fd9ffd26ff63b4f1487a59db3b9118a1` | Request → `frames`: timestamps, dimensions, and byte lengths matched; hashes differed. |
| R06 | `6b3699ebd7b9be26464b456637e20df9762d2385811c85f06488ff185354907d` | `7e24f5722881fb64e059a9b55eb5dae0cb3bbe41db6e6825f00ccdc70bbe6131` | Request → `frames`: timestamps, dimensions, and byte lengths matched; hashes differed. |

The comparison artifacts contain the exact per-frame values. Because no local/live request fingerprint was identical, the identical-request three-replay clause was not triggered.

## D. Root cause

- Primary: the Edge finalizer ran the legacy pre-resolver before accepting the typed Premium result. `manual_fallback` could erase an actionable Sol result. The typed `PREMIUM_ACTIONABLE_RESULT` is now authoritative.
- Secondary: R04 proved a post-Sol settlement divergence. Worker final fingerprint said `CHARGEABLE_ACTIONABLE → CONSUME`, while Edge reclassified the visible named REVIEW lead as no-result. Authenticated typed Premium chargeability is now preserved.
- C07 ingress: Railway's public YouTube probe returned `authentication_required`, producing no evidence and no Sol call. A bounded public oEmbed/thumbnail fallback now preserves public evidence without credentials, cookies, proxies, additional models, or additional Sol calls.
- Proof integrity: the first DEV proof implementation exposed a queued normal-lane parent to the normal poller and hardcoded cache reads to zero. The final harness inserts the already-terminal eligible fixture state directly and fails any case without exactly one persisted Premium Sol boundary.
- Was the Simple Sol recognition architecture wrong: **NO**.

## E. Shared implementation

- Evidence builder shared: YES — `buildBoundedSolSourceContext`.
- Prompt builder shared: YES — one `sol-parity-natural-v1` implementation.
- Parser shared: YES — one structured parser and schema.
- Canonicalizer shared: YES — runtime and parity use the same minimal Premium canonicalization path.
- Legacy resolver after a valid Simple Sol result: NO.

## F. Evidence

- Frame differences: local/live acquisition produced matching selection times and dimensions but different encoded bytes/hashes. Every run now persists frame SHA-256, timestamp, dimensions, and byte length.
- Caption, transcript, OCR, creator, and source-location values are persisted only as bounded hashes/lengths.
- Shared text normalization/bounds are used by parity and runtime.
- Evidence version: `premium-evidence-2026-09-05.v1`.
- Reuse states: `EVIDENCE_REUSE_VALID`, `EVIDENCE_REUSE_INCOMPLETE`, `EVIDENCE_REUSE_VERSION_MISMATCH`, `EVIDENCE_REGENERATED`.
- Final counted batches used `EVIDENCE_REGENERATED`; incompatible or incomplete evidence must regenerate.

## G. Sol reproducibility

- Identical-request reruns: not applicable; compared local/live request fingerprints were not identical at the frame boundary.
- Variance: repeated independent requests produced different specific but accepted hypotheses on ambiguous cases, especially R01/R02/R07. No default second call or retry was added.
- Model: exactly one `gpt-5.6-sol` request per counted Premium case, reasoning `high`, no web/MCP/Gemini/critic.

## H. Post-Sol behavior

- Useful Sol outputs lost after model: historical R01/R06 could not be reconstructed exactly; the legacy pre-resolver was a proven erasure path and was removed for typed Premium results. Live R04 directly proved the settlement reclassification bug and is fixed.
- Canonicalization divergence: no hidden legacy resolver remains; 1–3 minimal Places calls were observed per final priority case, within two calls per hypothesis.
- Safety divergence: REVIEW downgrades preserve visible results.
- Result mapping: typed actionable results now reach candidate confirmation/picker or safe autosave without becoming empty.
- Settlement: typed actionable decisions and visible named REVIEW leads consume; no-result/technical failures still release.

## I. Priority cases

| Case | Parity expected | Paid/local runtime | Counted Live A | Counted Live B | Final |
|---|---|---|---|---|---|
| R01 | Specific French gorge | Cirque de Gens, REVIEW | Gorges du Gardon / Cirque de Gens, REVIEW | Cirque de Gens / La Baume / Pont d'Arc, REVIEW | Useful |
| R02 | Maui/Hawaii specific candidate or truthful partial | Puʻu Kekaʻa (Black Rock), REVIEW | La Perouse Bay / Black Rock family, REVIEW | Puʻu Olai / Makena / La Perouse, REVIEW | Useful |
| R03 | Tamolitch Blue Pool | Tamolitch Blue Pool, REVIEW | Tamolitch Blue Pool, REVIEW | Tamolitch Blue Pool, REVIEW | Useful |
| R04 | Dorset quarry | Dorset Quarry, REVIEW | Dorset / Marble Street / West Rutland, REVIEW | Dorset Quarry, REVIEW | Useful |
| R05 | Okere/Kaituna/Tutea | Ōkere Falls Scenic Reserve, REVIEW | Okere Falls / Kaituna, REVIEW | Ōkere Falls / Tutea, REVIEW | Useful |
| R06 | Lake Havasu/Copper Canyon | Lake Havasu, REVIEW | Copper Canyon / Lake Havasu, REVIEW | Copper Canyon / Lake Havasu, REVIEW | Useful |
| R07 | Stryn/Norway | Stryn cliff-diving site, named lead | Oppstrynsvatnet / Lovatnet, REVIEW | Oppstrynsvatnet / Lovatnet, REVIEW | Useful |
| R08 | Moku Nui / Queen's Bath | Queen's Bath on Moku Nui, REVIEW | Moku Nui / Queen's Bath, REVIEW | Moku Nui / Queen's Bath, REVIEW | Useful |
| Paradise V05 | Paradise Dynasty | Paradise Dynasty South Coast Plaza, REVIEW | Paradise Dynasty, REVIEW | Paradise Dynasty, REVIEW | Useful |

All 18 counted rows had one Sol boundary, correct geography, no generic “Cliff Jumping” save, no parent substitution, and no restaurant contamination in R08.

## J. Reliability gate

- Priority Batch A: **9/9** (`live-priority-batch-a-counted.json`)
- Priority Batch B: **9/9** (`live-priority-batch-b-counted.json`)
- Required: 9/9 + 9/9 on one manifest.
- Wrong autosaves: 0 + 0.
- Missing Sol boundaries / machine-cache fast paths: 0 + 0.
- Result: **PASS**.

## K. C07

- Sol: San Diego Zoo.
- Final: `candidate_confirmation`, REVIEW.
- Autosave: NO.
- Useful: YES.
- Places: 1.
- Token: consumed for the useful result.
- Phase 5 artifact: `live-c07-phase5.json`.

## L. Places

Across the 18 counted priority requests:

- Mean: 2.28.
- Median: 2.
- P95: 3.
- Max: 3.
- Previous live: 1.53 mean.
- The mean increased by 0.75 requests/video but remains far below the old 7.60 architecture and preserves the minimal 1–3-call observed path.

## M. Token behavior

- Reserve: PASS — one reservation for every explicit Premium request.
- Consume: PASS — all 18 counted actionable priority results and final C07 consumed one token each.
- Release: PASS — observed on the pre-fix C07 acquisition failure and on no-result controls; working semantics were not changed.
- Duplicates: PASS — concurrent duplicate tap produced one reservation in every proof run.
- Regression: NO.
- Token-pack sizing migration `20260905000002` was preserved. The proof harness tops up using multiple DEV mock purchases without changing pricing or schema.

## N. Latency

Across the 18 counted priority requests:

| Stage | Mean | Median | P95 | Max |
|---|---:|---:|---:|---:|
| Evidence prep | 12.26 s | 12.69 s | 15.17 s | 15.17 s |
| Sol | 30.44 s | 21.21 s | 88.37 s | 88.37 s |
| Canonicalization | 0.49 s | 0.52 s | 0.80 s | 0.80 s |
| After evidence ready | 30.93 s | 21.79 s | 89.01 s | 89.01 s |
| Request wall clock, including queue | 129.61 s | 133.01 s | 258.31 s | 258.31 s |

C07: 10.11 s evidence prep, 4.57 s Sol, 0.24 s Places, 4.81 s after evidence ready. No 120-second orchestration loop was added; wall-clock tails reflect queued concurrent batch work.

## O. Cost

- Counted priority Sol cost: $0.808479 total, $0.044916 mean/request.
- Final C07 Sol cost: $0.010968.
- No extra model calls were added. Priority frame budget, model, reasoning, and request shape are unchanged.
- C07 adds only bounded public oEmbed/thumbnail retrieval plus local ffmpeg rendering before the same one-call Sol path.

## P. Tests

| Command | Result |
|---|---|
| `npm run typecheck` | PASS |
| `npm run test:premium-live-parity` | PASS — 37/37 |
| `npm run test:premium-sol-recognition` | PASS — 46/46 |
| `npm run test:sol-parity-harness` | PASS — 9/9 |
| `npm run test:premium-request-monetization` | PASS — 91 cases |
| `npm run test:media-finalize` | PASS |
| `npm run test:media-reliability` | PASS |
| `npm run test:share-job-result` | PASS |
| `npm run test:share-completion` | PASS |
| Worker typecheck | PASS |
| Worker full tests | PASS — 537 passed, 7 live-only skipped, 0 failed |
| Worker build | PASS |
| `deno check --no-config supabase/functions/process-share-jobs/index.ts` | PASS |
| `npm run test:startup-smoke` | PASS — 17/17 |
| `npm run test:release-gate` | PASS |
| `npm run test:deployment-guards` | PASS |
| `git diff --check` | PASS |

One early PowerShell `&&` composition and one ad-hoc `npm exec` path invocation were shell-command errors; each underlying command was rerun directly and passed. No required gate was waived.

## Q. Dev manifest

- Runtime candidate Git: `d618b9047ca6b612b44cf511725d44c3bc8f6a80`.
- Proof harness Git: `f3853fc7556a58fcbe6941cfd26f0fa94b2351e4`.
- Railway deployment: `fb400076-7d96-4a9e-9a9e-f22278625c2e`, SUCCESS.
- Railway image: `sha256:13db7f951ac15f6377d68f659c2857f08cadfac656c898ba70c478a5227d589e`.
- Edge `process-share-jobs`: v98, `f380d18f1e56d2fb83e792add3caf1f0f17472e831bb6226340491f680dfd45a`.
- Edge `monetization`: v30, `f795e67919f8f2f121798730ead638cae610c718aa19fddc6b40951f2aa57617`.
- Remote schema head: `20260905000002`.
- Prompt: `sol-parity-natural-v1`.
- Fingerprint: `premium-inference-fingerprint.v1`.
- Evidence: `premium-evidence-2026-09-05.v1`.
- Engine: `simple-sol-premium.v2`.
- Safety: `premium-recognition-safety.v2`.
- Token monetization: `premium-request-v2@20260905000002`.
- Environment unmixed through Batch A, Batch B, and Phase 5 C07: YES.

## R. Founder QA

**READY** — counted Batch A 9/9, immediately followed by counted Batch B 9/9 on the same deployed candidate, with final C07 useful and REVIEW-safe.

## S. Production

- Main merge: NO.
- Production Railway: NO mutation.
- Production Edge: NO mutation.
- Production database/migration: NO mutation.
- Production OTA/cache: NO mutation.

## T. Final verdict

SIMPLE SOL LIVE PARITY RELIABILITY PASSED — READY FOR FOUNDER DEV QA
