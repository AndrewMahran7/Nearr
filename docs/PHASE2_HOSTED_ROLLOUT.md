# Phase 2 hosted rollout

## Current verdict

**Hosted infrastructure is ready for a one-user canary.** On 2026-08-03, the
Railway development worker reported healthy and ready with all required
providers configured, concurrency `1`, and all media flags disabled. The new
per-place result ledger migration remains forward-only and must pass the release
gate before the updated worker and finalizer are deployed.

Provider retries are now bounded, jittered, `Retry-After` aware, and covered by
deterministic tests. Partial transcript/OCR evidence survives a transient Gemini
failure, while a complete Google Places outage is retried instead of being
misclassified as no-match.

Railway development is linked to project `Nearr Phase 2 Dev`, service
`media-worker`. It is the only worker target for this canary; no production
Railway service is used.

Keep `MEDIA_FALLBACK_ENABLED`, `INSTAGRAM_MEDIA_RESOLVER_ENABLED`, and
`NATIVE_VIDEO_ANALYSIS_ENABLED` set to `false` throughout infrastructure setup.
Keep Edge secrets `MEDIA_AUTO_SAVE_ENABLED=false` and both exact-user canary
IDs absent until their respective rollout steps.
No client or EAS build is required to disable or roll back Phase 2.

## Release gate

Complete these gates in order. Stop at the first failure.

1. Review the Phase 2 commit and run the local checks:

   ```powershell
   npm run typecheck
   npm run test:prebuild
   deno check --no-config --sloppy-imports supabase/functions/process-share-link/index.ts
   deno check --no-config --sloppy-imports supabase/functions/process-share-jobs/index.ts
   Push-Location services/media-worker
   npm run typecheck
   npm test
   docker build -t nearr-media-worker:phase2 .
   Pop-Location
   ```

2. Test all five migrations against a disposable local database:

   ```powershell
   npx supabase db reset
   npx supabase db lint
   docker cp scripts/seedTestUsers.sql supabase_db_Nearr:/tmp/seed.sql
   docker exec supabase_db_Nearr psql -U postgres -d postgres -f /tmp/seed.sql
   docker cp scripts/testShareMediaRls.sql supabase_db_Nearr:/tmp/rls.sql
   docker exec supabase_db_Nearr psql -U postgres -d postgres -v user_a=11111111-1111-4111-8111-111111111111 -v user_b=22222222-2222-4222-8222-222222222222 -f /tmp/rls.sql
   docker cp scripts/testShareMediaDurability.sql supabase_db_Nearr:/tmp/durability.sql
   docker exec supabase_db_Nearr psql -U postgres -d postgres -v user_id=11111111-1111-4111-8111-111111111111 -f /tmp/durability.sql
   docker cp scripts/testShareMediaRecovery.sql supabase_db_Nearr:/tmp/recovery.sql
   docker exec supabase_db_Nearr psql -U postgres -d postgres -v user_id=11111111-1111-4111-8111-111111111111 -f /tmp/recovery.sql
   docker cp scripts/testDatabasePrivileges.sql supabase_db_Nearr:/tmp/privileges.sql
   docker exec supabase_db_Nearr psql -U postgres -d postgres -f /tmp/privileges.sql
   ```

3. Confirm the hosted migration history. These versions are already applied and
   the dry-run must report the linked database is up to date:

   ```powershell
   npx supabase migration list --linked
   npx supabase db push --linked --dry-run
   ```

   Applied versions:

   ```text
   20260801000001_share_media_tasks.sql
   20260801000002_share_media_worker.sql
   20260801000003_share_media_task_recovery.sql
   20260801000004_explicit_privileges.sql
   20260801000005_aux_privileges.sql
   ```

   Confirm no Edge deployment is currently in progress. Both reviewed functions
   are deliberately redeployed only at gate 9.

4. Verify the post-migration state read-only. Both rows must report RLS, no
    client policies may exist, both crons must be active, and both tables must be
    empty before deployment:

    ```sql
    select c.relname, c.relrowsecurity
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
       and c.relname in ('share_media_tasks', 'share_media_runs');

    select count(*) from pg_policies
    where schemaname = 'public'
       and tablename in ('share_media_tasks', 'share_media_runs');

    select jobname, active from cron.job
    where jobname in ('process-share-jobs-sweep', 'process-media-tasks-sweep');

    select (select count(*) from public.share_media_tasks) as tasks,
               (select count(*) from public.share_media_runs) as runs;
   ```

