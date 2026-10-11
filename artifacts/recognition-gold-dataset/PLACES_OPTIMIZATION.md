# Places optimization

Status: development/calibration diagnostics and isolated ablations complete; no new retrieval strategy approved for integration. Heldout inference has not run.

| Repaired baseline | Development (112) | Calibration (34) |
|---|---:|---:|
| Text search requests | 202 | 58 |
| Text search cost | $6.464 | $1.856 |
| Geocoding requests | 27 | 0 |
| Geocoding cost | $0.135 | $0 |
| Complete correct set in retained top 1 | 24/78 positives | 6/26 positives |
| Complete correct set in retained top 3 / 5 / N | 26/78 | 7/26 |

These recall measures cover retained ranked candidates, including canonicalized Deep hypotheses and all available multi-place slots. They do not represent every raw provider hit. A separate reconstruction of the capped name-driven scoring trace covers 31 development and 17 calibration cases. It contains a complete correct set for 11 and 7 positives respectively, and adds no complete set absent from the retained candidates. Rejected hits can lack physical anchors; this is an incomplete observed pool, not proof that all missing places were absent from Google.

Places text search is 59.7% of measured development cost. Eight identical requests within cases account for only $0.094: two text searches and six geocodes. Calibration has no identical requests. Even eliminating every such request would save less than 1% of development cost, before cache overhead or retry semantics. Existing production request-local coalescing remains enabled. No cross-case answer cache or source-ID lookup is introduced.

The literal-source-street pilot preserves source text and extends search queries, but produced two wrong/unverified autonomous saves in five cases and is rejected. The strict tenant-name/unit veto removes a real parent substitution but also blocks two correct development saves; it is rejected as a general replacement. A narrower food-venue-versus-parent-category veto removes that substitution without losing any of the 16 correct development or three correct calibration autonomous resolutions. It grants no new save permission and performs no provider calls. This supports further testing, not a population safety guarantee.

Broader candidate generation and stronger visual identity evidence are higher-value targets than duplicate-request elimination. The schema clarification experiment improves some missing multi-place evidence before query construction, but the full structural combination is rejected after four newly wrong/incomplete multi-place saves. Local OCR alone cannot bind a tenant to a parent address; category and geography checks remain necessary. Retrieval embeddings and the prior geometric verifier remain off because their earlier locality-scale experiment did not establish safe exact identity.

Private evidence: hash-verified frozen baseline runs, evaluator v3 and `baseline_provider_candidate_audit_v2.json`. Version 1 is preserved but has an incorrect diagnostic tier-name mapping; version 2 corrects that mapping without changing candidate or provider totals. Provider duration sums describe total request work and are never presented as wall-clock latency.

## Final sealed result — 2026-10-11

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.

The earlier pending statements above describe experiment chronology. The final architecture and deployment status are in `FINAL_RECOGNITION_ARCHITECTURE.md` and `DEVELOPMENT_INTEGRATION_REPORT.md`.
