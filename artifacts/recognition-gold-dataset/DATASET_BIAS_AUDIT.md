# Dataset bias and limits

**DATASET SEALED; BASELINE NOT RUN. Snapshot 2026-10-11T00:33:08.172Z.** 347 canonical posts, 208 HIGH-confidence READY, 336 complete sampled-timeline reviews. READY classes: VERIFIED_EXACT_SINGLE: 124, VERIFIED_MULTI: 36, KNOWN_NEGATIVE: 46, VERIFIED_REGION_ONLY: 2.

| Platform | All posts | READY |
| --- | --- | --- |
| youtube | 168 | 106 |
| instagram | 151 | 76 |
| facebook | 13 | 13 |
| tiktok | 14 | 13 |
| other | 1 | 0 |

The corpus is a deliberately difficult, access-constrained sample, not a random sample of all social posts. Tourism, nature and waterfalls are overrepresented. Business/branch, misleading and no-place slices are retained in holdout and calibration, but per-slice intervals remain wide. Repeated branches share connected components; source count does not equal independent evidence count. Seen/unseen status follows explicit accepted group granularity rather than inferred model pretraining familiarity.

Metadata ablations share sources and are paired observations, not extra independent cases. No-op LOCATION_HIDDEN inputs are excluded from effect estimates. Baseline/provider latency and cost remain unmeasured.

Separate agent contexts performed source-timeline reviews and reference reconciliation; they are not independent human annotators. Review density varies among historical 1–2 fps packets and newer 4 fps packets. Strict heldout multis additionally require retained transition/tail review. No continuous audiovisual playback is claimed. Initial source-only freezes and later reference exposure are recorded separately; source captions alone do not establish depicted identity.