5. Link and review the existing Railway development target. Do not use the
   production environment for the canary:

   ```powershell
   railway link --project 4037a3b5-d66f-409e-b734-56c22c244e3e --environment development --service media-worker
   railway status
   ```

   Provision the required worker variables. Enter secrets interactively with
   `railway variable set NAME --stdin --skip-deploys` or use the Railway
   dashboard. Never pass secrets as command arguments or store them in the
   repository. Set all flags explicitly to `false` before deployment:

   ```text
   SHARE_MEDIA_WORKER_SECRET
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   SHARE_JOBS_FINALIZE_URL
   MEDIA_TRANSCRIPTION_PROVIDER=openai
   MEDIA_TRANSCRIPTION_API_KEY
   MEDIA_TRANSCRIPTION_MODEL
   MEDIA_ANALYSIS_PROVIDER=gemini
   GEMINI_API_KEY
   GEMINI_MODEL
   MEDIA_WORKER_MAX_CONCURRENCY=1
   MEDIA_WORKER_CLAIM_BATCH=2
   MEDIA_WORKER_CLAIM_LOCK_SECONDS=600
   MEDIA_RETRY_BASE_SECONDS=30
   MEDIA_RETRY_MAX_SECONDS=900
   MEDIA_MAX_DURATION_SECONDS=180
   MEDIA_MAX_DOWNLOAD_BYTES=157286400
   MEDIA_DOWNLOAD_TIMEOUT_MS=60000
   MEDIA_JOB_TIMEOUT_MS=480000
   MEDIA_MAX_SELECTED_FRAMES=24
   PORT=8080
   MEDIA_FALLBACK_ENABLED=false
   INSTAGRAM_MEDIA_RESOLVER_ENABLED=false
   NATIVE_VIDEO_ANALYSIS_ENABLED=false
   ```

   Optional authenticated retrieval variables are `MEDIA_FETCH_PROVIDER_URL`,
   `MEDIA_FETCH_PROVIDER_API_KEY`, `MEDIA_FETCH_PROVIDER_AUTH_HEADER`,
   `MEDIA_FETCH_PROVIDER_URL_PARAM`, and `MEDIA_FETCH_PROVIDER_RESULT_PATH`.
   Do not reuse `SHARE_JOBS_WORKER_SECRET` as `SHARE_MEDIA_WORKER_SECRET`.

   Pin `GEMINI_MODEL` before the canary. Do not use the moving
   `gemini-flash-latest` alias for a controlled cost/behavior comparison.

6. Deploy current code only after every required variable is present, then
   confirm the hosted worker is alive and honestly ready:

   ```powershell
   railway up services/media-worker --path-as-root --service media-worker --environment development
   railway deployment list --service media-worker --environment development
   curl.exe -fsS https://media-worker-development.up.railway.app/health
   curl.exe -fsS https://media-worker-development.up.railway.app/ready
   railway logs --service media-worker --environment development --lines 100
   ```

   `/health` and `/ready` must both return HTTP 200. Logs must contain no source
   URL query strings, tokens, media bytes, or raw model responses.

7. Store the worker endpoint and the same dedicated invocation secret in Vault.
   Enter values directly in the Supabase SQL editor or another secret-safe
   channel; do not put them in shell history or this repository.

   ```sql
   select vault.create_secret('<WORKER_BASE_URL>', 'share_media_worker_url');
   select vault.create_secret('<SHARE_MEDIA_WORKER_SECRET>', 'share_media_worker_secret');
   ```

8. Smoke-test infrastructure while all flags remain off:

   ```sql
   select to_regclass('public.share_media_tasks') as media_tasks,
          to_regprocedure('public.claim_media_tasks(integer,integer)') as claim_rpc,
          to_regprocedure('public.requeue_media_task(uuid,integer,text)') as requeue_rpc,
          to_regprocedure('public.claim_stranded_media_parents(integer)') as recovery_rpc;

   select jobname, schedule, active
   from cron.job
   where jobname in ('process-share-jobs-sweep', 'process-media-tasks-sweep')
   order by jobname;

   select name
   from vault.secrets
   where name in ('share_media_worker_url', 'share_media_worker_secret')
   order by name;

   select public.invoke_process_media_tasks();

   select status, count(*)
   from public.share_media_tasks
   group by status
   order by status;
   ```

   Both crons must be active, both Vault names must exist, and the worker must
   log the authenticated empty-queue invocation. Confirm a normal metadata-only
   share still follows Phase 1 and creates no `share_media_tasks` row.

9. Only after gates 1-8 pass, deploy the changed Edge Function.
   `process-share-jobs` uses the existing dedicated Phase 1 worker-secret check.

   ```powershell
   npx supabase functions deploy process-share-jobs --no-verify-jwt
   ```

   Repeat the Phase 1 metadata-only smoke test with all global Phase 2 flags
   false. Stop on any authentication, notification, queue, or save regression.

## One-task canary

