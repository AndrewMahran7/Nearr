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
