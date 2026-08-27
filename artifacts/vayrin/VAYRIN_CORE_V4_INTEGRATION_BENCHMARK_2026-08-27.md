# Vayrin Core V4 Integration Benchmark — 2026-08-27

Deterministic replay only. No fresh paid inference is claimed.

- Deduplicated reviewable fixtures: 74
- Real recognition fixtures: 41
- Semantic contract controls: 33
- Truth tiers (real fixtures): {"VERIFIED":23,"HIGHLY_LIKELY":3,"PLAUSIBLE":10,"UNKNOWN":5}

## Frozen R01–R08

| Metric | Current frozen | Integrated V4 |
|---|---:|---:|
| Top-1 exact | 1 | 3 |
| Top-1 correct/plausible | 2 | 6 |
| Top-3 correct/plausible | ≥2 | 8 |
| Safe autosaves / autosave-capable | 2 | 4 (R03, R04, R05, R06) |
| Wrong autosaves | 3 | 0 |
| Partials | 1 | 2 |
| No result | 1 | 0 |
| Semantic nonsense | not separately recorded | 0 |
| Explicit geo contradictions | not separately recorded | 0 |

The integrated autosave count is policy eligibility under retained outputs, not a live save claim.

## Blind baseline comparison

- Wins: 6
- Ties: 2
- Losses: 0

## Cost and latency (retained hard cases)

- Hard invocation: 5/8 (62.5%)
- Mean / p50 / p95 cost: $0.145098 / $0.144966 / $0.214936
- Mean / p50 / p95 latency: 77670.4 / 93704 / 121714 ms
- Mean frames per hard case: 9.6
- Places calls across R01–R08: 13

Acquisition, extraction, ASR, and finalization phase splits were not captured by the retained replay and remain a live Nearr-Dev measurement gate.
