# Evidence reuse boundary

No new shared persistent evidence cache was activated. The selected implementation reuses frames within a job, hashes the already extracted JPEGs in a batch, and memoizes successful exact-semantics Places responses for one recognition execution. These are bounded engineering reuse mechanisms, not authoritative answers.

Existing source artifacts can support local replays and retries under current access controls. A successful empty Places response is memoizable for that execution; transport/provider failures are evicted. Different credentials or cancellation owners never coalesce. There is no shared global memo table or cross-user answer.

The media manifest groups related Cavitt and La Jolla clips before splitting, preventing those source pairs from leaking across frame-evaluation groups. It does not establish a general cross-platform repost detector. No measured repost cache-hit rate or live acquisition/ASR saving is available. Repeated same-video retrieval is a control, not evidence of cross-platform place accuracy.

A future persistent cache needs separate immutable evidence keys (source identity plus byte hash, extraction/provider version and access scope), explicit rights/retention policy, expiry, provenance, and correction generations. Answer entries additionally need exact identity qualification, model/policy versions, Wrong Place quarantine, user-scoped rejection and fresh contradictory evidence checks. No cache entry may promote review or failed state. Cache and quarantine regression suites remain required even while answer reads are suspended.

Current artifacts contain hashes and public provenance, not copied media, private CDN URLs, model weights or a permanent Google image corpus. Historical private evidence is not licensed for broader redistribution merely because it was available locally.
