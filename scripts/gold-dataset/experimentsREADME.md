# Reproducible recognition experiments

`experiments.mjs` is a pure policy/statistics module. `experimentsCli.mjs` manages immutable local experiment artifacts. Neither dispatches providers or writes canonical datasets. The existing `services/media-worker/src/cli/recognitionGoldInference.ts` remains the live runner.

Run synthetic verification from the repository root:

```powershell
node --test scripts/gold-dataset/experiments.test.mjs
```

## Boundaries

1. Plan configurations and neutral inputs before inference. A plan emits runner argument arrays and hashes; it does not execute them.
2. Run inference through the existing runner with its budget ledger.
3. Freeze all four completed runtime files before any scoring process opens labels: `run.json`, `observations.jsonl`, `provider-ledger.jsonl`, and `completion.json`.
4. Score physically separate development/calibration shards. Fit on development only; select thresholds on calibration only.
5. Apply a frozen policy to frozen observations without label paths. Score its output in a separate invocation.
6. Held-out scoring stays with the existing seal/milestone CLI. Import its completed CSV report only for the single `baseline_v1` versus `final_candidate_v1` comparison.

Output files and directories use exclusive creation. A receipt binds all four runtime artifacts; later mutation fails verification. These are local integrity checks, not signatures or protection against a malicious filesystem administrator. Keep scored reports, models with training provenance, and group contexts private.

## Commands

Commands accept exactly the listed flags; neutral `plan`, `freeze`, and `apply` have no label-file argument. Paths below are placeholders.

```powershell
node scripts/gold-dataset/experimentsCli.mjs plan --spec private-plan-spec.json --out private-plan.json
node scripts/gold-dataset/experimentsCli.mjs freeze --run live-output --out frozen-output
node scripts/gold-dataset/experimentsCli.mjs score --frozen frozen-output --split development --view full --manifest dev-manifest.jsonl --labels dev-labels.jsonl --splits dev-splits.json --out dev-scores.json
node scripts/gold-dataset/experimentsCli.mjs fit --scores dev-scores.json --frozen frozen-output --options fit-options.json --out fitted-model.json
node scripts/gold-dataset/experimentsCli.mjs calibrate --model fitted-model.json --scores cal-scores.json --frozen cal-frozen --options calibration-options.json --out frozen-policy.json
node scripts/gold-dataset/experimentsCli.mjs apply --policy frozen-policy.json --early cal-frozen --escalated cal-deep-frozen --accounting sequential_incremental --out routed-frozen
node scripts/gold-dataset/experimentsCli.mjs compare --baseline baseline-scores.json --candidates candidate-reports.json --options bootstrap-options.json --out comparison.json
```

`candidate-reports.json` maps distinct arm names to private score reports. `baseline` is reserved. Comparison requires the same split, view, dataset hash, input contents, case cohort, and full group context.

A plan specification has this shape:

```json
{
  "version": 1,
  "experiment_id": "development_v1",
  "jobs": [{
    "arm_id": "early_model",
    "stage": "early",
    "split": "development",
    "view": "full",
    "inputs": "neutral-input-path-array.json",
    "configuration": "existing-runner-config.json",
    "output": "new-live-output-directory"
  }]
}
```

Each input path points to an existing neutral `input.json`; the input array and configurations use the existing runner format. `stage` is `early`, `escalated`, or `baseline`. Held-out jobs additionally require a planned `milestone` of `baseline_v1` or `final_candidate_v1`. A plan does not replace the existing materialization/seal gate or automatically rerun validation immediately before a manually dispatched command.

## Four routing families

All families choose an **existing completed autonomous early result** or the recorded escalation result. They never promote review candidates into autonomous places. They share geography, prior-only identity, and unresolved-set vetoes by default.

| Family | Early score | Selection |
| --- | --- | --- |
| `rules` | Minimum recorded identity confidence | Configured evidence rules and calibrated threshold |
| `calibrated` | Group-weighted isotonic calibration of confidence | Calibrated threshold |
| `small_supervised` | Deterministic ridge logistic regression | Calibrated threshold |
| `hybrid` | The same logistic model | Configured evidence rules and calibrated threshold |

The fixed scalar feature allowlist includes confidence/missingness, exact-evidence strength, conflict/prior flags, candidate/place counts, multi detection, and unresolved/failure flags. Names, coordinates, case IDs, source IDs, expected places, and gold labels are never model features. Training labels describe correctness of the **early stage only**. An escalation's success does not become the early-stage training target.

Example fit options:

