# Recognition gold dataset preparation

R&D complete through one frozen held-out comparison. The final candidate demonstrates a narrow cost improvement with unchanged held-out autonomous results; it is not a high-precision production system. See `RECOGNITION_BASELINE_FINAL.md`. Preparation counts and the original seal remain unchanged.

**DATASET SEALED; BASELINE AND FINAL CANDIDATE SCORED. Dataset snapshot 2026-10-11T00:33:08.172Z.** 347 canonical posts, 208 HIGH-confidence READY, 336 complete sampled-timeline reviews. READY classes: VERIFIED_EXACT_SINGLE: 124, VERIFIED_MULTI: 36, KNOWN_NEGATIVE: 46, VERIFIED_REGION_ONLY: 2.

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

Model metrics and paid experiment spend are not dataset-completion claims. Baseline and final candidate are scored under immutable milestones. Development and Production deployments were not performed by dataset preparation.

Final held-out baseline receipt: `b875537592f2e9acf38b6932e8c8da0f3bb433ced8cfd9a0763f90dc51776f8f`. Candidate receipt: `aee439e72117bbd9799e74d33190f4f533d633ff5dd2b6c2b2a7b24bad26630d`. Both froze before scoring; no individual held-out failure tuning followed.

READY geography covers 50 country labels; counts below are nonexclusive source-case appearances, not independent place groups: United States 65, Italy 8, Indonesia 7, Australia 6, France 6, Iceland 6, Portugal 6, Mexico 5, China 4, Japan 4, Poland 3, Singapore 3, Sri Lanka 3, Thailand 3, Bosnia and Herzegovina 2, Brazil 2, Costa Rica 2, Ghana 2, India 2, Mauritius 2, Philippines 2, Spain 2, Sweden 2, Albania 1, Armenia 1, Bhutan 1, Canada 1, Chile 1, Croatia 1, Cyprus 1, Czechia 1, Ecuador 1, Georgia 1, Guatemala 1, Jordan 1, Kazakhstan 1, Kuwait 1, Lesotho 1, Malaysia 1, New Zealand 1, Oman 1, Peru 1, South Korea 1, Taiwan 1, Turkey 1, Uganda 1, United Arab Emirates 1, United Kingdom 1, Vatican City 1, Vietnam 1. Negatives have no expected country.

Platform aspirations remain unmet: Instagram is not the largest READY slice and TikTok has 13 rather than 20. Truth standards were not relaxed to fill quotas.
