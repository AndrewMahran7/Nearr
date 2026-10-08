# Visual retrieval and geometric verification

**Executed locally; rejected for runtime activation.** Incremental paid spend: $0. No GPU service or production dependency was added. The frozen [plan](RETRIEVAL_PILOT_PLAN.json), [input manifest](evidence/retrieval-pilot-results-inputs.json), [outputs](evidence/retrieval-pilot-results.json), and [model hashes](evidence/retrieval-model-checksums.json) make the boundary explicit.

## Method and rights

Used 12 existing public Commons video files, with uploader descriptions and licensing links inherited from the curated source catalog. Frames remain in ignored local scratch; no media or model weights are committed. The gallery has 30 frames from 10 locality groups. There are 10 temporal queries from the same videos and four queries from two other source clips. Cavitt A/B share a source creator and location; these are related views, not independent geographic generalization. Both La Jolla labels remain quarantined for exact-place scoring because source description/category and views do not establish identical exact POIs. They count only in this explicitly broader locality retrieval exercise.

The compact [EigenPlaces](https://github.com/gmberton/EigenPlaces) ResNet18 512-D checkpoint ran on the available RTX 3050 6GB GPU. Code was pinned to `a2969f71d5ea31017443af490b15273ca4c50af1`; strict full checkpoint loading preserves its reviewed inference architecture without the redundant CosPlace warm-start download. The project uses an [MIT license](https://github.com/gmberton/EigenPlaces/blob/main/LICENSE). Country filtering uses an explicitly supplied source-catalog prior; it is not an inferred correct-place hint. Unknown country searches the full gallery. Some country subsets have one candidate and cannot demonstrate useful discrimination.

After descriptor retrieval, only the top three distinct locality candidates receive [DISK + LightGlue](https://github.com/cvg/LightGlue) matching through [Kornia](https://www.kornia.org/tutorials/nbs/image_matching_lightglue.html). No restrictive SuperPoint weights are used. The frozen overlap check requires at least eight homography-RANSAC inliers and a 0.2 inlier fraction at four pixels. This checks visual correspondence, not venue identity. Thresholds were not tuned after outputs.

## Results

| Query boundary | n frames / groups | Recall@1 | Recall@3 | Recall@5 |
|---|---:|---:|---:|---:|
| Same-video temporal control | 10 / 10 | 10/10 | 10/10 | 10/10 |
| Other source clip, locality granularity | 4 / 2 | 2/4 | 4/4 | 4/4 |

Global and country-filtered recall counts were equal. The same-video result measures repeat evidence matching and is not place-recognition generalization. Four queries from two groups are insufficient for a robust accuracy estimate.

Geometric overlap supported 11/14 same-locality comparisons but also **3/22 different-locality comparisons**. The other-source subset supported 2/4 positives and incorrectly supported 1/8 negatives. Repeated water/rock texture can create persuasive but false correspondence. These failures block using this pilot as automatic identity authorization.

| Local operation | n | p50 ms | p75 ms | p90 ms | p95 ms |
|---|---:|---:|---:|---:|---:|
| EigenPlaces descriptor, includes first inference | 44 | 10.19 | 14.93 | 24.23 | 41.25 |
| DISK feature extraction | 31 cached frames | 53.34 | 61.97 | 70.12 | 92.51 |
| LightGlue pair matching | 36 | 49.07 | 60.14 | 72.94 | 129.97 |

Homography estimation, image decoding and model startup/download are separate from those timings. Total descriptor storage for 44 frames is 90,112 bytes; the 30-reference gallery itself needs 61,440 bytes. Peak CUDA allocation for the combined pilot was 877,640,704 bytes. These single-machine measurements do not forecast Railway latency or hosted GPU costs.

## Decision

Keep the Python prototype evaluation-only. No nearest-neighbor autosave, new provider, production index, or Google imagery collection. MegaLoc and SigLIP 2 were not run: this compact pilot first exposed inadequate independent reference coverage and a failed geometric safety threshold. Model substitution cannot establish exact correctness without better references and adjudicated query labels. The next retrieval generation needs licensed independent views of many verified places, hard same-region negatives, minimum spatial coverage checks, and a new frozen test set; do not retune the present four queries and call it held-out improvement.
