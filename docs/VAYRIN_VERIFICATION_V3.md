# Vayrin Verification V3

## Scope and isolation

Verification V3 was built in `C:\Users\andre\Desktop\Nearr-worktrees\vayrin-verification-v3` on branch `feat/vayrin-verification-v3`. The branch started from clean main commit `fc293c179b6d4e90a350dc9208d282bc5da66541`. V2 commit `c8fb520f726f076f1ff332aabfaef601cd670645` was audited, but its stale ancestry was not merged. Only the useful verification, frame-safety, and region-to-POI semantics were reimplemented on the current code line.

Google Vision V2 is not imported, configured, or enabled. No new retrieval provider was added.

## Root cause and decision tree

V2 used a binary-ish model verdict after retrieval:

1. Hybrid retrieval produced a source-backed shortlist.
2. Sol returned `STRONG_MATCH`, `POSSIBLE_MATCH`, `WEAK_MATCH`, or `REJECT` plus freeform support and contradiction strings.
3. `rankVerifiedCandidates` immediately discarded a candidate when its evaluation was missing or its verdict was `REJECT`.
4. `mergeVerifiedRetrievalCandidates` could only merge candidates that survived that filter.

For Stiniva, retrieval correctly placed Stiniva Cove at rank 1. Sol described the visible clip as a compact cliff-diving basin rather than the expected elongated inlet, narrow entrance, and pebble beach, then returned `REJECT`. The code had no camera-view visibility test and no preservation invariant, so absence of canonical geometry became rejection and the correct candidate disappeared.

V3 uses this decision tree:

1. Preserve candidate identity, retrieval source, initial rank, retrieval strength, and retrieval evidence.
2. Require one structured evaluation for every candidate; synthesize an explicit `UNKNOWN`/`PRESERVE` record if the model omits one.
3. Normalize every claim to `SUPPORTS`, `CONTRADICTS`, or `UNKNOWN`.
4. Convert missing, cropped, occluded, seasonal, lighting-dependent, or viewpoint-dependent expected features to `UNKNOWN`.
5. Accept strong contradiction only for necessarily-visible `identity_conflict`, `geographic_conflict`, or directly impossible geometry.
6. Preserve a credible retrieval under weak contradiction or incomplete evidence.
7. Reject a strong retrieval only for a strong identity/geographic conflict or at least two independent strong impossible-geometry contradictions.
8. Rank all surviving candidates deterministically and retain an explicit record for rejected candidates.
9. Allow an outside proposal only when every shortlist candidate is observationally weak or every candidate is strongly contradicted; once admitted, the outside proposal may outrank weak placeholders.
10. Return at most three candidates to the product, always as candidate confirmation and never as an auto-save.

`finalScore` is a deterministic ranking weight, not a calibrated probability.

## Evidence semantics

- `SUPPORTS`: observed visual/textual identity, compatible region evidence, or other affirmative evidence.
- `CONTRADICTS`: evidence genuinely incompatible with the candidate and necessarily visible from the observed view. Strong rejection evidence is limited to identity, geography, or impossible geometry.
- `UNKNOWN`: missing or incomplete evidence, including expected features that may be outside the selected view, crop, occlusion, focal distance, season, weather, lighting, or camera angle.

An absent expected feature defaults to `UNKNOWN`. The verifier is not allowed to hallucinate a camera position.

## Structured control flow

The Sol candidate-verification response contains exactly one item per candidate with:

- candidate ID;
- up to three bounded, non-duplicate observational evidence claims;
- visual and region compatibility classes;
- promote/preserve/demote/reject verdict;
- short reason code.

The model describes evidence. `verificationV3.ts` owns normalization, preservation, rejection thresholds, ranking, outside-shortlist admission, candidate limits, and no-auto-save policy. The compact verification-only schema omits unused freeform geolocation fields, reducing output cost without dropping candidate records.

## Frame selection

V3 retains the bounded diverse-frame strategy: first and last boundaries plus temporally stratified frames selected by farthest perceptual hash. Six of at most twelve considered frames are sent in the benchmark. A newly hardened extraction path skips ffmpeg timestamp requests that exit successfully without producing a non-empty JPEG; it does not infer evidence from missing frames.

