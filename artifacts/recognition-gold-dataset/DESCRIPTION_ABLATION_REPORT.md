# Materialized evidence ablations

Snapshot 2026-10-11T00:33:08.172Z: 886 current inputs, 0 failures.

| View | Cases | Rule |
| --- | --- | --- |
| FULL | 208 | Retained creator text/metadata, frames and captured speech if available |
| DESCRIPTION_HIDDEN | 208 | Caption, description and hashtags removed |
| LOCATION_HIDDEN effective | 11 | Populated location/geography removed |
| LOCATION_HIDDEN no-op | 40 | Compatibility duplicates; exclude from effect estimates |
| VISUAL_ONLY | 208 | Frames and source timing; legitimate pixel text retained |
| VISUAL_AUDIO | 4 | Frames plus captured spoken-audio transcript |
| TEXT_ONLY | 207 | Retained text; no frames |
| PIXEL_TEXT_MASKED | 0 | Not produced |

109 accepted cases are explicitly audited as description-revealed, among 116 such inventory rows. Technical DESCRIPTION_HIDDEN availability is a different count. Strong scene-only exact cases: 68. Generic negatives do not enlarge that count.

All current visual input paths align with source-derived timestamps and duration. Immutable generations include the full payload hash; the earlier generation is retained. Source timing does not contain labels. Only four historical VISUAL_AUDIO inputs contain retained speech sidecars. New negative-review ASR sidecars were not automatically forwarded as inference speech; direct acoustic listening is not claimed. No-op location-hidden duplicates are excluded from ablation-effect estimates.

Inference receives only allowlisted creator evidence, neutral numbered JPEGs and source-derived duration/frame timestamps. Labels, source URLs/IDs, original paths, case/place groups, reviews, mappings and split assignments remain outside the input directory. Candidate-cache access is disabled. FULL/TEXT_ONLY may intentionally contain answer-bearing creator text; ordinary VISUAL_ONLY retains in-video text. These file-format controls do not by themselves isolate a runner with broad filesystem access.

Recognition effect estimates: not run.
