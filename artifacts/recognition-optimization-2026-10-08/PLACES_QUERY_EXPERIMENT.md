# Places query execution experiment

**Implemented: per-execution exact-request memoization/coalescing and bounded concurrency (maximum three).** Candidate generation, geography qualifiers, entity-role gates, field masks, result ranking and final safety policy are unchanged. No paid Places calls were made.

## Audit boundary

The normal Edge name-driven resolver already has a job-local cache and request cap. It gates roles and carries mention-specific geography, including independent geography for multi-place mentions. Its primary lookup key rounds bias coordinates; widening/category fallback lookups remain sequential. This task does not replace those queries or loosen guards. Other address verification/geocoding/legacy fallback surfaces remain intact. No measurable absent-POI recall gap justified another provider.

The previously serial premium/automatic-deep canonicalization loop did not coalesce queries across destination hypotheses. It now uses `placesQuerySession.ts`, scoped to one execution. Fingerprints include exact query text, endpoint, fixed field mask and result cap. Internal reuse additionally separates credentials and cancellation ownership; credentials and raw queries are absent from the session telemetry. Exact strings preserve case, accents, aliases and city/region/country distinctions. We deliberately do not call loose lexical similarity equivalent provider semantics.

Successful responses, including empty results, may be reused within the job. Failures are evicted. Returned objects are cloned so one hypothesis cannot mutate another's evidence. Queued requests stop on cancellation; late successful responses from cancelled owners are suppressed. Destination/hypothesis order is preserved. `placesRequests` counts actual provider invocations, while the extra session telemetry records requested queries, reuse, queue time, provider wall time, result count and bounded peak concurrency. Existing canonicalization call records still identify each hypothesis query and outcome.

## Independent ablations

The [offline scheduling runner](../../services/media-worker/src/cli/benchmarkPlacesSessions.ts) consumes 32 retained runtime records with 40 query requests. It replays only recorded result-ID/name projections. A fixed five-millisecond mock transport delay is intentionally distinct from actual provider response time. Five counterbalanced repetitions per record produced 160 paired observations per arm.

| Arm | Unique cases | Logical requests | Mock transport invocations | p50 ms | p75 ms | p90 ms | p95 ms |
|---|---:|---:|---:|---:|---:|---:|---:|
| Serial baseline | 32 | 40 | 40 | 16.77 | 30.00 | 50.56 | 66.70 |
| Memoized serial | 32 | 40 | 40 | 17.48 | 30.68 | 49.21 | 69.93 |
| Memoized + bounded 3 | 32 | 40 | 40 | 15.92 | 20.23 | 30.72 | 49.60 |

Ordered response projections were equal for every arm/case/repeat. **This workload has no exact within-job duplicate queries, so measured memoization savings are zero.** The scheduling reduction is a mechanism test, not a live latency claim. Real provider quota interactions under four worker jobs (up to 12 concurrent requests) require Development qualification. There is no measured improvement in candidate recall or cost per correct autonomous result.

Dedicated tests cover identical concurrent coalescing, different region/country/diacritics/key/signal isolation, cloned results, failed-request retry, empty success caching, ordering, global per-session bound, cancellation before dispatch and late responses. Existing premium/automatic-deep tests also pass. Candidate recall on the frozen policy replay is reported separately by the main runner, which refuses to invent incomplete retained provider responses.

## Selection

The implementation retains the internal `serial`, `memoized` and `bounded` seams for reproducible evaluation and rollback. `bounded` is the selected source default; it has no save authority. No fuzzy dedupe, extra candidate expansion, changed country parser, or supplementary POI provider was accepted without correctness evidence. See [raw scheduling output](evidence/places/places-session-benchmark.json).

## Candidate recall boundary

The 15 exact-label eligible retained post-deep cases have strict accepted-alias/locality candidate recall@1, @3, @5 and @N of **9/15 in both source arms**. Twelve have N=1 and three N=2. Five mismatches remain naming-inconclusive, and one established wrong-branch candidate is kept in review. The complete 31-case cohort has 25 lists of one candidate, four of two and two of three. These counts describe retained canonical hypotheses, not a new Places quality experiment. Complete pre-canonicalization candidate identity truth is unavailable, so a before/after canonicalization recall delta cannot be measured. No supplementary POI source was justified by a demonstrated absence gap.

Finite-integer concurrency normalization additionally handles NaN, infinities, zero, negative and fractional values without creating an unbounded session or sparse result array. Runtime uses the constant three. Cancellation suppresses queued dispatch, but an active provider must release its permit; provider transport behavior bounds cancellation completion.
