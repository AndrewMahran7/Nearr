# Automatic Deep Recognition release evidence

This directory contains Development-only release-proof output. No Production rows were mutated by these runs.

## Final release-gate runs

- `runs/automatic-deep-production_free-2026-09-06T02-00-43-961Z/`
  - Corrected worker with `AUTOMATIC_DEEP_RECOGNITION_ENABLED=false`.
  - Regression v2: Exact@1 7/31, Exact@3 7/31.
  - System isolation, zero wallet delta, zero Premium reservations, and zero wrong autosaves all passed.
- `runs/automatic-deep-auto_deep_candidate-2026-09-06T02-17-37-160Z/`
  - Same worker image with `AUTOMATIC_DEEP_RECOGNITION_ENABLED=true`.
  - Regression v2: Exact@1 9/31, Exact@3 9/31.
  - Improvements: R04 and R08. No exact-match regression versus the final disabled arm.
  - System isolation, zero wallet delta, zero Premium reservations, and zero wrong autosaves all passed.
- `runs/automatic-deep-auto_deep_candidate-2026-09-06T02-28-57-811Z/`
  - Founder-12: 9/9 expected recoveries, zero technical failures, zero manual fallbacks, and all isolation assertions passed.
- `runs/automatic-deep-auto_deep_candidate-2026-09-06T02-35-40-675Z/`
  - Founder-4: 4/4 useful results; all 3 expected deep cases recovered.
  - F4-01 required two attempts and recovered only on the distinct second pass.
  - The normal-path control did not invoke deep recognition.

## Persisted 42-video cliff benchmark

The deterministic benchmark source and rescored outputs live under the repository's cliff-benchmark artifact directory. The final rescore made no model, acquisition, web, or map calls. It preserves exact child identities when providers return only a parent:

- Simple Sol raw Exact@3: 27/28; specificity-safe canonical Exact@3: 27/28.
- Accuracy Max raw Exact@3: 28/28; specificity-safe canonical Exact@3: 28/28.
- 42/42 media acquired; 0 technical failures.
- CJ009 retains Waimea Bay Jump Rock and records Waimea Bay Beach Park only as its provider parent.
- CJ016 retains The Arch at Pappy's Point and records Sunset Cliffs Natural Park only as its provider parent.

## Superseded diagnostic runs

All other timestamped directories are retained as development audit history. They are not release evidence. They include prompt-development runs, interrupted runs, pre-fix runs, and a disabled-arm run made before the explicit canonical flag/default-off correction. In particular, `automatic-deep-production_free-2026-09-06T01-45-46-029Z` is invalid for comparison because runtime isolation failed.

Ground truth was applied only after blind observations and attempts were written. Secret scanning is part of the artifact validator; credentials and access tokens are not recorded.
