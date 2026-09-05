# Backend Recognition Regression V2

## Outcome

V2 establishes strict exact-physical-destination scoring across five domains, a fast deterministic tier, a no-answer-cache live current-backend tier, post-persistence ground-truth loading, honest technical failures, independent autosave safety, bounded failure artifacts, and separate live/deterministic ratchets.

The baseline measures the current backend; no recognition prompt, model architecture, Places behavior, frame selection, save behavior, deployment, or Production state was changed.

## Isolation and audited backend

- repository: `C:\Users\andre\Desktop\Nearr`
- isolated worktree: `C:\Users\andre\Desktop\Nearr-worktrees\backend-recognition-regression-v2`
- branch: `test/backend-recognition-regression-v2`
- captured starting `origin/main`: `57e745e8c1519babb111da2dc5509316b52d9e7f`
- engine/evidence/safety: `simple-sol-premium.v2` / `premium-evidence-2026-09-05.v1` / `premium-recognition-safety.v2`
- model/prompt/schema: `gpt-5.6-sol` / `sol-parity-natural-v1` / `sol-parity-destination-schema-v1`

The full pre-change audit is in `CURRENT_REGRESSION_AUDIT.md`.

## Corpus and label quality

Every one of 91 cases has exactly one required category:

| Category | All cases | Verified | High confidence | Provisional | Unscored |
|---|---:|---:|---:|---:|---:|
| Food / Restaurants | 35 | 4 | 21 | 8 | 2 |
| Cliff Jumping | 48 | 0 | 3 | 42 | 3 |
| Hiking Trails | 1 | 0 | 1 | 0 | 0 |
| Landmarks | 4 | 0 | 1 | 0 | 3 |
| Travel Destinations | 3 | 2 | 1 | 0 | 0 |
| Total | 91 | 6 | 27 | 50 | 8 |

`VERIFIED` and `HIGH_CONFIDENCE` are release-scorable (33 including two deterministic travel specificity controls). The ordinary live lane has 31 scorable real-media cases. There are 58 research cases; unresolved founder links never receive fabricated answers.

The 42-link founder cliff corpus is fully addressable. `FC04` is deduplicated to existing case `R08`; 41 additional links are stored as provisional research cases. A full research pass is available through `--category cliff-jumping --include-research`.

Reviewed changes are recorded in `ground-truth.json.fixtureCorrections` with old label, new label/evidence, reason, reviewer, and timestamp. The most material corrections are C07 (San Diego Zoo recall is exact but autosave is prohibited), ambiguous restaurant branches H06/H11 moved to provisional, explicit alias families, and classification of food venues as Food rather than Travel.

## Strict scorer

The scorer returns `EXACT`, `ACCEPTABLE_ALIAS`, `TOP3_EXACT`, `BROAD_AREA_ONLY`, `PARENT_PLACE_FAILURE`, `GENERIC_TYPE_FAILURE`, `WRONG`, `EMPTY`, `TECHNICAL_FAILURE`, or `UNSCORED`.

An exact match may use:

- normalized canonical identity;
- an explicitly accepted alias;
- coordinates inside an explicitly configured radius.

For specific-place truth, administrative areas, broad regions, generic types, and parent venues cannot pass. Required locality prevents a same-chain wrong branch from passing. Broad geography passes only when `intendedSpecificity` explicitly says the region/city itself is the destination.

Candidate recall and save safety are independent. A correct famous-place recall can pass exact@1 while an `AUTO_SAVE` is still prohibited, as with C07.

## Execution tiers and lifecycle

Tier 1 runs 25 dedicated harness tests and a deterministic replay through real scoring/orchestration boundaries:

```text
npm run test:recognition-regression
```

Tier 2 invokes the current acquisition, evidence/frame assembly, `gpt-5.6-sol`, runtime normalization, and Places canonicalization:

```text
RECOGNITION_LIVE_CONFIRM_PAID=1 npm run benchmark:recognition-live -- --all
```

Category examples:

```text
npm run benchmark:recognition-live -- --category food
npm run benchmark:recognition-live -- --category cliff-jumping
npm run benchmark:recognition-live -- --category hiking
npm run benchmark:recognition-live -- --category landmarks
npm run benchmark:recognition-live -- --category travel
```

Use `--dry-run` to inspect the inference-only manifest with no calls, and `--include-research` to include provisional/unscored sources. Paid execution requires `RECOGNITION_LIVE_CONFIRM_PAID=1`.

The enforced lifecycle is:

```text
category/source manifest (no truth)
  -> inference with recognition-answer cache disabled
  -> persist every requested attempt
  -> fix rank order
  -> load ground truth
  -> score and compare
```

Inference envelopes exclude canonical answers, aliases, coordinates, notes, prior hypotheses, and cache values. Every normalized attempt persists `cacheReadUsed: false`; no actual save is performed. Media/frame/transcript/OCR evidence may be reused only as source-versioned evidence.

## Live current-backend baseline

The full available live run requested 33 real-media cases; 31 are now release-scorable after two ambiguous branch labels were reviewed as provisional. One acquisition failed and remains in the denominator.

