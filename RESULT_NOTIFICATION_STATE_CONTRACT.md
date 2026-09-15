# Authoritative result and notification state contract

## Authority

`share_jobs.status` plus its terminal result fields are the durable authority. Candidate payloads are evidence snapshots; notification payloads are delivery snapshots. Neither may override the current job state.

| Durable status | Queue | Detail / Quick Check | Notification | Tap behavior |
|---|---|---|---|---|
| `queued` | Queued | non-actionable progress | none | fetch current job if an older push is tapped |
| `processing_metadata` + metadata stage | Getting post info | non-actionable progress | none | same |
| `processing_metadata` + media stage | Analyzing video | non-actionable progress | none | same |
| `processing_metadata` + verification stage | Checking possible places | non-actionable progress | none | same |
| active age ≥ 90 seconds | Taking longer than usual; background work continues | non-actionable progress | none | same |
| `needs_help` | Needs your review | candidate/partial/manual review matching persisted decision | review/result copy | route by `jobId`, fetch current state |
| `failed` | Couldn't identify this one / technical-failure copy | failure/retry; no candidate picker | failure copy | route by `jobId`, fetch current state |
| `completed` | leaves active queue | current saved result | completion copy | route by `jobId`, fetch current state |
| `cancelled` | hidden | non-actionable dismissed state | none | current state wins |

## Invariants

1. A technical failure cannot coexist with a High-match Quick Check surface.
2. Reviewable suggestions require `status=needs_help`; true processing failure requires `status=failed`.
3. Parked candidates may remain in storage for replay/diagnostics, but `failed` hides them from actionable presentation.
4. Role-limited/partial suggestions are Low/discovery-only unless independently grounded.
5. Notification copy is derived from the same final facts used for the guarded terminal update. `status=failed` always wins over candidate-count hints.
6. Every modern share notification includes `jobId`. On tap, the client opens that job's detail and fetches current state. Snapshot `reviewMode`, failure code, saved-place ID, or outcome never bypasses the current row.
7. Thus a needs-review push tapped after completion opens the current completed result; a failure push tapped after recovery opens the current review result.
8. While processing, queue locality comes only from `extraction_payload.sourceGeography`. A speculative candidate address may provide imagery internally but cannot be labeled as known source geography.
9. Refresh keeps the last readable job list while realtime/polling updates arrive; no new percentage or provider-internal wording is exposed.

## Failure and recovery transitions

- Transient external failures may requeue within existing bounded retry policy.
- Deterministic database/schema contract violations are non-retryable and terminalize on the first occurrence.
- A later explicit recovery may transition through the existing retry RPC back to active processing; any old notification remains only a snapshot because taps re-fetch by job ID.
- User selections and corrections use the existing guarded canonical save path and remain authoritative.

## Long-running threshold

The 90-second threshold is based on the recent Development media-task p90 of 96.265 seconds and normal (<10 minute) total p90 of 104.290 seconds. It is an acknowledgment threshold, not a timeout. Work continues and the UI tells the user they can leave Nearr and will be notified.
