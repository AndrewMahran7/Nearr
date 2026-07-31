-- Async share jobs (Phase 1).
--
-- The `share_jobs` table is the DURABLE SOURCE OF TRUTH for the async
-- share-to-app flow. The iOS share extension / Android host route create a
-- row and dismiss immediately; a durable worker (see
-- 20260731000003_share_jobs_worker.sql) claims and processes rows out of
-- band using the existing process-share-link resolver.
--
-- Additive + reversible. See the DOWN section at the bottom (commented) for
-- the exact rollback. No destructive changes to existing tables.
--
-- Run via Supabase CLI: supabase db push

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- share_jobs
-- ---------------------------------------------------------------------------
create table if not exists public.share_jobs (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users(id) on delete cascade,

  -- Input.
  source_url            text not null,
  canonical_url         text,
  source_platform       text,

  -- Lifecycle.
  status                text not null default 'queued'
                          check (status in (
                            'queued',
                            'processing_metadata',
                            'completed',
                            'needs_help',
                            'failed',
                            'cancelled'
                          )),
  progress_stage        text,

  -- Outcome.
  decision              text
                          check (decision is null or decision in (
                            'auto_save',
                            'candidate_confirmation',
                            'candidate_picker',
                            'multi_candidate_confirmation',
                            'manual_fallback',
                            'failed'
                          )),
  saved_place_id        uuid references public.saved_places(id) on delete set null,
  candidate_payload     jsonb,
  extraction_payload    jsonb,
  suggested_query       text,
  needs_help_reason     text,
  failure_reason        text,

  -- Idempotency (client-supplied request id) + rapid-duplicate protection.
  idempotency_key       text,

  -- Worker bookkeeping (retry-safe claim; see claim_share_jobs()).
  attempts              integer not null default 0,
  max_attempts          integer not null default 5,
  locked_until          timestamptz,
  last_error            text,

  -- Notification idempotency — set once when the terminal push is sent.
  notification_sent_at  timestamptz,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  completed_at          timestamptz
);

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
-- Queue listing (newest first) for a user.
create index if not exists share_jobs_user_created_idx
  on public.share_jobs (user_id, created_at desc);

-- Section counts / badge (needs_help) queries.
create index if not exists share_jobs_user_status_idx
  on public.share_jobs (user_id, status);

-- Worker claim scan: only ever touches actionable rows.
create index if not exists share_jobs_claimable_idx
  on public.share_jobs (created_at)
  where status in ('queued', 'processing_metadata');

-- Rapid-duplicate protection: at most one IN-FLIGHT job per (user, url).
-- Once a job reaches a terminal state (completed/needs_help/failed/cancelled)
-- a re-share is allowed to create a fresh job.
create unique index if not exists share_jobs_active_url_uidx
  on public.share_jobs (user_id, canonical_url)
  where status in ('queued', 'processing_metadata');

-- Explicit client idempotency (clientRequestId). Retried submissions with the
-- same key return the same job.
create unique index if not exists share_jobs_idempotency_uidx
  on public.share_jobs (user_id, idempotency_key)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- updated_at trigger (reuses the shared helper from the init migration).
-- ---------------------------------------------------------------------------
drop trigger if exists share_jobs_set_updated_at on public.share_jobs;
create trigger share_jobs_set_updated_at
  before update on public.share_jobs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security — owner-only. The Edge Functions use the service role
-- (which bypasses RLS); these policies govern the mobile client reading its
-- own queue and resolving / removing its own jobs.
-- ---------------------------------------------------------------------------
alter table public.share_jobs enable row level security;

drop policy if exists "share_jobs: owner select" on public.share_jobs;
drop policy if exists "share_jobs: owner insert" on public.share_jobs;
drop policy if exists "share_jobs: owner update" on public.share_jobs;
drop policy if exists "share_jobs: owner delete" on public.share_jobs;

create policy "share_jobs: owner select" on public.share_jobs
  for select using (auth.uid() = user_id);
create policy "share_jobs: owner delete" on public.share_jobs
  for delete using (auth.uid() = user_id);

