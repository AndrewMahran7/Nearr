# Production compatibility

The migration is additive to the 13+ consent schema and is not a Production deployment instruction. Current Production lacks the full 1.7 schema, retains separate Production-only migrations, and has a legacy enabled worker. Do not push Development migrations wholesale. Keep the prepared Production containment candidate separate; no temporary pause was published.

Legacy clients do not acquire Terms, Privacy, AI or guardian permission implicitly. Existing fail-closed queue/worker boundaries remain necessary, and installed old iOS client direct-provider behavior cannot be completely attested without the unavailable signed IPA/OTA bundle. A future rollout needs a fresh backup, exact source/Edge compatibility and old-instance retirement.