| Category | Cases attempted | Acquired | Scorable | Exact@1 | Exact@3 | Area-only | Parent | Generic | Wrong | Empty / technical | Wrong autosaves |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Food / Restaurants | 27 | 26 | 25 | 23 | 23 | 0 | 0 | 0 | 1 | 1 | 0 |
| Cliff Jumping | 3 | 3 | 3 | 3 | 3 | 0 | 0 | 0 | 0 | 0 | 0 |
| Hiking Trails | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Landmarks | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Travel Destinations | 1 | 1 | 1 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 |

- micro exact@1: 29/31 = 93.55%
- micro exact@3: 29/31 = 93.55%
- macro exact@1: 98.40%
- macro exact@3: 98.40%
- correct autosaves: 8
- wrong autosaves: 0
- correct review downgrades: 22

The exact@1 and exact@3 values are equal because this run did not rescue an exact destination at ranks 2–3. That is an observed result, not a scorer limitation.

## Failed scorable cases

### H10

- category: `FOOD_RESTAURANT`
- ground truth: Baja Sharkeez, Huntington Beach branch
- top 3: `Baja Sharkeez Newport Beach` (one candidate)
- failure: `WRONG` — same chain, wrong physical branch
- safety: `REVIEW`, so the recognition miss was not autosaved

### P10

- category: `FOOD_RESTAURANT`
- ground truth: Taqueria Los Pericos / Los Pericos
- top 3: none
- failure: `TECHNICAL_FAILURE` (`provider_changed: extractor_failed` in the raw backend run; normalized as missing persisted model attempt)
- safety: manual fallback

Specificity diagnostics in the baseline: area-only 0, parent-place 0, generic-type 0. These zeroes reflect the current scorable set; dedicated harness controls prove each failure class, and unresolved cliff cases cannot yet be counted.

## Ratchet and artifacts

`baseline.json` protects all 29 live exact@3 passes and stores per-category minimum counts, exact top-three outputs, recognition version, date, reviewed corrections, and the 100% product targets. `deterministic-baseline.json` independently protects the replay/CI tier so a stochastic live pass does not make deterministic CI impossible.

A run fails on a lost passing case, a category count below its ratcheted minimum, or any wrong autosave. A reduction is accepted only when the affected case has complete reviewed fixture-correction metadata. The ratchet rejects silent baseline decreases.

Each scorable failure has a bounded JSON artifact with the case/category, post-inference truth, returned candidates, recognition/evidence/model versions, frame timestamps and SHA-256 hashes, Places request count, classification, and cache proof. No private raw transcript, secret, or chain-of-thought is stored.

## Cost and latency

- current baseline model spend with returned token accounting: `$1.189932`
- model attempts with unknown model cost: 1 (the pre-model technical failure)
- other-provider spend: unknown, not treated as zero
- model requests: 32
- normalized API requests: 72
- p50 end-to-end attempt latency: 22,573 ms
- p95 end-to-end attempt latency: 32,969 ms

Cost and latency are informational and are not accuracy gates.

## Coverage gaps

- Food: strongest coverage, but still needs deliberate no-signage interiors, dish-only evidence, more mall/food-hall tenants, and more same-chain nearby-branch pairs.
- Cliffs: all 42 founder links are integrated, but only three cliff cases have sufficiently strong exact labels. Independent ground-truth work is the main blocker.
- Hiking: only one scorable trail/natural-feature case. Add desert, alpine, coastal, summit, trailhead, hidden/local, lake, and famous-trail examples.
- Landmarks: only C07 is scorable. Add famous and less-famous structures, museums, indoor attractions, natural landmarks, and partial-angle examples.
- Travel: only Hellfire Bay is scorable live media; Atuh Beach and broad Bali are deterministic semantics controls. Add real beach, resort, island attraction, park, viewpoint, neighborhood, city-as-destination, and region-as-destination media.

The high macro result is therefore not evidence that every domain is mature. It is a truthful score over a highly uneven current scorable corpus, and the category table makes that limitation explicit.

## Recommended next recognition work

1. Independently label the founder cliff corpus, starting with diverse ocean/quarry/waterfall/lake/bridge examples; model changes cannot be evaluated credibly against 3 scorable cliff cases.
2. Add real scorable hiking, landmark, and travel cases before optimizing aggregate accuracy.
3. Improve branch disambiguation using source locality/address evidence; H10 demonstrates a correct chain with the wrong nearby branch.
4. Harden Instagram/provider acquisition and fallback telemetry; P10 was lost before model inference and correctly remained in the denominator.
5. Only after corpus expansion, study why rank 2–3 supplied no rescue and whether calibrated alternatives improve exact@3 without increasing wrong autosaves.

## Production safety

The live baseline executed locally with the worktree's existing local environment configuration. Railway project and deployment metadata was inspected read only. There were no Railway deployments, Edge deployments, OTA publishes, migrations, flag changes, job mutations, cache-answer mutations, or Production calls/mutations.

BACKEND RECOGNITION REGRESSION V2 ESTABLISHED — BASELINE RECORDED
