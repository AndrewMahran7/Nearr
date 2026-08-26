# Vayrin Never-Dead-End Failure Analysis

Research date: 2026-08-24 America/Los_Angeles (production events are UTC)
Branch/worktree: `investigate/vayrin-never-dead-end` / `C:\Users\andre\Desktop\Nearr-worktrees\vayrin-never-dead-end`
Base: `main` at `7762d9bc0b5a7ab6bda4332efc9c24fa9a285f41`

## Executive decision

The incident was a compound technical/semantic conflation, not proof that the video contained no useful evidence. Gemini emitted one candidate whose required `name` was exactly the empty string. The strict candidate schema rejected the whole object. The worker did run the Sol fallback, but Sol returned no hypotheses; the pipeline then represented the combined result as ordinary `insufficient_evidence`, and the UI accurately rendered that incorrect internal classification as “We couldn't pin this one down.”

The safe next change is narrow: introduce a typed recognition outcome, retain noncanonical partial evidence, normalize/drop invalid optional fields at field level, and reserve `NO_USEFUL_EVIDENCE` for a successfully completed evidence ladder. Do not invent a name, trust model coordinates, bypass validation, or loosen autosave.

No production mutation was made.

## Evidence and production scope

- Current `origin/main` and local clean `main` matched at `7762d9b`. The founder's original checkout was dirty; its changes were left untouched. All research files are in the isolated worktree.
- Railway production project `Nearr Phase 2 Dev`, service `Nearr`, was healthy and running deployment `9f44f4a4-f76c-4a99-bd18-43fbd3450e7f`, created `2026-08-25T01:36:10.587Z`.
- The deployed worker source was GitHub `AndrewMahran7/Nearr`, branch `main`, commit `b4125daa4b5c18123cf436881c856ee069c09372` (“feat: auto-save viable Vayrin singletons”). Current `main` is six commits ahead, but the diff contains no changes in the worker, media finalizer, or relevant failure-presentation files. This establishes Railway worker-source parity. The Edge version/hash identifies the deployed function, but was not treated as source-level parity proof for the local Edge bundle.
- Production configuration used Gemini `gemini-2.5-flash`, Vayrin enabled with the code default `gpt-5.6-sol`, Verification V3 enabled, region-to-POI candidate limit 8, and enabled public acquisition resolvers/fallbacks. Values and keys were not captured.
- Production readiness was green, including Supabase, ffmpeg/ffprobe, yt-dlp `2026.08.19`, and configured ScrapeCreators capabilities.
- Production Supabase Edge functions were read only. Relevant deployed versions were `process-share-link` v133, `create-share-job` v25, and `process-share-jobs` v86. Other active functions were `delete-account` v24 and `delete-share-job` v1.
- The exact raw production output is not fully recoverable: `share_media_runs.model_output` retains only a 500-character preview. Sanitized structural facts are reported; user text and location values are not.

## A. Incident root cause

### Exact path

1. Gemini returned parseable JSON with one `places` element.
2. `services/media-worker/src/providers/model.ts:487` called `parseEvidenceWithDiagnostics`.
3. `services/media-worker/src/types/evidence.ts:46` required `name: z.string().min(1).max(200)`.
4. The actual retained shape was `name: ""`, producing `places.0.name:too_small`.
5. `parseEvidenceWithDiagnostics` validated the full candidate at `evidence.ts:204`. Because one field failed, the entire candidate was rejected. With zero survivors it forced `insufficientEvidence: true` at `evidence.ts:243` and logged `evidence_validation_rejected` at `model.ts:493`.
6. This did not immediately terminate recognition. `VayrinFallbackModel` recognized the empty baseline and invoked `gpt-5.6-sol`.
7. Sol completed normally but mapped to zero usable hypotheses and added `vayrin_no_hypotheses` at `visualGeolocationProvider.ts:704`.
8. `runMediaTask.ts:758-789` computed `hasEvidence=false`, finalized `outcome=insufficient_evidence`, and omitted evidence from the callback.
9. `mediaFinalizePlan.ts:150-151` mapped that outcome to manual fallback with `failureCode=insufficient_evidence` and `needs_help`.
10. The persisted job classified as `failure_category=analysis_insufficient`, `failure_code=insufficient_evidence`, `analysisAttempted=true`.
11. `lib/shareFailurePresentation.ts:123-129` rendered “We couldn't pin this one down.” Candidate-bearing detail states take precedence, but this job had no persisted candidates, mention slots, or search lead.

