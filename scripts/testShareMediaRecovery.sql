-- scripts/testShareMediaRecovery.sql
--
-- Phase 2 HARDENING guarantees (migration 20260801000003):
--   * retry backoff — claim skips a task whose next_attempt_at is in the future
--   * requeue_media_task sets a future next_attempt_at, keeps status=queued, and
--     does NOT increment attempts; it is a no-op on a terminal task
--   * claim skips a task whose parent is no longer processing_metadata
--   * cancelling a parent share_job cascades its media task to 'cancelled'
--   * claim_stranded_media_parents returns a processing parent with a terminal
--     media task, and NOT one whose parent is already terminal
--
-- Usage: psql "$DATABASE_URL" -v user_id='<uuid>' -f scripts/testShareMediaRecovery.sql

\set ON_ERROR_STOP on

begin;

create extension if not exists pgcrypto;
select replace(gen_random_uuid()::text, '-', '') as run_id \gset

drop table if exists _media_rec_ctx;
create temporary table _media_rec_ctx (
  future_task     uuid not null,
  ready_task      uuid not null,
  orphan_task     uuid not null,
  cancel_parent   uuid not null,
  cancel_task     uuid not null,
  stranded_parent uuid not null,
  recovered_parent uuid not null,
  requeue_task    uuid not null
) on commit drop;

with
  jf as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/f/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  jr as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/r/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  jo as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/o/' || :'run_id', 'instagram', 'needs_help') returning id),
  jc as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/c/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  js as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/s/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  jd as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/d/' || :'run_id', 'instagram', 'needs_help') returning id),
  jq as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/q/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  tf as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts, next_attempt_at)
         select jf.id, :'user_id'::uuid, 'f', 'instagram', 'queued', 0, 3, now() + interval '10 minutes' from jf returning id),
  tr as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts, next_attempt_at)
         select jr.id, :'user_id'::uuid, 'r', 'instagram', 'queued', 0, 3, now() - interval '1 minute' from jr returning id),
  toq as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select jo.id, :'user_id'::uuid, 'o', 'instagram', 'queued', 0, 3 from jo returning id),
  tc as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select jc.id, :'user_id'::uuid, 'c', 'instagram', 'queued', 0, 3 from jc returning id),
  ts as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select js.id, :'user_id'::uuid, 's', 'instagram', 'failed', 1, 3 from js returning id),
  td as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select jd.id, :'user_id'::uuid, 'd', 'instagram', 'failed', 1, 3 from jd returning id),
  tq as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts, locked_until)
         select jq.id, :'user_id'::uuid, 'q', 'instagram', 'processing', 2, 3, now() + interval '5 minutes' from jq returning id)
insert into _media_rec_ctx
select tf.id, tr.id, toq.id, jc.id, tc.id, js.id, jd.id, tq.id
  from tf, tr, toq, jc, tc, js, jd, tq;

-- A. Cancellation cascade: cancelling the parent cancels the media task.
do $$
declare c _media_rec_ctx%rowtype; st text;
begin
  select * into c from _media_rec_ctx;
  update public.share_jobs set status = 'cancelled' where id = c.cancel_parent;
  select status into st from public.share_media_tasks where id = c.cancel_task;
  if st = 'cancelled' then raise notice 'cancel_cascades_to_task: PASS';
  else raise notice 'cancel_cascades_to_task: FAIL (%).', st; end if;
end $$;

-- B. requeue_media_task: future backoff, status queued, attempts unchanged.
do $$
declare c _media_rec_ctx%rowtype; ok boolean; st text; att int; nfuture boolean;
begin
  select * into c from _media_rec_ctx;
  select public.requeue_media_task(c.requeue_task, 60, 'test_backoff') into ok;
  select status, attempts, (next_attempt_at > now()) into st, att, nfuture
    from public.share_media_tasks where id = c.requeue_task;
  if ok and st = 'queued' and att = 2 and nfuture
    then raise notice 'requeue_sets_backoff_keeps_attempts: PASS';
    else raise notice 'requeue_sets_backoff_keeps_attempts: FAIL (ok=% st=% att=% future=%)', ok, st, att, nfuture; end if;
end $$;

-- B2. requeue is a no-op on a terminal task (cancel_task is cancelled from A).
do $$
declare c _media_rec_ctx%rowtype; ok boolean;
begin
  select * into c from _media_rec_ctx;
  select public.requeue_media_task(c.cancel_task, 60, 'x') into ok;
  if ok = false then raise notice 'requeue_noop_on_terminal: PASS';
  else raise notice 'requeue_noop_on_terminal: FAIL (revived terminal)'; end if;
end $$;

-- C. claim respects next_attempt_at + parent status.
drop table if exists _rec_claimed;
create temporary table _rec_claimed on commit drop as
  select id from public.claim_media_tasks(20, 600);

do $$
declare c _media_rec_ctx%rowtype;
begin
  select * into c from _media_rec_ctx;
  if exists (select 1 from _rec_claimed where id = c.ready_task)
    then raise notice 'claim_includes_ready_backoff: PASS'; else raise notice 'claim_includes_ready_backoff: FAIL'; end if;
  if exists (select 1 from _rec_claimed where id = c.future_task)
    then raise notice 'claim_skips_future_next_attempt: FAIL'; else raise notice 'claim_skips_future_next_attempt: PASS'; end if;
  if exists (select 1 from _rec_claimed where id = c.requeue_task)
    then raise notice 'claim_skips_requeued_backoff: FAIL'; else raise notice 'claim_skips_requeued_backoff: PASS'; end if;
  if exists (select 1 from _rec_claimed where id = c.orphan_task)
    then raise notice 'claim_skips_non_processing_parent: FAIL'; else raise notice 'claim_skips_non_processing_parent: PASS'; end if;
  if exists (select 1 from _rec_claimed where id = c.cancel_task)
    then raise notice 'claim_skips_cancelled_task: FAIL'; else raise notice 'claim_skips_cancelled_task: PASS'; end if;
end $$;

-- D. claim_stranded_media_parents finds a processing parent w/ a terminal task,
--    and NOT one whose parent already went terminal.
drop table if exists _rec_stranded;
create temporary table _rec_stranded on commit drop as
  select id from public.claim_stranded_media_parents(20);

do $$
declare c _media_rec_ctx%rowtype;
begin
  select * into c from _media_rec_ctx;
  if exists (select 1 from _rec_stranded where id = c.stranded_parent)
    then raise notice 'stranded_returns_processing_parent: PASS'; else raise notice 'stranded_returns_processing_parent: FAIL'; end if;
  if exists (select 1 from _rec_stranded where id = c.recovered_parent)
    then raise notice 'stranded_skips_terminal_parent: FAIL'; else raise notice 'stranded_skips_terminal_parent: PASS'; end if;
end $$;

rollback;
