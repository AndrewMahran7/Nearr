# Repaired recognition baseline and evaluation boundary

**BASELINE_REPAIRED is the repaired Development behavior, including failed-job recovery and invalid-frame-hash repairs, plus conservative multi-place completeness protection.** Production's permissive historical finalizer is not the optimization comparator.

The immutable first replay is [runs/baseline_repaired/baseline_results.csv](runs/baseline_repaired/baseline_results.csv), with [source/hash manifest](runs/baseline_repaired/run.json), [all observations](runs/baseline_repaired/observations), and [summary](runs/baseline_repaired/summary.json). Source SHA at capture is `ca81374` (the manifest records the full SHA and imported algorithm file hashes). Its ancestors contain the safety commits corresponding to `67ec588`, `bc87b0d` and `de2ab86`. Frozen success criteria are in `SUCCESS_GATES.md` in the integration branch.

## What actually executes

The no-network adapter reuses paired historical raw Sol calls and typed runtime evidence. It executes current `canonicalizePremiumHypothesis` only where every logged provider result ID has its full stored object. Incomplete response sets keep their explicitly retained canonicalization output; they are not fabricated into complete provider responses. It then executes current `evaluatePremiumRecognitionSafety`, `applyAutomaticDeepReviewPolicy`, and `planAutomaticCompletion`.

This is a **conditional replay after deep escalation**. The cheap model's decision to escalate, original captions/transcript strings, acquisition, frames, actual provider latency, source-geography extraction, database transaction, saved-place integration and client presentation are outside its scope. Complete source text cannot be reconstructed from hashes. The adapter does not inject a place name as synthetic source evidence or call a paid model.

## First frozen result

| Measure | BASELINE_REPAIRED conditional replay |
|---|---:|
| Real source cases | 31 |
| Verified exact-label cases | 15 |
| Unverified, excluded from exact-place accuracy | 16 |
| Ordinary post-deep review results | 31/31 |
| Autosaves | 0/31 |
| Correct autonomous results, conditional cohort | 0/15 |
| Autonomous precision | Undefined: 0 autonomous outputs |
| Strict accepted-alias/locality top-1 matches | 9/15 |
| Additional naming inconclusives | 5/15 |
| Established physical branch conflict | 1/15, returned for review |
| Executed complete stored Places response lookups | 33 |
| Actual external paid provider requests | 0 |

The automatic-deep wrapper intentionally preserves review even when the inner premium engine would authorize saving. The inner policy produced eight AUTO_SAVE decisions, but none became an ordinary automatic result. The 0/15 conditional rate is **not** Nearr's overall autonomous resolution rate: metadata and cheap paths are absent by selection. Review prevents a wrong autosave but cannot count as an accuracy improvement through abstention.

The five alias mismatches are disclosed in the [dataset card](RECOGNITION_DATASET_CARD.md). The 9/15 result is a lower-bound strict name/locality matching score, not proof that six venues were wrong. There is no fresh model benchmark or held-out generalization estimate.

Local policy time was n31: p50 **0.1883 ms**, p75 **0.3644 ms**, p90 **0.8642 ms**, p95 **1.6039 ms**. These tiny CPU measurements exclude paid/acquisition work and include warm-up/order noise; they cannot establish a meaningful end-to-end speedup. Correct autonomous latency is undefined because no autonomous result occurred. Historical source latency is retained separately per observation and is never added to local replay spans.

Local paid replay spend is **$0.00**. This does not imply zero variable recognition cost. Historical model usage, Places calls and unknown acquisition/ASR costs belong to a different ledger and are not charged again or treated as current measured spend. Cost per correct autonomous result is undefined here.

## Reproducible commands

Run from the repository root after worker dependencies are installed:

```powershell
npm run test:recognition-evaluation
npm run eval:recognition -- --variant baseline_repaired
npm run eval:recognition -- --variant winner --compare artifacts/recognition-optimization-2026-10-08/runs/baseline_repaired/scores.json
```

The committed baseline already exists, so the second command intentionally rejects overwriting it. To make an explicit new local repetition, supply a distinct `--out` directory and preserve the original. Inputs/labels are hash-checked; observations persist before labels are parsed. The runner blocks network entry points, removes credential environment variables and supports audited local adapters only. It is not a sandbox for untrusted plugins. No runtime save, notification, token, database or cache writer is imported by the adapter.

The scorer computes numerator/denominator and Wilson intervals; paired source-group bootstrap; single exact matching and candidate recall; complete-set multi metrics; wrong-region/country errors only for adjudicated labels; coverage/precision separately; missing timing and cost as null; and incomparable-boundary rejection in Pareto comparisons. Unit tests cover wrong branches, negatives lowering precision, complete multi sets, failed confidence, leakage, immutable output, missing costs, alias assignment and unknown geography.

The higher-level winner must also preserve the executable safety controls and media/Places parity experiments. Those stage measurements can select a safe local implementation without pretending this policy replay measures all-user recognition accuracy.

## Final paired source-policy check

The final `winner` run at implementation SHA `7aa09f0f1bc6a738a3b83dd42c696ce40ce5d4a3` executed all 31 cases with no unavailable or invalid observations. All remained review; exact-label eligible cases stayed 15, strict top1 stayed 9/15, correct autonomous results stayed 0/15, and no decision changed. The paired correct-autonomous delta was zero across 13 independent eligible source groups. That describes this conditional cohort only; the degenerate bootstrap interval does not establish population equivalence.

Winner local policy timing was p50/p75/p90/p95 **0.491/0.709/1.242/2.096 ms**, versus baseline **0.188/0.364/0.864/1.604 ms** (n31 each). The winner check ran alongside integration verification. These sub-millisecond CPU differences are not a performance ablation; no speedup is claimed or hidden. Real queue, acquisition, ASR, model, Places transport, database and client durations remain outside this replay. No correct autonomous latency exists in either arm.

The aggregate `RECOGNITION_PER_CASE_RESULTS.csv` contains both arms (62 rows), including confidence, candidates, per-stage observations, usage availability and failure classes. The top-level `baseline_results.csv` is a byte-identical immutable convenience copy of the original. Evaluation hardening and the final run did not overwrite any original baseline artifact.
