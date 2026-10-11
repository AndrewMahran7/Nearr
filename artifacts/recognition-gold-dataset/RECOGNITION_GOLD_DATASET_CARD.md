# Recognition dataset card

**DATASET SEALED; BASELINE NOT RUN. Snapshot 2026-10-11T00:33:08.172Z.** 347 canonical posts, 208 HIGH-confidence READY, 336 complete sampled-timeline reviews. READY classes: VERIFIED_EXACT_SINGLE: 124, VERIFIED_MULTI: 36, KNOWN_NEGATIVE: 46, VERIFIED_REGION_ONLY: 2.

Frozen READY allocation: 112 development, 34 calibration and 62 held out. Holdout contains 60 independent source/place components.

| Gate | Current | Minimum |
| --- | --- | --- |
| ready | 208 | 200 |
| complete_multi | 36 | 30 |
| outdoor | 95 | 50 |
| description_hidden | 208 | 50 |
| strong_visual_only | 68 | 30 |
| misleading_metadata | 26 | 25 |
| branch_disambiguation | 35 | 25 |
| verified_negative | 46 | 25 |
| sealed holdout cases | 62 | 60 |
| sealed independent source/place groups | 60 | 60 |

| Platform | All posts | READY |
| --- | --- | --- |
| youtube | 168 | 106 |
| instagram | 151 | 76 |
| facebook | 13 | 13 |
| tiktok | 14 | 13 |
| other | 1 | 0 |

Separate agent contexts performed source-timeline reviews and reference reconciliation; they are not independent human annotators. Review density varies among historical 1–2 fps packets and newer 4 fps packets. Strict heldout multis additionally require retained transition/tail review. No continuous audiovisual playback is claimed. Initial source-only freezes and later reference exposure are recorded separately; source captions alone do not establish depicted identity.

Canonical manifest, labels, source identities, complete captions, media, review packets, mappings and split membership remain private outside Git or in the ignored local evaluation directory. Public reports contain aggregate statistics. The preserved public source-history files and 207-row evidence CSV are not the runnable benchmark.

Inference receives only allowlisted creator evidence, neutral numbered JPEGs and source-derived duration/frame timestamps. Labels, source URLs/IDs, original paths, case/place groups, reviews, mappings and split assignments remain outside the input directory. Candidate-cache access is disabled. FULL/TEXT_ONLY may intentionally contain answer-bearing creator text; ordinary VISUAL_ONLY retains in-video text. These file-format controls do not by themselves isolate a runner with broad filesystem access.

Source sampling and access bias remain: tourism and natural scenes, especially waterfalls, are prominent; YouTube exceeds Instagram in current READY count; TikTok is underrepresented. No claim of population representativeness or 99% autonomous precision follows from dataset size. See DATASET_BIAS_AUDIT.md and PRIVATE_STORAGE_RECOVERY.md.
