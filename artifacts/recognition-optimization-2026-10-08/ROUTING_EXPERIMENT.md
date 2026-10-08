# Evidence routing experiment — 2026-10-08

Implemented `services/media-worker/src/automaticDeep/evidenceRouter.ts` as a pure, deterministic shadow classifier. It consumes explicit source-geography strength, entity role, candidate-bound/source-named identity, canonical verification, alternatives, provenance-bearing text modality, visual availability, conflict, upstream decision and expected/supported/unresolved place counts. It does not consume a model confidence threshold or use case IDs.

| Class | Evidence boundary | Shadow recommendation |
|---|---|---|
| STRONG | Verified source geography, venue/location role, one canonical candidate with candidate-bound identity, no conflict/alternatives/incomplete stops | Cheap verification |
| MEDIUM | Attributed text and observed source geography, venue/location role, identity not yet proved | Visual verification |
| WEAK | Missing identity/geography support or non-venue entity role | Deep verification if visual evidence exists, otherwise review |
| CONFLICT | Geography/entity conflict or upstream REJECT | Deep verification; rejection is not erased |
| AMBIGUOUS | Multiple candidates/identity alternatives, upstream REVIEW, unresolved segments, missing or extra stops | Deep verification if visual evidence exists, otherwise review |

Every result records version `evidence-router.v1-shadow`, reasons, `mode: shadow`, and `authorizesAutosave: false`. There is no live dispatch import or new fast autosave route. Unknown expected-place count is not a completeness proof.

`node --import tsx --test tests/evidenceRouter.test.ts` in `services/media-worker` passed 12 controls: verified identity; caption with observed geography; visual-only; wrong geography; sponsor conflict; same-name branches; sticky REVIEW; REJECT; missing multi-place stop; extra stop; unresolved segment; brand without venue evidence. The tests verify no class authorizes autosave. These are synthetic policy controls, not empirical route frequency or accuracy.

Existing live `normalResultSpecificity` remains the deterministic escalation gate. The only live routing changes are conservative repairs: any broad unresolved parent in a mixed set blocks completion, and explicit multi-place output with partial places triggers `INCOMPLETE_MULTI_PLACE`. Added controls prove `[specific cafe, broad national park]` and unresolved multi-place output continue to deep recognition, while two supported specific identities remain on the existing path. The Automatic Deep wrapper's `applyAutomaticDeepReviewPolicy` export preserves existing REVIEW/REJECT semantics for retained-evidence evaluation; exporting it does not change policy.

No threshold was tuned on held-out labels. Historical Premium leads lack retained raw caption/transcript strings needed to reconstruct all feature facts, so assigning them invented STRONG/MEDIUM labels would be invalid. The evaluation adapter can exercise the real review/completion boundary from retained outputs, but this does not prove ordinary cheap recognition recall or justify skipping deep calls.

Decision: keep classification available for replay/shadow analysis; retain existing escalation. Promote a faster route only after independently labeled held-out raw evidence establishes unchanged autonomous exact-place correctness, zero additional wrong autosaves, correct multi-place stop sets, and favorable time/cost per correct usable result. No measured latency, cost reduction or autonomous-accuracy improvement is claimed for this classifier.
