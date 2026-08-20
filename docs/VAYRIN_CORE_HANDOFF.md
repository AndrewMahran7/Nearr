# Vayrin Core place finding handoff

## Isolation

- Feature worktree: `C:\Users\andre\Desktop\Nearr-vayrin-core`
- Branch: `feat/vayrin-core`
- Starting commit: `11f25abebab5c44fd0d570a2c2b3a8df25b4854a`
- Base description: production-safe baseline reconciled with the safe-development infrastructure available when this worktree was created.
- The original `C:\Users\andre\Desktop\Nearr` checkout was inspected read-only. Its existing changes were not altered.

## Existing recognition architecture

```text
share extension / app
  -> create-share-job
  -> process-share-jobs metadata pass
       fetch public metadata
       extract caption, handles, explicit addresses, source location tag
       resolve through Google Places + deterministic scoring/guards
       auto-save, confirmation, picker, multi, or manual
       -> when evidence is weak and media flags allow it: share_media_tasks row
  -> Railway media worker
       public media resolver (yt-dlp metadata + bounded download)
       ffprobe / optional normalization
       platform captions or audio transcription
       timestamped frame extraction
       perceptual frame deduplication
       optional OCR
       cheap/default evidence model (Gemini or heuristic)
       Vayrin strong-model fallback when enabled and still unresolved
  -> process-share-jobs finalize_media_task callback
       parse and ground evidence
       build logical venue mentions / multi-place slots
       verify each name through existing Places resolver
       apply existing auto-save gates and job decision mapping
       preserve unresolved names as suggested-query leads
```

`process-share-link` remains the synchronous resolver surface used by the ordinary extraction path. `process-share-jobs` owns the durable asynchronous path, retry policy, media enqueue/finalize behavior, candidate payloads, and user-facing job state.

### Frames and multimodal behavior

- Frames become available in `services/media-worker/src/pipeline/runMediaTask.ts` after normalization and transcription.
- `extractFrames.ts` includes first and last frames plus one-second interval samples, downsampled to `MEDIA_MAX_SELECTED_FRAMES` (default 24).
- Frames are scaled to at most 768px wide and carry timestamp, dimensions, reason, and a 64-bit average hash.
- `deduplicateFrames.ts` drops near-identical interior frames at Hamming distance <= 6 while preserving endpoints.
- The existing Gemini pass receives every post-dedup frame up to the 24-frame cap.
- Vayrin adds a second selection layer over those existing frames; no second production extraction pipeline or CV model is introduced.

### Metadata behavior

- `extractTaggedLocation` classifies a platform tag as `exact_place`, `geographic_context`, or `unknown`.
- Exact-place tags are verified through Places and never auto-saved on the tag alone.
- Geographic context scopes and ranks a search. It is not itself a specific destination.
- Existing region/country guards reject real geographic contradictions. Vayrin's trigger explicitly treats coarse-only output as unresolved, so a city tag cannot suppress the visual fallback.
- Public yt-dlp `location` / `release_location` fields now reach Vayrin as `metadataLocation`, explicitly labelled a prior.

### Ranking, verification, multi-place, retries, and diagnostics

- Candidate ranking is deterministic in `nameDrivenResolver.ts` and `placeScoring.ts`; provider IDs, names, type eligibility, geography, and evidence provenance are retained.
- Vayrin never creates Place IDs, addresses, or coordinates. Its named hypothesis becomes a search seed for the existing resolver.
- A credible natural/informal place with no exact Places record remains an unresolved named mention and a suggested-query lead instead of being erased.
- Existing `MediaPlaceEvidence.places`, roles, `multipleIntentionalPlaces`, logical mention IDs, and mention slots carry distinct scene places. Vayrin keeps timestamps on additional scene segments.
- Roundup posts are now eligible for media analysis (`roundup_video_places`) instead of being rejected before the multi-place pipeline can run.
- Only transport, 429, and 5xx Vayrin failures are retryable. Weak, empty, refused, permanent, or malformed answers degrade safely to the cheap result.
- Persisted diagnostics include baseline provider/prompt, parsing counts, Vayrin invoked/reason/model/prompt, frame count/strategy/diversity, hypotheses/alternatives count, multi-place flag, latency, token usage, estimated cost, and a bounded model preview.

## Vayrin implementation

