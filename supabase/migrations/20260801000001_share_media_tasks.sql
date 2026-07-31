-- Phase 2 — Durable media-analysis fallback queue.
--
-- When the Phase 1 metadata resolver cannot produce verified evidence for a
-- SUPPORTED platform (Instagram first), the worker enqueues ONE
-- `share_media_tasks` row instead of immediately moving the parent
-- `share_jobs` row to `needs_help`. A separate, containerized media worker
-- (services/media-worker) claims the task, retrieves the public video
-- temporarily, extracts spoken + visual place evidence, and calls back into
-- the EXISTING deterministic resolver + `safeToAutoSave` gate to finalize the
-- parent job. See docs/MEDIA_FALLBACK.md.
--
-- SAFETY / DURABILITY MODEL (read before changing anything):
--   * `share_media_tasks` is SERVICE-ROLE ONLY. Clients never read or write
--     it — the parent `share_jobs` row remains the user-facing source of
--     truth. RLS is enabled with NO client policies, and anon/authenticated
--     are explicitly revoked.
--   * Raw video / audio / frame BYTES are NEVER stored in Postgres. Only
--     lifecycle bookkeeping + small structured diagnostics live here.
--   * The claim RPC uses FOR UPDATE SKIP LOCKED with stale-lease recovery and
--     bounded attempts, exactly like `claim_share_jobs()`. Terminal tasks are
--     never reclaimed.
--
-- Additive + reversible. See the commented DOWN section at the bottom. No
-- destructive changes to Phase 1 tables. Run via: supabase db push

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- share_media_tasks — the durable media-analysis queue (service-role only).
-- ---------------------------------------------------------------------------
create table if not exists public.share_media_tasks (
  id                    uuid primary key default gen_random_uuid(),

  -- One media task per share job (prevents repeated fallback tasks). The FK
  -- keeps the task tied to its parent; deleting a job cascades the task away
  -- but NEVER touches the saved place (that lives on share_jobs).
  share_job_id          uuid not null unique
                          references public.share_jobs(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,

  -- Input (canonical_url is the post-redirect normalized URL).
  source_url            text not null,
  canonical_url         text,
  platform              text not null,

  -- Lifecycle.
  status                text not null default 'queued'
                          check (status in (
                            'queued',
                            'processing',
                            'completed',
                            'needs_help',
                            'failed',
                            'cancelled'
                          )),
  -- Human-readable internal progress. The CLIENT never reads this; the parent
  -- share_jobs.progress_stage carries the simplified user-facing copy.
  progress_stage        text
                          check (progress_stage is null or progress_stage in (
                            'queued',
                            'retrieving_media',
                            'inspecting_media',
                            'extracting_audio',
                            'transcribing_audio',
                            'extracting_frames',
                            'extracting_visible_text',
                            'analyzing_evidence',
                            'verifying_place',
                            'cleanup'
                          )),

  -- Worker bookkeeping (retry-safe claim; see claim_media_tasks()).
  attempts              integer not null default 0,
  max_attempts          integer not null default 3,
  locked_at             timestamptz,
  locked_until          timestamptz,

  -- Diagnostics-lite (no secrets, no signed URLs, no raw bytes).
  resolver_name         text,
  media_duration_seconds numeric,
  media_size_bytes      bigint,
  media_sha256          text,
  transcription_provider text,
  analysis_provider     text,
  failure_code          text,
  failure_detail        text,
  warnings              jsonb not null default '[]'::jsonb,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Worker claim scan: only ever touches actionable rows.
create index if not exists share_media_tasks_claimable_idx
  on public.share_media_tasks (created_at)
  where status in ('queued', 'processing');

-- Parent lookup / reaper joins.
create index if not exists share_media_tasks_job_idx
  on public.share_media_tasks (share_job_id);

create index if not exists share_media_tasks_user_idx
  on public.share_media_tasks (user_id);

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuses the shared helper from the init migration).
-- ---------------------------------------------------------------------------
drop trigger if exists share_media_tasks_set_updated_at on public.share_media_tasks;
create trigger share_media_tasks_set_updated_at
  before update on public.share_media_tasks
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Ownership invariant: the task's user_id MUST match the parent job's owner.
-- Enforced at the DB layer regardless of how the row is inserted (the worker
-- uses the service role, which bypasses RLS but not triggers).
-- ---------------------------------------------------------------------------
create or replace function public.share_media_tasks_enforce_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job_owner uuid;
begin
  select sj.user_id into v_job_owner
    from public.share_jobs sj
   where sj.id = new.share_job_id;

  if v_job_owner is null then
    raise exception 'share_media_tasks: parent share_job % not found', new.share_job_id;
  end if;
  if new.user_id is distinct from v_job_owner then
    raise exception 'share_media_tasks: user_id % does not match parent job owner %',
      new.user_id, v_job_owner;
  end if;
  return new;
end;
$$;

drop trigger if exists share_media_tasks_owner_guard on public.share_media_tasks;
create trigger share_media_tasks_owner_guard
  before insert or update of user_id, share_job_id on public.share_media_tasks
  for each row execute function public.share_media_tasks_enforce_owner();

-- ---------------------------------------------------------------------------
-- share_media_runs — service-role-only diagnostics for debugging extraction
-- failures. Reuses the pattern of share_agent_runs / share_extraction_failures
-- (append-only, no client access). NEVER stores private media URLs, signed
-- URLs, secrets, or raw bytes. Large model output is truncated by the worker
-- BEFORE insert.
-- ---------------------------------------------------------------------------
create table if not exists public.share_media_runs (
  id                     uuid primary key default gen_random_uuid(),
  share_media_task_id    uuid references public.share_media_tasks(id) on delete set null,
  share_job_id           uuid references public.share_jobs(id) on delete set null,
  user_id                uuid references auth.users(id) on delete set null,

  platform               text,
  resolver_name          text,
  model_provider         text,
  transcription_provider text,

  duration_ms            integer,
  media_duration_seconds numeric,
  frame_count            integer,
  transcript_segment_count integer,
  ocr_segment_count      integer,

  -- Structured, size-bounded evidence + model output for debugging. No raw
  -- media, no secrets, no signed URLs.
  evidence               jsonb,
  model_output           jsonb,
  warnings               jsonb not null default '[]'::jsonb,
  errors                 jsonb not null default '[]'::jsonb,

  created_at             timestamptz not null default now()
);

create index if not exists share_media_runs_task_idx
  on public.share_media_runs (share_media_task_id);
create index if not exists share_media_runs_job_idx
  on public.share_media_runs (share_job_id);
create index if not exists share_media_runs_created_idx
  on public.share_media_runs (created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security — SERVICE ROLE ONLY for both tables.
--
-- RLS is enabled with NO policies, so anon/authenticated get zero rows. We
-- ALSO revoke table privileges explicitly (defense in depth): even if a
-- future policy is added by mistake, the GRANTs are gone. The service role
-- bypasses RLS + retains ownership privileges, so the worker still has full
-- access.
-- ---------------------------------------------------------------------------
alter table public.share_media_tasks enable row level security;
alter table public.share_media_runs  enable row level security;

revoke all on public.share_media_tasks from anon, authenticated;
revoke all on public.share_media_runs  from anon, authenticated;

-- ---------------------------------------------------------------------------
-- claim_media_tasks(): race-safe pull for the containerized media worker.
--
-- Atomically transitions up to p_limit actionable rows to 'processing',
-- leasing them for p_lock_seconds. FOR UPDATE SKIP LOCKED so concurrent
-- worker invocations never grab the same row. RECLAIMS rows whose lease
-- expired (crashed / timed-out worker) as long as they have retry budget.
-- Terminal rows (completed/needs_help/failed/cancelled) are never reclaimed.
--
-- SECURITY DEFINER + revoked from anon/authenticated: only the service role
-- (worker) may claim.
-- ---------------------------------------------------------------------------
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
        and (
          c.status = 'queued'
          or (c.status = 'processing' and c.locked_until is not null and c.locked_until < now())
        )
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning mt.*;
end;
$$;

revoke all on function public.claim_media_tasks(integer, integer) from public;
revoke all on function public.claim_media_tasks(integer, integer) from anon, authenticated;
grant execute on function public.claim_media_tasks(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- expire_media_tasks(): backstop reaper. Marks non-terminal tasks that have
-- exhausted their retry budget (attempts >= max_attempts and lease expired)
-- as 'failed' so the Deno worker's finalizer can move the parent job to a
-- safe needs_help(manual) state. Returns the affected rows. Service-role only.
--
-- This guarantees a parent job can NEVER get stuck "checking the video"
-- forever if the media worker is permanently unavailable — even during a
-- rollback that stops the media worker but leaves process-share-jobs running.
-- ---------------------------------------------------------------------------
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
     set status = 'failed',
         failure_code = coalesce(mt.failure_code, 'media_worker_unavailable'),
         locked_until = null,
         updated_at = now()
   where mt.id in (
     select c.id
       from public.share_media_tasks c
      where c.status in ('queued', 'processing')
        and c.attempts >= c.max_attempts
        and (c.locked_until is null or c.locked_until < now())
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning mt.*;
end;
$$;

revoke all on function public.expire_media_tasks(integer) from public;
revoke all on function public.expire_media_tasks(integer) from anon, authenticated;
grant execute on function public.expire_media_tasks(integer) to service_role;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop function if exists public.expire_media_tasks(integer);
--   drop function if exists public.claim_media_tasks(integer, integer);
--   drop trigger if exists share_media_tasks_owner_guard on public.share_media_tasks;
--   drop function if exists public.share_media_tasks_enforce_owner();
--   drop table if exists public.share_media_runs;
--   drop table if exists public.share_media_tasks;
-- ---------------------------------------------------------------------------
