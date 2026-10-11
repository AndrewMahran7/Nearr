# Recognition frontier and recommendation

The frozen valid-empty-review plus food-parent-veto policy is a statistically supported cost improvement over the repaired baseline. All 9/56 held-out correct autonomous resolutions, 17 autonomous outputs and their identities are unchanged; no new wrong confident result or complete multi-set regression occurred. The conservative cost-per-correct ratio is 0.909136, with a 95% connected-group bootstrap interval [0.825217, 0.978259] (10,000 draws; 60 groups). This is at least 9.09% cheaper at the adversarial point estimate; the interval corresponds to a 2.17%–17.48% reduction. It narrowly misses the suggested 10% material point target, which was not the preregistered statistical acceptance gate.

| Architecture | Accuracy / safety | Speed / cost | Decision |
| --- | --- | --- | --- |
| Repaired baseline | Held-out 9/56 correct; 9/17 precision; 8/62 wrong/unverified | p90 16.444s; cost/correct $0.548970–$0.552525 | Retained rollback/control |
| Empty review + narrow food-parent veto | Same held-out autonomous identities; removes one wrong Development parent; loses one correct Development review candidate | Conservative held-out cost/correct $0.495533–$0.499088; no latency reduction claimed | Recommended controlled Development candidate |
| Full text lane | Development 15/78 correct; 14 wrong, 11 newly wrong | Much faster/cheaper | Rejected by mandatory safety gate |
| Four calibrated text routers | No admissible safe early-exit threshold | Pay text plus baseline; slower and dearer | Dominated, rejected |
| Schema vocabulary + recovery + atomic multi + parent combination | Development 21/78 correct, but 4 new wrong/incomplete multi saves and one lost correct result | Cost $9.585839 vs baseline $10.824126 | Rejected by mandatory safety gate |
| OCR, ASR, six/adaptive frames and literal-address pilots | Small pilots contain unsafe new outputs or insufficient evidence | Preprocessing and provider costs separately measured | No winning standalone evidence; excluded |
| Local retrieval / geometric verifier | Too few independent queries; geometric false positives | Additional complexity without accepted safety | Off |

This is a safety-constrained practical frontier. Baseline remains a rollback alternative; candidate has sub-millisecond measured policy overhead, so strict mathematical dominance in latency is not claimed. A 20% p90 gain and a high-precision production backend were not established. The identity weaknesses warrant a fresh Development/holdout generation, not tuning against individual failures of this sealed generation.

This result does not establish production safety or improved identity accuracy. Held-out precision is only 9/17 = 52.94% (group-bootstrap 95% interval 27.78%–80.00%); 8/62 outputs are wrong or unverified against the frozen exact standard. Coverage is 17/56 = 30.36% of exact-positive submissions (17/62 overall). No 99% precision or population equivalence claim is made. Multi-place exact autonomous sets remain 0/8; detection is 3/8. Missing parsed provider country/region fields mean geography check coverage is 0/17, so reported zero geographic mismatches is not evidence of zero errors. Wrong/unverified branches are 3/12; negative autonomous false positives are 0/6.