### Model output

The retained preview establishes:

- top-level `places` array with one element;
- `name` exactly `""`;
- category string (11 characters), category confidence `0.9`, one category evidence tag;
- address, city, and region each `""`;
- a country string was present (value redacted);
- coordinates `null`;
- role string, confidence `0.9`;
- `explicitEvidence` was a nonempty array whose first element was an object, but its contents fell beyond the retained preview.

The retained output and current schema contain no Google Place ID, provider identity, canonical candidate ID, or trusted coordinates. The full evidence object, inferred evidence, and memory cue cannot be reconstructed from the truncated preview.

### Answers

- Why `name:too_small` occurred: the exact value was an empty string; minimum length is one. It was not whitespace or a missing field.
- Useful evidence existed: **YES, partial evidence** (country/category/confidence/tag plus at least one explicit-evidence object). Whether it named a plausible exact destination is unknown.
- Candidate recoverable: **NO for an exact canonical place from captured fields; YES as a conditional non-saveable area/search lead if the explicit evidence can be grounded.**
- Did one invalid display field cause all useful place evidence to be discarded? **YES at the candidate-object boundary.** It was not the only cause of the final result: the subsequently invoked Sol fallback also returned no hypotheses.

## B. Validation

The worker rule is `PlaceCandidateEvidence` in `services/media-worker/src/types/evidence.ts:36-69`. `name` is identity input for the current name-driven resolver and display text downstream, but a nonempty display name is not intrinsically required when a canonical provider identity or recoverable address exists. Rejecting the entire object is therefore not generally necessary.

The Edge parser at `supabase/functions/process-share-jobs/mediaEvidence.ts:189` independently requires a trimmed, nonempty name. It is more forgiving for several optional fields and always drops model coordinates. The worker currently has no provider-ID field, and its recognition request asks Gemini for JSON MIME but does not supply a provider-enforced response schema (`model.ts:423-431`).

| Rule | Current behavior | Classification | Recommended handling |
|---|---|---|---|
| `name` missing/empty/over 200 | Reject whole candidate | Identity-critical only when no other identity path; otherwise recoverable | Rehydrate from canonical ID/address, or retain a typed partial lead; never fabricate |
| Very short nonempty name | Length 1 passes; no trim in worker | Recoverable/identity review | Trim; treat generic/weak names as non-saveable, not schema fatal |
| `logicalPlaceId` empty/over 80 | Reject whole candidate | Optional | Drop or regenerate internal grouping ID |
| `identityEvidenceKind` unknown | Reject whole candidate | Safety-relevant but recoverable | Default conservatively to `model_prior`/unknown; confirmation only |
| `hypothesisRank` noninteger/out of range | Reject whole candidate | Optional | Clamp/drop |
| Unknown `category` | Reject whole candidate | Optional | Normalize to `null`; canonical Places can recategorize |
| Category confidence outside 0..1 | Reject whole candidate | Display/optional | Clamp or default 0 |
| More than 8/tall category tags | Reject whole candidate | Display-only | Filter/truncate; recurring production failure |
| Address/city/region/country wrong type/oversize | Reject whole candidate | Recoverable | Normalize empty to null; drop/truncate bad field while retaining provenance |
| Address missing | Allowed | Optional | Continue name/provider resolution |
| Coordinates malformed | Reject whole candidate | Optional/untrusted | Drop only coordinates. Model coordinates remain noncanonical |
| Coordinates missing | Allowed | Optional | Continue other paths |
| Unknown `role` | Reject whole candidate | Recoverable | Default `primary` only when single; otherwise conservative review |
| Place confidence outside 0..1 | Reject whole candidate | Recoverable | Clamp/default; do not upgrade trust |
| Evidence item wrong shape/source | Bare malformed items are dropped | Recoverable | Keep item-level filtering |
| Evidence item empty/over 400 | Object survives shape filter, then rejects whole candidate | Recoverable | Drop/truncate item with diagnostic; preserve valid siblings within the candidate |
| Evidence array over 24/8 | Reject whole candidate | Optional/display | Truncate after item validation |
| Empty explicit evidence | Candidate parses but is later nonrenderable | Evidence-semantic | Retain as lead only with separately grounded provenance; never autosave |
| `memoryCue` empty/over 180 | Reject whole candidate | Display-only | Null/drop; it is explicitly not identity evidence |
| `places` over 12 | Envelope hard-fails after sibling pass | Recoverable | Independently validate then cap |
| Flags/warnings wrong type/oversize | Envelope hard-fails | Optional/diagnostic | Default, filter, truncate |
| Malformed reason/failure code | Unknown codes generally present as technical | Recoverable taxonomy | Map to typed unknown technical cause; never infer insufficient evidence |
| No object/`places` array and no parsable partials | Hard-fail | Fatal for this payload | `MALFORMED_MODEL_OUTPUT`, then repair/retry/fallback |

