-- scripts/testShareJobsDurability.sql
--
-- Worker-durability SQL checks for share_jobs.
--
-- Usage:
--   psql "$DATABASE_URL" -v user_id='<uuid>' -f scripts/testShareJobsDurability.sql
--
-- Purpose:
--   - Claim behavior + stale lease reclaim
--   - Max-attempt gating
--   - Notification claim behavior (pending/retryable/stale-sending)
--   - Receipt claim behavior for submitted notifications

\set ON_ERROR_STOP on

-- Wrap the whole script in ONE explicit transaction so the ON COMMIT DROP
-- context table survives across statements. Under psql autocommit each
-- statement commits on its own, which would drop the temp table immediately
-- after CREATE TEMP TABLE (the reported failure). ROLLBACK at the end discards
-- all seeded test rows.
begin;

create extension if not exists pgcrypto;

select replace(gen_random_uuid()::text, '-', '') as run_id \gset

drop table if exists _share_job_durability_ctx;
create temporary table _share_job_durability_ctx (
  queued_a uuid not null,
  queued_b uuid not null,
  stale_processing uuid not null,
  fresh_processing uuid not null,
  maxed uuid not null,
  notif_pending uuid not null,
  notif_retryable uuid not null,
  notif_stale_sending uuid not null,
  notif_submitted uuid not null
) on commit drop;

with
  seeded as (
    insert into public.share_jobs (
      user_id,
      source_url,
      canonical_url,
      source_platform,
      status,
      progress_stage,
      attempts,
      max_attempts,
      locked_until,
      notification_status,
      notification_attempts,
      notification_max_attempts,
      notification_last_attempt_at,
      notification_next_attempt_at,
      notification_ticket_ids,
      notification_payload,
      notification_submitted_at,
      notification_receipts_checked_at
    )
    values
      (
        :'user_id'::uuid,
        'https://example.com/queued-a/' || :'run_id',
        'https://example.com/queued-a/' || :'run_id',
        'instagram',
        'queued',
        'queued',
        0,
        5,
        null,
        null,
        0,
        6,
        null,
        null,
        null,
        null,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/queued-b/' || :'run_id',
        'https://example.com/queued-b/' || :'run_id',
        'instagram',
        'queued',
        'queued',
        0,
        5,
        null,
        null,
        0,
        6,
        null,
        null,
        null,
        null,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/stale/' || :'run_id',
        'https://example.com/stale/' || :'run_id',
        'instagram',
        'processing_metadata',
        'queued',
        1,
        5,
        now() - interval '5 minutes',
        null,
        0,
        6,
        null,
        null,
        null,
        null,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/fresh/' || :'run_id',
        'https://example.com/fresh/' || :'run_id',
        'instagram',
        'processing_metadata',
        'queued',
        1,
        5,
        now() + interval '10 minutes',
        null,
        0,
        6,
        null,
        null,
        null,
        null,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/maxed/' || :'run_id',
        'https://example.com/maxed/' || :'run_id',
        'instagram',
        'queued',
        'queued',
        5,
        5,
        null,
        null,
        0,
        6,
        null,
        null,
        null,
        null,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/notif-pending/' || :'run_id',
        'https://example.com/notif-pending/' || :'run_id',
        'instagram',
        'completed',
        'completed',
        1,
        5,
        null,
        'pending',
        0,
        6,
        null,
        now() - interval '1 minute',
        null,
        '{"title":"A","body":"B","data":{"type":"share_job_completed"}}'::jsonb,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/notif-retryable/' || :'run_id',
        'https://example.com/notif-retryable/' || :'run_id',
        'instagram',
        'needs_help',
        'manual',
        1,
        5,
        null,
        'retryable_failed',
        2,
        6,
        now() - interval '2 minutes',
        now() - interval '30 seconds',
        null,
        '{"title":"A","body":"B","data":{"type":"share_job_needs_help"}}'::jsonb,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/notif-stale-sending/' || :'run_id',
        'https://example.com/notif-stale-sending/' || :'run_id',
        'instagram',
        'needs_help',
        'manual',
        1,
        5,
        null,
        'sending',
        1,
        6,
        now() - interval '10 minutes',
        now() + interval '10 minutes',
        null,
        '{"title":"A","body":"B","data":{"type":"share_job_needs_help"}}'::jsonb,
        null,
        null
      ),
      (
        :'user_id'::uuid,
        'https://example.com/notif-submitted/' || :'run_id',
        'https://example.com/notif-submitted/' || :'run_id',
        'instagram',
        'completed',
        'completed',
        1,
        5,
        null,
        'submitted',
        1,
        6,
        now() - interval '3 minutes',
        null,
        '[{"ticketId":"ExponentPushTicket[abc]","tokenId":"00000000-0000-0000-0000-000000000001"}]'::jsonb,
        '{"title":"A","body":"B","data":{"type":"share_job_completed"}}'::jsonb,
        now() - interval '3 minutes',
        now() - interval '3 minutes'
      )
    returning id, source_url
  )
