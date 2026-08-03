-- Atomic save + RLS checks for share_job_place_results.
-- Local only; requires scripts/seedTestUsers.sql after a database reset.

\set ON_ERROR_STOP on
begin;

create or replace function pg_temp._t(cond boolean, label text) returns void
language plpgsql as $$
begin
  if cond then raise notice 'PASS %', label;
  else raise exception 'FAIL %', label;
  end if;
end $$;

create temporary table _place_result_ctx (
  job_a uuid, job_b uuid, task_a uuid, task_b uuid, run_a uuid, run_b uuid,
  first_saved uuid, first_place uuid
) on commit drop;
grant select on _place_result_ctx to authenticated;

with
  ja as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage)
    values ('11111111-1111-4111-8111-111111111111', 'https://instagram.com/reel/shared-source', 'instagram', 'processing_metadata', 'checking_video') returning id
  ),
  jb as (
    insert into public.share_jobs (user_id, source_url, source_platform, status, progress_stage)
    values ('22222222-2222-4222-8222-222222222222', 'https://instagram.com/reel/user-b', 'instagram', 'processing_metadata', 'checking_video') returning id
  ),
  ta as (
    insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, progress_stage)
    select id, '11111111-1111-4111-8111-111111111111', 'https://instagram.com/reel/shared-source', 'instagram', 'processing', 'verifying_place' from ja returning id, share_job_id
  ),
  tb as (
    insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, progress_stage)
    select id, '22222222-2222-4222-8222-222222222222', 'https://instagram.com/reel/user-b', 'instagram', 'processing', 'verifying_place' from jb returning id, share_job_id
  ),
  ra as (
    insert into public.share_media_runs (share_media_task_id, share_job_id, user_id, platform)
    select ta.id, ta.share_job_id, '11111111-1111-4111-8111-111111111111', 'instagram' from ta returning id, share_media_task_id
  ),
  rb as (
    insert into public.share_media_runs (share_media_task_id, share_job_id, user_id, platform)
    select tb.id, tb.share_job_id, '22222222-2222-4222-8222-222222222222', 'instagram' from tb returning id, share_media_task_id
  )
insert into _place_result_ctx (job_a, job_b, task_a, task_b, run_a, run_b)
select ja.id, jb.id, ta.id, tb.id, ra.id, rb.id from ja, jb, ta, tb, ra, rb;

do $$
declare c _place_result_ctx%rowtype; saved uuid; place uuid; was_reused boolean;
begin
  select * into c from _place_result_ctx;
  select * into saved, place, was_reused from public.auto_save_share_job_place_result(
    c.job_a, c.task_a, c.run_a, 'm1', 'google-a', 'Place A', '1 A St, Los Angeles, CA',
    34.01, -118.01, 'restaurant', 'instagram', 'https://instagram.com/reel/shared-source',
    0.97, 'media-autosave-2026-08-03.v1', '["all_deterministic_checks_passed"]');
  update _place_result_ctx set first_saved = saved, first_place = place;
  perform * from public.auto_save_share_job_place_result(
    c.job_a, c.task_a, c.run_a, 'm2', 'google-b', 'Place B', '2 B St, Los Angeles, CA',
    34.02, -118.02, 'restaurant', 'instagram', 'https://instagram.com/reel/shared-source',
    0.96, 'media-autosave-2026-08-03.v1', '["all_deterministic_checks_passed"]');
end $$;

select pg_temp._t((select count(*) = 2 from public.share_job_place_results where share_job_id = (select job_a from _place_result_ctx)), 'two logical places from one URL');
select pg_temp._t((select count(*) = 2 from public.saved_places where user_id = '11111111-1111-4111-8111-111111111111' and source_url = 'https://instagram.com/reel/shared-source'), 'source URL does not collapse distinct places');

do $$
declare c _place_result_ctx%rowtype; saved uuid; place uuid; was_reused boolean;
begin
  select * into c from _place_result_ctx;
  select * into saved, place, was_reused from public.auto_save_share_job_place_result(
    c.job_a, c.task_a, c.run_a, 'm1', 'google-a', 'Place A', '1 A St, Los Angeles, CA',
    34.01, -118.01, 'restaurant', 'instagram', 'https://instagram.com/reel/shared-source',
    0.97, 'media-autosave-2026-08-03.v1', '["all_deterministic_checks_passed"]');
  perform pg_temp._t(saved = c.first_saved and place = c.first_place, 'replay returns identical saved/place rows');
  perform pg_temp._t((select count(*) = 2 from public.saved_places where user_id = '11111111-1111-4111-8111-111111111111'), 'replay creates no duplicate');
end $$;

do $$
declare c _place_result_ctx%rowtype;
begin
  select * into c from _place_result_ctx;
  begin
    perform * from public.auto_save_share_job_place_result(c.job_a, c.task_a, c.run_a, 'm1', 'google-conflict', 'Wrong', '3 C St', 34, -118, null, 'instagram', 'x', 0.99, 'v1', '[]');
    raise exception 'FAIL candidate conflict accepted';
  exception when others then
    if sqlerrm = 'FAIL candidate conflict accepted' then raise; end if;
    perform pg_temp._t(position('logical_result_candidate_conflict' in sqlerrm) > 0, 'candidate conflict rejected');
  end;
  begin
    perform * from public.auto_save_share_job_place_result(c.job_a, c.task_b, c.run_b, 'm3', 'google-c', 'Place C', '3 C St', 34, -118, null, 'instagram', 'x', 0.99, 'v1', '[]');
    raise exception 'FAIL owner mismatch accepted';
  exception when others then
    if sqlerrm = 'FAIL owner mismatch accepted' then raise; end if;
    perform pg_temp._t(position('media_task_link_mismatch' in sqlerrm) > 0, 'task/run owner mismatch rejected');
  end;
end $$;

-- Seed one result for user B to prove owner-only reads.
do $$
declare c _place_result_ctx%rowtype;
begin
  select * into c from _place_result_ctx;
  perform * from public.auto_save_share_job_place_result(c.job_b, c.task_b, c.run_b, 'm1', 'google-user-b', 'User B Place', '4 D St', 35, -119, null, 'instagram', 'x', 0.99, 'v1', '[]');
end $$;

select pg_temp._t(not has_function_privilege('anon', 'public.auto_save_share_job_place_result(uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,text,text,numeric,text,jsonb)', 'execute'), 'anon cannot execute auto-save RPC');
select pg_temp._t(not has_function_privilege('authenticated', 'public.auto_save_share_job_place_result(uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,text,text,numeric,text,jsonb)', 'execute'), 'authenticated cannot execute auto-save RPC');
select pg_temp._t(has_function_privilege('service_role', 'public.auto_save_share_job_place_result(uuid,uuid,uuid,text,text,text,text,numeric,numeric,text,text,text,numeric,text,jsonb)', 'execute'), 'service role can execute auto-save RPC');
select pg_temp._t(not has_table_privilege('authenticated', 'public.share_job_place_results', 'insert'), 'authenticated cannot insert ledger');
select pg_temp._t(not has_table_privilege('authenticated', 'public.share_job_place_results', 'update'), 'authenticated cannot update ledger');

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
select pg_temp._t((select count(*) = 2 from public.share_job_place_results), 'owner A sees only own rows');
select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select pg_temp._t((select count(*) = 1 from public.share_job_place_results), 'owner B sees only own rows');
reset role;

rollback;