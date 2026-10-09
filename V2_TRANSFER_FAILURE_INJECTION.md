# V2 transfer failure injection — LOCAL PASS, OVERALL V2 FAIL

`scripts/testSafeOnboardingV2Failure.sql` ran against an isolated PostgreSQL 18 restore of the post-repair Production backup with the rejected V2 candidate installed locally. Injected exceptions after parent move/child update, during duplicate-source copy, during destination-note merge, and before grant completion each rolled back save, source, and grant changes. It also rejected a historical v1 owner-mismatch fixture, a foreign saved-place UUID carried by an anonymous job, a queued job, and conflicting destination notes. Retry after a lost completion response was covered in `scripts/testSafeOnboardingV2Core.sql`.

This proves only those tested rollback paths. The candidate failed the independent real two-session late-child race in `V2_TRANSFER_CONCURRENCY_REPORT.md`. Failure-injection passes cannot waive that absolute stop. No Production V2 mutation occurred.
