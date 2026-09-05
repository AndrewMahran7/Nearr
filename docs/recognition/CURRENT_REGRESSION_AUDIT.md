# Current Backend Recognition Regression Audit

Audit date: 2026-09-05. Starting `origin/main`: `57e745e8c1519babb111da2dc5509316b52d9e7f`.

## Sol parity benchmark

Test commands: `npm run benchmark:sol-parity`, `npm run report:sol-parity`, `npm run test:sol-parity-harness`.

Purpose and cases: 48 real social-media URLs, including natural places, restaurants/businesses, multi-place posts, controls, and negatives. Live mode exercises acquisition, frames, transcript/OCR, `runPremiumRecognitionInference`, `completePremiumRecognition`, Places canonicalization, and the simulated save decision. Frozen artifacts support replay.

Ground truth and scoring: `artifacts/sol-parity/ground-truth.json`; canonical strings, aliases, expected broad geography, and qualitative flags. It measured exact top-1, but its `useful_top3` accepted truthful partials and broad geography. It did not implement strict exact-place top-3.

- Top1 measured: YES
- Top3 measured: YES, but not strict exact top-3
- Exact physical location required: NO
- Broad area can pass: YES
- Cache isolated: YES in benchmark mode
- External providers exercised: YES in paid live mode; NO in frozen replay
- Main weaknesses: mixed taxonomy, broad geography credited as useful, category imbalance hidden by aggregate metrics, no explicit provisional-label tier, and no per-category ratchet.

## Premium Sol recognition contract tests

Test command: `npm run test:premium-sol-recognition`.

Purpose and cases: deterministic tests of the shared Premium orchestration boundary, inference persistence, Places completion, safety decisions, and result contracts. Cases are focused fixtures/mocks, not a representative real-media accuracy corpus.

- Live vs replay: deterministic/mocked
- Recognition path exercised: shared Premium modules
- Ground truth: test-local expectations
- Top1 measured: NO corpus metric
- Top3 measured: NO corpus metric
- Exact physical location required: only in individual assertions
- Broad area can pass: contract-dependent
- Cache isolated: YES
- External providers exercised: NO
- Main weakness: strong orchestration coverage, weak product-level accuracy measurement.

## Premium live parity

Test commands: `npm run test:premium-live-parity`, `npm run compare:premium-live-parity`, `npm run evaluate:premium-sol-recognition`.

Purpose and cases: replay persisted paid attempts through the current completion boundary and compare fingerprints/decisions.

- Live vs replay: recorded live inputs, deterministic replay/comparison
- Recognition path exercised: Premium completion and fingerprint contracts
- Ground truth: legacy Sol labels where evaluation is requested
- Top1 measured: partially
- Top3 measured: not as strict exact-place recall
- Exact physical location required: NO
- Broad area can pass: YES under the legacy useful scorer
- Cache isolated: YES for recorded attempts
- External providers exercised: Places may be exercised during evaluation; model is replayed
- Main weakness: parity and drift detection, not representative five-domain accuracy.

## Media live regression

Test command: `npm run test:media-live-regression`.

Purpose and cases: eight live URLs covering source acquisition, metadata quality, and garbage/wrong-region guards.

- Live vs replay: live
- Recognition path exercised: media resolver and current media pipeline
- Ground truth: fixture-level source/region expectations
- Top1 measured: NO
- Top3 measured: NO
- Exact physical location required: NO
- Broad area can pass: YES/not applicable
- Cache isolated: not an explicit recognition-answer guarantee
- External providers exercised: YES
- Main weakness: unavailable sources can be reported outside the recognition denominator; it is acquisition coverage, not exact-place accuracy.

## Share regression

Test command: `npm run test:share-regression`.

Purpose and cases: five pinned real share URLs with expected venue/address fragments through the deployed share-processing boundary.

- Live vs replay: live remote integration
- Recognition path exercised: deployed share/edge/backend flow
- Ground truth: fixture strings and addresses
- Top1 measured: indirectly
- Top3 measured: NO
- Exact physical location required: partially
- Broad area can pass: not consistently prohibited
- Cache isolated: NO explicit answer-cache bypass
- External providers exercised: YES
- Main weakness: may depend on remote state and is unsuitable as the hermetic V2 release scorer. Preserved unchanged.

## Vayrin verification and region-POI suites

Test commands: `npm run test:vayrin-verification-v3`, `npm run test:vayrin-region-poi-v3`, `npm run test:never-dead-end`.

Purpose and cases: unit/fixture coverage for candidate verification, natural-place leads, region-to-POI logic, generic guards, and conservative safety.

- Live vs replay: deterministic fixtures by default
- Recognition path exercised: Vayrin verification/candidate logic
- Ground truth: test-local expected candidates/decisions
- Top1 measured: NO corpus metric
- Top3 measured: NO corpus metric
- Exact physical location required: in selected assertions only
- Broad area can pass: may remain a named lead
- Cache isolated: YES
- External providers exercised: NO by default
- Main weakness: valuable component coverage, not end-to-end five-domain accuracy.

## Recognition cache tests

Test command: `npm run test:recognition-cache`.

Purpose: cache-key, state, and integration semantics. No place corpus or recognition accuracy score.

- Top1 measured: NO
- Top3 measured: NO
- Exact physical location required: NO
- Cache isolated: not applicable; cache is the subject
- External providers exercised: NO
- Main weakness: cannot prove a benchmark answer was freshly inferred.

## Extraction and behavior fixture evaluators

Test commands: `npm run eval:share-extraction`, `npm run eval:share-agent-shadow`.

Purpose and cases: 48 extraction fixtures and 13 behavior fixtures for source parsing/routing behavior.

- Live vs replay: replay/deterministic
- Recognition path exercised: extraction/agent policy, not full current recognition
- Ground truth: expected extraction fields/actions
- Top1 measured: NO
- Top3 measured: NO
- Exact physical location required: NO
- Broad area can pass: not a primary assertion
- Cache isolated: YES
- External providers exercised: NO
- Main weakness: useful parser coverage but not a destination-recognition benchmark.

## Audit conclusion

The repository had strong component, parity, acquisition, and safety tests, but no single release-grade answer to “is the exact physical destination in the first three candidates?” V2 preserves those suites and adds the missing strict scorer, label-quality policy, five-domain metrics, answer-cache firewall, durable inference-before-truth boundary, live lane, and ratchet.
