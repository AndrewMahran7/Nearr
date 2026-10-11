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