Fatal should mean no trustworthy identity, geography, observable text, or provenance remains after bounded normalization—not merely that an optional field is malformed.

## C. Failure taxonomy and every user-facing route

Use two orthogonal dimensions rather than one overloaded boolean:

- Evidence result: `EXACT_CANONICAL`, `CANDIDATE_SET`, `COARSE_AREA`, `RAW_LEAD`, `GROUNDED_GUESS`, `NO_PLAUSIBLE_CANDIDATE`, `NO_USEFUL_EVIDENCE`.
- Technical result: `NONE`, `MALFORMED_MODEL_OUTPUT`, `VALIDATION_FAILURE`, `PROVIDER_FAILURE`, `MEDIA_ACQUISITION_FAILURE`, `PLACES_RESOLUTION_FAILURE`, `TIMEOUT`, `INTERNAL_ERROR`.

Each result should also carry `stage`, `retryable`, `repairable`, `attempts`, `partialEvidence`, and `provenance`. `INSUFFICIENT_EVIDENCE` should be renamed internally to `NO_USEFUL_EVIDENCE` and emitted only when the technical result is `NONE`.

| Code path/root cause | Technical vs evidence | Current user result | Keep? | Recommended behavior |
|---|---|---|---|---|
| Clean empty model result after all successful stages | Evidence | “We couldn't pin this one down” | Conditional | First show grounded area/lead/guess; honest no-evidence only if none exists |
| Candidate schema rejection, then empty Sol | Technical + evidence conflation | Exact failure copy | No | Field repair/partial preservation; technical state if recovery exhausts |
| Gemini JSON parse failure, then empty Sol | Technical + evidence conflation | Can become exact failure copy | No | `MALFORMED_MODEL_OUTPUT` repair/retry/fallback |
| Gemini transient provider outage without heuristic evidence | Technical | Retry, then “Something went wrong” | Yes | Keep provider-agnostic retry/technical copy |
| Gemini outage with grounded transcript heuristic | Recovery | Candidate/confirmation path | Yes | Keep, with provenance and autosave gates |
| Malformed/permanent Sol response | Technical, currently baseline-dependent | Can become exact failure copy | No | One bounded repair or alternate provider; preserve baseline partials |
| Sol returns zero hypotheses | Could be evidence or model limitation | Often exact failure copy | Not by itself | Preserve region/raw lead; label evidence-empty only if ladder succeeded |
| V3 contradiction rejects canonical candidates | Evidence | Candidate/area/manual or exact copy if nothing retained | Conditional | Preserve rejected context as noncanonical lead only if independently grounded |
| Region-to-POI empty/error | Technical or legitimate no match | Can disappear into no-hypothesis path | No | Persist `PLACES_RESOLUTION_FAILURE`; retain region AREA MATCH |
| Edge evidence parse failure | Technical | Technical “Something went wrong” through failure mapper | Yes | Keep distinct and retry/repair before terminal |
| Valid candidate but zero explicit/renderable evidence | Evidence/provenance | Exact failure copy | Conditional | Raw lead only if observable provenance exists; otherwise honest no-evidence |
| Resolver returns no canonical candidate but raw identity slot exists | Evidence uncertainty | Search/manual lead | Yes | Keep searchable lead, never autosave |
| Resolver returns no candidates and no lead | Evidence | Exact failure copy | Conditional | Area/guess first; then honest no-useful-evidence |
| All Places providers error | Technical | Retry; exhausted technical failure | Yes | Preserve partials and offer retry, not evidence conclusion |
| Media access/private/auth | Access | Access-specific copy | Yes | Keep provider-agnostic access guidance |
| Unsupported/invalid/oversize media | Technical/product limitation | Usually technical or duration/access copy | Mostly | Add explicit internal taxonomy; do not call it analysis insufficiency |
| Timeout/internal exception/retry exhaustion | Technical | “Something went wrong” | Yes | Keep retry state; never exact evidence copy |
| Persisted confirmation/picker/AREA MATCH candidate | Evidence uncertainty | Candidate UI overrides failure | Yes | Keep; candidates remain authoritative and non-saveable unless existing gates pass |

