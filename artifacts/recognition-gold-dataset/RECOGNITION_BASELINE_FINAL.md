# Repaired baseline and sealed comparison

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

| Split / policy | Correct autonomous / exact-positive | Precision | Coverage / exact-positive | Wrong confident / submissions | Review / failed | p50 / p90 seconds | Cost / correct autonomous |
| --- | --- | --- | --- | --- | --- | --- | --- |
| development / baseline | 16/78 (20.51%) | 16/20 (80.00%) | 20/78 (25.64%) | 4/112 (3.57%) | 59 / 33 | 6.637 / 25.128 | $0.676508 |
| development / candidate | 16/78 (20.51%) | 16/19 (84.21%) | 19/78 (24.36%) | 3/112 (2.68%) | 92 / 1 | 6.638 / 25.128 | $0.550879 |
| calibration / baseline | 3/26 (11.54%) | 3/7 (42.86%) | 7/26 (26.92%) | 4/34 (11.76%) | 21 / 6 | 11.224 / 21.228 | $0.987763 |
| calibration / candidate | 3/26 (11.54%) | 3/7 (42.86%) | 7/26 (26.92%) | 4/34 (11.76%) | 27 / 0 | 11.225 / 21.228 | $0.797275 |
| held_out / baseline | 9/56 (16.07%) | 9/17 (52.94%) | 17/56 (30.36%) | 8/62 (12.90%) | 38 / 7 | 8.610 / 16.444 | $0.548970–$0.552525 |
| held_out / candidate | 9/56 (16.07%) | 9/17 (52.94%) | 17/56 (30.36%) | 8/62 (12.90%) | 44 / 1 | 8.610 / 16.444 | $0.495533–$0.499088 |

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.

Held-out single-place exact top-1 is 17/48. Complete retained-candidate recall is 17/56 at top 1 and 18/56 at top 3, 5 and N, unchanged by the final policy. These are retained rankings, not a claim about every provider result before filtering. Development provider-pool auditing found no additional complete correct set absent from the retained rankings within its available trace subset.

Timing starts with retained evidence and ends at authoritative server finalization planning. It excludes live media acquisition, fresh ASR, queueing, database writes and device delivery. Candidate replay retains the entire baseline latency plus measured local policy overhead; no skipped-work speedup is claimed. Costs are provider usage times frozen tariffs, not invoice totals. The one unknown fixed-price request remains unknown in primary metrics; ranges use its reserved $0.032 maximum.

Both runs were frozen before either score. One Google response timeout stopped the first batch. The failed attempted case remains failed; only 52 cases with zero dispatched requests resumed under the original total reservation. No score or held-out identity was opened to select those cases. Exactly one immutable baseline_v1 and final_candidate_v1 score exists; the initial partial attempt was never scored.

Detailed aggregate results and receipt hashes: `FINAL_AGGREGATE_METRICS.json`. Public pseudonymous per-case scores: `RECOGNITION_PER_CASE_FINAL.csv`; private identities and crosswalk stay outside Git.
