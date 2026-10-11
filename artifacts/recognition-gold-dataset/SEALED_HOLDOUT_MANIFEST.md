# Sealed holdout aggregate manifest

**DATASET SEALED; BASELINE AND FINAL CANDIDATE SCORED. Dataset snapshot 2026-10-11T00:33:08.172Z.** 347 canonical posts, 208 HIGH-confidence READY, 336 complete sampled-timeline reviews. READY classes: VERIFIED_EXACT_SINGLE: 124, VERIFIED_MULTI: 36, KNOWN_NEGATIVE: 46, VERIFIED_REGION_ONLY: 2.

Frozen READY allocation: 112 development, 34 calibration and 62 held out. Holdout contains 60 independent source/place components.

| Measure | Heldout | Calibration |
| --- | --- | --- |
| cases | 62 | 34 |
| independent_components | 60 | 31 |
| VERIFIED_EXACT_SINGLE | 48 | 22 |
| VERIFIED_MULTI | 8 | 4 |
| KNOWN_NEGATIVE | 6 | 6 |
| outdoor | 40 | 21 |
| business | 12 | 5 |
| branch | 12 | 4 |
| misleading | 14 | 7 |
| strong_scene | 29 | 15 |
| description_hidden | 62 | 34 |
| visual_only | 62 | 34 |

All original 207 source-history rows and every connected source/place component are excluded from strict holdout. Publicly exposed but otherwise unscored eligible cases may enter calibration; historical model-outcome exposure remains development only. Three older multis with insufficiently documented dense transition coverage are excluded from strict holdout. No unresolved linked-candidate quarantine component is used.

All heldout positive place groups are UNSEEN_PLACE relative to development/calibration at recorded accepted granularity. Negatives have no place identity; they are not counted as unseen places. Source, place, repost and explicit candidate links travel together.

Predeclared immutable milestones: baseline_v1, final_candidate_v1. One score per milestone and view. Tune only on development/calibration; freeze final configuration before final heldout inference. Do not use individual heldout failures for same-generation tuning. Manifest hash `6114876eced18915babed6e049e5cdae2ec16c1b6b139888aaf785fecbcd11d8`; labels hash `b5b72faca6d3a9eba14944e948a86489956da06c202881173627896bae1b08f7`; splits hash `f00b41b075c15a78af6a945fd6c95a69ad10c994170d073d88ab6bd356fb148f`.

Canonical manifest, labels, source identities, complete captions, media, review packets, mappings and split membership remain private outside Git or in the ignored local evaluation directory. Public reports contain aggregate statistics. The preserved public source-history files and 207-row evidence CSV are not the runnable benchmark.

Final held-out baseline receipt: `b875537592f2e9acf38b6932e8c8da0f3bb433ced8cfd9a0763f90dc51776f8f`. Candidate receipt: `aee439e72117bbd9799e74d33190f4f533d633ff5dd2b6c2b2a7b24bad26630d`. Both froze before scoring; no individual held-out failure tuning followed.
