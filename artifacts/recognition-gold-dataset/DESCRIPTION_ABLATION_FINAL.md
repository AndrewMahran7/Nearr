# Description and modality ablation

Status: development pilot only. The final full-view heldout pair is running; masked-view heldout results are not claimed.

| Same five sources | Correct autonomous positives | Autonomous outputs | Wrong/unverified outputs | Total provider cost | p90 |
|---|---:|---:|---:|---:|---:|
| FULL | 0/4 | 0 | 0 | $0.49008920 | 12.097 s |
| DESCRIPTION_HIDDEN | 0/4 | 1 | 1 | $0.44405540 | 21.606 s |
| VISUAL_ONLY | 0/4 | 0 | 0 | $0.27304007 | 7.772 s |
| TEXT_ONLY lane | 1/4 | 2 | 1 | $0.52350290 | 5.129 s |

All five sources have immutable FULL, DESCRIPTION_HIDDEN and VISUAL_ONLY input variants; the latter retains legitimate text embedded in pixels. No pixel-text-masked experiment was run. The TEXT_ONLY row selects the same five cases from the larger frozen text-lane run: frames and Automatic Deep are disabled, so this is an architecture comparison as well as a modality ablation. It is not a causal estimate of removing images alone.

The pilot contains four exact positives and one negative. Every visual baseline variant failed the negative; returning no autonomous output does not by itself establish a correct negative decision. No arm identifies a reliable visual-only autonomous lane on this small pilot. Masking descriptions can create a wrong confident output, so missing metadata is not permission to lower the save gate.

On all development inputs, the full baseline resolves 16/78 positives versus 15/78 in the text lane; the text lane introduces 11 new wrong/unverified saves. Calibration confirms unsafe text-only coverage. Metadata contributes useful evidence, but neither source text alone nor generic scene similarity proves exact physical identity. LOCATION_HIDDEN and VISUAL_AUDIO neutral views are materialized where eligible, but have not received separate paid inference runs. No unrun view is assigned a result.
