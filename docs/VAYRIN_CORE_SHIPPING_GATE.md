# Vayrin Core shipping gate

## Decision

GPT-5.6 Sol materially improves the current Nearr pipeline on three independently grounded hard single-place classes and one verified multi-place composite. The strongest incremental cases use no exact name, address, coordinates, or readable identifying sign:

- Dettifoss from waterfall/canyon morphology, versus only `Iceland` in cheap context and no Gemini answer.
- Cocoa Beach Pier from pier/beach geometry, versus only `Florida` and no Gemini answer.
- Griffith Observatory from its Foucault-pendulum rotunda, versus only `Los Angeles` and no Gemini answer.
- Fused multi-place output separated and correctly identified Dettifoss and Griffith Observatory by scene/timestamp.

This is a small shipping gate, not a broad recognition benchmark. It establishes incremental value on representative cases; it does not establish universal geolocation accuracy.

## Evidence configurations

`cheap` below separates deterministic context from the worker heuristic. The administrative location is known where supplied, but the heuristic emitted no specific place. Gemini is the current `PLACE_EVIDENCE_SYSTEM_PROMPT` pass over the production frame set, not a label for all pre-GPT extraction.

| Fixture | Class | Ground truth | Cheap/default | Gemini media evidence | Sol visual-only | Sol fused | Best | Incremental GPT |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Dettifoss | hidden natural; coarse refinement | high | Iceland only; heuristic no place | no hypotheses | Dettifoss, 0.96, EXACT | Dettifoss, 0.94, EXACT | fused/visual | YES |
| Cocoa Beach Pier | natural/landmark; coarse refinement | high | Florida only; heuristic no place | no hypotheses | Cocoa Beach Pier, 0.86, EXACT | Westgate Cocoa Beach Pier, 0.90, EXACT | fused | YES |
| Griffith Observatory | unlabeled/background venue; coarse refinement | high | Los Angeles only; heuristic no place | no hypotheses | exact pendulum at Griffith Observatory, 0.90, EXACT | Griffith Observatory, 0.96, EXACT | fused/visual | YES |
| Small waterfall | hard negative | high for “no defensible exact place” | no answer | no answer | no answer | no answer | all safe | NO |
| YouTube zoo | famous-clip negative | exact venue UNKNOWN | generic zoo/elephant text only | no hypotheses | San Diego Zoo prior, UNKNOWN | San Diego Zoo prior, UNKNOWN | no accuracy claim | NO |
| Verified composite | multi-place | high | generic two-place caption only | no hypotheses | Dettifoss exact + Perlan wrong, WRONG | Dettifoss + Griffith Observatory, separate scenes, EXACT | fused | YES |

The first two multi attempts are retained rather than hidden. The original selector chose one early and five late frames and collapsed the scenes. Temporal stratification then separated the scenes, but the initial eight-second source interval did not show enough of Dettifoss. The final composite used a declared informative interval from the same independently grounded source. It succeeded fused; visual-only still got the second scene wrong.

## Fixture qualification

The complete source/ground-truth manifest is `artifacts/vayrin/shipping-gate-fixtures.json`.

- Dettifoss: the source description independently names the waterfall. Test inputs supplied only Iceland and a generic waterfall caption. No exact name/sign/address was supplied.
- Cocoa Beach: the uploader's own-work description and categories independently identify the beach and pier. Test inputs supplied only Florida and a generic beach/pier caption.
- Griffith: the uploader's own-work description independently identifies the exhibit and observatory. Test inputs supplied only Los Angeles and a generic pendulum caption.
- Small waterfall: the reviewed source says only “a small waterfall in a park.” This supports a negative claim (no defensible exact answer), not an invented location.
- Zoo: the existing corpus independently verified the owner captions and that no zoo is named. The actual zoo is UNKNOWN for this evaluation, so the San Diego output is excluded from success/failure accuracy totals and used only to test prior handling.
- Multi: a local, uncommitted composite concatenated the Dettifoss and Griffith source intervals without labels. Each interval's truth comes from its independent source page.

## Scored totals

| Configuration | EXACT | USEFUL | COARSE | WRONG | NO ANSWER | UNKNOWN |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cheap/default | 0 | 0 | 3 | 0 | 3 | 0 |
| Gemini | 0 | 0 | 0 | 0 | 6 | 0 |
| Sol visual-only | 3 | 0 | 0 | 1 | 1 | 1 |
| Sol fused | 4 | 0 | 0 | 0 | 1 | 1 |

UNKNOWN is not counted as success. The multi visual-only result is WRONG because one of its two specific identities contradicted ground truth, even though its scene split and first identity were useful.

## Same-scene identity alternatives

Previous behavior verified only the best model hypothesis; all other hypotheses were diagnostics. Now:

1. Every Vayrin scene receives a stable `logicalPlaceId`.
2. Ranked hypotheses within a scene carry `hypothesisRank` and are punctuation-normalized/deduplicated.
3. `buildVenueMentions` emits one logical mention with ranked `identityAlternatives`.
4. The name-driven resolver searches each identity independently under the same geographic guards.
5. Results reconverge by logical mention ID. Canonical Place IDs deduplicate spelling/address variants; different Place IDs stay ranked in one mention's existing candidate picker.
6. Distinct scene IDs never enter that alternative group and remain multi-place mentions.
7. Any unresolved identity uncertainty blocks media auto-save. A `model_prior` is always blocked.

