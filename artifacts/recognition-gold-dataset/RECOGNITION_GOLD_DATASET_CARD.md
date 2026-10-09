# Nearr recognition dataset — visual collection snapshot

**NOT READY FOR OPTIMIZATION — 2026-10-09T21:14:03.025Z.** The original zero-ready inventory has become 109 accepted cases with retained visual evidence, private truth, independent agent review and actual sanitized inputs. The requested complete benchmark is unfinished. See the exact deficits in [DATASET_COMPLETION_GATE.md](DATASET_COMPLETION_GATE.md).

| Measure | Count |
| --- | --- |
| Distinct source posts / source groups | 207 / 206 |
| Complete-timeline visual reviews | 196 |
| HIGH READY | 109 |
| READY classes | VERIFIED_EXACT_SINGLE: 53, VERIFIED_MULTI: 15, KNOWN_NEGATIVE: 39, VERIFIED_REGION_ONLY: 2 |
| Remaining candidate classes | UNVERIFIED: 91, AMBIGUOUS: 6, KNOWN_NEGATIVE: 1 |
| Retained reviewed frames / READY frames | 3231 / 1451 |
| Actual sanitized inference inputs | 452 |
| Calibration / sealed holdout / baseline calls | 0 / 0 / 0 |
| Paid provider/API spend | $0.00 |

The original 124-row `dataset_manifest.jsonl` and its split file remain the preserved source-history inventory. The current runnable corpus is the ignored `.local/recognition-gold-dataset/benchmark_manifest_private.jsonl`, `benchmark_labels_private.jsonl`, and `benchmark_splits_private.json`. These include full source evidence and private truth; do not commit them. A recovery copy and all collection overlays live in the external private evaluation folder.

Reviewers were separate agent contexts, not independent human annotators. They inspected complete 1 fps or 2 fps contact-sheet timelines, including opening, middle, ending and scene changes; this is not a claim of continuous audiovisual playback. Rapid events between samples remain a limitation. Case promotion required source-specific visual observations and independent place corroboration, not caption agreement alone.

Normal visual-only preserves legitimate pixel text. Strong scene-only exact cases are counted separately (22); generic no-place frames are not counted as strong place-recognition cases. Source categories overlap and candidate tags are never accepted labels. Geography below counts accepted cases per adjudicated country; a multi-country video appears in both countries, and no-place cases have no justified country.

| Country | Accepted case appearances |
| --- | --- |
| Indonesia | 2 |
| Costa Rica | 2 |
| Japan | 3 |
| Jordan | 1 |
| United States | 43 |
| Singapore | 2 |
| not_established | 39 |
| Italy | 3 |
| Australia | 2 |
| Spain | 2 |
| France | 3 |
| Albania | 1 |
| Mexico | 2 |
| Portugal | 1 |
| South Africa | 1 |
| New Zealand | 1 |
| Vatican City | 1 |
| Iceland | 1 |

Temporary source MP4s, complete captions, frame/contact-sheet evidence, hashes, audio sidecars and private labels live at `C:\Users\andre\Desktop\Nearr-gold-private-2026-10-08`. Ignored `.local/recognition-gold-dataset` contains combined private files, second-pass review packets, neutral materialized inputs and case mappings. No video, original frame, full caption or private label is committed. Historical retention ends 2026-11-07; newer caches end 2026-11-08. Use the earlier date for a combined archive unless rights are re-reviewed. Cleanup is documented, not scheduled or performed.

The local directory is not durable recovery storage. Its Windows ACL grants the user, administrators, SYSTEM and the local Codex sandbox group access. No approved private archival bucket/team folder was established. Follow [PRIVATE_STORAGE_RECOVERY.md](PRIVATE_STORAGE_RECOVERY.md) for the required founder storage decision and restore check. Application/recognition behavior, Development and Production were not changed. Only dataset evidence, documentation and necessary dataset gate corrections changed.
