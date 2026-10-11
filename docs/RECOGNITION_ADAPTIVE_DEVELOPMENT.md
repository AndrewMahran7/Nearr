# Adaptive recognition: isolated Development candidate

Base: `6cb3084d4bea4357610a028e613db41fdf99a3b7`, the repaired recognition baseline used by the sealed gold evaluation. This branch does not represent the current shared Development tip and must not replace it directly.

The patch contains two optional changes: return review before Deep after fully valid empty normal evidence; veto legacy food evidence resolving to an exclusively nonfood parent. It preserves source, schema, geography, multi-place and authoritative autosave gates. No model prompt, frame schedule, ASR, OCR, retrieval, database schema or client code changes are included.

Both switches default to false:

| Component | Development switch |
| --- | --- |
| Media worker | `ADAPTIVE_EMPTY_EVIDENCE_REVIEW_ENABLED=true` |
| process-share-jobs Edge function | `ADAPTIVE_LEGACY_PARENT_CATEGORY_VETO_ENABLED=true` |

The worker switch acts only when automatic Deep recognition is enabled. Returning empty review does not authorize a save or declare a source to be a negative. Invalid/partial/multi output and real source failures retain their previous paths. Disabling the switches restores the baseline policies.

The preregistered paired held-out comparison has 62 cases / 60 independent groups. Correct autonomous outcomes remain 9/56, precision 9/17 and exact-positive coverage 17/56. The conservative cost ratio is 0.909136 (95% group-bootstrap interval 0.825217–0.978259). Primary exact costs remain unknown because one fixed-price provider response timed out; its full $0.032 exposure is reserved. Candidate request usage comes from label-free common-prefix replay. No live speedup or high population precision is established. Complete autonomous multi sets remain 0/8.

Validation: 703 worker tests passed, 7 gated live/local-database tests skipped; 79 focused adaptive tests passed after fixture type fixes; strict worker typecheck, worker build and app typecheck passed. A 320-case synthetic differential comparison of the actual inline Edge block against the frozen evaluation planner passed with flags on and off. Of 55 broader backend/configuration regression scripts, 51 passed. Four failures reproduced on the untouched base: development env-file fixture expectations, missing removed monetization screen, missing live share-regression environment, and an existing same-place-moment geography assertion. The full repository regression is therefore not green; no new failure was introduced by this patch in those checks.

No deployment has been performed. The shared Development worker's deployment metadata does not attest a commit, and the current shared Git branch has diverged. Reconcile the live worker and Edge source with the concurrent Development owner, apply this small patch to that verified branch, rerun its checks and then deploy only to Development. No database migration is required. Keep existing controlled access to autosave; observed precision is too low to justify broad rollout.

Production readiness still requires a cross-worker/Edge per-job monetary cap with durable retry accounting, live acquisition-to-finalization timing, a fresh independently adjudicated dataset generation for identity/multi weaknesses, and physical iPhone QA. Existing bounds are 180-second source duration, 24 selected frames, two Deep attempts and 480-second job wall time. The research $50 batch guard is not a deployed per-job monetary guard.

Full dataset, experiment history and final reports are on `audit/recognition-gold-dataset`, under `artifacts/recognition-gold-dataset`. Private labels and source media are not part of this patch. Production and Nearr 1.5 are untouched.
