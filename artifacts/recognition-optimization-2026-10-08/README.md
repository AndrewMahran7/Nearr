# Recognition optimization handoff — October 8, 2026

**Selected:** repaired Development safety, identical-evidence batched frame hashing, bounded per-execution Places requests, and ordinary-recognition claim fences. Parallel preparation is implemented but disabled; OCR, retrieval and the new router remain evaluation/shadow-only. No deployment and $0.00 paid experiment spend.

The main result is a safe local engineering improvement with preserved sampled evidence, not demonstrated higher autonomous recognition accuracy. Held-out frame-stage p90 fell 28.2% on four sources, while calibration p95 worsened 7.6%. The paired conditional post-deep replay kept all 31 cases in review, with 9/15 strict top1 name/locality matches and zero autonomous results in both arms. There are no verified real multi-place sets and no new recognition holdout. End-to-end speed and cost-per-correct-autonomous improvements remain unproven.

## Decision and evidence

- [Winning architecture](WINNING_RECOGNITION_ARCHITECTURE.md), [frontier](RECOGNITION_PARETO_FRONTIER.md), [35-row experiment matrix](RECOGNITION_EXPERIMENT_MATRIX.csv), [rejections](REJECTED_EXPERIMENTS.md).
- [Frozen gates](SUCCESS_GATES.md), [dataset card](RECOGNITION_DATASET_CARD.md), [repaired baseline and paired results](RECOGNITION_OPTIMIZATION_BASELINE.md), [immutable baseline CSV](baseline_results.csv), [62 per-case rows](RECOGNITION_PER_CASE_RESULTS.csv).
- [Safety semantic diff](SAFETY_SEMANTIC_DIFF.md), [multi-place evaluation](MULTI_PLACE_EVALUATION.md), [routing](ROUTING_EXPERIMENT.md), [evaluation review](EVALUATION_REVIEW.md).
- [Media](MEDIA_PIPELINE_BENCHMARK.md), [ASR](ASR_EXPERIMENT.md), [OCR](OCR_EXPERIMENT.md), [Places and candidate recall](PLACES_QUERY_EXPERIMENT.md), [retrieval and geometry](RETRIEVAL_EXPERIMENT.md), [evidence cache](EVIDENCE_CACHE_EXPERIMENT.md).
- [Cost and bounded $50 proposal](COST_PER_CORRECT_RESULT.md), [682-row usage ledger](provider_usage_ledger.csv).
- [Tests and inherited failures](TEST_RESULTS.md), [source/deployment provenance](PROVENANCE.md), [founder QA and ground-truth plan](FOUNDER_QA_PLAN.md).

The full worker suite passes 697 tests with seven opt-in skips; typecheck, build, prebuild and 23 targeted extra suites pass. The broader inventory also ran 85 additional commands: 74 pass and 11 fail identically on the starting commit. The repository is not globally green. The failures were not hidden or weakened. Docker/hosted concurrency, supplemental completed-parent atomicity and the pre-existing callback billing retry gap remain disclosed limits.

Implementation at final paired replay: `7aa09f0f1bc6a738a3b83dd42c696ce40ce5d4a3`; later commits add handoff evidence. Branch: `feat/recognition-pareto-optimization`. Resolve the final report commit with `git rev-parse HEAD` or the chat handoff. Development integration remains required; Production is untouched.

Next step: **collect better ground truth**, especially independently verified real multi-place posts and sealed source/place groups. Do not begin Production rollout.
