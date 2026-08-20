-- Durable convergence for AI notes on video/share-derived saved places.
--
-- This extends the EXISTING share_media_tasks queue instead of introducing a
-- second worker/queue system. Recognition tasks remain byte-for-byte compatible
-- (`task_kind = 'recognition'`). A lightweight `ai_note_enrichment` task points
-- at the final saved_places row, reuses the same media retrieval/transcription/
-- Gemini analysis pipeline, and writes only saved_places.ai_note after the Deno
-- finalizer validates place identity and evidence.
--
-- Forward correctness only: this migration deliberately does NOT enqueue every
-- historical row. See scripts/backfillVideoAiNoteTasks.sql for an explicit,
-- idempotent, batchable future backfill.

set check_function_bodies = off;

-- Resolve only provenance the media worker can process. Every row needs a
-- durable post/video URL shape. An explicit normalized label must agree with
-- that URL; `link`/null preserves legacy compatibility.
create or replace function public.video_source_platform(
  p_source_type text,
  p_source_url text
)
returns text
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select case
    when coalesce(length(trim(p_source_url)), 0) = 0 then null
    when lower(trim(coalesce(p_source_type, ''))) = 'manual' then null
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'instagram')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?instagram\.com/((p|reel|reels|tv)/[^/?#]+|stories/[^/?#]+/[^/?#]+)/?([?#].*)?$' then 'instagram'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'tiktok')
      and lower(p_source_url) ~ '^https://(vm\.|vt\.)tiktok\.com/[^/?#]+' then 'tiktok'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'tiktok')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?tiktok\.com/(@[^/]+/video/[0-9]+|t/[^/?#]+)/?([?#].*)?$' then 'tiktok'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'youtube')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?youtube\.com/(shorts|live)/[^/?#]+/?([?#].*)?$' then 'youtube'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'youtube')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?youtube\.com/watch/?\?[^#]*v=[^&#]+' then 'youtube'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'youtube')
      and lower(p_source_url) ~ '^https://youtu\.be/[^/?#]+' then 'youtube'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'facebook')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?facebook\.com/(reel|reels)/[^/?#]+' then 'facebook'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'facebook')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?facebook\.com/[^/?#]+/(videos|posts)/[^/?#]+' then 'facebook'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'facebook')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?facebook\.com/share/(r|v|p)/[^/?#]+' then 'facebook'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'facebook')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?facebook\.com/watch/?\?[^#]*v=[^&#]+' then 'facebook'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'facebook')
      and lower(p_source_url) ~ '^https://fb\.watch/[^/?#]+' then 'facebook'
    when lower(trim(coalesce(p_source_type, ''))) in ('', 'link', 'snapchat')
      and lower(p_source_url) ~ '^https://([^/?#]+\.)?snapchat\.com/spotlight/[^/?#]+' then 'snapchat'
    else null
  end;
$$;

revoke all on function public.video_source_platform(text, text) from public, anon, authenticated;
grant execute on function public.video_source_platform(text, text) to service_role;

create or replace function public.is_video_derived_saved_place(
  p_source_type text,
  p_source_url text
)
returns boolean
language sql
immutable
parallel safe
set search_path = public, pg_temp
as $$
  select public.video_source_platform(p_source_type, p_source_url) is not null;
$$;

revoke all on function public.is_video_derived_saved_place(text, text) from public, anon, authenticated;
grant execute on function public.is_video_derived_saved_place(text, text) to service_role;

-- Generalize the existing durable media queue. Recognition still has exactly
-- one task per share_job. AI-note enrichment has exactly one task per saved
-- place and may exist without a parent share_job (legacy synchronous/manual
-- fallback paths).
alter table public.share_media_tasks
  alter column share_job_id drop not null;

alter table public.share_media_tasks
  drop constraint if exists share_media_tasks_share_job_id_key;

alter table public.share_media_tasks
  add column if not exists task_kind text not null default 'recognition',
  add column if not exists saved_place_id uuid references public.saved_places(id) on delete cascade,
  add column if not exists target_place_id uuid references public.places(id) on delete cascade,
  add column if not exists retry_cycles integer not null default 0,
  add column if not exists evidence_snapshot jsonb not null default '[]'::jsonb,
  add column if not exists media_acquired_once boolean not null default false,
  add column if not exists analysis_model text,
  add column if not exists prompt_version text,
  add column if not exists latency_ms integer,
  add column if not exists model_calls integer,
  add column if not exists model_input_tokens integer,
  add column if not exists model_output_tokens integer,
  add column if not exists model_thinking_tokens integer,
  add column if not exists model_latency_ms integer,
  add column if not exists ai_note_outcome text;

alter table public.share_media_tasks
  drop constraint if exists share_media_tasks_task_kind_check;
alter table public.share_media_tasks
  add constraint share_media_tasks_task_kind_check
  check (task_kind in ('recognition', 'ai_note_enrichment'));

alter table public.share_media_tasks
  drop constraint if exists share_media_tasks_evidence_snapshot_check;
alter table public.share_media_tasks
  add constraint share_media_tasks_evidence_snapshot_check
  check (
    jsonb_typeof(evidence_snapshot) = 'array'
    and octet_length(evidence_snapshot::text) <= 16000
  );

alter table public.share_media_tasks
  drop constraint if exists share_media_tasks_target_check;
alter table public.share_media_tasks
  add constraint share_media_tasks_target_check
  check (
    (task_kind = 'recognition' and share_job_id is not null and saved_place_id is null and target_place_id is null)
    or
    (task_kind = 'ai_note_enrichment' and share_job_id is null and saved_place_id is not null and target_place_id is not null)
  );

create unique index if not exists share_media_tasks_recognition_job_uidx
  on public.share_media_tasks (share_job_id)
  where task_kind = 'recognition';

create unique index if not exists share_media_tasks_ai_note_saved_place_uidx
  on public.share_media_tasks (saved_place_id)
  where task_kind = 'ai_note_enrichment';

create index if not exists share_media_tasks_saved_place_idx
  on public.share_media_tasks (saved_place_id)
  where saved_place_id is not null;

-- Service-role writes do not bypass triggers. Validate ownership against the
-- correct parent for both task kinds.
create or replace function public.share_media_tasks_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_owner uuid;
  v_target uuid;
begin
  if new.task_kind = 'recognition' then
    select sj.user_id into v_owner
      from public.share_jobs sj
     where sj.id = new.share_job_id;
    if v_owner is null then
      raise exception 'share_media_tasks: parent share_job % not found', new.share_job_id;
    end if;
  elsif new.task_kind = 'ai_note_enrichment' then
    select sp.user_id, sp.place_id into v_owner, v_target
      from public.saved_places sp
     where sp.id = new.saved_place_id;
    if v_owner is null then
      raise exception 'share_media_tasks: saved_place % not found', new.saved_place_id;
    end if;
    if new.target_place_id is distinct from v_target then
      raise exception 'share_media_tasks: target_place_id % does not match saved place %',
        new.target_place_id, v_target;
    end if;
  else
    raise exception 'share_media_tasks: invalid task_kind %', new.task_kind;
  end if;

  if new.user_id is distinct from v_owner then
    raise exception 'share_media_tasks: user_id % does not match task owner %',
      new.user_id, v_owner;
  end if;
  return new;
end;
$$;

drop trigger if exists share_media_tasks_owner_guard on public.share_media_tasks;
create trigger share_media_tasks_owner_guard
  before insert or update of user_id, share_job_id, saved_place_id, target_place_id, task_kind
  on public.share_media_tasks
  for each row execute function public.share_media_tasks_enforce_owner();

-- Central invariant point. Every INSERT and every provenance/AI-note change
-- converges through one trigger, regardless of whether it came from automatic
-- recognition, confirmation, picker, multi-save, correction, manual fallback,
-- duplicate recovery, or existing-place attachment.
create or replace function public.ensure_video_ai_note_task()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_platform text;
  v_rearm boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_rearm :=
      not public.is_video_derived_saved_place(old.source_type, old.source_url)
      or old.place_id is distinct from new.place_id
      or old.source_url is distinct from new.source_url
      or (
        coalesce(length(trim(old.ai_note)), 0) > 0
        and coalesce(length(trim(new.ai_note)), 0) = 0
      );
  end if;
  if public.is_video_derived_saved_place(new.source_type, new.source_url)
     and coalesce(length(trim(new.ai_note)), 0) = 0 then
    v_platform := public.video_source_platform(new.source_type, new.source_url);

    insert into public.share_media_tasks (
      task_kind,
      share_job_id,
      saved_place_id,
      target_place_id,
      user_id,
      source_url,
      canonical_url,
      platform,
      status,
      progress_stage,
      attempts,
      max_attempts,
      next_attempt_at,
      locked_at,
      locked_until,
      failure_code,
      failure_detail,
      completed_at,
      ai_note_outcome
    ) values (
      'ai_note_enrichment',
      null,
      new.id,
      new.place_id,
      new.user_id,
      trim(new.source_url),
      trim(new.source_url),
      v_platform,
      'queued',
      'queued',
      0,
      3,
      now() + interval '15 seconds',
      null,
      null,
      null,
      null,
      null,
      'queued'
    )
    on conflict (saved_place_id) where task_kind = 'ai_note_enrichment'
    do update set
      user_id = excluded.user_id,
      target_place_id = excluded.target_place_id,
      source_url = excluded.source_url,
      canonical_url = excluded.canonical_url,
      platform = excluded.platform,
      status = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then 'queued'
        else public.share_media_tasks.status
      end,
      progress_stage = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then 'queued'
        else public.share_media_tasks.progress_stage
      end,
      attempts = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then 0
        else public.share_media_tasks.attempts
      end,
      next_attempt_at = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then now() + interval '15 seconds'
        else public.share_media_tasks.next_attempt_at
      end,
      locked_at = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then null else public.share_media_tasks.locked_at end,
      locked_until = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then null else public.share_media_tasks.locked_until end,
      failure_code = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then null else public.share_media_tasks.failure_code end,
      failure_detail = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then null else public.share_media_tasks.failure_detail end,
      completed_at = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then null else public.share_media_tasks.completed_at end,
      ai_note_outcome = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then 'queued' else public.share_media_tasks.ai_note_outcome end,
      retry_cycles = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          or v_rearm
          then 0 else public.share_media_tasks.retry_cycles end,
      evidence_snapshot = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          then '[]'::jsonb else public.share_media_tasks.evidence_snapshot end,
      media_acquired_once = case
        when public.share_media_tasks.source_url is distinct from excluded.source_url
          or public.share_media_tasks.target_place_id is distinct from excluded.target_place_id
          then false else public.share_media_tasks.media_acquired_once end,
      updated_at = now();
  else
    -- Synchronous generation won the race, a user deleted the video-derived
    -- row, or provenance became manual. Stop only this supplemental task.
    update public.share_media_tasks
       set status = 'completed',
           progress_stage = 'cleanup',
           locked_until = null,
           completed_at = coalesce(completed_at, now()),
           ai_note_outcome = case
             when coalesce(length(trim(new.ai_note)), 0) > 0 then 'already_present'
             else 'not_video_derived'
           end,
           updated_at = now()
     where task_kind = 'ai_note_enrichment'
       and saved_place_id = new.id
       and status in ('queued', 'processing');
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_video_ai_note_task() from public, anon, authenticated;
grant execute on function public.ensure_video_ai_note_task() to service_role;

-- A cue belongs to a place/source pair. Wrong-place correction intentionally
-- keeps the saved_places row identity and changes place_id; carrying the old
-- place's cue across that mutation would make a perfectly grounded Place A note
-- appear on Place B. Clear generated text only (never user-authored `notes`),
-- then let the central AFTER trigger enqueue a fresh task for the final place.
create or replace function public.invalidate_video_ai_note_on_place_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if old.place_id is distinct from new.place_id
     and public.is_video_derived_saved_place(new.source_type, new.source_url) then
    new.ai_note := null;
  end if;
  return new;
end;
$$;

revoke all on function public.invalidate_video_ai_note_on_place_change() from public, anon, authenticated;
grant execute on function public.invalidate_video_ai_note_on_place_change() to service_role;

drop trigger if exists saved_places_invalidate_ai_note_on_place_change on public.saved_places;
create trigger saved_places_invalidate_ai_note_on_place_change
  before update of place_id
  on public.saved_places
  for each row execute function public.invalidate_video_ai_note_on_place_change();

drop trigger if exists saved_places_ensure_video_ai_note on public.saved_places;
create trigger saved_places_ensure_video_ai_note
  after insert or update of place_id, source_url, source_type, ai_note
  on public.saved_places
  for each row execute function public.ensure_video_ai_note_task();

-- The claim/retry infrastructure is unchanged; the eligibility join now
-- understands both task kinds. AI-note tasks remain claimable after the place
-- save because their durable target is saved_places, not a nonterminal job.
create or replace function public.claim_media_tasks(
  p_limit integer default 2,
  p_lock_seconds integer default 600
)
returns setof public.share_media_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_media_tasks mt
     set status = 'processing',
         attempts = mt.attempts + 1,
         locked_at = now(),
         locked_until = now() + make_interval(secs => greatest(p_lock_seconds, 60)),
         progress_stage = coalesce(mt.progress_stage, 'queued'),
         updated_at = now()
   where mt.id in (
     select c.id
       from public.share_media_tasks c
      where c.attempts < c.max_attempts
        and (c.next_attempt_at is null or c.next_attempt_at <= now())
        and (
          c.status = 'queued'
          or (c.status = 'processing' and c.locked_until is not null and c.locked_until < now())
        )
        and (
          (
            c.task_kind = 'recognition'
            and exists (
              select 1
                from public.share_jobs sj
               where sj.id = c.share_job_id
                 and (
                   sj.status = 'processing_metadata'
                   or (sj.status = 'completed' and sj.saved_place_id is not null)
                 )
            )
          )
          or
          (
            c.task_kind = 'ai_note_enrichment'
            and exists (
              select 1
                from public.saved_places sp
               where sp.id = c.saved_place_id
                 and sp.user_id = c.user_id
                 and sp.place_id = c.target_place_id
                 and sp.source_url = coalesce(c.canonical_url, c.source_url)
                 and public.is_video_derived_saved_place(sp.source_type, sp.source_url)
                 and coalesce(length(trim(sp.ai_note)), 0) = 0
            )
          )
        )
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning mt.*;
end;
$$;

revoke all on function public.claim_media_tasks(integer, integer) from public, anon, authenticated;
grant execute on function public.claim_media_tasks(integer, integer) to service_role;

-- Recognition keeps its original terminal exhaustion semantics. An AI-note
-- task is a durable obligation: after a worker crash or repeated transient
-- outage exhausts one three-attempt cycle, renew it on an increasingly long,
-- capped cooldown. This cannot hot-loop, and it converges once the provider
-- recovers without making the place save synchronous.
create or replace function public.expire_media_tasks(
  p_limit integer default 25
)
returns setof public.share_media_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_media_tasks mt
     set status = case when mt.task_kind = 'ai_note_enrichment' then 'queued' else 'failed' end,
         attempts = case when mt.task_kind = 'ai_note_enrichment' then 0 else mt.attempts end,
         retry_cycles = case when mt.task_kind = 'ai_note_enrichment' then mt.retry_cycles + 1 else mt.retry_cycles end,
         next_attempt_at = case
           when mt.task_kind = 'ai_note_enrichment' then
             now() + make_interval(secs => least(86400, 3600 * power(2, least(mt.retry_cycles, 5)))::integer)
           else mt.next_attempt_at
         end,
         failure_code = coalesce(mt.failure_code, 'media_worker_unavailable'),
         ai_note_outcome = case
           when mt.task_kind = 'ai_note_enrichment' then 'retry_after_outage'
           else mt.ai_note_outcome
         end,
         locked_until = null,
         completed_at = case when mt.task_kind = 'ai_note_enrichment' then null else now() end,
         updated_at = now()
   where mt.id in (
     select c.id
       from public.share_media_tasks c
      where c.status in ('queued', 'processing')
        and c.attempts >= c.max_attempts
        and (c.locked_until is null or c.locked_until < now())
      order by c.updated_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning mt.*;
end;
$$;

revoke all on function public.expire_media_tasks(integer) from public, anon, authenticated;
grant execute on function public.expire_media_tasks(integer) to service_role;

-- Internal invariant metric. This is intentionally service-role only; it is a
-- diagnostics source, not user-facing UI. One row per missing place, including
-- current convergence/retry state and bounded error codes.
create or replace view public.video_derived_saved_places_without_ai_note
with (security_invoker = true)
as
select
  sp.id as saved_place_id,
  sp.user_id,
  sp.place_id,
  sp.source_type,
  sp.source_url,
  sp.created_at as saved_at,
  mt.id as task_id,
  mt.status as generation_status,
  mt.attempts as retry_count,
  mt.max_attempts,
  mt.retry_cycles,
  mt.analysis_provider as provider,
  mt.analysis_model as model,
  mt.prompt_version,
  mt.latency_ms,
  mt.model_calls,
  mt.model_input_tokens,
  mt.model_output_tokens,
  mt.model_thinking_tokens,
  mt.model_latency_ms,
  mt.failure_code,
  mt.ai_note_outcome,
  jsonb_array_length(mt.evidence_snapshot) as retained_evidence_count,
  mt.media_acquired_once,
  mt.updated_at as task_updated_at
from public.saved_places sp
left join public.share_media_tasks mt
  on mt.saved_place_id = sp.id
 and mt.task_kind = 'ai_note_enrichment'
where public.is_video_derived_saved_place(sp.source_type, sp.source_url)
  and coalesce(length(trim(sp.ai_note)), 0) = 0;

revoke all on public.video_derived_saved_places_without_ai_note from public, anon, authenticated;
grant select on public.video_derived_saved_places_without_ai_note to service_role;

comment on view public.video_derived_saved_places_without_ai_note is
  'Invariant metric: video/share-derived saved places still missing a useful AI note, with durable task diagnostics.';
