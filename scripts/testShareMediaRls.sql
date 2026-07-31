-- scripts/testShareMediaRls.sql
--
-- Reproducible RLS + access-surface checks for the Phase 2 media tables
-- (share_media_tasks, share_media_runs) and the worker-only RPCs.
--
-- Usage (local Supabase DB / psql):
--   psql "$DATABASE_URL" -v user_a='<uuid-a>' -v user_b='<uuid-b>' -f scripts/testShareMediaRls.sql
--
-- Run pattern used in this repo (auth.users seeded by scripts/seedTestUsers.sql):
--   docker cp scripts/testShareMediaRls.sql supabase_db_Nearr:/tmp/x.sql
--   docker exec supabase_db_Nearr sh -c "psql -U postgres -d postgres -q \
--     -v user_a=11111111-1111-1111-1111-111111111111 \
--     -v user_b=22222222-2222-2222-2222-222222222222 -f /tmp/x.sql 2>&1"
--
-- Both media tables are RLS-enabled with NO client policies AND revoked from
-- anon/authenticated, so a client can never see or mutate them. Every media
-- access below is wrapped in a DO block because the missing GRANT raises
-- `insufficient_privilege` (which we treat as PASS).

\set ON_ERROR_STOP on

begin;

create extension if not exists pgcrypto;

select replace(gen_random_uuid()::text, '-', '') as run_id \gset

drop table if exists _media_rls_ctx;
create temporary table _media_rls_ctx (
  a_job_id  uuid not null,
  b_job_id  uuid not null,
  a_task_id uuid not null,
  a_user    uuid not null,
  b_user    uuid not null
) on commit drop;
grant select on _media_rls_ctx to authenticated;

with
  job_a as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage)
    values (:'user_a'::uuid, 'https://www.instagram.com/reel/a/' || :'run_id', 'instagram', 'processing_metadata', 'checking_video')
    returning id
  ),
  job_b as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage)
    values (:'user_b'::uuid, 'https://www.instagram.com/reel/b/' || :'run_id', 'instagram', 'processing_metadata', 'checking_video')
    returning id
  ),
  task_a as (
    insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, progress_stage)
    select job_a.id, :'user_a'::uuid, 'https://www.instagram.com/reel/a/' || :'run_id', 'instagram', 'queued', 'queued'
      from job_a
    returning id, share_job_id
  )
insert into _media_rls_ctx (a_job_id, b_job_id, a_task_id, a_user, b_user)
select task_a.share_job_id, job_b.id, task_a.id, :'user_a'::uuid, :'user_b'::uuid
  from task_a, job_b;

-- Seed a diagnostics run (service-role/admin context).
insert into public.share_media_runs (share_media_task_id, share_job_id, user_id, platform, resolver_name)
select a_task_id, a_job_id, a_user, 'instagram', 'instagram/yt-dlp' from _media_rls_ctx;

-- ==========================================================================
-- CLIENT (authenticated) CONTEXT — must have ZERO access to both media tables.
-- ==========================================================================
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);

do $$
declare v int;
begin
  select count(*) into v from public.share_media_tasks;
  if v = 0 then raise notice 'client_cannot_select_media_tasks: PASS (0 rows via RLS)';
  else raise notice 'client_cannot_select_media_tasks: FAIL (% rows leaked)', v; end if;
exception when insufficient_privilege then
  raise notice 'client_cannot_select_media_tasks: PASS (no grant)';
end $$;

do $$
declare v int;
begin
  select count(*) into v from public.share_media_runs;
  if v = 0 then raise notice 'client_cannot_select_media_runs: PASS (0 rows via RLS)';
  else raise notice 'client_cannot_select_media_runs: FAIL (% rows leaked)', v; end if;
exception when insufficient_privilege then
  raise notice 'client_cannot_select_media_runs: PASS (no grant)';
end $$;

do $$
begin
  insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status)
  values ((select a_job_id from _media_rls_ctx), current_setting('request.jwt.claim.sub')::uuid, 'x', 'instagram', 'queued');
  raise notice 'client_cannot_insert_media_task: FAIL (unexpectedly allowed)';
exception when others then
  raise notice 'client_cannot_insert_media_task: PASS (%).', sqlerrm;
end $$;

do $$
begin
  update public.share_media_tasks set status = 'completed'
   where id = (select a_task_id from _media_rls_ctx);
  raise notice 'client_cannot_update_media_task: FAIL (unexpectedly allowed)';