```json
{
  "family": "hybrid",
  "epochs": 600,
  "learningRate": 0.2,
  "l2": 0.02,
  "rules": {
    "minimumConfidence": 0.8,
    "requireExactSupport": true,
    "rejectGeographyConflict": true,
    "rejectModelPrior": true,
    "requireCompleteSet": true
  }
}
```

Logistic training gives each connected source/place group equal total weight. Development/calibration overlap is rejected using both connected group IDs and hashed source/place tokens, including unselected bridge cases in the shard context. No randomized train/test subdivision is performed.

Example calibration options:

```json
{"minimumPrecision": 0.98, "minimumAccepted": 5, "minimumGroups": 3}
```

Threshold selection maximizes early coverage under those empirical constraints. No qualifying threshold means escalate every case. Calibration selection statistics are not a population precision guarantee. Fit refuses a development shard with no adjudicable early autonomous examples. Freeze family, features, rules, fitting/calibration options, and bootstrap options before held-out inference.

## Two-stage accounting

`sequential_incremental` adds early and escalation costs and elapsed times only when escalation is used. This includes failed early requests. Each stage must represent its own incremental physical work. Early acceptance excludes unused escalation charges from the counterfactual policy estimate; both original run ledgers remain retained as actual experimental spending.

`cumulative_including_early` is only for a deep observation whose measured totals already include that exact early run. It requires:

```json
{"stage_accounting":{"kind":"cumulative_including_early","includes_early_observation_sha256":"SHA256_OF_JSON_STRINGIFY_EARLY_OBSERVATION"}}
```

In cumulative mode the deep total is used once. Matching opaque input IDs, views, and input-content hashes are required in either mode. Missing escalation stays `failed`, with `multi_place_detected: null`, empty predictions, and the early cost retained. It is not imputed as a successful deep answer. Unknown ledger costs or elapsed times stay unknown. Local router computation time is measured and added separately.

Offline replay is a selected-stage counterfactual, not an end-to-end online latency experiment: acquisition, queueing, shared batching, and caches outside the retained runner boundary are not measured. The observation records this limit. Keep actual acquisition spend separate from policy cost estimates.

## Paired statistics

The primary sampling unit is the connected component of **both source and exact-place group links**, including transitive bridge cases outside the scored view. Resample complete components with replacement, using the same draw for both arms. Metrics remain case-weighted. Default options are:

```json
{"iterations": 2000, "seed": "paired-v1", "confidence": 0.95}
```

Reports include correct autonomous resolution, coverage/precision, wrong-confident and failure rates, all-submission cost, cost per correct autonomous result, and latency percentiles. They include paired candidate-minus-baseline intervals, paired latency/cost ratios, newly wrong-confident cases, repaired wrong-confident cases, multi regressions, and exact autonomous-output signatures. Failed submissions remain in their eligible denominators. Unknown costs/latencies invalidate the corresponding full-cohort estimate and interval rather than silently dropping cases.

Intervals with fewer than two groups are unavailable. Fewer than 20 groups trigger a warning. Draws with undefined denominators are excluded and their valid-draw counts are reported. A zero observed wrong-confident count does not establish near-perfect population precision. Development/calibration intervals after selection are descriptive. The point-estimate Pareto set uses accuracy, wrong-confidence, mean cost, and p95 latency; it does not assert statistical superiority or automatically select a winner. Apply the separately frozen preregistration criteria.

## Importing an existing held-out milestone

This command opens no manifest or label file and never calls the scorer. It verifies the existing marker filename via `heldoutRunKey`, the seal binding, matching observation hash, freeze-before-score time, summary/CSV consistency, and per-case observation identity. It follows the summary's existing `per_case_private_path`.

```powershell
node scripts/gold-dataset/experimentsCli.mjs import-milestone --frozen held-frozen --summary existing-held-summary.json --marker existing-heldout-run-marker.json --seal existing-seal.json --groups coordinator-group-context.json --out imported-held-scores.json
```

The coordinator supplies this **label-free** context, preserving all bridge cases:

```json
{
  "version": 1,
  "seal_sha256": "SHA256_OF_EXISTING_SEAL_FILE",
  "group_universe": [{
    "case_id": "g_0123456789abcdef",
    "source_group_id": "sg_0123456789abcdef",
    "place_group_ids": ["pg_0123456789abcdef"],
    "split": "held_out"
  }]
}
```

Only the opaque fields shown are accepted. The context can include development/calibration rows to retain global connectivity; cross-split components are rejected. Its provenance is coordinator-trusted and its hash is retained. The import does not re-adjudicate identities or authenticate a forged trusted-scorer export. Held-out comparison permits exactly one imported `baseline_v1` arm versus one imported `final_candidate_v1` from the same seal. Do not use individual held-out failures to tune the same experiment generation.
