-- OPTIONAL / MANUAL ONLY. Do not run as part of migration deployment.
--
-- Enqueue at most :batch_size historical video-derived saved places that still
-- lack an AI note. Re-run until `remaining_missing` reaches zero. Existing
-- notes are never selected or modified, and the partial unique index makes the
-- operation idempotent.
--
-- Example (after the 20260819000001 migration is deployed to the intended DB):
--   psql "$DATABASE_URL" -v batch_size=250 -f scripts/backfillVideoAiNoteTasks.sql

begin;

with candidates as (
  select sp.id, sp.user_id, sp.place_id, sp.source_url, sp.source_type
    from public.saved_places sp
   where public.is_video_derived_saved_place(sp.source_type, sp.source_url)
     and coalesce(length(trim(sp.ai_note)), 0) = 0
     and not exists (
       select 1
         from public.share_media_tasks mt
        where mt.task_kind = 'ai_note_enrichment'
          and mt.saved_place_id = sp.id
     )
   order by sp.created_at, sp.id
   limit :batch_size
), inserted as (
  insert into public.share_media_tasks (
    task_kind, share_job_id, saved_place_id, target_place_id, user_id,
    source_url, canonical_url, platform,
    status, progress_stage, attempts, max_attempts, next_attempt_at,
    ai_note_outcome
  )
  select
    'ai_note_enrichment', null, c.id, c.place_id, c.user_id,
    trim(c.source_url), trim(c.source_url),
    public.video_source_platform(c.source_type, c.source_url),
    'queued', 'queued', 0, 3, now(), 'queued'
  from candidates c
  on conflict (saved_place_id) where task_kind = 'ai_note_enrichment'
  do nothing
  returning id
)
select count(*) as enqueued_this_batch from inserted;

select count(*) as remaining_missing
from public.video_derived_saved_places_without_ai_note;

commit;