**Prepared only; do not execute during infrastructure readiness.** Use internal
user `<INTERNAL_USER_ID>` and the known public media-poor test URL
`https://www.instagram.com/p/DYbLVMBp_dY/`. Confirm immediately before use that
it is still public and appropriate for the test.

1. Keep all global media flags and `MEDIA_AUTO_SAVE_ENABLED` false. Set server-only
   `PHASE2_CANARY_USER_ID=<INTERNAL_USER_ID>` under the Supabase project's Edge
   Function secrets/environment settings. The value must be one exact UUID;
   invalid values enable nothing. Deploy the reviewed `process-share-jobs` code
   only after the release gate is green.
2. In Railway development only, set `MEDIA_FALLBACK_ENABLED=true` and
   `INSTAGRAM_MEDIA_RESOLVER_ENABLED=true`; leave
   `NATIVE_VIDEO_ANALYSIS_ENABLED=false`. Redeploy and require `/ready` HTTP
   200. This lets the private worker process an allowlisted task; task creation
   remains restricted to the exact Edge canary user.
3. Record the internal user's current saved-place count. Then, using that user's
   access token, create exactly one job and capture `jobId`:

   ```powershell
   $body = @{ url = 'https://www.instagram.com/p/DYbLVMBp_dY/'; clientRequestId = 'phase2-controlled-canary-001' } | ConvertTo-Json
   Invoke-RestMethod -Method Post -Uri 'https://<PROJECT_REF>.supabase.co/functions/v1/create-share-job' -Headers @{ Authorization = 'Bearer <INTERNAL_USER_ACCESS_TOKEN>' } -ContentType 'application/json' -Body $body
   ```

4. Verify one non-auto-save Phase 2 result first. Only then set
   `MEDIA_AUTO_SAVE_ENABLED=true` and
   `MEDIA_AUTO_SAVE_CANARY_USER_ID=<INTERNAL_USER_ID>`. Both controls must match
   for an automatic save; either one disables automatic saving immediately.
5. Track only `<SHARE_JOB_ID>` and verify bounded attempts and stage changes:

   ```sql
      select id, status, progress_stage, decision, saved_place_id,
         needs_help_reason, failure_reason, last_error,
          created_at, updated_at, completed_at
   from public.share_jobs
   where id = '<SHARE_JOB_ID>';

   select id, share_job_id, status, progress_stage, attempts, max_attempts,
          next_attempt_at, failure_code, resolver_name,
          transcription_provider, analysis_provider,
          created_at, updated_at, completed_at
   from public.share_media_tasks
   where share_job_id = '<SHARE_JOB_ID>';

   select share_media_task_id, resolver_name, model_provider,
          transcription_provider, duration_ms, frame_count,
          transcript_segment_count, ocr_segment_count, warnings, errors,
          created_at
   from public.share_media_runs
   where share_job_id = '<SHARE_JOB_ID>'
   order by created_at;

   select status, decision, progress_stage, saved_place_id,
          candidate_payload->>'version' as payload_version,
          coalesce(jsonb_array_length(candidate_payload->'mentionSlots'), 0)
            as mention_slot_count,
          notification_status, notification_attempts,
          notification_submitted_at, notification_error_code
   from public.share_jobs
   where id = '<SHARE_JOB_ID>';

   select place_id, count(*)
   from public.saved_places
   where user_id = '<INTERNAL_USER_ID>'
   group by place_id
   having count(*) > 1;
   ```

6. Confirm exactly one media task, one notification reservation on the parent,
   no duplicate `place_id`, and no automatic save unless every deterministic
   gate requirement is recorded in `share_job_place_results`.
   Remove the resolved/completed job through the normal mobile queue action; do
   not delete database rows manually.
7. Accept only one of these outcomes: deterministic verified auto-save under the
   exact-user gate, deterministic result presented for confirmation, safe
   `needs_help`, or bounded retry followed by safe `needs_help`. Reject any save
   based on model confidence alone, duplicate save, stranded parent, leaked
   media URL, or unbounded retry.
8. Confirm worker logs show temp cleanup after success, failure, cancellation,
   or timeout and contain no source URL query, token, media bytes, or raw model
   response. Verify no files remain under the configured temp root.
9. To roll back, return both Railway worker flags to `false`, set
   `MEDIA_AUTO_SAVE_ENABLED=false`, remove both exact-user IDs, redeploy the
   worker and `process-share-jobs`, and require `/ready` HTTP 200 with the
   redacted worker flags false. Keep durable diagnostic rows until the audit is
   complete.

## Global configuration

Use the same server controls after the one-user release gates pass:

- Global analysis: set Edge secrets `MEDIA_FALLBACK_ENABLED=true` and
   `INSTAGRAM_MEDIA_RESOLVER_ENABLED=true`, and remove
   `PHASE2_CANARY_USER_ID`.
