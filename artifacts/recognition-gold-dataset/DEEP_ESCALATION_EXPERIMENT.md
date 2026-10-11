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
rule. The 62-case sealed paired cost evaluation was frozen before dispatch; results
are pending. Defaults, Premium charging and Production are unchanged. The provider budget guard now supports an
opt-in reservation bound using [documented high-detail image token limits](https://developers.openai.com/api/docs/guides/images-vision?api-mode=responses).
That accounting change preserves request bytes and output ceilings; it is not a
recognition cost saving. Unknown request shapes retain the conservative byte bound.
