# Cost per correct result

Status: development/calibration comparison; sealed confirmation pending. Amounts use actual request usage multiplied by frozen tariffs, before tax, credits or discounts. Candidate rows are retained common-prefix counterfactual costs, not new bills.

| Split / architecture | Cost / submission | Cost / correct returned exact set | Cost / correct autonomous set | Correct autonomous |
|---|---:|---:|---:|---:|
| development / baseline | $0.096644 | $0.676508 | $0.676508 | 16 |
| development / empty + parent | $0.078697 | $0.550879 | $0.550879 | 16 |
| development / text-only | $0.041257 | $0.308049 | $0.308049 | 15 |
| calibration / baseline | $0.087156 | $0.987763 | $0.987763 | 3 |
| calibration / empty + parent | $0.070348 | $0.797275 | $0.797275 | 3 |
| calibration / text-only | $0.054100 | $0.613132 | $0.613132 | 3 |

A correct retained candidate is not an autonomous resolution. The scorer counts a complete returned exact set for the second economic denominator; a merely correct top-ranked review option is reported in candidate recall instead. All submitted failures remain in total cost. No cost-per-correct value is invented for arms with zero correct results.

The candidate retains every correct autonomous decision in development and calibration. Its cost-per-correct ratios are 0.8143 (95% grouped bootstrap 0.7231–0.8840) and 0.8072 (0.6468–0.9400). Calibration has only three correct autonomous cases; 9,543/10,000 bootstrap draws have a defined ratio. These are descriptive selected-policy results pending heldout confirmation.

The schema/structural combination costs $9.5858388 for 112 inputs and resolves 21/78 positives, but four new wrong/incomplete autonomous multi-place outputs reject it regardless of its lower cost-per-correct value.

Actual cumulative completed experiment spending is $34.69523770 across 1,551 physical requests, with no unknown charges, immediately before the heldout batch. Its retry-inclusive reservation cap is $9.50 within the total $50 authorization. Replays add zero paid spending. Historical media acquisition, retained ASR, local electricity and hardware, queueing and database costs are outside this provider accounting.
