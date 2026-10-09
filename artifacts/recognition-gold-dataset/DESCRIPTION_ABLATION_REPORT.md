# Actual evidence ablations

Snapshot 2026-10-09T21:14:03.025Z. Materialization created or byte-checked 452 current inputs across 109 accepted source cases; 0 failures. These are saved runnable evidence inputs, not eligibility estimates and not model results.

| View | Actual cases | Evidence rule |
| --- | --- | --- |
| FULL | 109 | All retained source text/metadata, frames and any captured speech transcript |
| DESCRIPTION_HIDDEN | 109 | Remove caption, description and hashtags; retain genuine speech and other permitted metadata |
| LOCATION_HIDDEN | 13 | Remove location tag and structured source geography |
| VISUAL_AUDIO | 4 | Retained frames plus spoken-audio transcript; no social metadata |
| VISUAL_ONLY | 109 | Retained frames only, including legitimate in-video text |
| TEXT_ONLY | 108 | Retained text/transcript/metadata; no frames |
| VISUAL_PIXEL_TEXT_MASKED | 0 | Not produced; no claim that OCR text was erased |

Only 62 inventory cases are explicitly audited/tagged description-revealed; 55 are accepted. This conservative discovery subset is separate from the 109 technically materialized description-hidden cases. Unreviewed heuristics are not used to reach 75/50. 22 accepted exact cases qualify as strong scene-only; generic negative examples do not enlarge that number.

FULL represents all **retained** evidence, not automatic native-video or continuous-audio inference. Most videos have no captured transcript; four have local Whisper speech sidecars with two-model cross-checks, timestamp/model/media hashes and visible subtitle checks. Direct acoustic listening was unavailable. Audio has not been synthesized, transcribed from the caption, or converted into a truth label. One accepted case has no usable text-only evidence. LOCATION_HIDDEN is counted only where an actual source location/geography field is removed, avoiding meaningless duplicate variants.

Caption/description/tag hiding is distinct from hiding pixel text. Ordinary VISUAL_ONLY preserves overlays, subtitles, venue signs and watermarks. No pixel-text-masked study is claimed. Neutral JPEG re-encoding strips image metadata; inference fields are allowlisted, original paths/IDs and answer annotations are absent, mappings remain private, and candidate caches are disabled.

Baseline metrics for all six views are **NOT RUN** because the completion gates failed. Exact top-1, correct autonomous, autonomous precision, review rate, wrong-confident rate and candidate recall are unavailable, not zero. Future paired comparisons must use matching case IDs and a frozen label/group; multiple views are not independent source examples.
