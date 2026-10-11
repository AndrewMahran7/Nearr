# Latency and economics by exclusive route

| Split | Exclusive tier | Cases | Correct autonomous | Precision | Coverage | p50/p75/p90/p95 seconds | Cost/submission |
| --- | --- | --- | --- | --- | --- | --- | --- |
| development | normal_visual_places | 45 (40.18%) | 16/45 (35.56%) | 16/19 (84.21%) | 19/45 (42.22%) | 5.096 / 5.925 / 7.472 / 10.503 | $0.075795 |
| development | deep_review | 33 (29.46%) | 0/32 (0.00%) | 0/0 (n/a) | 0/32 (0.00%) | 18.812 / 26.384 / 39.448 / 43.218 | $0.161589 |
| development | empty_review | 34 (30.36%) | 0/1 (0.00%) | 0/0 (n/a) | 0/1 (0.00%) | 6.227 / 7.141 / 7.765 / 10.739 | $0.002084 |
| calibration | normal_visual_places | 17 (50.00%) | 3/16 (18.75%) | 3/7 (42.86%) | 7/16 (43.75%) | 9.039 / 10.816 / 11.523 / 15.430 | $0.069253 |
| calibration | deep_review | 11 (32.35%) | 0/10 (0.00%) | 0/0 (n/a) | 0/10 (0.00%) | 18.804 / 21.217 / 25.458 / 27.332 | $0.109030 |
| calibration | empty_review | 6 (17.65%) | 0/0 (n/a) | 0/0 (n/a) | 0/0 (n/a) | 11.244 / 11.658 / 13.690 / 14.666 | $0.002533 |
| held_out | normal_visual_places | 41 (66.13%) | 9/41 (21.95%) | 9/17 (52.94%) | 17/41 (41.46%) | 7.163 / 8.571 / 9.534 / 9.821 | $0.072758–$0.073538 |
| held_out | deep_review | 15 (24.19%) | 0/15 (0.00%) | 0/0 (n/a) | 0/15 (0.00%) | 16.407 / 19.912 / 21.965 / 27.398 | $0.096632 |
| held_out | empty_review | 6 (9.68%) | 0/0 (n/a) | 0/0 (n/a) | 0/0 (n/a) | 10.747 / 12.360 / 12.927 / 13.076 | $0.004543 |

Normal visual/Places includes weak or failed normal-resolution attempts that did not reach Deep; it is not a ground-truth easy-case class. Deep review includes weak named evidence, partial/multi intent and recovery. Empty review requires fully valid empty normal evidence and no partial or multi intent.

Held-out submitted latency is 8.610 / 11.871 / 16.444 / 20.868 seconds at p50/p75/p90/p95. On the 9 correct autonomous results it is approximately 6.65 seconds p50 and 8.34 seconds p90. The 6 empty-review cases retain full old-run latency in this table, even though their later requests are removed from the cost calculation. Do not interpret that conservative replay value as measured live early-review latency.

Timing starts with retained evidence and ends at authoritative server finalization planning. It excludes live media acquisition, fresh ASR, queueing, database writes and device delivery. Candidate replay retains the entire baseline latency plus measured local policy overhead; no skipped-work speedup is claimed. Costs are provider usage times frozen tariffs, not invoice totals. The one unknown fixed-price request remains unknown in primary metrics; ranges use its reserved $0.032 maximum.