The confirmed technical route to the exact copy is: schema/parse failure becomes empty evidence, fallback completes with nothing, and the combined outcome is rewritten as `insufficient_evidence`. Similar routes exist for malformed permanent Sol output and swallowed region-to-POI failure.

## D. Production incidence and blast radius

Direct Railway logs over the available 14-day query returned three `places.0.name:too_small` events: two recovered to auto-save through Sol; the incident did not. The exact incident ran Sol for 19.914 seconds and finalized after 44.373 seconds total.

The last 200 available `share_media_runs` covered `2026-08-18T04:25Z` through `2026-08-25T03:43Z`. Of those, 190 were recognition runs and 10 were supplemental/other rows.

- 26/200 runs had a validation rejection: **13.0% of all rows**, or **13.68% of recognition rows**.
- Platforms: 25 Instagram, 1 TikTok. Provider: Gemini for all 26.
- 7/26 completed (**26.92% recovered**), 16/26 were user-terminal/failed (**61.54%**), and 3/26 had no remaining job row/status in the bounded query.
- 11/26 were rejection-associated empty manual terminals with no candidate, mention slot, or search lead. This is a likely-risk set, not 11 proven causal false outcomes.
- The exact incident is one confirmed validation-to-insufficient conflation. A causal percentage of all failures cannot be computed from retained data and is not fabricated here.

Top rejection paths (a run can contribute more than one path):

| Path | Count |
|---|---:|
| `places.0.name:invalid_type` | 16 |
| `places.0.name:too_small` | 3 |
| `places.1.name:too_small` | 2 |
| `places.0.categoryEvidenceTags:too_big` | 3 |
| `places.6.categoryEvidenceTags:too_big` | 2 |
| `places.1/2/3/7.name:invalid_type` | 1 each |
| `places.0.explicitEvidence.10.value:too_big` | 1 |

No coordinate-invalid or candidate-ID-missing path appeared. Candidate-ID absence cannot reject because the worker schema has no provider-ID field. “Name required” appears in Zod diagnostics as `name:invalid_type`, not a `required` code.

## E. Current recovery ladder

| Stage | Current fallback/retry | Premature/incorrect terminal behavior |
|---|---|---|
| Primary acquisition | Recognition cache, then platform resolver/yt-dlp | Unsupported/access/invalid classes finalize manual; expected |
| ScrapeCreators | One bounded fallback for Instagram, TikTok, Facebook when enabled/eligible | No equivalent fallback for YouTube/Snapchat; absence is not mislabeled if typed error survives |
| Transcript | Platform captions, else audio transcription; failure is nonfatal | None; continues to frames/model |
| Frames/OCR | Bounded frames and OCR; grounded text retained | OCR is optional; weak evidence may continue |
| Gemini | JSON parse + strict evidence schema; grounded heuristic can rescue certain outages | Parse/schema invalid is represented as empty evidence rather than a technical cause |
| V3 region-to-POI | Strong region can issue up to two Places text searches and retain up to 8 canonical candidates | Empty/HTTP failure returns empty without typed terminal failure; region can be lost downstream |
| Sol | Runs for empty/insufficient/coarse baseline; transient errors throw and retry task | Permanent malformed output or zero hypotheses returns baseline; with rejected baseline this becomes “insufficient” |
| Places resolver | Name/address caption, mentions, context-aware ranking; all-provider error retries | Model schema has no canonical ID seam; names are searched again; partial candidate already gone |
| Candidate confirmation/picker | Up to 3 visible, provider-canonical candidates; broad candidates show `AREA MATCH` | Correctly non-saveable; broad is suppressed when exact candidates exist |
| Raw-name search | Identity hypotheses in mention slots can become searchable leads | Invalid worker candidate does not automatically enter this lane |
| Honest failure | `analysis_insufficient` when attempted and no candidate | Overloaded `insufficientEvidence` cannot say whether analysis succeeded |

Technical dead-ends:

1. Gemini JSON/schema failure is converted to evidence absence.
2. One invalid field rejects all other fields in its candidate.
3. Empty/oversize object-shaped evidence items can reject the whole candidate.
4. Malformed/permanent Sol output gets no bounded repair and can inherit an already-erased baseline.
5. Region-to-POI failures are nonthrowing and may disappear into no hypotheses.
6. Provider/canonical identity is not carried in `MediaPlaceEvidence`, so deterministic rehydration is unavailable at the failure boundary.
7. `insufficientEvidence` is both a semantic model answer and a technical parser fallback.
8. `name:too_small` currently triggers a full Sol call, not a cheap field-level recovery.

