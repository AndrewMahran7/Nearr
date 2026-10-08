# Nearr recognition gold-dataset card — candidate inventory v0

**Verdict (2026-10-08): not yet a gold benchmark and not strong enough to optimize recognition against.** This branch delivers a source inventory, separated provisional labels, split/masking/review/scoring infrastructure, and explicit gates for a future sealed benchmark. It does **not** claim a completed 300–400-post dataset. The honest runnable full-video and held-out counts are zero.

## Current inventory

| Measure | Count / state |
| --- | ---: |
| Distinct real social posts | 124, in 123 source groups |
| Freshly inspected public posts | 21 (15 Instagram, 6 YouTube) |
| Historical references without fresh public-access confirmation | 103 |
| Cases with historically exposed outcomes | 105, including two also found during new Instagram research |
| Local provisional `VERIFIED_EXACT_SINGLE` labels | 19 (15 historically reviewed, four new source-audited) |
| Complete `VERIFIED_MULTI` sets / depicted appearances therein | 0 / 0 |
| Provisional `KNOWN_NEGATIVE` / `AMBIGUOUS` / `UNVERIFIED` | 3 / 1 / 101 |
| Ready full-video cases / calibration / sealed held-out | 0 / 0 / 0 |
| Mask eligibility: full / description-hidden / location-hidden / visual-only / text-only | 0 / 0 / 0 / 0 / 38 |
| New paid dataset acquisition / recognition-label calls | $0 / 0 |

All 124 source rows are `state:candidate`. A provisional exact label documents a defensible *source-level* claim, not a benchmark-ready full-video case. The 15 historical exact labels have previously exposed recognition outcomes, and their sources have not been freshly verified accessible. The four new source-audited exact labels have official/operator corroboration but no independent human held-out review or permitted retained visual frames. The private label store is intentionally absent from Git.

Platforms: Instagram 108, YouTube 11, TikTok 2, Facebook 2, and other 1. Candidate category tags overlap; examples include natural 48, cliff 40, restaurant 30, business 30, beach 7, waterfall 5, and hike 2. Only 30 rows have an adjudicated/source-researched country: United States 13, Spain 7, Costa Rica 4, Japan 3, France 1, Indonesia 1, Jordan 1. The remaining 94 have no reliable country in this inventory. These counts are **discovery distribution**, not verified gold category coverage. See the [bias audit](DATASET_BIAS_AUDIT.md).

## Acquisition and labeling boundary

Historical cases came from Nearr's existing v2 recognition input corpus, founder/regression/onboarding fixtures, and bounded read-only Development/Production correction audit. Two constructed composites and 28 Wikimedia Commons media controls were excluded from the real-social count. Production-only action URLs were retained only in an ignored restricted review queue because public status was unconfirmed. A Wrong Place event without a replacement target, an autosave, or silence after a result never supplies exact ground truth. Two demonstrably conflicting old classifications were downgraded to `UNVERIFIED`.

The new search inspected public Instagram posts in an existing browser session and six public YouTube Shorts. It recorded public source IDs, limited observed text, category/geography research, offset-only answer spans, and uncertainty. No social-media actions or mass scraping occurred. No copyrighted video or frame was committed or retained as a permanent dataset asset. See the [collection log](DATASET_COLLECTION_LOG.md), [Instagram collection notes](collection/INSTAGRAM_COLLECTION.md), [historical inventory](../recognition-gold-existing/README.md), and [sources](SOURCES.md).

`dataset_manifest.jsonl` is source-only. `dataset_labels_private.jsonl` holds provisional answers, aliases, depicted-versus-mentioned roles, place groups, confidence, provenance, and reviews. For unresolved posts, `proposed_places` is a review hypothesis; `expected_places` is empty. The private labels are in this worktree's ignored dataset directory and a local backup at `C:\Users\andre\Desktop\Nearr-gold-private-2026-10-08\dataset_labels_private.jsonl` (SHA-256 `EFEB6FAE4B022C9E72AAF3340247486E6E462146E5BFAD27759C86A4D4E190A1`). The backup includes manifest/split snapshots; it is local, not a team archival store. Transfer and hash-verify it in access-controlled durable storage before another machine or worktree is expected to reproduce labels. No held-out labels exist yet.

## Benchmark design and current gate

The [tooling](../../scripts/gold-dataset/README.md) validates IDs and source/place grouping, proposes connected-component splits, materializes five sanitized views, generates a local review page, scores outcome observations, and seals only an eligible private combined manifest. Inference input uses opaque IDs and neutral re-encoded frame names. It excludes source URLs/IDs, label data, original paths, answer annotations, split, and candidate cache. Mask eligibility requires human answer/overlay review; visual evidence requires permitted local frames and hashes. A seal requires 250+ total, 60–80 held-out posts from 60+ source groups, full visual evidence, independent human label review, and coverage gates. Historical exposed cases are forced into development. The current [split proposal](dataset_splits.json) has 124 development, zero calibration, zero held-out; a seal correctly refuses it.

The scorer handles exact singles, complete multi sets, no-place abstention, region-only geography, autonomous resolution, wrong-confident outcomes, time, and measured cost. A baseline can run only when a recognition adapter produces observations from materialized inputs; there is no permitted full-video input in this inventory and no calibration cases. Thus the [development](baseline_results_development.csv), [calibration](baseline_results_calibration.csv), and [held-out](HELDOUT_BASELINE_V1.json) baseline artifacts explicitly record `not_run`; they contain no invented metrics. The held-out one-time marker has not been created.

## Promotion path

First, recheck public access and rights for promising historical sources; collect permitted temporary frames for new and historical posts; independently review every exact and negative; finish all depicted/mentioned multi-place sets and temporal segments; audit text and visual overlays; and merge repost, creator-series, and place groups. Fill the absent slices deliberately: 40+ complete multi posts, 75–100 description-revealed posts with paired masks, 30–40 adjudicated misleading-metadata posts, 30+ branch cases, 30+ negatives, 50+ usable hard outdoor visual posts, and enough non-Instagram/geographic diversity. Then freeze a meaningful development/calibration split and a private, independently reviewed 60–80-case holdout. Run a bounded baseline only on ready development/calibration; the first held-out baseline should occur once after a valid seal. Do not optimize recognition on this candidate inventory.
