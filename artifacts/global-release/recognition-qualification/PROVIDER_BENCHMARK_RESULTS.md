# Recognition benchmark — blocked live, offline checks passed

26 October 2026. Paid inference budget used: **$0; zero inference calls issued by this task**. No contractually qualified end-to-end route or dedicated recognition credentials/model were established. No production traffic was replayed and no Gemini call was made. Accuracy, recall, multi-place recall, autonomous-save precision, wrong-autosave rate, review rate, no-place accuracy, inference latency and cost/submission are **not measured**, not zero and not passing.

## Existing assets preserved

- `scripts/mediaRegressionCorpus.json`: retained cross-platform corpus; tutorial validator checks 11 audited tutorial sources and five schema/safety/freshness groups.
- `artifacts/recognition-regression/corpus.json`: category overlay; source URLs/frames come from `artifacts/sol-parity/inference-corpus.json` and cliff corpus. Ground truth is separate in `ground-truth.json`, including fixture corrections and safe specificity.
- `artifacts/recognition-regression/baseline.json`, `deterministic-baseline.json`, and `runs/current-live-baseline`: historical evidence only. Not a new run or a proven contemporaneous Production comparison.
- Existing worker tests cover scene evidence, misleading metadata, multi-place, corrected identity, saved-source notes and no-place outcomes. They are deterministic contract tests, not new real-world accuracy measurements.

This run executed `recognitionLiveBenchmark.ts --category landmarks --dry-run`: C07 selected, research excluded, cache reads false, ground truth not loaded, no inference. Exposed historical cases/holdouts are not relabeled as independent holdouts. The current benchmark CLI's paid path invokes the historical premium engine; do not use that as evidence for the new OpenAI adapter without wiring the candidate into the same scoring/persistence contract.

## Bounded first qualified run

After account, guardian, processor and market qualification: cap at 8 retained development cases, one attempt each, at most $5 incremental paid spend, concurrency 1, 90-second maximum model deadline and no hidden fallback. Use existing labels; select one exact named place, scene-only/outdoors, misleading caption, multi-place, no-place, corrected identity and saved-source note control before inference. Preserve sealed holdouts. Persist inference before loading truth; collect request IDs, call counts, provider/model version, candidate identities, final decisions, saved-source association, latency and all acquisition/audio/model/Places costs. A global spend stop must include retries and acquisition. Do not unlock autonomous saves based on a sample this small; require zero wrong autosaves, preserve review/no-place behavior, and ratchet against the applicable historical baseline with its limitations disclosed.

## Actual regression results

Final worker correction at `9f2b1299824b2f7102fd3443da7d3a888f4d8c94`: added a regression for revocation after claim bookkeeping, reproduced its failure, then fixed pre-acquisition authorization. Full rerun: **664 tests, 657 pass, 7 skipped, 0 fail**, typecheck/build pass. Consent identity test also passes. Earlier numbers below describe the initial deployment, not the final corrected suite.

Worker at `001eea5d40ee1ebca742bb1f48f042ba40f802b9`: typecheck and build pass; 663 tests, **656 pass, 7 intentionally skipped, 0 fail**. Local PostgreSQL: 12 eligibility/security suites including 60 age/region combinations pass. Host consent boundary passes. Corpus validator: 5 groups pass. Recognition audit preflight: all 38 checks pass. Quick Check resolution: 12 checks pass. An initial mistyped Quick Check test filename failed to resolve; rerunning the actual package-script target passed. No product regression inferred from that invocation error.

Railway's install audit reported one pre-existing high-severity Zod advisory, GHSA-mrhx-c7xc-m3w5, confirmed by `npm audit --omit=dev`. Its advertised repair is a major upgrade to Zod 4.6.7. No forced dependency upgrade was applied during the disabled deployment. Response bounds reduce exposure on the OpenAI adapter but do not constitute a full exploitability review; assess/remediate before recognition activation/public release.
