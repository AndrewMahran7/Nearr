# Media preparation benchmark

The selected runtime improvement is **batching perceptual hashing of the existing JPEGs**. It preserves the repaired baseline's video seeks, timestamp plan, resizing, JPEG encoding, hashes and dedup survivors. No frame budget was reduced. Failed or truncated hashes now retain their frames instead of making unrelated images look identical.

The true one-decode alternative was implemented and rejected: it failed 3/16 development sources, including missing final output streams and queued-filter-buffer exhaustion. Its successful-source p90 was 11.587s versus 8.711s for baseline. Failure times are not included in that successful-source percentile; failures make the arm unacceptable regardless of timing.

## Corpus and frozen evaluation

Existing Wikimedia/public video cache: 26 source videos, of which 24 meet the current 180-second/150-MiB limits. Eiffel (950s/155MiB) and Kozjak (327s) were excluded before execution. No source was downloaded, recopied into an artifact, or assigned model-derived ground truth. The source catalog records source pages and licenses; several entries have only a general free-license note, which is insufficient authorization for a new permanent image corpus. This experiment only reads existing local evidence.

[MEDIA_BENCHMARK_PLAN.json](MEDIA_BENCHMARK_PLAN.json) predates implementation. [media_manifest.json](media_manifest.json) freezes input byte SHA256s, ffprobe facts, public source provenance and source-group splits. Cavitt A/B and La Jolla A/B stay together. There are 16 development sources, 4 calibration sources (two counterbalanced repetitions), and 4 held-out sources. [MEDIA_WINNER_FREEZE.json](MEDIA_WINNER_FREEZE.json), committed at `11c9c04`, selects batched hashing before held-out execution. Held-out means unseen **frame optimization outcomes**, not a new recognition generalization test: these source videos existed in prior recognition research.

Exact image/hash/dedup equality passed **28/28 paired runs over 24 unique sources**, including **4/4 held-out sources**. Three additional generated CFR/VFR/scene-transition controls preserve their complete evidence sequence. These controls are engineering fixtures, never real-place ground truth.

## Local latency

Seconds; quantiles interpolate at `(n-1)*p`. Windows, local FFmpeg 7.1, sequential source processing. Acquisition, model inference, provider transcription and client delivery are excluded.

| Cohort / arm | Runs / unique sources | p50 | p75 | p90 | p95 |
|---|---:|---:|---:|---:|---:|
| Development baseline | 16 / 16 | 6.469 | 7.669 | 8.711 | 8.950 |
| Development batch hash | 16 / 16 | 4.875 | 5.426 | 6.063 | 6.966 |
| Calibration baseline | 8 / 4 | 5.547 | 7.951 | 9.409 | 9.523 |
| Calibration batch hash | 8 / 4 | 3.897 | 5.477 | 8.360 | 10.248 |
| Held-out baseline | 4 / 4 | 6.056 | 6.917 | 7.076 | 7.129 |
| Held-out batch hash | 4 / 4 | 4.032 | 5.001 | 5.079 | 5.105 |

Held-out p50 improves 33.4%, p90 28.2%, p95 28.4%. Calibration p95 **worsens 7.6%** because one paired run is slower; 7/8 calibration pairs improve. Source-level descriptive bootstrap of median paired held-out reduction is 36.0% (95% interval 24.9–41.2%, 5,000 resamples). Four cases cannot establish a fleet percentile improvement. Development timing includes incidental local tooling load; calibration and held-out were run without local model inference. No exact-place or end-to-end latency improvement is inferred from these measurements.

`ffmpeg -benchmark` measures resources in calibration/held-out without altering image evidence. Across four held-out sources, process launches fall **162→85**, average summed child CPU **4.848→4.217s/source**, peak single-child RSS **104,068→104,096KiB**. This is a process-startup reduction with similar peak memory; it is not a GPU optimization. CPU statistics have the platform timer's granularity. No provider/image-token saving is claimed because the model receives identical frames.

## Parallel audio/frame arm

