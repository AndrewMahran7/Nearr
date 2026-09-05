# Simple Sol live-parity pre-change discrepancy table

Captured before implementation changes on 2026-09-05.

## Immutable starting state

- Base / starting HEAD: `cb9dd6f8193282009415c8a7cbe40ace779e32bc`
- `origin/main`: `1e0772971cda925227c7f677fc249b9c8e643b4f`
- Railway DEV deployment: `7909c6eb-9cf4-464f-afb0-3d5d13bd85ef` (`SUCCESS`)
- Railway DEV image: `sha256:24015ea038e1423b2f84b72d297ff3f7487c46f30042affe59cac6d04c16c113`
- Edge DEV `process-share-jobs`: v96, `054a803dcea3897010ae71d34db13b999f5217a7ac06dd563210fc7d2633e3f4`
- Edge DEV `monetization`: v30, `f795e67919f8f2f121798730ead638cae610c718aa19fddc6b40951f2aa57617`
- Remote DEV migration head: `20260905000002` (newer token-pack sizing migration; no recognition change)
- Original dirty checkout: observed and left untouched.

## Prior priority discrepancies

| Case | Paid same-evidence parity | Live batch 1 | Live batch 2 | Proven pre-change first divergence |
|---|---|---|---|---|
| R01 | Useful: Cirque de Gens / Pont d’Arc / Pont du Diable; 3 Places calls | Useful: Vallon-Pont-d’Arc / Cirque de Gens / La Baume / Pont d’Arc; 3 Places calls | No useful result; 3 Places calls; token released | Not attributable from retained artifacts. The model was reached and three hypotheses were canonicalized, but the old live artifact erased rejected Sol hypotheses and did not retain request, Sol, canonical, safety, or final hashes. First divergence is no later than post-Sol safety/result mapping, but may be the Sol response itself. |
| R02 | Useful: Puʻu Kekaʻa / La Perouse Bay / Little Beach; 3 Places calls | Wrong geography: Swami’s Beach / North Beach / Ocean Beach; token consumed | Useful: La Perouse Bay / Puʻu Kekaʻa / ʻĀhihi-Kīnaʻu; 3 Places calls | Not attributable from retained artifacts. The final California identities prove divergence no later than Sol/canonical output, but frame/context/request fingerprints and the raw structured Sol boundary were not persisted. |
| R06 | Useful: Lake Havasu / Copper Canyon / Parker Strip; 3 Places calls | Useful: Parker Strip / Copper Canyon / Lake Havasu; 3 Places calls | No useful result; 3 Places calls; token released | Not attributable from retained artifacts. As with R01, three Places calls prove useful model hypotheses existed before the terminal empty result, but rejected hypotheses and safety reasons were discarded. First divergence is no later than safety/result mapping, with model variance still possible. |

The failed sets did not overlap: batch 1 failed R02; batch 2 failed R01 and R06.

## Existing observability gap

The paid artifact retains the structured Sol result and canonical path. The two
live artifacts retain final names and aggregate cost/latency data only. They do
not retain privacy-safe frame/context/request hashes, a structured-result hash,
rejected hypotheses, canonicalization outcomes, or the final transition chain.
Consequently, the historical first divergent field cannot be reconstructed
honestly. The next implementation step adds bounded fingerprints at those
boundaries so the required A/B/C experiment can identify the first difference
without logging raw private text or hidden reasoning.
