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
intervals resample connected source/place groups. The 62-case holdout is now running as
one baseline and one frozen final candidate milestone, with a shared immutable
first-pass prefix and label-free candidate replay. The full baseline time is retained
for the candidate, so only avoided provider cost is credited.

No architecture has passed the preregistered safety and improvement gates yet.
