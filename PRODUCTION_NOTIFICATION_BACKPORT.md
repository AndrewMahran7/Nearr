# Isolated Production notification backport (staged, NOT deployed)

Production `process-share-jobs` is active v123, Edge bundle SHA-256 `578f81df4c87b54ec178ee0ce32aadd35be527d6d6f30c0760a0bb8add925339`, `verify_jwt=false`. Its downloaded `index.ts` SHA-256 `F8D83FBD2FDCF785C252185952BD453C5F1E43EB463022BFFCFDFAF346CD077F` matches `origin/main` byte-for-byte. The working-tree backport index hash is `41248524F7AB3F4D4B81EC84F397A9699612B99E5A58D84164B14729F721F752`; the new authority helper hash is `908870290A2915911B05284E2CD8250A4DDDF39447D01511D83A6589EBF37D1B` (pre-commit working-file hashes, not a deployed bundle hash).

Only the October 8 approved `45cedb7` notification behavior was ported to that v123 source:

- Import `authoritativeShareJobNotification` from the approved pure helper.
- After an atomic `claim_share_job_notifications`, reread `share_jobs.id,user_id,status,notification_status,notification_payload,notification_attempts,notification_max_attempts`. Reject a missing/nonterminal/mismatched job or payload before calling Expo. Use the current row's user/payload rather than the claim snapshot. On read failure, leave `sending` for stale-claim recovery; on invalid current state, mark failed without sending.
- Log notification dispatch start. On successful `finalize_media_task`, drain pending notifications immediately; keep the existing sweep and receipt handling unchanged as fallback.

No result composition, title/body/type/deep link, recognition model, threshold, prompt, cache, candidate generation, Jev, Railway, monetization, or database notification state change is in the diff. The current `share_job_completed`/`share_job_needs_help` payload still carries `data.jobId`. A read-only aggregate of Production rows with non-null notification payload found 900/900 with `data.jobId = share_jobs.id`; this does not prove future payloads or device delivery.

Local proof: TypeScript typecheck; `test:result-notifications`; `test:notification-tap-routing`; Deno worker boot/auth guard; `testProductionNotificationBackport.ts` (old route/payload, authority rejection, immediate and cron drains). **Not proven:** simultaneous finalize/sweep/worker sends, provider-accepted-but-timeout duplicates, transient retries, state changes between reread and provider send, actual device receipt/foreground presentation. The existing SQL claim uses `FOR UPDATE SKIP LOCKED`, but a claim/read/send sequence is not a single transaction with Expo; the requested no-duplicate guarantee still needs adversarial integration testing before deployment.
