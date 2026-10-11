# Adaptive router — experimental, not integrated

The intended cascade starts with available source text and independent candidate
verification, then escalates to timed visual evidence, optional OCR/ASR, and deep
analysis only when the earlier result cannot safely finish. Multi-place completeness,
entity role, geography and exact physical identity remain stop conditions.

Four implementations are available: deterministic rules, isotonic calibrated scores,
a small regularized logistic classifier and a hybrid. They consume an explicit scalar
feature allowlist. Training uses development groups; thresholds use calibration groups.
The model can choose an already completed autonomous result or escalate. It cannot
turn a review suggestion into an autonomous identity.

All families retain geography, model-prior and incomplete-set vetoes. A high confidence
value alone does not override them. Counterfactual routing accounts for both early
and escalated cost/latency unless a cumulative record proves that it already includes
the exact same early observation. Physical input and group identities must agree.

The text-only stage completed all 112 development and 34 calibration cases. It receives
original source text, tags, geography and any legitimately retained transcript, with
visual frames omitted and Automatic Deep disabled. Development produced 15 correct
autonomous results among 29 saves, versus the baseline's 16 among 20. It introduced
11 newly wrong or unverified confident outputs. Calibration produced only three
correct saves among 13. It is rejected as a complete replacement.

All four routers were fitted on development and calibrated independently. None met
the frozen requirement of at least five accepted examples across three groups with
98% empirical precision. Their safe selected policy exits early on zero cases and
therefore adds an unnecessary text pass. No acceptance requirement was lowered.
See [calibration results](ROUTING_CALIBRATION.md).

The structural combination completed 112 development cases. It improved correct
autonomous resolution from 16 to 21 cases and reached one complete autonomous multi
set, but introduced four new wrong or incomplete multi-place saves. It is rejected.
A complete emitted set is not proof that every depicted place was recovered.

The frozen final candidate keeps the original prompt and frame/model budgets. After
a fully valid empty first pass it returns review without Deep. Technical errors,
partial identities and multi-place intent retain recovery. A narrow finalizer veto
blocks a food venue being replaced by a nonfood parent. This preserves all 19 correct
autonomous development/calibration results and removes one actual parent error.
The discarded Deep suffix contains one correct development review candidate; that
loss is reported, not reclassified as a negative. The rule changes cost allocation
without claiming higher autonomous accuracy.

Scoring requires immutable inference artifacts before opening labels. Paired confidence
intervals resample connected source/place groups. The 62-case holdout completed as
one baseline and one frozen final candidate milestone, with a shared immutable
first-pass prefix and label-free candidate replay. The full baseline time is retained
for the candidate, so only avoided provider cost is credited.

The frozen empty-review plus parent-veto policy passed the relative cost and observed-safety gates. Absolute identity precision remains inadequate for broad production rollout.

## Final sealed result — 2026-10-11

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.

The earlier pending statements above describe experiment chronology. The final architecture and deployment status are in `FINAL_RECOGNITION_ARCHITECTURE.md` and `DEVELOPMENT_INTEGRATION_REPORT.md`.