insert into _share_job_durability_ctx (
  queued_a,
  queued_b,
  stale_processing,
  fresh_processing,
  maxed,
  notif_pending,
  notif_retryable,
  notif_stale_sending,
  notif_submitted
)
select
  (array_agg(id) filter (where source_url like '%queued-a/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%queued-b/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%stale/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%fresh/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%maxed/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%notif-pending/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%notif-retryable/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%notif-stale-sending/' || :'run_id'))[1],
  (array_agg(id) filter (where source_url like '%notif-submitted/' || :'run_id'))[1]
from seeded;

-- Claim picks queued/stale rows, not maxed.
select 'claim_share_jobs_count' as test_name,
       (select count(*) from public.claim_share_jobs(10, 120)) = 3 as pass;

select 'claim_share_jobs_sets_processing' as test_name,
       count(*) = 3 as pass
  from public.share_jobs
 where id in (
   (select queued_a from _share_job_durability_ctx),
   (select queued_b from _share_job_durability_ctx),
   (select stale_processing from _share_job_durability_ctx)
 )
   and status = 'processing_metadata';

select 'claim_share_jobs_skips_maxed' as test_name,
       (select status from public.share_jobs where id = (select maxed from _share_job_durability_ctx)) = 'queued' as pass;

-- Non-stale lease is NOT stolen: a processing row whose lock is still in the
-- future must be left untouched (status + attempts unchanged).
select 'claim_share_jobs_skips_fresh_lock' as test_name,
       (select status from public.share_jobs where id = (select fresh_processing from _share_job_durability_ctx)) = 'processing_metadata'
       and (select attempts from public.share_jobs where id = (select fresh_processing from _share_job_durability_ctx)) = 1 as pass;

-- Terminal jobs are NOT reclaimed: a completed row is never pulled back into
-- the worker queue by claim_share_jobs.
select 'claim_share_jobs_skips_terminal_completed' as test_name,
       (select status from public.share_jobs where id = (select notif_pending from _share_job_durability_ctx)) = 'completed' as pass;

-- A second claimer immediately after the first gets NOTHING: the first claim
-- leased every actionable row (FOR UPDATE SKIP LOCKED + fresh lease), so two
-- concurrent workers can never return the same job.
select 'claim_share_jobs_second_claim_empty' as test_name,
       (select count(*) from public.claim_share_jobs(10, 120)) = 0 as pass;

-- Attempts increment atomically on claim (queued-a 0->1, stale 1->2).
select 'claim_share_jobs_increments_attempts' as test_name,
       (select attempts from public.share_jobs where id = (select queued_a from _share_job_durability_ctx)) = 1
       and (select attempts from public.share_jobs where id = (select stale_processing from _share_job_durability_ctx)) = 2 as pass;

-- Notification claim includes pending/retryable/stale-sending paths.
select 'claim_notifications_count' as test_name,
       (select count(*) from public.claim_share_job_notifications(10, 180)) = 3 as pass;

select 'claim_notifications_to_sending' as test_name,
       count(*) = 3 as pass
  from public.share_jobs
 where id in (
   (select notif_pending from _share_job_durability_ctx),
   (select notif_retryable from _share_job_durability_ctx),
   (select notif_stale_sending from _share_job_durability_ctx)
 )
   and notification_status = 'sending';

-- Receipt claim includes submitted rows with ticket ids and stale receipt check timestamp.
select 'claim_receipts_count' as test_name,
       (select count(*) from public.claim_share_job_receipts(10, 90)) = 1 as pass;

select 'claim_receipts_updates_check_time' as test_name,
       notification_receipts_checked_at > now() - interval '5 seconds' as pass
  from public.share_jobs
 where id = (select notif_submitted from _share_job_durability_ctx);

