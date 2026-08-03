# Phase 2 hosted rollout

## Current verdict

**Do not enable hosted Phase 2 traffic yet.** The code and local mobile flow are
ready for review, but the hosted media infrastructure is not installed or
verified:

- migrations `20260801000001` through `20260801000005` are local-only;
- `share_media_tasks`, its claim/requeue/recovery RPCs, the media Vault entries,
  and `process-media-tasks-sweep` are absent remotely;
- the Railway project is not linked, so deployment configuration, logs, and a
  hosted `/ready` response are unverified;
- the updated Edge Functions are not deployed;
- Gemini 429/5xx responses currently become unavailable evidence instead of a
  bounded task retry. OpenAI transcription failure is non-fatal so visual
  evidence can still succeed, but the inverse partial-evidence path needs an
  explicit product decision or implementation before traffic is enabled.

Keep `MEDIA_FALLBACK_ENABLED`, `INSTAGRAM_MEDIA_RESOLVER_ENABLED`, and
`NATIVE_VIDEO_ANALYSIS_ENABLED` set to `false` throughout infrastructure setup.
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

3. Preview the hosted migration plan and confirm it contains only these files:

   ```powershell
   npx supabase migration list --linked
   npx supabase db push --linked --dry-run
   ```

   Expected pending versions:

   ```text
   20260801000001_share_media_tasks.sql
   20260801000002_share_media_worker.sql
   20260801000003_share_media_task_recovery.sql
   20260801000004_explicit_privileges.sql
   20260801000005_aux_privileges.sql
   ```

4. Apply the migrations, still with every Phase 2 flag off:

   ```powershell
   npx supabase db push --linked
   ```

5. Deploy the two reviewed Edge Functions. Preserve their existing authentication
   settings: `process-share-link` verifies JWTs and `process-share-jobs` uses the
   existing dedicated worker-secret check.

   ```powershell
   npx supabase functions deploy process-share-link
   npx supabase functions deploy process-share-jobs --no-verify-jwt
   ```

6. Link the intended Railway project, review the target, configure variable
   **names** in Railway, and deploy `services/media-worker/Dockerfile`:

   ```powershell
   railway login
   railway link
   railway status
   railway up services/media-worker --path-as-root --service <MEDIA_WORKER_SERVICE> --environment <ENVIRONMENT>
   ```

   Required production variable names:

   ```text
   SHARE_MEDIA_WORKER_SECRET
   SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   SHARE_JOBS_FINALIZE_URL
   MEDIA_TRANSCRIPTION_PROVIDER=openai
   MEDIA_TRANSCRIPTION_API_KEY
   MEDIA_ANALYSIS_PROVIDER=gemini
   GEMINI_API_KEY
   GEMINI_MODEL
   MEDIA_FALLBACK_ENABLED=false
   INSTAGRAM_MEDIA_RESOLVER_ENABLED=false
   NATIVE_VIDEO_ANALYSIS_ENABLED=false
   ```

   Pin `GEMINI_MODEL` before the canary. Do not use the moving
   `gemini-flash-latest` alias for a controlled cost/behavior comparison.

7. Confirm the hosted worker is alive and honestly ready:

   ```powershell
   curl.exe -fsS https://<WORKER_HOST>/health
   curl.exe -fsS https://<WORKER_HOST>/ready
   railway logs
   ```

   `/health` and `/ready` must both return HTTP 200. Logs must contain no source
   URL query strings, tokens, media bytes, or raw model responses.

8. Store the worker endpoint and the same dedicated invocation secret in Vault.
   Enter values directly in the Supabase SQL editor or another secret-safe
   channel; do not put them in shell history or this repository.

   ```sql
   select vault.create_secret('<WORKER_BASE_URL>', 'share_media_worker_url');
   select vault.create_secret('<SHARE_MEDIA_WORKER_SECRET>', 'share_media_worker_secret');
   ```

9. Smoke-test infrastructure while all flags remain off:

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

## One-task canary

Do this only after the release gate is green and provider retry behavior has
been accepted or fixed. Use one internal account and one known public Instagram
reel. Keep `NATIVE_VIDEO_ANALYSIS_ENABLED=false` until the final step.

1. Set `MEDIA_FALLBACK_ENABLED=true` and
   `INSTAGRAM_MEDIA_RESOLVER_ENABLED=true` in both `process-share-jobs` and the
   media worker. Leave `NATIVE_VIDEO_ANALYSIS_ENABLED=false`.
2. Restart/redeploy only those services and require `/ready` HTTP 200.
3. Submit exactly one internal share that requires media fallback.
4. Immediately set `MEDIA_FALLBACK_ENABLED=false` again. The durable task may
   finish, but no second task can be created.
5. Track only that job and task:

   ```sql
   select id, status, progress_stage, result_type, error_code,
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
   ```

6. Accept only one of these outcomes: deterministic verified result presented
   for confirmation, safe `needs_help`, or bounded retry followed by safe
   `needs_help`. Reject any silent model-generated save, duplicate save,
   stranded parent, leaked media URL, or unbounded retry.
7. After the canary, delete any local temp artifacts and verify the hosted
   worker temp directory has no retained media. Do not delete durable diagnostic
   rows until the audit is complete.

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

1. Set all three flags to `false` in `process-share-jobs` and Railway, then
   redeploy/restart those services.
2. Stop dispatch and the worker:

   ```sql
   select cron.unschedule('process-media-tasks-sweep');
   ```

   ```powershell
   railway down --service <MEDIA_WORKER_SERVICE> --environment <ENVIRONMENT> --yes
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

5. Keep additive tables and diagnostics for investigation. Use migration DOWN
   sections only for a separately reviewed full teardown; immediate rollback
   does not require dropping data or changing the Phase 1 app/auth bridge.