- `services/media-worker/src/vayrin/visualGeolocationClient.ts`: single server-only Responses API client, data-URI image construction, Structured Outputs parsing, latency/usage/cost, and failure classification.
- `services/media-worker/src/vayrin/visualGeolocationPrompt.ts`: versioned investigator prompt and strict JSON schema.
- `services/media-worker/src/vayrin/frameSelection.ts`: uniform, pipeline, diverse, and capped-all strategies.
- `services/media-worker/src/vayrin/visualGeolocationProvider.ts`: cheap-pass wrapper, trigger, evidence adapter, multi-place preservation, and bounded diagnostics.
- `lib/vayrin/geoEvidence.ts`: pure specificity, compatibility, contradiction, strength, and ranking policy.
- `lib/vayrin/productMapping.ts`: pure mapping onto Nearr's existing resolver decision vocabulary; it is not a second state machine.
- `services/media-worker/src/cli/vayrinGeolocate.ts`: local video/frame-directory harness.

The client posts to `https://api.openai.com/v1/responses` using `gpt-5.6-sol`, timestamped `input_text` parts, base64 `input_image` parts, `store:false`, and `text.format.type=json_schema` with strict mode. It requests concise observable evidence, not hidden reasoning.

Secrets are read only from `VAYRIN_OPENAI_API_KEY`, `OPENAI_API_KEY`, or the existing server-side `MEDIA_TRANSCRIPTION_API_KEY`. Values and value characteristics are never written to output. Nothing uses an `EXPO_PUBLIC_*` variable or enters the mobile bundle.

Example:

```powershell
cd services/media-worker
npm run vayrin:geo -- --video C:\fixtures\clip.mp4 `
  --strategies uniform,pipeline,diverse --budgets 6,12 `
  --conditions visual_only,visual_metadata,fused `
  --metadata "Los Angeles, California" `
  --caption-file C:\fixtures\caption.txt `
  --transcript-file C:\fixtures\transcript.txt `
  --output ..\..\artifacts\vayrin\case.json
```

## Trigger and feature flag

The outer media fallback must already be enabled for a supported platform. It runs for metadata failure, manual fallback, recoverable resolver failure, weak non-address confirmation/picker, a blocked auto-save gate, a degenerate multi result, and now roundup posts. It does not run after a safe metadata auto-save, a resolved multi result, two explicit addresses, or a Places infrastructure error.

Inside the worker, `VAYRIN_VISUAL_GEOLOCATION_ENABLED=false` is the default. When enabled, Vayrin runs only when frames exist and the cheap pass emitted no explicit place, declared insufficient evidence, or emitted only administrative geography. A specific cheap-pass destination skips the call. Default model is `gpt-5.6-sol`; the measured default is six diverse frames.

## Geographic evidence policy

Specificity order is:

```text
country < region < city < neighborhood < place
```

Evidence sources are visual, caption, transcript, metadata, visible text, and Places verification. Comparison only occurs at geographic levels asserted by both clues:

- matching overlapping levels are compatible;
- different countries or regions are contradictions;
- different city labels inside an otherwise agreeing geography are `unverified`, because containment requires a real gazetteer/Places check;
- a more-specific level asserted by only one clue is refinement, not disagreement.

Ranking leads with evidence strength, then specificity, then confidence. Specificity cannot compensate for low credibility. A credible, uncontradicted place-level visual result may replace a coarse cheap-pass result, but the downstream resolver still verifies it and retains final authority.

## Measured experiment

Only existing, legitimately documented corpus URLs were used. Downloaded media copies were deleted after the runs; secret-free result JSON remains under `artifacts/vayrin/`.

### Metadata versus vision

| Case | Metadata | Visual-only | Fused | Ground truth | Winner | Why |
|---|---|---|---|---|---|---|
| TikTok coffee shop | San Antonio, Texas (city) | Tuxedo Cat's Coffee + full street address, 0.99 | Same exact venue/address, 0.99 | Manually verified Tuxedo Cat's Coffee at 6075 Heath Rd | Visual and fused | Visual read the repeated overlay and business branding; it was correctly more specific than metadata. |
| YouTube zoo negative | None | No hypotheses | San Diego Zoo hypothesis from recognition of the famous title/dialogue | Fixture verifies no specific zoo is named or visually established; actual venue was not independently re-verified in this task | Visual-only for safety | The fused answer relies on cultural/memorized clip identity. It is retained as UNKNOWN exploratory output, not counted as ground truth. |