-- ---------------------------------------------------------------------------
-- Bounded backoff: a retryable notification whose next-attempt is in the
-- FUTURE must NOT be claimed yet.
-- ---------------------------------------------------------------------------
with ins_future as (
  insert into public.share_jobs (
    user_id, source_url, canonical_url, source_platform, status, progress_stage,
    notification_status, notification_attempts, notification_max_attempts,
    notification_last_attempt_at, notification_next_attempt_at, notification_payload
  )
  values (
    :'user_id'::uuid,
    'https://example.com/notif-future/' || :'run_id',
    'https://example.com/notif-future/' || :'run_id',
    'instagram', 'needs_help', 'manual',
    'retryable_failed', 2, 6,
    now() - interval '1 minute', now() + interval '5 minutes',
    '{"title":"A","body":"B","data":{"type":"share_job_needs_help"}}'::jsonb
  )
  returning id
)
select id as future_notif_id from ins_future \gset

select 'claim_notifications_skips_future_retryable' as test_name,
       (select count(*) from public.claim_share_job_notifications(50, 180)
         where id = :'future_notif_id'::uuid) = 0 as pass;

-- ---------------------------------------------------------------------------
-- Rapid duplicate submissions collapse inside the 90s window; a re-share after
-- the window creates a fresh job. Exercises create_share_job_for_user directly.
-- ---------------------------------------------------------------------------
select job_id as dedupe_first_job, duplicate as dedupe_first_dup
  from public.create_share_job_for_user(
    :'user_id'::uuid,
    'https://example.com/dedupe/' || :'run_id',
    'https://example.com/dedupe/' || :'run_id',
    'instagram', null, 90) \gset

select 'dedupe_first_submission_is_new' as test_name, :'dedupe_first_dup' = 'f' as pass;

select job_id as dedupe_second_job, duplicate as dedupe_second_dup
  from public.create_share_job_for_user(
    :'user_id'::uuid,
    'https://example.com/dedupe/' || :'run_id',
    'https://example.com/dedupe/' || :'run_id',
    'instagram', null, 90) \gset

select 'dedupe_second_submission_is_duplicate' as test_name, :'dedupe_second_dup' = 't' as pass;
select 'dedupe_returns_same_job' as test_name, :'dedupe_first_job' = :'dedupe_second_job' as pass;

-- Age the job out of the dedupe window -> the next submission is a NEW job.
update public.share_jobs set created_at = now() - interval '10 minutes'
 where id = :'dedupe_first_job'::uuid;

select duplicate as dedupe_after_dup
  from public.create_share_job_for_user(
    :'user_id'::uuid,
    'https://example.com/dedupe/' || :'run_id',
    'https://example.com/dedupe/' || :'run_id',
    'instagram', null, 90) \gset

select 'dedupe_after_window_is_new' as test_name, :'dedupe_after_dup' = 'f' as pass;

-- ---------------------------------------------------------------------------
-- Save idempotency across worker retries: the (user_id, place_id) unique
-- constraint means a retry that re-saves the same place cannot create a
-- duplicate saved_places row (this is what makes saveForUser idempotent).
-- ---------------------------------------------------------------------------
select set_config('durability.user_id', :'user_id', true);
do $$
declare
  v_place uuid;
  v_uid uuid := current_setting('durability.user_id')::uuid;
begin
  insert into public.places (google_place_id, name, formatted_address, latitude, longitude, category)
  values ('dur-save-' || substr(md5(random()::text), 1, 10), 'Durability Save', '1 Test St', 1, 1, 'test')
  returning id into v_place;

  insert into public.saved_places (user_id, place_id, source_type, source_url)
  values (v_uid, v_place, 'manual', 'https://example.com/save-1');

  begin
    insert into public.saved_places (user_id, place_id, source_type, source_url)
    values (v_uid, v_place, 'manual', 'https://example.com/save-2');
    raise notice 'save_idempotent_unique_user_place: FAIL (duplicate saved_place allowed)';
  exception when unique_violation then
    raise notice 'save_idempotent_unique_user_place: PASS (%).', sqlerrm;
  end;
end $$;

-- Roll back ALL seeded test data (belt-and-suspenders with ON COMMIT DROP on
-- the context table). No production rows are touched by this script.
rollback;
