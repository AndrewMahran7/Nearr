# Multi-place backend — candidate under evaluation

The sealed dataset contains 36 complete multi-place videos: 24 development, four
calibration and eight held-out. Baseline development detects 21/24 but autonomously
resolves zero complete sets. Candidate recall and complete-set recovery are distinct
from detection.

A concrete normal-extraction defect appears in 20 development cases: 75 rejected
field values are invalid scene-change labels. Four calibration cases contain eight
such values. The prompt says to use allowed labels but does not enumerate them.
The isolated prompt amendment lists the actual runtime enum, leaves invalid outputs
rejected, and records a new prompt suffix. It does not relax parsing or invent labels.

The existing moment grouper retains temporal evidence and distinguishes repeated
views from separate destinations. The experimental frame selector preserves temporal
coverage using bounded probes and can allocate more frames to itineraries. Its first
pilot failed safety, so it is not part of the current combined candidate.

An opt-in atomic finalization policy requires every known destination to clear its
existing identity/geography gate. A partial or unresolved set stays in review, with
resolved candidates still available. It never grants a new autonomous identity.
Replay preserves all baseline autonomous results in both development and calibration.

The combined prompt and finalization candidate completed development and failed
safety, as detailed below. No segment-level accuracy or Development deployment is
claimed. Caption lists and scene changes alone remain insufficient proof that every
listed place is depicted.

## Full development result

The structural combination recovers one correct autonomous multi set, but newly saves four incorrect or incomplete multi sets. The atomic output guard cannot detect a missing scene that the model never emits, a broad site substituted for multiple monuments, or an overbroad district name substituted for a depicted building. These are evidence and granularity failures, not grounds to widen the evaluator. The candidate is rejected. The final cost-policy candidate retains the repaired baseline multi-place path unchanged. No segmentation or multi-place accuracy win is claimed.

## Final sealed result — 2026-10-11

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.

The earlier pending statements above describe experiment chronology. The final architecture and deployment status are in `FINAL_RECOGNITION_ARCHITECTURE.md` and `DEVELOPMENT_INTEGRATION_REPORT.md`.
