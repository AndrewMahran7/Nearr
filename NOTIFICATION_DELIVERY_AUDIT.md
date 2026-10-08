# Notification delivery audit

Date: 2026-10-08
Environment: Nearr-Dev (`qnfxnmvxpjzfydgudtvs`) only

## Measured timeline

The sanitized source data is in `notification_timing.csv`; the reproducible read-only query is `scripts/auditNotificationTiming.sql`. IDs are irreversible short hashes and no user identifiers, tokens, URLs, captions, or place content are included.

| Stage | Persisted source | Meaning |
|---|---|---|
| T0 ingress | Not retained in the audited notification row | Share/job arrival |
| T1 result ready | `completed_at` | Terminal result committed |
| T2 decision/queue | Same terminal transaction as T1 | Notification payload/status becomes eligible atomically |
| T3 dispatch start | `notification_last_attempt_at` | Worker claims and starts delivery |
| T4 provider accepted | `notification_submitted_at` | Expo push provider accepted the request |
| T5 client received | Not observable server-side | Requires physical client telemetry |
| T6 presented/suppressed | Not historically retained | Evaluated by current foreground policy |

Two rows with provider acceptance measured T1-to-T3 at 0.664 seconds and 17.617 seconds; provider submission then took 0.316 seconds and 0.188 seconds respectively. One diagnostic row completed at `00:17:07.757Z` and was attempted at `00:18:01.493Z`, a 53.736-second gap.

The matching scheduler runs began at `00:17:00.040Z` and `00:18:00.088Z`. The result became ready just after the first sweep and waited for the following minute. This proves the founder's approximately one-minute delay was created by Nearr's minute cron polling, not by measured APNs/device latency. Server acceptance is not evidence of client receipt.

Some old no-token rows have a later rewritten `completed_at`; those are preserved and labeled in the CSV but must not be used for latency arithmetic. App state, client receipt, and historical suppression were not observable and remain explicitly `unknown`.

## Implemented delivery path

When `process-share-jobs` successfully finalizes a media task, it now immediately invokes `processPendingNotifications`. The existing every-minute sweep remains a recovery fallback, not the primary delivery trigger. The target for Nearr-controlled T1-to-T3 latency is seconds under normal load; the fallback cadence is still up to roughly 60 seconds if the event-driven attempt cannot run.

Immediately after a notification claim, the function re-reads the authoritative share-job row and validates that:

- the row still exists and belongs to the payload user;
- the payload job ID matches the row;
- the row is still in a terminal or sending state;
- the current persisted notification payload is valid.

Invalid or stale claims are rejected and permanently failed without sending. Existing atomic claim/finalize behavior preserves idempotency; transient delivery failures remain retryable through the sweep.

## Foreground presentation contract

`lib/notificationForegroundPolicy.ts` suppresses a share-result notification only when the app is active and the user is already viewing `/share-jobs/{the same jobId}`. It does not suppress:

- background/inactive delivery;
- a result for a different job;
- nearby-place reminders;
- other notification classes.

`app/_layout.tsx` publishes the current route to that policy, and `lib/notifications.ts` applies it in the Expo notification handler.

## Appearance warning investigation

Repository search found no app-owned `Appearance.addChangeListener` subscription and no app-level warning suppression. The retained logs supplied for this work did not include the complete warning text, so its exact origin cannot be proven from available evidence. The partial founder report is consistent with a React Native development-only `RCTAppearance` warning. It was not hidden with `LogBox`; physical QA should capture the complete warning if it recurs so an upstream/native dependency can be identified without guesswork.

## Regression proof

`npm run test:notification-delivery-policy` covers authoritative-row validation, mismatched payload rejection, terminal-state requirements, exact-screen suppression, unrelated foreground presentation, and nearby foreground presentation. Existing result-notification, tap-routing, share-job-routing, and worker-boot suites remain green.
