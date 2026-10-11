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