The durable mention slot also retains `identityHypotheses`, so a hypothesis that does not become a Google candidate is not silently erased.

## Non-Places lead contract

When Places cannot verify a named natural/informal hypothesis, the durable domain object can now retain:

```json
{
  "mentionId": "m1",
  "displayName": "Hidden Falls",
  "contextLabel": "Example County",
  "outcome": "no_match",
  "candidates": [],
  "identityHypotheses": [
    {
      "name": "Hidden Falls",
      "contextLabel": "Example County",
      "confidence": 0.63,
      "evidenceKind": "observable",
      "timestamps": [2, 8]
    }
  ]
}
```

The job also retains `suggested_query` from the mention display name. There is no Google Place ID, address, coordinate, or verified-candidate claim. This is enough for a future “I've got a few leads” surface; this pass deliberately does not implement that UI.

## Multi-place contract

| Scene | Expected | Final fused Vayrin | Domain state |
| --- | --- | --- | --- |
| 0-12s | Dettifoss | Dettifoss, 0.90 | `vayrin-scene-1` -> `m1`, independent evidence |
| 12-26s | Griffith Observatory | Foucault Pendulum, Griffith Observatory, 0.85 | `vayrin-scene-2` -> `m2`, timestamps 12.23/16.68/17.79/25.58 |

`multipleIntentionalPlaces=true` requires more than one surviving logical scene. Per-scene hypothesis arrays are mapped independently, country conflicts prevent shared geography, and the resolver processes each mention independently. One no-match/provider error does not discard a different successful mention. Existing mention-slot selection and selected/all save functions remain unchanged.

## Famous-clip protection

Both zoo runs recognized the famous video at 0.99 without a visible venue identifier. The v2 schema required `evidence_basis`; both outputs honestly returned `contextual_or_memory_prior`. The adapter converts that into `identityEvidenceKind=model_prior`. The media auto-save gate now returns `model_prior_unverified` regardless of Places score. The result may survive as a lead, but it cannot silently become verified truth.

This is additional hardening beyond the prior grounding step. The old grounding admitted any supplied-frame clue as explicit and could not distinguish unique observable identity from memorized clip recognition.

## Cost and latency

All 16 GPT calls, including four preserved calls from the two failed multi attempts:

| Metric | Mean | Median | Range | Total |
| --- | ---: | ---: | ---: | ---: |
| Frames | 5.5 | 6 | 2-6 | 88 |
| Latency | 24.48s | 21.11s | 6.24-59.32s | 391.71s |
| Input tokens | 2,765.69 | 2,530.5 | 1,941-3,440 | 44,251 |
| Output tokens | 1,167.25 | 1,079 | 224-2,908 | 18,676 |
| Estimated cost | $0.04210 | $0.03722 | $0.00925-$0.09724 | $0.67360 |

Per-call details are in each `shipping-gate-*.json` artifact. Ordinary single-place calls remain consistent with the prior $0.02-$0.06 planning range. Multi-place outputs were longer and reached $0.053-$0.097, so multi fallback planning should use roughly $0.05-$0.10.

## Shipping questions

- Q1 — Material improvement beyond existing Nearr: **YES**.
- Q2 — Demonstrated classes: visible signage/address (prior coffee fixture), unlabeled venue, background venue, natural feature, coarse-metadata refinement, multi-place.
- Q3 — Still unproven: unlabeled restaurants/hotels/resorts at useful breadth; obscure cliffs/trails/swimming holes; informal locations with live no-Places verification; cross-language/location diversity; broad real-social-video accuracy.
- Q4 — Trigger: **approximately correctly**. Every gate fixture lacked a cheap specific result and was correctly eligible; the negative declined and the famous prior was safely downgraded.
- Q5 — Six diverse frames: **YES**, with temporal stratification. The multi failure demonstrated why unstratified visual diversity was unsafe.
- Q6 — Same-scene ambiguity routed to picker: **YES** when two identities survive Places as canonical candidates; one canonical plus unresolved non-Places hypotheses remains review-only with durable lead data.
- Q7 — Unresolved non-Places hypotheses survive: **YES** at the backend/domain contract.
- Q8 — Verified multi-place domain/contract: **YES**. The final fused fixture produced two timestamped scene identities, and deterministic tests prove unique mention slots and independent partial-success behavior.

## Remaining limitations

- This is six fixtures, not a statistically powered benchmark.
- Sol visual-only was wrong on one scene of the final multi fixture; fused context was required for the exact two-place result.
- Same-scene alternatives that resolve to two Places candidates use the existing picker. A non-Places alternative is retained as a lead but is not a saveable picker candidate.
- The future “few leads” UI is not implemented.
- Exact venue identity can still be wrong; feature flag, Places verification, provenance, ambiguity, and auto-save gates remain mandatory.
- The existing Gemini prompt intentionally rejects inferred visual geography, so this comparison demonstrates product-path incrementality, not an equal-prompt model bake-off.

## Shipping verdict

The branch is appropriate for safe-base integration behind `VAYRIN_VISUAL_GEOLOCATION_ENABLED=false`. It is not authorization to enable production behavior or deploy infrastructure.