### Frame strategy

| Strategy | Frames | Coffee result | Latency | Estimated cost |
|---|---:|---|---:|---:|
| uniform | 6 | EXACT, 0.99 | 6.48s | $0.04546 |
| uniform | 12 | EXACT, 0.99 | 6.43s | $0.08350 |
| pipeline-first | 6 | EXACT venue, 0.99 | 6.75s | $0.04849 |
| pipeline-first | 12 | EXACT, 0.99 | 9.05s | $0.08392 |
| diverse | 6 | EXACT, 0.99 | 5.05s | $0.04558 |
| diverse | 8 | EXACT, 0.99 | 6.64s | $0.06393 |
| diverse | 12 | EXACT, 0.99 | 9.54s | $0.08710 |

Twelve frames added no specificity on the verified positive and roughly doubled input cost. Six diverse frames are the best initial setting from this small experiment: they maximize measured hash diversity and cover the clip without front-loading only early scenes.

Across all 11 calls: 114,414 input tokens, 3,436 output tokens, $0.61305 estimated total, 5.05-10.33s latency (7.74s mean). Six-frame marginal cost was $0.01480 on the low-detail negative and $0.04558 on the positive vertical clip. A reasonable initial planning range is $0.02-$0.06 per invoked fallback; this is not a universal price guarantee because image dimensions/content and output length affect usage.

Scored output counts: EXACT 9, USEFUL 0, COARSE 0, WRONG 0, NO ANSWER 1, UNKNOWN exploratory 1. The no-answer result was the appropriate visual-only safety behavior on the negative control.

## Product mapping

- Strong, single, verified: existing `auto_save` vocabulary, but current name-driven media safety still requires confirmation unless the existing deterministic auto-save gates authorize it.
- Likely single: `candidate_confirmation` / single review.
- Several alternatives for one place: `candidate_picker` in the pure product mapping. The low-level model preserves alternatives in diagnostics, but production rendering of model-level alternatives as one picker still needs an integration change (see limitations).
- Multiple distinct places: `multi_candidate_confirmation`, existing mention slots, no silent collapse.
- Coarse-only: useful confirmation/search seed, never treated as solved and never discarded.
- No useful evidence: existing manual fallback.

## Proven, promising, and deferred

Proven enough to integrate behind an off-by-default development flag:

- Responses API image + strict-schema path works with the requested model.
- Six compact frames can identify the exact verified venue without metadata.
- Coarse metadata does not suppress a more specific visual result.
- Twelve frames were wasteful on the verified positive.
- Empty visual evidence can return no answer honestly.
- Existing Places verification and multi-place contracts accept Vayrin evidence without a parallel state machine.

Promising but not proven:

- Natural-feature, hidden-cliff, beach, gatekeeping, hotel-background, and restaurant-without-name gains.
- Live multi-place scene grouping; code and synthetic contract tests pass, but the legitimate multi-place corpus download was provider-blocked.
- Whether eight frames materially outperform six on hard natural/outdoor clips.

Not worth pursuing from current evidence:

- Thirty-frame payloads or a new CV scene-segmentation system before six/eight-frame hard-case data demonstrates a need.

### Remaining limitations before Nearr-Dev deployment

1. Run a small manually verified hard-place set (natural feature, unlabeled venue, gatekept spot) and at least one accessible multi-place itinerary.
2. Same-scene alternatives are now wired through one logical mention and the existing picker contract; see `docs/VAYRIN_CORE_SHIPPING_GATE.md`. Non-Places alternatives remain durable leads rather than saveable candidates.
3. Verify the final safe base and cherry-pick this branch's commits rather than rebasing blindly.
4. Configure the server-only flag/key/pricing in Nearr-Dev, deploy the worker and relevant Edge change in the normal integration lane, then run a device share test. No environment was changed here.

## Shipping-gate addendum

The follow-up hardening pass established incremental GPT value beyond the current cheap/Gemini path on Dettifoss, Cocoa Beach Pier, Griffith Observatory, and a verified two-scene composite. It also added model-prior provenance, temporal coverage for the six-frame selector, same-scene picker routing, and a durable non-Places lead shape. Full results, preserved failures, and limitations are in `docs/VAYRIN_CORE_SHIPPING_GATE.md`.