## Region to POI

Region-to-POI expansion is independent of Vision. Strong region evidence may come from location metadata, a coarse area candidate, or a non-generic location hashtag. The worker performs no more than two category-aware Places text queries, deduplicates canonical place IDs, retains no more than eight POIs, and exposes no more than three candidates downstream.

The key is server-only (`GOOGLE_PLACES_KEY`) and never appears in diagnostics or mobile configuration. Missing credentials, HTTP failures, and empty results return a bounded empty result without blocking the provider. Every region POI is confirmation-only.

The 2026-08-24 live Supai check used two calls and returned eight unique canonical IDs in 339 ms: Havasu Falls, Fifty Foot Falls, Mooney Falls, Little Navajo Falls, Chutes Havasu, Havasupai Falls, Fiftyfoot Falls, and Hidden Falls. This is a candidate set, not an exact-place claim.

## Frozen benchmark

The same exact-eight corpus and ground-truth aliases from the V2 artifact were reused. Ground truth was absent from the retrieval-shortlist manifest and every Sol prompt; it was applied only by the deterministic compiler after calls completed. Exact frozen hashes and source provenance are recorded per fixture in `artifacts/vayrin/verification-v3-benchmark.json`.

| Metric | Baseline | V2 final | V3 |
|---|---:|---:|---:|
| Recall@1 | 0% | 25% | 37.5% |
| Recall@3 | 0% | 25% | 37.5% |
| Recall@5 | 0% | 25% | 37.5% |
| Wrong top-1 | 100% | 75% | 62.5% |
| Correct candidate preserved | n/a | 50% | 100% |
| Correct candidate rejected | n/a | 50% | 0% |
| Retrieved-correct-but-rejected | 0 | 1 | 0 |
| Mean shortlist survival | n/a | 19.64% | 100% |
| Median verifier latency | 6.89 s | 34.29 s | 38.06 s |
| p95 verifier latency | 17.05 s | 53.91 s | 49.02 s |
| Median verifier cost | n/a | $0.072033 | $0.075890 |
| p95 verifier cost | n/a | $0.090338 | $0.093740 |

V3 median verifier cost is 5.35% above V2, below the benchmark's 10% materiality threshold. V3 p95 cost is 3.77% above V2. Median latency is 11.0% above V2, while p95 is 9.1% lower. The recall gain is 12.5 percentage points at ranks 1, 3, and 5.

The 100% shortlist-survival figure is intentional on this ambiguity-heavy corpus: V3 keeps uncertain candidates for explicit confirmation, while the user-facing cap remains three. It does not convert survival into exact-place certainty.

## Stiniva regression

- Retrieved: yes.
- Initial rank: 1.
- Final rank: 1.
- Verdict: `PRESERVE`.
- Rejected: no.

Exact evidence assignment:

- `SUPPORTS`: Croatian location text and visible pale limestone/clear-water coastal compatibility.
- `CONTRADICTS`: none.
- `UNKNOWN`: the visible frames do not establish the expected Stiniva enclosure/pebble-beach geometry; camera orientation and crop are unresolved.

The deterministic policy preserves rank-one Stiniva under that uncertainty.

## Safety and operating limits

- Wrong auto-saves: 0.
- Broad-region false exact promotions: 0.
- Premature outside-shortlist jumps: 0.
- Candidate-confirmation rate: 87.5% (seven of eight fixtures; the no-evidence control remained honest).
- Places queries: maximum 2.
- Internal verification candidates: maximum 8.
- User-facing candidates: maximum 3.
- Vision V2: off.
- Production: untouched.

## Reproduction

Run the focused policy suite with `npm run test:vayrin-verification-v3`. Run one withheld verifier fixture with the worker `vayrin:verification-v3` command, then compile the frozen report with `vayrin:verification-v3:compile`. The compiler requires the V2 benchmark artifact, V2 raw reports, and V3 raw reports so legacy and new metrics remain traceable.

The benchmark artifact is the machine-readable source of truth for per-fixture hashes, ranks, every candidate record, Sol usage, latency, cost, and no-save outcome.
