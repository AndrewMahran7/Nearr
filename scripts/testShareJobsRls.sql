-- scripts/testShareJobsRls.sql
--
-- Reproducible two-user RLS and mutation-surface checks for share_jobs and
-- user_push_tokens.
--
-- Usage (local Supabase DB / psql):
--   psql "$DATABASE_URL" -v user_a='<uuid-a>' -v user_b='<uuid-b>' -f scripts/testShareJobsRls.sql
--
-- This script uses request.jwt.claim.sub to emulate authenticated users.

\set ON_ERROR_STOP on

-- Wrap the whole script in ONE explicit transaction so the ON COMMIT DROP
-- context table survives across statements. Under psql autocommit each
-- statement commits on its own, which would drop the temp table immediately
-- after CREATE TEMP TABLE (the reported failure). ROLLBACK at the end discards
-- all seeded test rows. Every intentionally-failing permission check lives in
-- its own DO block (a subtransaction), so a caught error never aborts this
-- outer transaction.
begin;

create extension if not exists pgcrypto;

-- Generate run-unique markers so repeated executions do not collide.
select replace(gen_random_uuid()::text, '-', '') as run_id \gset

-- Temp context for seeded row ids.
drop table if exists _share_job_rls_ctx;
create temporary table _share_job_rls_ctx (
  a_job_id uuid not null,
  b_job_id uuid not null,
  a_saved_place_id uuid not null,
  b_saved_place_id uuid not null
) on commit drop;

-- The context table is created by the postgres/service role, but the RLS
-- checks below read the seeded ids from it AFTER `set role authenticated`.
-- Grant read access to this test-only scratch table (it holds no protected
-- data — only the ids of rows we seeded; RLS still governs the real tables).
grant select on _share_job_rls_ctx to authenticated;

with
  place_a as (
    insert into public.places (google_place_id, name, formatted_address, latitude, longitude, category)
    values (
      'rls-a-' || :'run_id',
      'RLS Place A',
      '1 Test Ave',
      37.781,
      -122.41,
      'test'
    )
    returning id
  ),
  place_b as (
    insert into public.places (google_place_id, name, formatted_address, latitude, longitude, category)
    values (
      'rls-b-' || :'run_id',
      'RLS Place B',
      '2 Test Ave',
      37.782,
      -122.42,
      'test'
    )
    returning id
  ),
  saved_a as (
    insert into public.saved_places (user_id, place_id, source_type, source_url)
    select :'user_a'::uuid, place_a.id, 'manual', 'https://example.com/a/' || :'run_id'
      from place_a
    returning id
  ),
  saved_b as (
    insert into public.saved_places (user_id, place_id, source_type, source_url)
    select :'user_b'::uuid, place_b.id, 'manual', 'https://example.com/b/' || :'run_id'
      from place_b
    returning id
  ),
  job_a as (
    insert into public.share_jobs (
      user_id,
      source_url,
      canonical_url,
      source_platform,
      status,
      progress_stage
    )
    values (
      :'user_a'::uuid,
      'https://www.instagram.com/p/a1/' || :'run_id',
      'https://www.instagram.com/p/a1/' || :'run_id',
      'instagram',
      'needs_help',
      'single'
    )
    returning id
  ),
  job_b as (
    insert into public.share_jobs (
      user_id,
      source_url,
      canonical_url,
      source_platform,
      status,
      progress_stage
    )
    values (
      :'user_b'::uuid,
      'https://www.tiktok.com/@x/video/1/' || :'run_id',
      'https://www.tiktok.com/@x/video/1/' || :'run_id',
      'tiktok',
      'queued',
      'queued'
    )
    returning id
  )
insert into _share_job_rls_ctx (a_job_id, b_job_id, a_saved_place_id, b_saved_place_id)
select job_a.id, job_b.id, saved_a.id, saved_b.id
  from job_a, job_b, saved_a, saved_b;

-- Seed rows as service-role/admin context.
insert into public.user_push_tokens (id, user_id, token, platform, enabled)
values
  (gen_random_uuid(), :'user_a'::uuid, 'ExponentPushToken[testA-' || :'run_id' || ']', 'ios', true),
  (gen_random_uuid(), :'user_b'::uuid, 'ExponentPushToken[testB-' || :'run_id' || ']', 'ios', true)
on conflict (token) do nothing;

-- -------------------------------------------------------------------------
-- User A context
-- -------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_a', true);

-- A cannot SELECT B jobs/tokens.
select 'A_cannot_select_B_job' as test_name,
       count(*) = 0 as pass
  from public.share_jobs
 where id = (select b_job_id from _share_job_rls_ctx limit 1);

select 'A_cannot_select_B_tokens' as test_name,
       count(*) = 0 as pass
  from public.user_push_tokens
 where user_id = :'user_b'::uuid;

-- A cannot UPDATE B job (RLS + no direct update grant).
do $$
begin
  begin
    update public.share_jobs
       set progress_stage = 'hacked'
     where id = (select b_job_id from _share_job_rls_ctx limit 1);
    raise notice 'A_update_B_job_direct: FAIL (unexpectedly allowed)';
  exception when others then
    raise notice 'A_update_B_job_direct: PASS (%).', sqlerrm;
  end;
end;
$$;

-- A cannot DELETE B job (RLS filters the row out → 0 rows deleted). A
-- data-modifying statement must live in a CTE, not a FROM subquery.
with a_delete_b as (
  delete from public.share_jobs
   where id = (select b_job_id from _share_job_rls_ctx limit 1)
  returning 1
)
select 'A_cannot_delete_B_job' as test_name,
       (select count(*) from a_delete_b) = 0 as pass;

