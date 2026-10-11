# Latency and cost by measured tier

Status: development/calibration only; the sealed pair is running. Tiers below are mutually exclusive paths selected from the recorded provider calls. Every case runs the cheap visual/text model; no metadata-only early exit passed calibration.

All times start at retained-evidence inference and end at finalization planning. Source acquisition, new frame extraction, historical transcript generation, queueing, database I/O and device rendering are outside the boundary. The candidate retains full baseline latency plus measured local policy overhead, even for avoided Deep calls. This is a conservative replay bound, not a measured deployed speedup.

| Split / tier | Cases | Correct autonomous / positives | Precision | Autonomous coverage | p50 | p75 | p90 | p95 | Mean provider cost |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| development / visual + Places | 45 | 16/45 | 16/19 | 19/45 | 5.096s | 5.925s | 7.472s | 10.503s | $0.075795 |
| development / Deep review/recovery | 33 | 0/32 | undefined (0 saves) | 0/32 | 18.812s | 26.384s | 39.448s | 43.218s | $0.161589 |
| development / early review after empty pass | 34 | 0/1 | undefined (0 saves) | 0/1 | 6.227s | 7.141s | 7.765s | 10.739s | $0.002084 |
| calibration / visual + Places | 17 | 3/16 | 3/7 | 7/16 | 9.039s | 10.816s | 11.523s | 15.430s | $0.069253 |
| calibration / Deep review/recovery | 11 | 0/10 | undefined (0 saves) | 0/10 | 18.804s | 21.217s | 25.458s | 27.332s | $0.109030 |
| calibration / early review after empty pass | 6 | 0/0 | undefined (0 saves) | not applicable | 11.244s | 11.658s | 13.690s | 14.666s | $0.002533 |

Deep remains review-only in the repaired baseline. None of its 67 development or 17 calibration cases ended autonomously before the new stopping policy. Removing all Deep would lose useful review candidates; only the valid-empty subset is selected for early review. Other weak, partial and multi-place sources still receive the existing Deep path.

Provider request durations overlap; their sums represent work, not wall time. No summed stage durations are offered as a durable-job critical path. A fresh deployed timing run and physical device QA remain necessary for the omitted stages. Local OCR averages about 4.1 seconds of preprocessing on this corpus and has not earned inclusion in the selected path.