- Global auto-save: set `MEDIA_AUTO_SAVE_ENABLED=true` and remove
   `MEDIA_AUTO_SAVE_CANARY_USER_ID`.
- Auto-save off, analysis on: set `MEDIA_AUTO_SAVE_ENABLED=false`; no redeploy
   or mobile build is required for the secret update.
- Phase 2 off: set Edge secrets `MEDIA_FALLBACK_ENABLED=false` and
   `INSTAGRAM_MEDIA_RESOLVER_ENABLED=false`, remove `PHASE2_CANARY_USER_ID`, and
   leave the Phase 1 worker/sweep active.
- Instagram retrieval off: set Edge and Railway
   `INSTAGRAM_MEDIA_RESOLVER_ENABLED=false`.
- Native analysis off: set Railway `NATIVE_VIDEO_ANALYSIS_ENABLED=false`.
- Pause processing: set Railway `MEDIA_WORKER_MAX_CONCURRENCY=1`, then disable
   the media sweep or stop the Railway service only after in-flight work drains.

None of these rollback actions requires an app build, App Store release,
database rollback, or deletion of user data.

## Mobile five-place audit

The development fixture is compiled only under `__DEV__`; it cannot create a
production result. Use an existing development build, not EAS:

```powershell
npx expo start --dev-client
```

Open `/share-jobs/phase2-five-pizza-preview` on a physical device. Verify:

- exactly five top-level place cards are visible and scroll safely;
- one verified place is preselected;
- the ambiguous mention starts unselected and allows only one location;
- the already-saved place opens its existing map item and is not counted again;
- the unmatched place offers manual search;
- `X Eats at Brewery X` is one relationship card and the host-only candidate is
  not treated as verified;
- the button label changes between `Save 1 place`, `Save N places`, and
  `Save selected places`;
- successful saves remain saved if another selection fails, and retry keeps
  only failed selections pending.

No new native build is required when a compatible development client is already
installed. The main-app JavaScript changes are EAS Update-capable for a matching
runtime, but this fixture is deliberately unreachable in production because of
its `__DEV__` guard. If no compatible development client exists, a development
build would be required later. Do not create an EAS build or publish an EAS
Update as part of this rollout.

## Approximate per-task cost

This is an **engineering estimate, not a billing quote**. At the hard 180-second
limit, Whisper pricing of `$0.006/minute` contributes at most `$0.018`. Gemini
Flash processes at most 24 JPEG frames plus a small text/JSON response; budget
`$0.001-$0.01` until a model is pinned and measured. Google Places verification
varies by mention count, requested fields, SKU, and account credits; reserve
`$0.01-$0.20` for a five-place result. Railway compute and network egress are
plan-dependent.

Use a conservative initial budget of **about `$0.03-$0.23` per five-place
task**, plus Railway. Record actual provider usage from the one-task canary
before setting any daily cap or enabling more traffic. The moving Gemini alias
and variable Google Places SKU make a more exact pre-canary number misleading.

## Immediate rollback

1. Set all three flags to `false`, remove `PHASE2_CANARY_USER_ID`, and redeploy
   `process-share-jobs` plus Railway. Verify the worker's redacted flag summary.
2. Stop dispatch and the worker:

   ```sql
   select cron.unschedule('process-media-tasks-sweep');
   ```

   ```powershell
   railway down --service media-worker --environment development --yes
   ```

3. Leave Phase 1's `process-share-jobs-sweep` active. Do not modify its Vault
   entries, authentication bridge, or worker secret.
4. Inspect parked parents. The Phase 1 recovery sweep must move failed or
   cancelled media parents to safe `needs_help`; never force them to completed:

   ```sql
   select sj.id, sj.status, mt.status as media_status, mt.attempts,
          mt.failure_code, sj.updated_at
   from public.share_jobs sj
   join public.share_media_tasks mt on mt.share_job_id = sj.id
   where sj.status = 'processing_metadata'
   order by sj.updated_at;
   ```

5. If the new Edge source regresses Phase 1, deploy the known pre-readiness
   source from `e5a18ce` through a temporary worktree. Do not reset or alter the
   active checkout:

   ```powershell
   git worktree add ..\Nearr-edge-rollback e5a18ced4110f638acbfb3fefa77c1de36162ed3
   Push-Location ..\Nearr-edge-rollback
   npx supabase functions deploy process-share-link
   npx supabase functions deploy process-share-jobs --no-verify-jwt
   Pop-Location
   git worktree remove ..\Nearr-edge-rollback
   ```

6. Keep additive tables and diagnostics for investigation. Use migration DOWN
   sections only for a separately reviewed full teardown; immediate rollback
   does not require dropping data or changing the Phase 1 app/auth bridge.