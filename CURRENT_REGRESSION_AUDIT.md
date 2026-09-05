# Current Backend Recognition Regression Audit

Audit point: `57e745e8c1519babb111da2dc5509316b52d9e7f` (`origin/main` after the required initial fetch on 2026-09-05). The remote advanced during the work; the final branch is rebased onto the latest `origin/main` while this captured audit point remains explicit.

Current backend recognition identifiers at the audit point:

- engine: `simple-sol-premium.v2`
- evidence assembly: `premium-evidence-2026-09-05.v1`
- safety: `premium-recognition-safety.v2`
- model: `gpt-5.6-sol`
- model prompt: `sol-parity-natural-v1`
- response schema: `sol-parity-destination-schema-v1`

Relevant fixture stores were `artifacts/sol-parity/`, `artifacts/premium-live-parity/`, `artifacts/premium-sol-recognition/`, `artifacts/vayrin/`, `scripts/mediaRegressionCorpus.json`, and `scripts/shareRegressionFixtures.ts`. These remain intact.

## 1. Sol parity benchmark

Test command:
`npm run benchmark:sol-parity -- [options]`; compile with `npm run report:sol-parity`.

Purpose:
Compare direct Sol model/frame arms, canonicalize model hypotheses, and optionally execute the current local Premium runtime.

Cases:
48 distinct real social-media cases in `artifacts/sol-parity/inference-corpus.json`.

Case categories:
Research-era groupings such as natural place, business, hotel, multi-place, and controls; not the five product domains.

Live vs replay:
Live/paid benchmark with frozen prior runs available for replay and reporting.

Recognition path exercised:
Real acquisition, F1/F2/F3 frame paths, direct Responses model call, post-model Places canonicalization, and current local runtime output. It is close to the current backend but was designed as an experiment matrix rather than a stable release regression.

Ground truth:
Separate `artifacts/sol-parity/ground-truth.json`, loaded after inference. Labels include exact identities, aliases, truthful partials, broad geography, wrong identities, and multi-place expectations.

Scoring:
`exact_top1`, `useful_top1`, and `useful_top3`; token containment is accepted. The top-three diagnostic is the first destination plus its alternatives and includes truthful partials.

Top1 measured:
YES.

Top3 measured:
YES, but as useful@3 rather than strict exact physical destination@3.

Exact physical location required:
NO.

Broad area can pass:
YES. Matching `expected_broad_geography` can make a result useful.

Cache isolated:
YES for recognition answers (`cache_used: false`); source evidence may be reused.

External providers exercised:
YES: source acquisition, OpenAI, optional web search arms, and Places canonicalization.

Current weaknesses:
No five-domain taxonomy, no strict exact@3 metric, broad geography/partials can pass the primary useful metric, results are matrix-oriented, and no stored per-case release ratchet.

## 2. Premium Sol recognition contract suite

Test command:
`npm run test:premium-sol-recognition`.

Purpose:
Verify the current Premium fingerprint, model adapter, parsing, orchestration, canonicalization, and safety/result contracts.

Cases:
37 deterministic tests in `services/media-worker/tests/premiumSolRecognition.test.ts`; examples are focused contracts rather than a representative corpus.

Case categories:
Mixed natural places, restaurants, negative controls, and mocked result shapes; no explicit five-domain assignment.

Live vs replay:
Deterministic unit/contract tests with mocks. Separate live-dev proof artifacts exist.

Recognition path exercised:
Individual parts of the actual `simple-sol-premium.v2` path, including inference fingerprinting and orchestration boundaries.

Ground truth:
Inline expectations and fixture-specific assertions.

Scoring:
Assertions on parsed candidates, evidence, canonicalization, safety, and decisions; no shared corpus scorer.

Top1 measured:
YES in individual assertions, not as an aggregate accuracy rate.

Top3 measured:
NO representative aggregate.

Exact physical location required:
NO suite-wide contract.

Broad area can pass:
YES in contracts where broad output is merely expected or preserved.

Cache isolated:
YES in unit tests through mocks, but this does not itself prove live cache bypass.

External providers exercised:
NO in the deterministic command.

Current weaknesses:
Strong component coverage but not an accuracy benchmark; mocked examples cannot reveal current model/provider quality or denominator loss.

## 3. Premium live-parity contract suite

Test command:
`npm run test:premium-live-parity`.

Purpose:
Check persisted-attempt integrity, inference boundary isolation, local-runtime normalization, and parity comparison behavior.

Cases:
28 deterministic tests in `services/media-worker/tests/premiumLiveParity.test.ts`, plus historical paid run artifacts in `artifacts/premium-live-parity/`.

Case categories:
Priority natural-place cases and controls; no five-domain taxonomy.

Live vs replay:
Deterministic tests around stored/live-parity artifacts; separate paid batches were run historically.

Recognition path exercised:
The current local Premium runtime and parity persistence/comparison boundary.

Ground truth:
Sol parity labels and per-phase expected behavior.

Scoring:
Parity/fingerprint and behavioral assertions, not a stable strict exact@1/exact@3 release score.

Top1 measured:
PARTIAL; case comparisons expose top candidate.

Top3 measured:
NO stable exact@3 aggregate.

Exact physical location required:
NO suite-wide contract.

Broad area can pass:
YES under inherited useful/partial semantics.

Cache isolated:
YES for the paid parity lane's inference attempts; deterministic tests validate the boundary.

External providers exercised:
Only in explicit paid runs, not the normal test command.

Current weaknesses:
Useful for orchestration parity, but not representative, category-balanced, or ratcheted as a product accuracy suite.

## 4. Vayrin Verification V3

