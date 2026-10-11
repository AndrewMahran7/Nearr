# Routing calibration — all text-first families rejected

2026-10-11. Fit: 112 development cases. Threshold selection: 34 separately grouped
calibration cases. The 62-case sealed holdout remains unused.

The early stage uses source text and retained transcript without frames or Deep.
Calibration has only three strictly correct autonomous early results, among thirteen
saves. No threshold can meet the preset minimum of five accepted cases, three
independent groups and 98% empirical precision. Empirical precision would not be a
population guarantee even if the selection requirement passed.

| Family | Fit | Calibration outcome | Early exits |
|---|---|---|---:|
| Rules | Fixed evidence vetoes and score | No admissible threshold | 0 |
| Calibrated score | Isotonic calibration | No admissible threshold | 0 |
| Small supervised | Regularized logistic classifier | No admissible threshold | 0 |
| Hybrid | Rules plus logistic classifier | No admissible threshold | 0 |

All eight development/calibration replay artifacts are immutable and bind their
policy, input inventory and parent inference receipts. Every selected policy
escalates every case. Correctness equals baseline, but sequential text-plus-baseline
tariff rises to $15.4448634 on development and $4.8026848 on calibration. Development
p90 rises to about 27.743 seconds. These policies are dominated and will not ship.

The unfiltered text-only lane was fast (development p90 2.719 seconds), but introduced
11 newly wrong or unverified confident outputs. Across 93 connected development
groups, the paired 95% interval for the wrong-confident-rate increase is approximately
3.42 to 15.38 percentage points. Speed cannot override that safety failure.

## Final sealed result — 2026-10-11

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.

The earlier pending statements above describe experiment chronology. The final architecture and deployment status are in `FINAL_RECOGNITION_ARCHITECTURE.md` and `DEVELOPMENT_INTEGRATION_REPORT.md`.
