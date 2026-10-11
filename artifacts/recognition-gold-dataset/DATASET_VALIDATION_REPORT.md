# Final local validation

**DATASET SEALED; BASELINE NOT RUN. Snapshot 2026-10-11T00:33:08.172Z.** 347 canonical posts, 208 HIGH-confidence READY, 336 complete sampled-timeline reviews. READY classes: VERIFIED_EXACT_SINGLE: 124, VERIFIED_MULTI: 36, KNOWN_NEGATIVE: 46, VERIFIED_REGION_ONLY: 2.

Frozen READY allocation: 112 development, 34 calibration and 62 held out. Holdout contains 60 independent source/place components.

| Check | Result |
| --- | --- |
| Manifest/labels Draft2020-12 schemas and formats | 0 |
| Original source MP4 hashes checked | 336 |
| Retained selected-frame hashes checked | 10546 |
| Source/frame integrity errors | 0 |
| Input views matched to current inference payload | 886 |
| Input/mapping/hash/private-field errors | 0 |
| Neutral materialized JPEG files checked | 27246 |
| READY cases missing two reviewer IDs | 0 |
| Timestamp/segment integrity errors | 0 |
| Complete multi cases / depicted places | 36 / 126 |
| Missing multi coordinates | 0 |

All source/selected-frame checks refer to saved bytes. Eleven historical cases lack saved source media/hashes and remain outside READY. All current payloads include neutral source timing. Cache access is disabled; private labels, paths, IDs and split records remain outside inference input folders. Authentic creator text and text visible in pixels are permitted evidence.

Canonical snapshot SHA-256 fingerprints:

- benchmark_manifest_private.jsonl: `6114876eced18915babed6e049e5cdae2ec16c1b6b139888aaf785fecbcd11d8`
- benchmark_labels_private.jsonl: `b5b72faca6d3a9eba14944e948a86489956da06c202881173627896bae1b08f7`
- benchmark_splits_private.json: `f00b41b075c15a78af6a945fd6c95a69ad10c994170d073d88ab6bd356fb148f`
- materialization_batch_private.json: `3d4abe4f771103e9f586e56414609a37abf9db31a0579e48676385ee3f2222d0`

Current input hash aggregate: `83a432a781c18ca03b7f648f825c30567a639d3664d6379e6e3bde9c072f71da`. The private audit retains complete inventories and validation details; public reports contain no fresh source identities or truth labels.

Separate agent contexts performed source-timeline reviews and reference reconciliation; they are not independent human annotators. Review density varies among historical 1–2 fps packets and newer 4 fps packets. Strict heldout multis additionally require retained transition/tail review. No continuous audiovisual playback is claimed. Initial source-only freezes and later reference exposure are recorded separately; source captions alone do not establish depicted identity.

No recognition provider call or model baseline was performed by dataset preparation. Code testing and later experiments are reported by their own validated records. Collection gates pass and the strict split is sealed; see DATASET_COMPLETION_GATE.md and SEALED_HOLDOUT_MANIFEST.md.
