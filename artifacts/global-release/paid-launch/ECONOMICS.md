# Paid launch economics

Calculated 2026-10-29 UTC. USD planning analysis, not measured production unit cost. The requested product remains **unlimited**; this analysis does not introduce a hidden find cap.

## Subscription exposure

At 1.99/month, a 30% commission scenario leaves 1.3930 and a 15% scenario leaves 1.6915 **before applicable taxes, refunds, RevenueCat, infrastructure and other costs**. Apple documents 70% subscription proceeds in the first paid year and 85% afterward; qualifying enrolled Small Business participants receive 85% from the start. Actual Nearr enrollment and territory-specific terms have not been verified. [Apple subscriptions](https://developer.apple.com/app-store/subscriptions/), [Small Business Program](https://developer.apple.com/app-store/small-business-program/).

| Monthly successful finds | Maximum average all-in cost/find at 30% commission | At 15% commission | Total cost at 0.01/find | At 0.05/find | At 0.10/find |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 | 0.139300 | 0.169150 | 0.10 | 0.50 | 1.00 |
| 25 | 0.055720 | 0.067660 | 0.25 | 1.25 | 2.50 |
| 50 | 0.027860 | 0.033830 | 0.50 | 2.50 | 5.00 |
| 100 | 0.013930 | 0.016915 | 1.00 | 5.00 | 10.00 |
| 500 | 0.002786 | 0.003383 | 5.00 | 25.00 | 50.00 |

Formula: `net_before_other_costs = price * (1 - commission)`; break-even average cost is `net / successful_finds`. At 500 finds and only one cent all-in cost each, contribution is already **-3.6070 / -3.3085** under the two commission scenarios. Free-user usage subsidy and fixed costs worsen this result. Unlimited exposure is not bounded by the five illustrative rows.

RevenueCat's published Pro pricing is free through 2,500 monthly tracked revenue, then 1% of tracked revenue. Actual account plan/enrollment was not read. For a 1.99 transaction, a 1%-of-gross scenario adds 0.0199 before other adjustments. [RevenueCat pricing](https://www.revenuecat.com/pricing).

## Consumable exposure

The principal scenario uses the founder's requested **1.20/2.50/5.00** prices. Their exact Apple availability remains unverified; recalculate only after live price-point readback establishes a difference.

| Pack | Planning price | Proceeds 30% / 15% | Maximum cost/find 30% / 15% before other costs |
| --- | ---: | ---: | ---: |
| 20 | 1.20 | 0.8400 / 1.0200 | 0.042000 / 0.051000 |
| 50 | 2.50 | 1.7500 / 2.1250 | 0.035000 / 0.042500 |
| 200 | 5.00 | 3.5000 / 4.2500 | 0.017500 / 0.021250 |

Non-expiring balances create a future service obligation. Immediate cash receipts are not proof that all unspent finds are profitable to fulfill.

Optional one-cent sensitivity only: if Apple ultimately requires 1.19 or 2.49, net proceeds per pack fall by 0.0070 / 0.0085 under the 30% / 15% commission scenarios. These alternatives are not selected or verified prices.

## Actual path and unknowns

`services/media-worker/src/providers/openaiRecognition.ts` bounds the candidate to 12 frames, 6 MiB total frames, 24,000 context characters and up to 8,000 output tokens per call. It tracks input/output/cached tokens, but returns unknown cost unless explicit per-million rates and a pricing reference are configured. `MEDIA_OPENAI_RECOGNITION_MODEL` has no qualified default. This review made no inference calls and obtained no real cost/accuracy samples.

For illustration only, OpenAI's GPT-4.1 mini model page lists 0.40 input, 0.10 cached input and 1.60 output per million tokens. It is not a selected or qualified launch model. An example 10,000 uncached input + 1,000 output costs 0.0056 for that call only; image tokenization, other passes, retries and services still matter. The repository's `whisper-1` transcription default is marked deprecated by its current model page, which lists 0.006/minute. Provider qualification must resolve availability and the exact supported model before use. [Model pricing](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [Whisper model](https://developers.openai.com/api/docs/models/whisper-1).

Current Google global pricing lists Text Search Pro at 32/1,000 and Place Details Pro at 17/1,000 in the first paid volume tier, each after its shared SKU free threshold. The actual path uses Places text search with display-name/location fields; SKU counts, cache hit rate, extra lookups and free-threshold allocation need measurement. One paid 0.032 text search already exceeds the 200-pack per-find proceeds, before recognition. This comparison assumes the search occurs for each successful find and is above shared free usage; it is not an observed request count. [Google pricing](https://developers.google.com/maps/billing-and-pricing/pricing).

Measure `all-in cost / successful durable billable source`, including media acquisition, frame/OCR/CPU work, transcription, main model, targeted note repair, Places and geocoding, storage/egress, retry/failure costs, queues, free usage subsidy, support/refunds, and allocated fixed costs. Multiple destinations still produce only one billable find. Report median/p95 and high-usage cohorts, not only a successful model call. Full-path cost, failure rate and sustained usage distribution remain **unknown**; profitability is not qualified by cheap token pricing alone.
