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

The first text-only stage is being evaluated across all 112 development cases with
visual frames omitted and Automatic Deep disabled. It receives original source text,
tags, geography and any legitimately retained transcript. Unknown cases stay unresolved.
This is an experimental early stage, not an approved complete replacement pipeline.

Scoring requires immutable inference artifacts before opening labels. Paired confidence
intervals resample connected source/place groups. The 62-case holdout is reserved for
one baseline and one frozen final candidate milestone, not repeated tuning.

No architecture has passed the preregistered safety and improvement gates yet.