## F. `name:too_small` recovery options

| Option | Applicability to this incident | Cost/latency | Reliability/risk |
|---|---|---|---|
| A. Canonical identity rehydrate | Not available in retained Gemini object; preferred when V3/provider side channel has ID | One Place Details lookup | Highest reliability; deterministic identity, but provider ID must be preserved |
| B. Address/provider coordinates | Incident address empty, coordinates null | One Places lookup | Good for real address/provider coordinates; model coordinates must remain untrusted |
| C. Small model repair | Only if observable evidence contains a name to extract | Small text-only call | Cheap, but asking a model to guess an absent name is unsafe. One bounded extraction/format repair only |
| D. Preserve search/region lead | Applicable to retained country/category/evidence shape if grounding passes | No model/provider cost | Safest fallback; less precise, confirmation/manual only |
| E. Full retry/Sol | Already attempted and returned none | Highest | Appropriate for transient provider/malformed-output recovery, not a first response to one bad field |

Recommended order: **A → B → deterministic field normalization → bounded evidence-grounded C → D → typed technical retry/fallback E.** For this incident, D was the only potentially available direct recovery. Because the full explicit evidence is not retained, exact recovery cannot be proven retrospectively.

## G. Never-dead-end architecture

```text
MODEL/PROVIDER RESULT
  -> decode transport and JSON
     technical failure? -> MALFORMED_MODEL_OUTPUT / PROVIDER_FAILURE
                          -> bounded repair or retry/provider fallback
  -> independently decode every candidate and every field
     strict-valid candidate -> grounded evidence gate
     partial candidate -> retain typed fragments + provenance (never canonical yet)
       -> canonical provider ID available? -> rehydrate
       -> address/provider coordinates? -> Places rehydrate
       -> invalid optional/display fields? -> normalize/drop with diagnostics
       -> grounded name fragment? -> one bounded field-only repair
       -> locality/raw lead only? -> COARSE_AREA / RAW_LEAD
  -> V3 region-to-POI and Sol (technical results remain typed)
  -> deterministic Places resolution + context-aware ranking
     exact canonical -> existing autosave/confirmation gates
     candidate set -> confirmation/picker
     broad canonical -> AREA MATCH
     grounded text -> searchable raw lead
     grounded locality -> strongest non-saveable area/guess
     technical exhaustion -> retry state / provider-agnostic technical copy
     successful ladder + nothing grounded -> NO_USEFUL_EVIDENCE
```

Implementation boundary: the recovery representation must carry `partialEvidence` separately from canonical candidates. It must not construct a `PlaceCandidateEvidence` that looks fully trusted merely to satisfy the old schema. Existing resolver and media autosave gates remain downstream and can only downgrade, never be bypassed.

## H. Best useful fallback and feasibility

The founder principle is feasible if “always return something” means “always preserve the strongest grounded, honestly labeled state,” not “always name a place.”

- Exact place available: provider-canonical entity; pass existing save/confirmation gates.
- Candidate unavailable but several plausible entities exist: bounded candidate set, confirmation only.
- Region available: `AREA MATCH` / “Likely area,” never silent save. Run bounded region-to-POI first, but retain the region if it fails.
- Text lead available: searchable raw lead with observable caption/speech/visible-text provenance.
- Only scene evidence available: “Possible area”/grounded guess only when minimum evidence below is met.
- Nothing grounded: honest no-useful-evidence outcome, but only when all invoked technical stages completed successfully.
- Something broke: technical retry state and provider-agnostic copy; never claim Vayrin found no place.

Minimum evidence for a weak guess:

1. provider-verified location metadata; or
2. two independent observable sources agreeing on a locality; or
3. one high-quality explicit geographic text observation with no contradictions.

A raw place lead requires a non-generic proper name present in caption, speech, or visible text. Category-only scenery, model memory prior, a broad unverified country, conflicting geographies, or generic descriptions are not enough. Weak results are labeled uncertain, capped, and never auto-saved. V3 already has useful primitives—tri-state evidence, strong-contradiction handling, region expansion, and confirmation-only candidates—but needs a durable coarse-result lane after verification.

## I. Cost/latency

Production measurements for the three logged `places.0.name:too_small` events:

- Sol calls: 11.325–30.262 seconds and approximately $0.055155–$0.109090 each.
- Exact incident: 9,854 input tokens (2,242 cached), 1,049 output tokens; 19.914 seconds; $0.070651. Full task: 44.373 seconds.

