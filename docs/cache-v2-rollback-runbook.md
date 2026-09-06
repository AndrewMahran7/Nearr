# Recognition Cache V2 rollback runbook

## Immediate safety action

Set the canonical Production Edge secret
`RECOGNITION_CACHE_READS_ENABLED=false`, redeploy the affected Edge workers if
the platform does not apply secrets dynamically, and verify health telemetry
reports reads disabled. This restores current fresh automatic recognition; it
must not restore legacy answer shortcuts or mandatory user search.

## Targeted component rollback

1. Capture current Production deployment IDs, Edge versions/digests, migration
   history, main SHA, and effective flag before changing anything.
2. Confirm no newer concurrent deployment owns the affected service.
3. Keep additive V2 tables, correction events, support history, revision data,
   and legacy invalidations. Do not destructively roll back the database.
4. If required, redeploy the recorded prior `process-share-jobs`,
   `create-share-job`, and media-worker artifacts while reads remain disabled.
5. Do not restore the old source-only or completed-job recognition shortcuts.
6. Run a fresh-recognition controlled smoke and confirm corrections still leave
   old V2 and legacy answers ineligible.

## Data and retry handling

Retain quarantined/disputed answers and failed work diagnostics. Abandoned V2
worker leases may be recovered by the bounded recovery function; never reset
feedback revisions to make an answer reusable. Exact controlled smoke fixtures
may be deleted by recorded IDs only. Organic saves, feedback, support history,
provider evidence, and benchmark artifacts must not be bulk-deleted.

## Forward recovery

Correct the defect on a branch from current `origin/main`, rerun deterministic
and real concurrency gates, deploy with reads off, and re-enable only after a
controlled cache-hit plus correction proof. Never rewrite Git history or deploy
over a newer release blindly.
