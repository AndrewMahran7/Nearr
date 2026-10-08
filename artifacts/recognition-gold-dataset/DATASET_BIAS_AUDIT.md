# Bias and readiness audit

This is an inventory-biased **candidate** corpus. It must not be advertised as a representative gold benchmark or used to choose recognition models.

| Dimension | Current evidence | Consequence |
| --- | --- | --- |
| Source history | 105/124 posts have historically exposed outcomes; 103 source rows lack fresh public-access confirmation. | Historical rows are development-only; sampling them as holdout would leak prior outcomes. |
| Platform | Instagram 108, YouTube 11, TikTok 2, Facebook 2, other 1. | Instagram is 87% of the inventory; cross-platform conclusions would be weak. |
| Geography | Only 30 rows have a country from source research or accepted draft label (US 13, Spain 7, Costa Rica 4, Japan 3, France/Indonesia/Jordan 1 each). | Geography is unknown for 94; country coverage is sparse and uneven. |
| Category | Candidate tags include natural 48, cliff 40, restaurant 30, business 30, beach 7, waterfall 5, hike 2. Tags overlap and many derive from old source metadata. | Outdoor, food, and branch targets are not met as verified, runnable slices; hotels/nightlife are absent. |
| Hard cases | Six multi-place candidates, four misleading/nearby-confusion candidates, three candidate negatives, four branch candidates. | Complete multi sets, strong misleading cases, and broad negatives are absent. |
| Evidence | Full/description-hidden/location-hidden/visual-only each 0; text-only 38. | No visual recognition or description-ablation result can yet be measured. |
| Split | Development 124; calibration 0; held-out 0. | No threshold tuning or sealed evaluation is authorized by this dataset. |

Some public-source titles plainly name famous places. Those help discover and verify candidates but will inflate an unmasked text-only impression. The requested visual test requires retained rights-permitted frames, complete answer-bearing text/overlay review, and paired evidence views. The next collection should deliberately fill verified multi-place, generic negative, misleading-metadata, branch, and non-Instagram/geographic slices before freezing any split. Even the 19 provisional exact-single labels are on `candidate` records, not runnable gold cases.
