# Frozen recognition optimization gates — generation 1

Frozen before optimization experiments on 2026-10-08. Starting source: `45cedb7fc3e5d391e68295f60e2e097640008faa`, descendant of repaired Development `d75177dd3c9e5011935a4f5209719f7d2947380f`. Safety repairs required by the gates form BASELINE_REPAIRED and are not counted as optimization gains. Changes to these criteria require a new experiment generation.

## Objective and scoring

Priority order: correct autonomous resolution, then time to a correct usable result, then variable cost per correct autonomous resolution. An autonomous single requires the verified exact venue/branch. An autonomous multi requires detection and the complete expected physical-place set at its declared granularity, no extras, and no user intervention. Review and failure never count as autonomous success. Saved status is not ground truth. Unverified cases never enter exact-place accuracy denominators.

Report correct autonomous submissions / all verifiable submissions, autonomous precision (correct / all autonomous adjudicable results), coverage, single exact top-1, candidate recall@1/@3/@5/@N before and after canonicalization, and multi detection/place precision/recall/F1/exact-set. Include changed-case wins and losses. Report autonomous place and submission precision separately when multi sets differ.

## Mandatory acceptance gates

1. Zero new known-regression autosaves, including Mallorca/Girona, Greece/Prada, upstream REVIEW, wrong branch, unsupported identity, corrections, and multi-place partial sets.
2. Preserve source geography and entity-role safeguards in every finalization path. Client-supplied confidence cannot grant authority.
3. Failed jobs cannot become confident results through recovery. Deterministic permanent failures do not retry indefinitely.
4. Obsolete attempts and responses cannot overwrite newer user/generation state in the paths changed here. Explicitly report transaction-boundary gaps that remain unproven.
5. Preserve review availability and multi-place behavior. More abstention is not an accuracy improvement; report baseline-correct-to-review transitions.
6. No lost frame evidence for a default media optimization: same requested timestamps, frames and selected set, or independent correctness evidence establishing non-regression. Hash failures cannot manufacture duplicate evidence. Reduced budgets remain experimental without multi and exact-place evidence.
7. New Places reuse is limited to identical request semantics within one job; keep geography/language/field masks/provider options in identity. Preserve result ordering, safety filters, errors, and actual-call accounting.
8. No real user saves, pushes, token mutation, Production cache writes, paid provider calls, or shared deployments from evaluation. Jev stays shadow.

## Statistical and provenance rules

Freeze source/label hashes and grouped splits before tuning. Historical outcomes already inspected belong to exposed development, even if a past report called them held out. No synthetic fixture is real-world ground truth. Do not invent unseen data, complete multi sets, null costs, or missing stage timings. Label replay, local deterministic control, media microbenchmark and fresh end-to-end inference separately.

Use paired cases, numerator/denominator, Wilson intervals for proportions, and paired source-group bootstrap intervals for timings where sample size permits. Publish n and p50/p75/p90/p95, critical-path wall time (not sums of concurrent spans), errors/missingness, CPU/resource measurements where available, and frozen random seed/order. Baseline outputs are write-once. A serious held-out flaw fails this generation; do not tune against those outcomes.

At equal or better correct autonomous resolution and precision, seek >=20% p90 latency reduction and/or >=10% lower cost per correct autonomous resolution. These are goals, not required claims. A local stage improvement cannot establish those end-to-end targets.

## Selection and stopping

Reject dominated or unsafe strategies. Among equally correct validated implementations choose faster, then cheaper. Keep dependencies only for the winner, or isolate unsupported prototypes to evaluation. Stop when credible remaining strategies require missing labels, rights, provider budget, or hardware. Publish exact limits and a bounded next experiment request. No approved paid budget exists at freeze time; maximum paid experiment spend for this generation is $0 until the user explicitly changes it.

## Development integration

Development process-share-jobs advanced to v142 during the audit. Start from its newest candidate source and preserve concurrent notification/client contracts. Recheck live identities before any proposed integration. Do not overwrite another agent's shared lane; commit/push the feature branch and report integration required. Production rollout is excluded.