Current [OpenAI API pricing](https://platform.openai.com/pricing) lists standard short-context Sol at $5/M input, $0.50/M cached input, and $30/M output, matching worker telemetry. [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) lists Gemini 2.5 Flash at $0.30/M text/image/video input and $2.50/M output including thinking tokens. [Google Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing) depends on field mask/SKU: ID-only lookup is listed without usage charge; display name/details moves to a paid Places SKU, and Text Search Pro is listed at $32/1,000 requests after its monthly free cap.

| Strategy | Estimated marginal cost | Estimated latency | Expected usefulness |
|---|---:|---:|---|
| Deterministic normalize/preserve lead | ~$0 | <1 ms local | High for optional-field failures; no identity invention |
| Place ID rehydrate | $0 ID-only; details field mask may be about $0.017/request at first paid tier | ~0.1–1 s engineering estimate | Very high when canonical ID exists |
| Address/region Text Search | Up to about $0.032/request at first paid Pro tier | ~0.1–1 s engineering estimate | High with specific address; moderate with region |
| Small Gemini field repair (e.g. 200 input/50 output tokens) | About $0.000185 | ~0.3–2 s engineering estimate | High for formatting/extraction; unsafe for invention |
| Full Gemini multimodal rerun | Cannot be calculated from retained production usage | Seconds to tens of seconds | Duplicates expensive frame analysis; reserve for transient/malformed result |
| Full Sol rerun | Observed $0.055–$0.109 | Observed 11–30 s | Useful for visual ambiguity, poor first response to one malformed field |

Prices are inspection-time list prices; actual billing tier, free caps, field masks, and regional processing can change.

## J. Safety

- Unsafe auto-save introduced: **NO**.
- Fabricated place identity: **NO**.
- Validation bypass: **NO**.
- Model coordinates trusted: **NO**.
- Raw text treated as canonical truth: **NO**.
- Provider/schema internals surfaced to users: **NO**.

Recovered candidates remain non-saveable until they are canonicalized and pass every existing resolver, contradiction, confidence, evidence, and media autosave gate. A field-level normalizer may only remove or conservatively default malformed optional fields; it may never upgrade provenance or confidence.

## K. Tests and evidence

New deterministic corpus: `services/media-worker/tests/neverDeadEndResearch.test.ts`. Machine-readable findings: `artifacts/vayrin/never-dead-end-failure-analysis.json`.

All requested commands passed:

| Command | Result |
|---|---|
| `npm run test:worktree-workflow` | PASS before mutation |
| `npm run test:deployment-guards` | PASS before mutation |
| `npm run typecheck` | PASS |
| `npm run test:vayrin-never-dead-end-research` | PASS, 12/12 |
| `npm run test:vayrin-core` | PASS |
| `npm run test:vayrin-verification-v3` | PASS, 36/36 |
| `npm run test:failure-messaging` | PASS, 6 fixtures |
| `npm run test:media-source-evidence` | PASS |
| `npm run test:ambiguity-review` | PASS |
| `npm run test:metadata-autosave` | PASS |
| `npm run test:share-job-result` | PASS |
| `npm run test:quick-check` | PASS |
| `npm run test:context-aware-places-resolution` | PASS, 18-case benchmark/20 regressions |
| `npm --prefix services/media-worker run typecheck` | PASS |
| `npm --prefix services/media-worker test` | PASS, 397 passed / 7 intentional skips / 0 failed |

The 12 fixtures cover: empty name, missing name plus provider ID, missing name plus address/coordinates, malformed category, malformed evidence list, partial candidate, invalid JSON, provider timeout, Places/provider failure, genuine empty evidence, weak region-only evidence, and a valid/malformed sibling pair.

## L. Recommendation

Proceed with a separately reviewed implementation ticket, scoped to:

1. introduce the two-dimensional evidence/technical outcome contract;
2. add a field-level partial decoder for optional/display fields and evidence items;
3. preserve canonical provider IDs from V3/provider results as a side channel;
4. retain region/raw leads through all fallback failures;
5. add one bounded repair only for grounded formatting/extraction problems;
6. update finalization so technical exhaustion cannot become `analysis_insufficient`;
7. keep all current autosave and canonical identity gates unchanged.

Do not implement a generalized “best guess” generator and do not deploy as part of this research branch.

**READY FOR NEVER-DEAD-END IMPLEMENTATION**
