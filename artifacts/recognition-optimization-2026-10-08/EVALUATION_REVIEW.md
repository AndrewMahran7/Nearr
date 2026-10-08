# Evaluation and Places integration review

Independent source review found no incorrect confidence promotion in the new Places session integration. It preserves input order, exact query semantics and credential/signal ownership; only successful responses are memoized; retries do not reuse failed responses; the shared session bounds nested destination/hypothesis concurrency; actual-call telemetry counts provider invocations. Pending cancellation still depends on the active provider releasing its permit. A non-finite concurrency argument is an API-hardening opportunity; current integration supplies the constant three.

The evaluation harness was hardened after its first valid baseline:

- Invalid failed/review outputs claiming autonomy are retained as invalid observations and counted as safety violations, rather than disappearing into an empty safe failure.
- Missing retained observations remain unavailable, excluded from measured correctness, with requested/observed counts reported separately. Unknown provider consumption remains unknown.
- Pairing rejects missing/duplicate cases, different groups, label revisions, split assignments and measurement boundaries. The CLI also checks both dataset hashes before comparing runs.
- The retained-policy adapter declares exactly which arms it supports. `baseline_repaired`, `winner` and `policy_parity` identify source captures of the same policy replay. It performs **no media or Places-session scheduling transform** and sets `performanceAblation: false`. Unsupported ablation names fail. Use the dedicated media/Places experiments for performance attribution.
- Non-Latin names retain their Unicode letters; unrelated Japanese names can no longer collapse to an empty matching key.
- Label-derived grouping keys and source-catalog classifications are withheld from the inference adapter. Internal case IDs and evidence paths remain provenance and must never be forwarded as model evidence by a future live adapter.
- An adapter cannot label its local replay as a different measurement boundary.

Twenty evaluation tests pass. A new `harness_hardening_validation` policy replay preserves all 31 cases and reports zero changed autonomous outcomes. Every one of the **36 original baseline files** is byte-identical to commit `424af92`; no baseline result or label was rewritten. The new validation run is separate and is not a new performance claim.

A read-only scan of the integration worktree's new artifact directory inspected 63 JSON files and 5 CSV files at review time. They parsed consistently and had no detected provider-key, JWT, signed-media-URL or private-CDN patterns. Public source references, public Places identifiers, opaque case IDs and group hashes remain intentionally present. Pattern checks complement provenance review; they are not a guarantee that arbitrary future artifacts cannot contain sensitive values.
