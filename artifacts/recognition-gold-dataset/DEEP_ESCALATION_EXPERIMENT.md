# Deep escalation — measured stopping-policy pilot

Baseline runs the shared Sol engine after a weak normal result. With zero specific
first-pass hypotheses it always runs a second recovery prompt. The first deep call
remains valuable: one development input with empty normal evidence obtains a correct
candidate from Deep. Skipping it sacrifices that review candidate; an empty model result is not proof of a negative.

The experimental stop requires successful parsing, an empty normal result without
technical errors, no partial/multi-place intent, a successful empty first deep result,
and no additional frame in recovery. Frame membership compares the exact selected
file, timestamp and perceptual hash. Technical errors, tentative places, multi-place
intent and new recovery frames retain the original second attempt.

Stopping produces review with no fabricated candidate. A second prompt could still
find an identity from identical evidence, so this policy needs paired evaluation.
The five-case pilot preserved all autonomous outcomes (zero saves), changed the
negative case from failure to review, and cost $0.4236806 versus $0.4900892 baseline.
Its p90 was slower (14.387 versus 12.097 seconds); no pilot speed win is claimed.

The full combination failed its safety gate: four newly wrong/incomplete multi-place
autonomous saves. It is rejected. A narrower valid-empty-pass policy is the frozen
final candidate: require a fully valid empty schema, no partials, no multi intent and
successful normal-provider transport; return honest review before Deep. On immutable
common-prefix replay it avoids $2.010064 across 34 development cases and $0.571464
across six calibration cases. Every existing correct autonomous result is preserved;
one development review candidate is lost. Neither population equivalence nor a
correct-negative classifier is claimed.

A fresh five-case pilot executes this stopping boundary: $0.2976399, 15 physical
requests, zero autonomous outputs, zero technical failures and one early review.
Stochastic rerun differences mean its entire cost change cannot be attributed to the
rule. The 62-case sealed paired cost evaluation was frozen before dispatch and now confirms a conservative cost reduction with unchanged autonomous identities. Defaults, Premium charging and Production are unchanged. The provider budget guard supports an
opt-in reservation bound using [documented high-detail image token limits](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses).
That accounting change preserves request bytes and output ceilings; it is not a
recognition cost saving. Unknown request shapes retain the conservative byte bound.

## Final sealed result — 2026-10-11

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.

The earlier pending statements above describe experiment chronology. The final architecture and deployment status are in `FINAL_RECOGNITION_ARCHITECTURE.md` and `DEVELOPMENT_INTEGRATION_REPORT.md`.
