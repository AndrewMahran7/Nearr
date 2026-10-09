# Dataset completion gate

**NOT READY FOR OPTIMIZATION. Snapshot 2026-10-09T21:14:03.025Z.** 109 HIGH-confidence accepted cases out of 207 distinct posts; 196 have complete-timeline visual inspection. No baseline, calibration run, holdout seal or recognition optimization was performed.

| Gate | Current | Minimum | Remaining |
| --- | --- | --- | --- |
| ready | 109 | 200 | 91 |
| complete_multi | 15 | 30 | 15 |
| outdoor | 31 | 50 | 19 |
| description_hidden | 109 | 50 | 0 |
| strong_visual_only | 22 | 30 | 8 |
| misleading_metadata | 8 | 25 | 17 |
| branch_disambiguation | 11 | 25 | 14 |
| verified_negative | 39 | 25 | 0 |
| sealed holdout cases | 0 | 60 | 60 |
| sealed source/place groups | 0 | 60 | 60 |
| description-revealed inventory | 62 | 75 | 13 |
| description-revealed READY | 55 | 50 | 0 |

Counts overlap: one new qualified case can close several gaps. Meeting the total alone does not satisfy the other gates. The 60-case and 60-group holdout deficits are both outstanding, not 120 extra required cases. Only 16 current accepted cases pass preliminary unsealed holdout eligibility; source/place grouping, near-duplicate review, balanced composition and private source exposure still need final audit. All current assignments remain development; calibration and sealed holdout are zero. No seen/unseen holdout claim can be made.

Platform inventory: youtube: 71, instagram: 126, facebook: 2, tiktok: 7, other: 1. Accepted platform mix: youtube: 49, instagram: 52, facebook: 2, tiktok: 6. YouTube exceeds 20 accepted; TikTok still needs 14 to reach 20 accepted and Facebook 8 to reach 10 accepted, if access permits. These platform aspirations do not justify weaker truth. Instagram is the largest source inventory, but the accepted set's platform balance must be read separately.

The original 124-row `dataset_manifest.jsonl` and its split file remain the preserved source-history inventory. The current runnable corpus is the ignored `.local/recognition-gold-dataset/benchmark_manifest_private.jsonl`, `benchmark_labels_private.jsonl`, and `benchmark_splits_private.json`. These include full source evidence and private truth; do not commit them. A recovery copy and all collection overlays live in the external private evaluation folder.

All metric cells remain **not run**, including exact top-1, correct autonomous, precision, review rate, wrong-confident rate, candidate recall, multi detection, place precision/recall/F1, exact-set accuracy, extra/missed places and autonomous exact-set resolution. Next work should fill difficult outdoor, complete multi, misleading and exact-branch slices, then independently freeze development/calibration/holdout. Do not use these development examples to claim unbiased model improvement.

Original 124-source status reconciliation: READY: 49, INSUFFICIENT_EVIDENCE: 58, NEEDS_REVIEW: 7, AMBIGUOUS: 6, SOURCE_UNAVAILABLE: 3, READY_NEGATIVE: 1. No original source row was discarded. Two previously deduplicated capture packets were reattached to their original canonical IDs, without adding posts or promoting labels.
