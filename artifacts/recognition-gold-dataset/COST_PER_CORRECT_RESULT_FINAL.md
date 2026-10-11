# Cost per correct result

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

| Split / policy | Total tariff cost range | Cost/submission | Cost/correct autonomous |
| --- | --- | --- | --- |
| development / baseline | $10.824126 | $0.096644 | $0.676508 |
| development / candidate | $8.814062 | $0.078697 | $0.550879 |
| calibration / baseline | $2.963290 | $0.087156 | $0.987763 |
| calibration / candidate | $2.391826 | $0.070348 | $0.797275 |
| held_out / baseline | $4.940729–$4.972729 | $0.079689–$0.080205 | $0.548970–$0.552525 |
| held_out / candidate | $4.459795–$4.491795 | $0.071932–$0.072448 | $0.495533–$0.499088 |

Primary held-out exact cost metrics are null because one request has unknown billing status. The supplementary analysis was frozen before scoring. In every group-bootstrap draw, it assigns baseline unknown cost zero and candidate unknown cost the full $0.032 maximum. These deliberately adverse bounds still exclude no improvement. They are not measured charges. The shared unknown request is identical in both arms; $0.480934 of fully measured later work is avoided. Accounting for that shared charge gives a point saving between 9.67% and 9.73%, but the reported interval uses the more conservative preregistered method.

Development cost-per-correct ratio: 0.81430, 95% CI [0.72307, 0.88401]. Calibration: 0.80715, [0.64685, 0.94001], with 9,543/10,000 defined ratio draws because only three correct autonomous results were observed. These were selection data; held-out evidence is reported separately.

Final physical experiment account: **$39.63596670 known tariff charges + $0.032 reserved unknown = $39.66796670 maximum exposure**, 1,758 dispatched requests. Remaining authorized exposure is $10.33203330. No credit/free-tier assumption, purchased plan, paid GPU or new storage charge is included. Candidate replays dispatch zero new requests. Baseline combination rows do not duplicate physical spend.

Cost/correct usable result equals cost/correct autonomous result under the scorer's observed terminal-result definition for these runs. Review-candidate recall is separate and is not counted as a delivered correct result. Cost per correct multi-place result is undefined because the winner has zero complete autonomous multi sets.

Timing starts with retained evidence and ends at authoritative server finalization planning. It excludes live media acquisition, fresh ASR, queueing, database writes and device delivery. Candidate replay retains the entire baseline latency plus measured local policy overhead; no skipped-work speedup is claimed. Costs are provider usage times frozen tariffs, not invoice totals. The one unknown fixed-price request remains unknown in primary metrics; ranges use its reserved $0.032 maximum.
