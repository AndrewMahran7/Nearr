# Recognition baseline — ongoing research, no final winner

Measured development/calibration snapshot, 2026-10-11. The 62-case,
60-independent-group holdout has not been inferred or scored. Production and the
Nearr 1.5 release are untouched.

The repaired runtime completed all 112 development cases: 54 single, 24 complete
multi-place and 34 negative. The baseline preserves the shared finalizer and
Automatic Deep behavior. Its extraction passed 312 differential synthetic controls.

| Development metric | Result |
|---|---:|
| Strict correct autonomous resolution | 16 / 78 exact-positive cases (20.51%) |
| Autonomous precision | 16 / 20 (80.00%) |
| Autonomous coverage of exact-positive cases | 20 / 78 (25.64%) |
| Autonomous submission coverage | 20 / 112 (17.86%) |
| Wrong or unverified confident outputs | 4 / 112 (3.57%) |
| Review | 59 / 112 |
| Failure | 33 / 112 |
| Autonomous complete multi-place sets | 0 / 24 |
| Mean / p50 latency | 11.330 s / 6.637 s |
| p75 / p90 / p95 latency | 13.076 s / 25.128 s / 36.441 s |
| Physical provider requests | 442 |
| Total provider tariff | $10.8241256 |
| Mean tariff per submission | $0.09664398 |
| Tariff per strictly correct autonomous result | $0.67650785 |

Latency starts with retained timed evidence and includes frame preparation, live
inference and finalization. It excludes acquisition, fresh ASR, queue/database and
client delivery. This is not production end-to-end latency. Prices are measured
provider usage multiplied by frozen public tariffs, before credits, tax or discounts.

The strict identity score is a lower bound where provider names or physical pins
remain unverified. The four failures include a demonstrated parent-versus-tenant
mistake, two natural-feature pin differences and an unproved provider-name spelling.
They must not all be described as four independently proven wrong destinations.
Missing parsed provider country/region is unknown, not evidence of geographic accuracy.

## Scorer provenance

The original sealed manifest, labels and splits remain unchanged. Separate V2 and
V3 truth-side audit maps add independently observed names, full-address formatting
equivalence and missing physical anchors. Existing coordinates/radii, floor and unit
contradictions remain binding. V3 inspected the original references uniformly for
address-only records; seven groups still lack exact anchors. No held-out predictions
were available during that audit. Development results were exposed, so the audit
is explicitly not blind to development outcomes. Legacy and V2 reports are preserved.

- Evaluator map V3: `887be519301889eb25d4b50f79aed7c2df937e17151e70c5141dd6dd907ea300`.
- Combined frozen baseline receipt: `6bde671932a0a8b76b791da6a569dd244431973f34d3a2002c0399db3c2cdd2c`.
- Combined observations: `f115da87b3a9c5f870067ca318d0c66d993f6641c047b4e80c5131349ca24f49`.

The first five-case pilot and the two later development batches used explicitly
recorded equivalent retained-evidence configurations. Their physical requests were
not rerun or counted twice when assembling and scoring all 112 cases. Private score
reports bind exact scorer code, evaluator map, input inventory and frozen observations.

## Development pilots

Each isolated pilot contains five cases, including only four exact positives. These
are diagnostic results, not statistical superiority claims. Model-output variability
is a confounder; a difference cannot automatically be attributed to the edited flag.

| Arm | Correct autonomous / exact | Autonomous precision | Wrong or unverified | Tariff |
|---|---:|---:|---:|---:|
| Original baseline pilot | 0 / 4 | — (0 saves) | 0 | $0.49008920 |
| Natural-scene taxonomy | 1 / 4 | 1 / 2 | 1 | $0.51137770 |
| Literal source-street query | 1 / 4 | 1 / 3 | 2 | $0.40559297 |
| Local OCR | 2 / 4 | 2 / 3 | 1 | $0.31724400 |
| Local medium ASR | 1 / 4 | 1 / 1 | 0 | $0.39362910 |
| OpenAI ASR | 1 / 4 | 1 / 2 | 1 | $0.34854842 |
| Six uniform frames | 1 / 4 | 1 / 2 | 1 | $0.50544214 |

Each arm also had one failure. OCR/ASR retained sidecar inference timings omit their
original local compute and are not valid fresh-policy speed claims. The source-street,
taxonomy, OCR, OpenAI ASR and uniform-six variants produced additional confident errors
on this cohort; none is accepted as a standalone winner.

A label-free finalizer replay verified exact baseline parity for all 79 retained
finalization plans. The strict tenant-name veto removed one demonstrated wrong save,
but also two correctly identified results. It is rejected as a standalone replacement.
The replay incurred zero new paid requests and adds its local veto compute to retained
baseline latency; it is not a fresh runtime latency measurement.

## Calibration and subsequent checks

The 34-case baseline calibration run is frozen. It produced 3/26 correct autonomous
exact results, 3/7 autonomous precision, 7/26 exact-positive coverage, four wrong or
unverified confident results and six failures. p90 was 21.228 seconds; 115 physical
requests cost $2.9632896. This is a calibration result, not the sealed benchmark.

The full text-only lane and all four calibrated text-first routers are rejected;
see [routing calibration](ROUTING_CALIBRATION.md). The adaptive frame pilot produced
zero correct autonomous results and one new confident mismatch among five cases.

The missing scene-change vocabulary fix produced one correct autonomous result,
no new confident mismatch and $0.3791172 tariff in its five-case pilot. The empty
recovery stop preserved zero autonomous outputs, converted the negative failure to
review, and cost $0.4236806. These small pilots justify broader evaluation only.

An isolated category-only parent veto removes the demonstrated restaurant-to-mall
mistake without losing any of the 16 correct development saves. Calibration is
unchanged. Development precision becomes 16/19; correct autonomous resolution stays
16/78. The strict name/unit variant remains rejected. An atomic multi-place veto
preserves all baseline autonomous outputs in both splits. These are zero-provider
replays with exact baseline control parity; their timings are not fresh inference.
