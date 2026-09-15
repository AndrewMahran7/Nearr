# Recognition latency waterfall — founder job `d6382d4cd48f`

All timestamps are UTC. Database timestamps are exact; recording-aligned client observations are approximate. The private source URL is excluded.

## Result

- Durable row: `00:04:29.680604`.
- Terminal decision: `00:08:05.087`.
- Total persisted duration: **215.406 s**.
- Final row update: `00:08:05.524416` (**215.844 s** after creation).
- Notification submit attempt: `00:08:05.276389` to `00:08:05.473` (**197 ms**).
- Attempts: **5 of 5**; four retries.
- Worker tasks/runs: **0 / 0**.
- Media/model/worker provider calls: **0**.

## Stage waterfall

| Stage | Start | End | Wall time | Queue/wait | Active | Retries/calls | Outcome |
|---|---:|---:|---:|---:|---:|---:|---|
| Client share → durable row | ~00:04:22.681 | 00:04:29.680604 | ~7.0 s | not retained | not retained | 0 | accepted |
| First metadata/candidate pass | ≥00:04:29.680604 | ~00:04:36.681 | ≤7.0 s | not separable | not separable | call count not retained | Prada candidates parked |
| Media-task insert | within each Edge attempt | same attempt | not retained | 0 | DB request | 5 attempts | deterministic NOT NULL failure |
| Retry/recovery envelope | 00:04:29.680604 | 00:08:05.087 | 215.406 s | dominant | small repeated metadata/DB work | 4 retries | attempts exhausted |
| Worker pickup | — | — | 0 | 0 | 0 | 0 | never started |
| Download/acquisition | — | — | 0 | 0 | 0 | 0 | never started |
| Audio / Whisper | — | — | 0 | 0 | 0 | 0 | never started |
| Frames / OCR | — | — | 0 | 0 | 0 | 0 | never started |
| Gemini | — | — | 0 | 0 | 0 | 0 | never started |
| Sol | — | — | 0 | 0 | 0 | 0 | never started |
| Worker Places / callback | — | — | 0 | 0 | 0 | 0 | never started |
| Terminal persistence | 00:08:05.087 | 00:08:05.524416 | 437 ms | 0 | 437 ms | 0 | failed committed |
| Client terminal observation | 00:08:05.087 | ~00:08:05.681 | ≤594 ms | polling/realtime not separable | — | — | queue item disappeared |
| Notification submission | 00:08:05.276389 | 00:08:05.473 | 197 ms | 0 | 197 ms | 1 Expo call | submitted |
| Notification visible | ~00:08:16.681 | — | ~11.2 s after submit | OS/network | — | — | visible |
| Quick Check visible | ~00:08:21.681 | — | ~5 s after push | user interaction/render | — | — | contradictory candidate picker |

The historical row does not retain individual claim, metadata, or metadata Places timestamps. Five claims are exact from `attempts=5`; the per-minute cron configuration and 215-second envelope show that retry wait dominated, but inventing exact per-claim timestamps would be false precision. See `recognition_latency_trace.csv` for explicit precision labels.

## Top bottlenecks

1. **Misclassified permanent failure + cron retry wait:** four retries expanded a fast schema violation into a 215-second terminal outcome.
2. **Duplicated metadata resolution:** each reclaimed job re-entered `processOne` before hitting the identical enqueue boundary. Per-attempt active time/call count was not retained, so it is not numerically fabricated.
3. **Observability gap:** no per-attempt/stage timing existed, preventing exact split of metadata network, Places, and cron wait. This did not cause latency, but materially extended diagnosis and concealed the true bottleneck from the product UX.

Notification submission and client observation were not material bottlenecks. Worker/model performance was not involved in this incident.

## Measured fixes

| Fix | Before | After / expected impact | Quality risk |
|---|---:|---:|---|
| Correct media-task JSON contracts | every insert failed | insert succeeds once; worker starts | none; separates source geography from AI-note evidence |
| Permanent schema-error classification | 5 attempts / 215.406 s to failure | 1 attempt; expected terminal failure within the initial Edge pass if a future contract error occurs | none; only deterministic DB contract signatures bypass retries |
| Role/geography-aware queries | unscoped `Prada`; US candidates | Greece-scoped queries and country filtering | no breadth loss within supported geography; visual/media path unchanged |
| 90-second long-running notice | 180 seconds | 90 seconds | none; work continues in background |
| Structured stage timing | only aggregate row/task/run timestamps | exact Edge metadata/enqueue and worker acquisition/ffmpeg/transcription/frame/OCR/model events | none; diagnostic logging only |

No model was removed, no frame/transcription stage was skipped, no global confidence threshold was lowered, and candidate breadth was not reduced solely for speed.

## Internal latency targets

These are operational targets, not user promises:

- durable share acknowledgment: ≤2 s target; ≤5 s recovery bound;
- job-to-media-task creation: p90 ≤3 s (current p90 2.161 s);
- first meaningful context/progress: ≤5 s;
- normal recognition completion: p75 ≤75 s, p90 ≤105 s;
- long-running acknowledgment: 90 s;
- active media hard timeout/recovery: existing 480 s worker timeout; deterministic contract failures fail immediately rather than waiting for it.

The 7-day Development cohort and its limitations are in `RECOGNITION_LATENCY_COHORT.md`.
