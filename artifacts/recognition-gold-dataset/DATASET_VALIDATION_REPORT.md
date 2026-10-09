# Final local validation

Completed 2026-10-09 at 21:15:12 UTC against a fixed collection snapshot: **207 posts, 109 READY, 196 complete-timeline visual reviews**. The canonical files did not change during this audit. This is a collection verification snapshot, not a sealed holdout.

| Check | Result |
| --- | --- |
| Manifest and label Draft 2020-12 schemas, including formats | 0 errors |
| Source MP4 SHA-256 | 196 verified; 1,082,136,670 bytes |
| Retained original-pixel frame SHA-256 | 3,231 verified; 405,386,438 bytes |
| READY reviewer identities, frame timestamps and segment bounds | All 109 pass; at least two distinct reviewers each |
| Complete multi coordinates and coordinate sources | 15 videos / 61 depicted places; 0 gaps |
| Expected evidence views and allowlisted inference payload equality | All 452 inputs match; 0 missing or unexpected views |
| Neutral materialized JPEGs, mapping/hash/file inventories | 4,852 verified frame references; no EXIF/XMP/Photoshop metadata |
| Private identity/path fields and cache access in inference inputs | 0 leaks found; candidate caches disabled |
| Dataset tooling tests | 22 passed, 0 failed |
| Application/recognition changes, provider calls, baseline calls | None |

Current evidence views: FULL 109, DESCRIPTION_HIDDEN 109, LOCATION_HIDDEN 13, VISUAL_AUDIO 4, VISUAL_ONLY 109, TEXT_ONLY 108. Authentic creator text in permitted modalities and text embedded in video pixels are intentional evidence, not label-store leakage. Only 22 cases qualify as strong scene-only exact recognition examples.

Canonical SHA-256 fingerprints:

- Private manifest: `1458cc737ddfcf7cbf3cfd6602380e0db262d019b94ab5232148ca93c5ed0abe`
- Private labels: `d544b4f89b84f52ca8ed36a332efbd298c09c5ffe466c9106896ddef898ee059`
- Private splits: `00f04592d21c6040f69908f87c5dcf377ac8f8b834abb7e16166d867dc4737f1`
- Current materialization batch: `766b52e3a0c9d256cea567839a5df7f7f64e477b8eb09a5047f146ce31fb7908`

Detailed checks, original/source hash records and per-input results remain in the external private `audit_final_verification` directory and recovery package. The public digest list reveals no labels or captions. Git whitespace checks passed. No inference adapter or recognition model was run. Dataset completion remains **NOT READY**: see [DATASET_COMPLETION_GATE.md](DATASET_COMPLETION_GATE.md).
