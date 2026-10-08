# Cost per correct result

**Incremental paid experiment spend: $0.00.** No paid model, Places, acquisition, ASR or hosted GPU request was made. Local CPU/GPU electricity and existing fixed hosting are not metered here. This does not establish zero production recognition cost.

| Measure | Repaired baseline | Selected winner | Interpretation |
|---|---|---|---|
| Paid cost/submission in local 31-case policy replay | $0 | $0 | Reuses retained observations; excludes historical costs |
| Live variable cost/submission | Unknown | Unknown | No fresh end-to-end paid ledger |
| Live cost/correct usable result | Unknown | Unknown | No paired complete-cost run |
| Cost/correct autonomous result | Undefined | Undefined | Zero autonomous results in the conditional replay |
| Places mock calls per 32-attempt workload | 40 | 40 | No duplicates in this stored workload; no dollar reduction |
| Paid image/token calls in frame experiment | 0 | 0 | Identical frames; no inference-token saving established |

The required aggregate `provider_usage_ledger.csv` identifies the measurement boundary and provider for each replay or local experiment. Retained historical spend is not rebilled, and incomplete historical usage is not silently treated as zero. Synthetic fixed-delay providers are labeled mocks. The acquisition, OCR, model and ASR production mix remains unknown for this selected cohort.

## Exact bounded next paid experiment proposal — not executed

After adjudicating 100 new, rights-cleared source videos with at least 50 sealed held-out source/place groups, compare two frozen pipelines on the same evidence. Include at least 20 real multi-place videos and hard same-brand/same-region negatives. The current exposed corpus remains development data. Do not begin requests until the budget is explicitly approved and the prepaid reservation ledger is implemented and checked.

| Provider / operation | First-pass maximum | Planning usage | Enforced per-call cap | Planning cost | First-pass cap |
|---|---:|---|---|---:|---:|
| Gemini 3.5 Flash-Lite | 200 calls | 8k input + 2k output tokens | 12k input + 8k output, including thinking | $1.48 | $4.72 |
| GPT-5.6 Sol | 40 calls | 20k input + 5k output tokens | 40k input + 12k output, including reasoning | $7.20 | $16.00 |
| Places Text Search Pro | 100 calls | Explicit Pro field mask | One request, no hidden pagination | $3.20 | $3.20 |
| Whisper | 30 files / 30 total minutes | Same paired proper-noun audio | At most 30 billed minutes | $0.18 | $0.18 |
| GPT-Transcribe | 30 files / 30 total minutes | Same paired proper-noun audio | At most 30 billed minutes | $0.135 | $0.135 |
| **Total** | **400 first-pass requests maximum** | | | **$12.195 (~$12.20)** | **$24.235 (~$24.24)** |

Allowing at most one complete retry of every operation gives **800 requests and $48.47 maximum**. Proposed **hard ceiling: $50**, including retries; cached source acquisition, local OCR/retrieval and no paid search tools. Reject a request before sending if its full worst-case reservation would breach provider count, duration, token or dollar limits. Use local/input-token accounting before multimodal sends, configured output ceilings, and preserve the reservation when billed usage is unknown. Never assume a timeout was free. Stop and record incomplete paired cases if the budget is exhausted; do not force a cheaper answer or silently omit needed calls. This ceiling is not permission to purchase credits or provision hardware. It includes the smaller ASR proposal in `ASR_EXPERIMENT.md`, rather than adding that budget again.

Rates verified October 8, 2026: Gemini Flash-Lite $0.30 input/$2.50 output per million tokens ([Google](https://ai.google.dev/gemini-api/docs/pricing)); Sol $4 input/$20 output per million tokens ([OpenAI](https://developers.openai.com/api/docs/models/gpt-5.6-sol)); Text Search Pro $32/1,000 requests before volume discounts ([Google Maps](https://developers.google.com/maps/billing-and-pricing/pricing)); GPT-Transcribe $0.0045/minute ([OpenAI](https://developers.openai.com/api/docs/models/gpt-transcribe)). Whisper's current $0.006/minute rate and retirement must be rechecked before scheduling ([OpenAI Whisper](https://developers.openai.com/api/docs/models/whisper-1), [deprecations](https://developers.openai.com/api/docs/deprecations)). No free-tier allowance is assumed. Reprice immediately before execution; a changed price cannot expand the hard ceiling.

The expected usage column is a planning scenario, not an empirical forecast. This is an instrumented bounded batch proposal; the available request caps may stop execution before all 100 videos have complete paired outcomes. A full-population cost or accuracy estimate requires reporting that censoring and completing an appropriately funded frozen cohort later.
