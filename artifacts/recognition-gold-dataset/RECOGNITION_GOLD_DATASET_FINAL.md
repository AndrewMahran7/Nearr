# Recognition gold dataset preparation

R&D progress after the preparation snapshot: the first five-case development pilot is frozen and scored, and the remaining development baseline is running. Its aggregate metrics and tariff-based spending are tracked in `RECOGNITION_EXPERIMENT_LEDGER.csv`. No held-out inference or winner selection has occurred. The preparation counts and seal below remain unchanged.

**DATASET SEALED; BASELINE NOT RUN. Snapshot 2026-10-11T00:33:08.172Z.** 347 canonical posts, 208 HIGH-confidence READY, 336 complete sampled-timeline reviews. READY classes: VERIFIED_EXACT_SINGLE: 124, VERIFIED_MULTI: 36, KNOWN_NEGATIVE: 46, VERIFIED_REGION_ONLY: 2.

Frozen READY allocation: 112 development, 34 calibration and 62 held out. Holdout contains 60 independent source/place components.

| Slice | READY |
| --- | --- |
| ready | 208 |
| complete_multi | 36 |
| outdoor | 95 |
| description_hidden | 208 |
| visual_only | 208 |
| strong_visual_only | 68 |
| misleading_metadata | 26 |
| branch_disambiguation | 35 |
| verified_negative | 46 |

| Platform | All posts | READY |
| --- | --- | --- |
| youtube | 168 | 106 |
| instagram | 151 | 76 |
| facebook | 13 | 13 |
| tiktok | 14 | 13 |
| other | 1 | 0 |

Reviewed selected evidence contains 10546 retained frames; current materialization contains 886 input views with 0 failures. Multis contain 126 depicted-place appearances, with 0 missing coordinates.

Separate agent contexts performed source-timeline reviews and reference reconciliation; they are not independent human annotators. Review density varies among historical 1–2 fps packets and newer 4 fps packets. Strict heldout multis additionally require retained transition/tail review. No continuous audiovisual playback is claimed. Initial source-only freezes and later reference exposure are recorded separately; source captions alone do not establish depicted identity.

Canonical manifest, labels, source identities, complete captions, media, review packets, mappings and split membership remain private outside Git or in the ignored local evaluation directory. Public reports contain aggregate statistics. The preserved public source-history files and 207-row evidence CSV are not the runnable benchmark.

Model metrics and paid experiment spend are not dataset-completion claims. Baseline is not run in this snapshot. Development and Production deployments were not performed by dataset preparation.
