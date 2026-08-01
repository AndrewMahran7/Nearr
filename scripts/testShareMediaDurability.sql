-- scripts/testShareMediaDurability.sql
--
-- Worker-durability SQL checks for share_media_tasks:
--   - claim_media_tasks claims queued + stale-lease rows (FOR UPDATE SKIP LOCKED)
--   - does NOT steal fresh (non-stale) processing rows
--   - does NOT reclaim terminal (completed) rows
--   - does NOT claim rows past max_attempts
--   - increments attempts
--   - a second claim in the same window returns nothing (concurrency)
--   - expire_media_tasks marks exhausted rows failed (backstop reaper)
--
-- Usage:
--   psql "$DATABASE_URL" -v user_id='<uuid>' -f scripts/testShareMediaDurability.sql
-- Run pattern: docker cp + docker exec psql (auth.users seeded by seedTestUsers.sql).

\set ON_ERROR_STOP on

begin;

create extension if not exists pgcrypto;

select replace(gen_random_uuid()::text, '-', '') as run_id \gset

drop table if exists _media_dur_ctx;
create temporary table _media_dur_ctx (
  queued            uuid not null,
  stale_processing  uuid not null,
  fresh_processing  uuid not null,
  maxed             uuid not null,
  completed         uuid not null
) on commit drop;

-- One parent share_job per media task (share_job_id is unique + owner-enforced),
-- seeded via a single CTE so RETURNING ids flow into the context table.
with
  jq as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/reel/q/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  js as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/reel/s/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  jf as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/reel/f/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  jm as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/reel/m/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  jd as (insert into public.share_jobs (user_id, source_url, source_platform, status)
         values (:'user_id'::uuid, 'https://ig/reel/d/' || :'run_id', 'instagram', 'processing_metadata') returning id),
  tq as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select jq.id, :'user_id'::uuid, 'q', 'instagram', 'queued', 0, 3 from jq returning id),
  ts as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts, locked_until)
         select js.id, :'user_id'::uuid, 's', 'instagram', 'processing', 1, 3, now() - interval '2 minutes' from js returning id),
  tf as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts, locked_until)
         select jf.id, :'user_id'::uuid, 'f', 'instagram', 'processing', 1, 3, now() + interval '10 minutes' from jf returning id),
  tm as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select jm.id, :'user_id'::uuid, 'm', 'instagram', 'queued', 3, 3 from jm returning id),
  td as (insert into public.share_media_tasks (share_job_id, user_id, source_url, platform, status, attempts, max_attempts)
         select jd.id, :'user_id'::uuid, 'd', 'instagram', 'completed', 1, 3 from jd returning id)
insert into _media_dur_ctx (queued, stale_processing, fresh_processing, maxed, completed)
select tq.id, ts.id, tf.id, tm.id, td.id from tq, ts, tf, tm, td;

-- ---- First claim ----------------------------------------------------------
drop table if exists _claimed;
create temporary table _claimed on commit drop as
  select id from public.claim_media_tasks(10, 600);

do $$
declare c _media_dur_ctx%rowtype;
begin
  select * into c from _media_dur_ctx;
  if exists (select 1 from _claimed where id = c.queued)
    then raise notice 'claim_includes_queued: PASS'; else raise notice 'claim_includes_queued: FAIL'; end if;
  if exists (select 1 from _claimed where id = c.stale_processing)
    then raise notice 'claim_reclaims_stale_lease: PASS'; else raise notice 'claim_reclaims_stale_lease: FAIL'; end if;
  if exists (select 1 from _claimed where id = c.fresh_processing)
    then raise notice 'claim_skips_fresh_lease: FAIL'; else raise notice 'claim_skips_fresh_lease: PASS'; end if;
  if exists (select 1 from _claimed where id = c.maxed)
    then raise notice 'claim_skips_maxed: FAIL'; else raise notice 'claim_skips_maxed: PASS'; end if;
  if exists (select 1 from _claimed where id = c.completed)
    then raise notice 'claim_skips_completed: FAIL'; else raise notice 'claim_skips_completed: PASS'; end if;
end $$;

-- ---- Attempts incremented on claim ----------------------------------------
do $$
declare c _media_dur_ctx%rowtype; a_queued int; a_stale int;
begin
  select * into c from _media_dur_ctx;
  select attempts into a_queued from public.share_media_tasks where id = c.queued;
  select attempts into a_stale from public.share_media_tasks where id = c.stale_processing;
  if a_queued = 1 then raise notice 'claim_increments_queued_attempts: PASS'; else raise notice 'claim_increments_queued_attempts: FAIL (%).', a_queued; end if;
  if a_stale = 2 then raise notice 'claim_increments_stale_attempts: PASS'; else raise notice 'claim_increments_stale_attempts: FAIL (%).', a_stale; end if;
end $$;

-- ---- Second claim in the same window returns nothing ----------------------
do $$
declare n int;
begin
  select count(*) into n from public.claim_media_tasks(10, 600);
  if n = 0 then raise notice 'second_claim_empty: PASS'; else raise notice 'second_claim_empty: FAIL (% claimed)', n; end if;
end $$;

-- ---- Fresh (non-stale) processing row was never touched --------------------
do $$
declare c _media_dur_ctx%rowtype; st text; att int;
begin
  select * into c from _media_dur_ctx;
  select status, attempts into st, att from public.share_media_tasks where id = c.fresh_processing;
  if st = 'processing' and att = 1 then raise notice 'fresh_lease_untouched: PASS'; else raise notice 'fresh_lease_untouched: FAIL (%/%).', st, att; end if;
end $$;

-- ---- Completed row never reclaimed ----------------------------------------
do $$
declare c _media_dur_ctx%rowtype; st text;
begin
  select * into c from _media_dur_ctx;
  select status into st from public.share_media_tasks where id = c.completed;
  if st = 'completed' then raise notice 'completed_not_reclaimed: PASS'; else raise notice 'completed_not_reclaimed: FAIL (%).', st; end if;
end $$;

-- ---- expire_media_tasks reaps the exhausted row ---------------------------
do $$
declare c _media_dur_ctx%rowtype; st text; n int;
begin
  select * into c from _media_dur_ctx;
  select count(*) into n from public.expire_media_tasks(25);
  select status into st from public.share_media_tasks where id = c.maxed;
  if st = 'failed' then raise notice 'expire_reaps_exhausted: PASS'; else raise notice 'expire_reaps_exhausted: FAIL (%).', st; end if;
end $$;

rollback;