-- Security hardening: client writes must go through constrained RPCs below.
-- This prevents forged worker states (processing/attempt counters/locks) and
-- bypassing URL validation/idempotency invariants.
revoke insert on public.share_jobs from anon, authenticated;
revoke update on public.share_jobs from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: let the in-app queue receive live status changes (RLS still
-- scopes each client to its own rows). Guarded so apply never fails if the
-- default publication is absent.
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.share_jobs;
exception when others then
  raise notice 'Could not add share_jobs to supabase_realtime publication (add it manually if you want live queue updates).';
end $$;

-- ---------------------------------------------------------------------------
-- claim_share_jobs(): race-safe pull for the durable worker.
--
-- Atomically transitions up to p_limit actionable rows to
-- 'processing_metadata', leasing them for p_lock_seconds. Uses
-- FOR UPDATE SKIP LOCKED so concurrent worker invocations never grab the
-- same row. Also RECLAIMS rows whose processing lease expired (crashed /
-- timed-out worker) as long as they have retry budget left.
--
-- SECURITY DEFINER + revoked from PUBLIC: only the service role (worker)
-- may claim. Regular users must never mutate the queue's worker state.
-- ---------------------------------------------------------------------------
create or replace function public.claim_share_jobs(
  p_limit integer default 5,
  p_lock_seconds integer default 120
)
returns setof public.share_jobs
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  return query
  update public.share_jobs sj
     set status = 'processing_metadata',
         attempts = sj.attempts + 1,
         locked_until = now() + make_interval(secs => greatest(p_lock_seconds, 30)),
         updated_at = now()
   where sj.id in (
     select c.id
       from public.share_jobs c
      where c.attempts < c.max_attempts
        and (
          c.status = 'queued'
          or (c.status = 'processing_metadata' and c.locked_until is not null and c.locked_until < now())
        )
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning sj.*;
end;
$$;

revoke all on function public.claim_share_jobs(integer, integer) from public;
grant execute on function public.claim_share_jobs(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- Client mutation RPCs (owner-scoped, constrained transitions only).
-- ---------------------------------------------------------------------------

create or replace function public.resolve_share_job(
  p_job_id uuid,
  p_saved_place_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_saved_owner uuid;
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_saved_place_id is null then
    raise exception 'invalid_saved_place_id';
  end if;

  select sp.user_id into v_saved_owner
    from public.saved_places sp
   where sp.id = p_saved_place_id;

  if v_saved_owner is distinct from v_uid then
    raise exception 'saved_place_not_owned';
  end if;

  update public.share_jobs sj
     set status = 'completed',
         saved_place_id = p_saved_place_id,
         completed_at = now(),
         progress_stage = 'completed',
         updated_at = now()
   where sj.id = p_job_id
     and sj.user_id = v_uid
     and sj.status in ('needs_help', 'failed');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.resolve_share_job(uuid, uuid) from public;
grant execute on function public.resolve_share_job(uuid, uuid) to authenticated;

create or replace function public.cancel_share_job(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.share_jobs sj
     set status = 'cancelled',
         completed_at = now(),
         updated_at = now()
   where sj.id = p_job_id
     and sj.user_id = v_uid
     and sj.status in ('queued', 'processing_metadata');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.cancel_share_job(uuid) from public;
grant execute on function public.cancel_share_job(uuid) to authenticated;

create or replace function public.retry_share_job(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.share_jobs sj
     set status = 'queued',
         attempts = 0,
         locked_until = null,
         last_error = null,
         failure_reason = null,
         completed_at = null,
         progress_stage = 'queued',
         updated_at = now()
   where sj.id = p_job_id
     and sj.user_id = v_uid
     and sj.saved_place_id is null
     and sj.status in ('failed', 'needs_help');

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.retry_share_job(uuid) from public;
grant execute on function public.retry_share_job(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop function if exists public.claim_share_jobs(integer, integer);
--   drop table if exists public.share_jobs;   -- cascades its trigger + policies
-- ---------------------------------------------------------------------------