exception when others then
  raise notice 'client_cannot_update_media_task: PASS (%).', sqlerrm;
end $$;

do $$
begin
  delete from public.share_media_tasks where id = (select a_task_id from _media_rls_ctx);
  raise notice 'client_cannot_delete_media_task: FAIL (unexpectedly allowed)';
exception when others then
  raise notice 'client_cannot_delete_media_task: PASS (%).', sqlerrm;
end $$;

do $$
begin
  perform public.claim_media_tasks(1, 600);
  raise notice 'client_cannot_call_claim_media_tasks: FAIL (unexpectedly allowed)';
exception when insufficient_privilege then
  raise notice 'client_cannot_call_claim_media_tasks: PASS (execute revoked)';
when others then
  raise notice 'client_cannot_call_claim_media_tasks: PASS (%).', sqlerrm;
end $$;

do $$
begin
  perform public.expire_media_tasks(1);
  raise notice 'client_cannot_call_expire_media_tasks: FAIL (unexpectedly allowed)';
exception when insufficient_privilege then
  raise notice 'client_cannot_call_expire_media_tasks: PASS (execute revoked)';
when others then
  raise notice 'client_cannot_call_expire_media_tasks: PASS (%).', sqlerrm;
end $$;

-- ==========================================================================
-- ADMIN CONTEXT — worker-only RPC grants + invariants.
-- ==========================================================================
reset role;

do $$
begin
  if has_function_privilege('anon', 'public.claim_media_tasks(integer,integer)', 'execute')
    then raise notice 'claim_media_tasks_anon_locked: FAIL';
    else raise notice 'claim_media_tasks_anon_locked: PASS';
  end if;
  if has_function_privilege('authenticated', 'public.claim_media_tasks(integer,integer)', 'execute')
    then raise notice 'claim_media_tasks_auth_locked: FAIL';
    else raise notice 'claim_media_tasks_auth_locked: PASS';
  end if;
  if has_function_privilege('service_role', 'public.claim_media_tasks(integer,integer)', 'execute')
    then raise notice 'claim_media_tasks_service_execute: PASS';
    else raise notice 'claim_media_tasks_service_execute: FAIL';
  end if;
  if has_function_privilege('anon', 'public.expire_media_tasks(integer)', 'execute')
    then raise notice 'expire_media_tasks_anon_locked: FAIL';
    else raise notice 'expire_media_tasks_anon_locked: PASS';
  end if;
  if has_function_privilege('authenticated', 'public.expire_media_tasks(integer)', 'execute')
    then raise notice 'expire_media_tasks_auth_locked: FAIL';
    else raise notice 'expire_media_tasks_auth_locked: PASS';
  end if;
end $$;

-- One media task per share job (unique share_job_id).
do $$
declare v_job uuid; v_user uuid;
begin
  select a_job_id into v_job from _media_rls_ctx;
  select user_id into v_user from public.share_jobs where id = v_job;
  begin
    insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status)
    values (v_job, v_user, 'dup', 'instagram', 'queued');
    raise notice 'one_media_task_per_job: FAIL (duplicate allowed)';
  exception when unique_violation then
    raise notice 'one_media_task_per_job: PASS (unique share_job_id)';
  end;
end $$;

-- Ownership invariant: task.user_id must equal the parent job owner.
do $$
declare v_job_b uuid; v_user_a uuid;
begin
  select b_job_id, a_user into v_job_b, v_user_a from _media_rls_ctx;
  begin
    insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status)
    values (v_job_b, v_user_a, 'x', 'instagram', 'queued');
    raise notice 'media_task_owner_invariant: FAIL (mismatch allowed)';
  exception when others then
    raise notice 'media_task_owner_invariant: PASS (%).', sqlerrm;
  end;
end $$;

-- Deleting a media task leaves the parent share_job intact.
do $$
declare v_task uuid; v_job uuid; v_jobs int;
begin
  select a_task_id, a_job_id into v_task, v_job from _media_rls_ctx;
  delete from public.share_media_tasks where id = v_task;
  select count(*) into v_jobs from public.share_jobs where id = v_job;
  if v_jobs = 1 then raise notice 'media_task_delete_keeps_parent: PASS';
  else raise notice 'media_task_delete_keeps_parent: FAIL (parent gone)'; end if;
end $$;

rollback;