Test command:
`npm run test:vayrin-verification-v3`; live generation/compilation uses the worker's `vayrin:verification-v3` and `vayrin:verification-v3:compile` commands.

Purpose:
Measure shortlist verification and candidate-preservation behavior for the older Vayrin verification pipeline.

Cases:
Eight frozen exact fixtures in `artifacts/vayrin/verification-v3-benchmark.json`; 29 deterministic V3/region tests.

Case categories:
Mostly exact natural-location cases, not the five required product domains.

Live vs replay:
Frozen/replay report with an explicit paid compiler lane.

Recognition path exercised:
Vayrin shortlist retrieval/verification, not the current direct Premium Sol orchestration.

Ground truth:
Frozen exact fixtures and aliases withheld from verifier prompts until compilation.

Scoring:
Recall@1/@3/@5, wrong-top1, preservation/rejection, safety, cost, and latency.

Top1 measured:
YES.

Top3 measured:
YES.

Exact physical location required:
YES for the eight frozen fixtures, though the compiler uses permissive normalized containment for aliases.

Broad area can pass:
NO as exact; broad-region false promotions are separately counted.

Cache isolated:
YES for verifier answers in the paid lane; benchmark inputs/results are frozen.

External providers exercised:
YES in paid generation; NO in ordinary deterministic tests.

Current weaknesses:
Only eight cases, older recognition architecture, natural-place heavy, and six desired exact sources were unavailable.

## 5. Cross-platform media live regression

Test command:
`npm run test:media-live-regression` with its documented live-stage environment controls.

Purpose:
Verify URL recognition, public-page acquisition, evidence/query planning, garbage-candidate rejection, and wrong-region guards.

Cases:
Eight independently described real entries in `scripts/mediaRegressionCorpus.json`.

Case categories:
Platform/acquisition and negative-control oriented; not five-domain recognition categories.

Live vs replay:
Live and provider-dependent.

Recognition path exercised:
Public metadata, optional `yt-dlp`, query-plan construction, and optional Places resolution; not full current model recognition.

Ground truth:
Per-entry independently observed platform text and forbidden outputs/regions.

Scoring:
Transport availability, generated queries, forbidden candidates, and wrong regions.

Top1 measured:
NO.

Top3 measured:
NO.

Exact physical location required:
NO.

Broad area can pass:
YES; exact destination recall is not its purpose.

Cache isolated:
Acquisition explicitly disables `yt-dlp` cache; no recognition-answer cache is involved.

External providers exercised:
YES in live stages.

Current weaknesses:
Fixture-unavailable sources are reported outside useful accuracy semantics, the model path is absent, and there is no exact-place denominator.

## 6. Remote share regression

Test command:
`npm run test:share-regression`.

Purpose:
Smoke-test the deployed `process-share-link` behavior on five typed real share fixtures.

Cases:
Five fixtures in `scripts/shareRegressionFixtures.ts`: Hellfire Bay, Capone's Cucina, Brooklyn City Pizzeria, 2nd Floor, and Paradise Dynasty.

Case categories:
One travel/natural case and four food/restaurant cases, not explicitly categorized in the fixture type.

Live vs replay:
Live remote/deployed Edge test.

Recognition path exercised:
The deployed share-link path, auth, provider calls, and result contract.

Ground truth:
Accepted decisions plus case-insensitive name/address substrings, forbidden names, optional provider IDs, and optional safety expectations.

Scoring:
Decision membership and substring assertions rather than strict ranked identity scoring.

Top1 measured:
PARTIAL; it checks the resolved candidate.

Top3 measured:
NO.

Exact physical location required:
PARTIAL; branch address assertions are strong for several restaurants, but there is no shared exact-place scorer.

Broad area can pass:
Potentially, where weak substring assertions allow it.

Cache isolated:
NO explicit recognition-answer cache bypass contract.

External providers exercised:
YES.

Current weaknesses:
Non-hermetic, deployment-dependent, small, mutable provider results, and unsafe for routine local regression against Production.

## 7. Cache, ranking, canonicalization, and result-contract tests

Test command:
Includes `npm run test:recognition-cache`, `npm run test:sol-parity-harness`, Premium suites, context-aware reranking tests, canonical-save contract tests, and media-worker canonicalization/resolver tests.

Purpose:
Protect cache keys, stale-entry behavior, ranking, parser, Places matching, named-lead preservation, and API/result shapes.

Cases:
Synthetic or narrowly curated component cases spread across `scripts/` and `services/media-worker/tests/`.

Case categories:
Component behavior rather than representative product categories.

Live vs replay:
Mostly deterministic; separately named proof commands may use development or Production.

Recognition path exercised:
Important internal boundaries, but no single command covers end-to-end current quality.

Ground truth:
Inline expected objects and mocked provider rows.

Scoring:
Exact structural assertions.

Top1 measured:
NO aggregate.

Top3 measured:
NO aggregate.

Exact physical location required:
Only in individual controls.

Broad area can pass:
Not applicable suite-wide.

Cache isolated:
Cache behavior is deliberately exercised; therefore these tests cannot be treated as no-cache quality measurements.

External providers exercised:
Normally NO; explicit proof commands may do so.

Current weaknesses:
Critical contract coverage was fragmented and could not answer the product question “is the exact physical destination in the top three?”

## Audit conclusion

The repository had strong ingredients—real media, a label firewall, persisted attempts, current-runtime output, canonicalization tests, and an eight-case exact benchmark—but no coherent current-backend release regression across the five requested domains. Sol parity's “useful” metric was the largest semantic mismatch because a broad geography or truthful partial could pass. No prior suite combined strict exact@3, honest technical denominators, per-category macro/micro reporting, no-answer-cache proof, independent safety scoring, bounded failure artifacts, and a monotonic per-case ratchet.