do $$
begin
  begin
    update public.share_jobs
       set status = 'processing_metadata', locked_until = now() + interval '10 minutes'
     where id = (select a_job_id from _share_job_rls_ctx limit 1);
    raise notice 'A_update_worker_fields_direct: FAIL (unexpectedly allowed)';
  exception when others then
    raise notice 'A_update_worker_fields_direct: PASS (%).', sqlerrm;
  end;
end;
$$;

do $$
begin
  begin
    insert into public.share_jobs (
      user_id,
      source_url,
      canonical_url,
      source_platform,
      status,
      progress_stage
    )
    values (
      current_setting('request.jwt.claim.sub')::uuid,
      'https://example.com/blocked-insert',
      'https://example.com/blocked-insert',
      'instagram',
      'queued',
      'queued'
    );
    raise notice 'A_insert_share_job_direct: FAIL (unexpectedly allowed)';
  exception when others then
    raise notice 'A_insert_share_job_direct: PASS (%).', sqlerrm;
  end;
end;
$$;

do $$
begin
  begin
    update public.share_jobs
       set attempts = 999,
           max_attempts = 999,
           notification_status = 'submitted',
           notification_attempts = 999,
           notification_error_code = 'forged',
           failure_reason = 'forged'
     where id = (select a_job_id from _share_job_rls_ctx limit 1);
    raise notice 'A_update_internal_fields_direct: FAIL (unexpectedly allowed)';
  exception when others then
    raise notice 'A_update_internal_fields_direct: PASS (%).', sqlerrm;
  end;
end;
$$;

-- Worker-only RPCs must NOT be executable by anon or authenticated. These are
-- CATALOG privilege checks — they never invoke the functions. (Actually calling
-- invoke_process_share_jobs fires pg_net and can terminate the backend in the
-- local image; calling claim_/create_ RPCs would mutate the queue. A privilege
-- check is both safe and the exact property we care about.)
--
-- NOTE: on Supabase, `revoke ... from public` does NOT strip the default
-- EXECUTE grants Supabase gives directly to anon/authenticated, so these
-- assertions FAIL until a migration also `revoke ... from anon, authenticated`.
select 'worker_rpc_claim_share_jobs_locked' as test_name,
       has_function_privilege('anon', 'public.claim_share_jobs(integer,integer)', 'execute') = false
       and has_function_privilege('authenticated', 'public.claim_share_jobs(integer,integer)', 'execute') = false as pass;

select 'worker_rpc_claim_notifications_locked' as test_name,
       has_function_privilege('anon', 'public.claim_share_job_notifications(integer,integer)', 'execute') = false
       and has_function_privilege('authenticated', 'public.claim_share_job_notifications(integer,integer)', 'execute') = false as pass;

select 'worker_rpc_claim_receipts_locked' as test_name,
       has_function_privilege('anon', 'public.claim_share_job_receipts(integer,integer)', 'execute') = false
       and has_function_privilege('authenticated', 'public.claim_share_job_receipts(integer,integer)', 'execute') = false as pass;

select 'worker_rpc_create_share_job_locked' as test_name,
       has_function_privilege('anon', 'public.create_share_job_for_user(uuid,text,text,text,text,integer)', 'execute') = false
       and has_function_privilege('authenticated', 'public.create_share_job_for_user(uuid,text,text,text,text,integer)', 'execute') = false as pass;

select 'worker_rpc_invoke_dispatcher_locked' as test_name,
       has_function_privilege('anon', 'public.invoke_process_share_jobs()', 'execute') = false
       and has_function_privilege('authenticated', 'public.invoke_process_share_jobs()', 'execute') = false as pass;

-- A cannot resolve B job.
select 'A_resolve_B_job_rejected' as test_name,
       public.resolve_share_job(
         (select b_job_id from _share_job_rls_ctx limit 1),
         (select a_saved_place_id from _share_job_rls_ctx limit 1)
       ) = false as pass;

-- A cannot attach B saved_place_id to own job.
do $$
begin
  begin
    perform public.resolve_share_job(
      (select a_job_id from _share_job_rls_ctx limit 1),
      (select b_saved_place_id from _share_job_rls_ctx limit 1)
    );
    raise notice 'A_attach_B_saved_place: FAIL (unexpectedly allowed)';
  exception when others then
    raise notice 'A_attach_B_saved_place: PASS (%).', sqlerrm;
  end;
end;
$$;

-- A constrained RPCs on owned jobs.
select 'A_resolve_own_job_success' as test_name,
       public.resolve_share_job(
         (select a_job_id from _share_job_rls_ctx limit 1),
         (select a_saved_place_id from _share_job_rls_ctx limit 1)
       ) as pass;

select 'A_retry_own_job_without_saved_place_false' as test_name,
       public.retry_share_job(
         (select a_job_id from _share_job_rls_ctx limit 1)
       ) = false as pass;

reset role;

-- -------------------------------------------------------------------------
-- User B context
-- -------------------------------------------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'user_b', true);

select 'B_cannot_select_A_job' as test_name,
       count(*) = 0 as pass
  from public.share_jobs
 where id = (select a_job_id from _share_job_rls_ctx limit 1);

select 'B_cannot_select_A_tokens' as test_name,
       count(*) = 0 as pass
  from public.user_push_tokens
 where user_id = :'user_a'::uuid;

select 'B_cancel_own_job_success' as test_name,
       public.cancel_share_job((select b_job_id from _share_job_rls_ctx limit 1)) as pass;

select 'B_retry_own_cancelled_job_false' as test_name,
       public.retry_share_job((select b_job_id from _share_job_rls_ctx limit 1)) = false as pass;

reset role;

-- Roll back ALL seeded test data (belt-and-suspenders with ON COMMIT DROP on
-- the context table). No production rows are touched by this script.
rollback;