`prepareMediaEvidence` offers two joined branches. Platform captions retain precedence. Audio extraction/ASR and frame extraction can overlap, then both results join before OCR/model analysis. Expected failed ASR still returns visual evidence. Parent cancellation reaches both children; a fatal branch aborts its sibling, and all started work settles before temp cleanup. Independent timings and the critical-path wall time are recorded separately.

A local generated four-second audio/video control ran four independent arms, three repetitions each. Audio WAV SHA256, JPEG SHA256s, frame hashes/timestamps and transcript payload match **12/12**. The ASR provider is a **fixed simulated 1,000ms delay**; no paid provider was called.

| Scheduling control | p50 seconds | p90 seconds |
|---|---:|---:|
| Baseline repaired | 2.397 | 3.195 |
| Batch hash only | 1.802 | 2.027 |
| Parallel only | 1.317 | 1.461 |
| Batch + parallel | 1.096 | 1.106 |

This establishes scheduling/evidence behavior under a controlled network wait, not real ASR latency or a forecast of user-perceived gains. Batch hashing is the default. Parallel preparation remains available with `MEDIA_PARALLEL_PREPARATION_ENABLED=true`, **off by default** pending shared-worker concurrent CPU/memory qualification. The worker currently runs multiple jobs; one extra simultaneous FFmpeg child per job must be load-tested before enabling globally.

## Frame selection and multi-place

Baseline timestamp coverage and the 24-frame cap remain. Existing diverse selection already uses temporal strata; neither it nor a smaller 4/6/8/12-frame budget has been shown to preserve all required places on a labeled temporal multi-place corpus. The exact-parity winner cannot remove a brief second place that the baseline sampled. It cannot recover a brief sign the baseline never sampled either. Better scene/text/quality selection needs source-aligned place/segment labels and downstream recognition runs, so smaller budgets are rejected as defaults here.

## Reproduce

From `services/media-worker`, point `--media-root` at the existing cache:

```text
npm run benchmark:media-parity -- --split development --media-root <cache>
npm run benchmark:media-parity -- --split calibration --variants baseline_repaired,batched_hash --repeats 2 --media-root <cache>
npm run benchmark:media-parity -- --split held_out --variants baseline_repaired,batched_hash --media-root <cache>
npm run benchmark:media-preparation
```

Result files use exclusive creation and cannot silently overwrite a baseline. Use a new `--name` for a new generation, preserving the original manifest/split. Run `python scripts/eval/summarizeMediaBenchmark.py` from the worktree to regenerate [MEDIA_METRICS.json](MEDIA_METRICS.json) and [media_latency_results.csv](media_latency_results.csv). Raw JSON retains per-frame hashes and failures; no frames/video are committed. Exact paid spend: **$0.00**.

## Additional FFmpeg compatibility qualification

The integrated worker suite exposed a version compatibility failure after selection: local Scoop FFmpeg **9.0.1** rejects the removed `-vsync` option, so batch hashing returned unknown hashes and correctly retained duplicate frames. The benchmark used local Anaconda FFmpeg **7.1**, where that option succeeds. This was not CPU contention. The command now uses the equivalent output option `-fps_mode passthrough`, which passes each frame with its timestamp, as specified by the [FFmpeg documentation](https://ffmpeg.org/ffmpeg.html#Advanced-options).

Both installed versions passed the unchanged static-video dedup assertion and the CFR/VFR/duplicate-scene parity integration test after the fix (**2/2 tests per binary**). That parity test now also requires every synthetic frame to have a valid hash, preventing two failed hash paths from appearing equal. JPEG SHA256, timestamps, hashes, and selected survivors match between the legacy and batch arms **within each binary**; cross-version JPEG equality is not claimed. These are additional synthetic engineering controls, not fresh held-out recognition observations or a new model/strategy selection. Original corpus results and latency measurements remain intact.

The Dockerfile installs distribution FFmpeg through an unpinned `node:22-slim` apt repository. The local Docker Linux daemon was unavailable, so the exact container FFmpeg binary and deployed image were not exercised. A build/runtime parity check remains required before deployment. Failure logs now include bounded exit-code/timeout metadata without media paths or raw stderr.
