# Development recognition latency cohort

Generated `2026-09-15T00:54:59.985Z` from Development Supabase `qnfxnmvxpjzfydgudtvs`.

## Cohort definition

- Window: prior 7 days, beginning `2026-09-08T00:54:59.382Z`.
- Bound: latest 500 terminal jobs; 57 remained after exclusions.
- Excluded: `nearr-e2e` idempotency keys and tutorial-fixture runs.
- Environment: Development only. No Production job/content cohort was queried.
- Composition: 23 completed, 27 needs-help, 7 failed; 41 media tasks; 41 run rows (40 with usable active duration).

## Distributions

| Metric | n | p50 | p75 | p90 | p95 | min | max |
|---|---:|---:|---:|---:|---:|---:|---:|
| All terminal job duration | 57 | 46.553 s | 98.079 s | 3,247.075 s | 3,253.019 s | 1.256 s | 359,970.331 s |
| Normal terminal jobs ≤10 min | 50 | 44.333 s | 75.407 s | 104.290 s | 145.203 s | 1.256 s | 221.247 s |
| Job → media-task created | 41 | 1.620 s | 1.875 s | 2.161 s | 4.860 s | 1.037 s | 6.967 s |
| Media-task terminal duration | 41 | 43.114 s | 65.768 s | 96.265 s | 104.867 s | 16.817 s | 211.526 s |
| Retained active media run | 40 | 37.680 s | 46.011 s | 64.588 s | 81.387 s | 12.681 s | 107.885 s |
| Task non-run overhead | 40 | 4.004 s | 4.876 s | 11.569 s | 41.268 s | 2.231 s | 57.708 s |

Seven jobs were terminalized more than ten minutes after creation. They dominate all-job p90/p95 and represent delayed recovery/terminalization rather than continuous provider execution; they are reported, not silently discarded. The ≤10-minute slice is separately labeled and used only to characterize normal interactive recognition.

## Interpretation

- Queue-to-media insertion is already fast (p90 2.161 s), so worker wake/initial Edge dispatch was not optimized blindly.
- Active media work is the normal dominant stage (p50 37.680 s), but the founder job never entered it.
- Normal total p90 is 104.290 s and media-task p90 is 96.265 s. A 90-second “taking longer” acknowledgment is early enough to be useful while remaining near the observed upper tail.
- The founder's 215.406-second failure is comparable to the task max but has a different cause: Edge cron retries before any task existed.
- Historical provider sub-stages were not retained; only current aggregate task/run diagnostics were available. New structured logs close that gap for future jobs.

## SLO basis

- Share acknowledgment target: 2 seconds; recovery bound 5 seconds.
- Media-task creation target: p90 ≤3 seconds.
- First meaningful context/progress: 5 seconds.
- Normal terminal recognition: p75 ≤75 seconds, p90 ≤105 seconds.
- Long-running notice: 90 seconds.
- Hard active worker timeout: existing 480 seconds; task retry/recovery policy remains bounded.

The cohort script is `scripts/auditRecognitionLatencyCohort.ts`. It emits only aggregate measurements and no URLs, captions, user IDs, or place names.
