-- ---------------------------------------------------------------------------
-- share_extraction_failures (LLM-friendly extraction miss diagnostics)
-- ---------------------------------------------------------------------------
--
-- Stores one structured row per debug-worthy extraction attempt
-- (manual fallback, failed/open_app paths, suspicious confirmations, etc.).
--
-- This table is developer/debug only. Client roles have NO read access.
-- Inserts are performed by the process-share-link Edge Function using the
-- service role client (which bypasses RLS).

set check_function_bodies = off;

create extension if not exists "pgcrypto";

create table if not exists public.share_extraction_failures (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  user_id uuid null references auth.users(id) on delete set null,

  original_url text not null,
  canonical_url text null,
  platform text null,

  status text null,
  user_facing_decision text null,
  safe_to_auto_save boolean null,
  confidence text null,

  failure_class text null,
  failure_reason text null,

  selected_candidate_name text null,
  selected_candidate_address text null,
  selected_candidate_place_id text null,
  selected_candidate_score numeric null,

  address_present boolean not null default false,
  address_count integer not null default 0,
  candidate_count integer not null default 0,
  query_count integer not null default 0,

  title_preview text null,
  description_preview text null,
  suggested_query text null,

  evidence jsonb not null default '{}'::jsonb,
  query_plan jsonb not null default '[]'::jsonb,
  candidates jsonb not null default '[]'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  diagnostics jsonb not null default '{}'::jsonb,

  llm_summary jsonb not null default '{}'::jsonb,

  app_version text null,
  backend_version text null,
  request_id text null
);

create index if not exists share_extraction_failures_created_idx
  on public.share_extraction_failures (created_at desc);
create index if not exists share_extraction_failures_platform_idx
  on public.share_extraction_failures (platform, created_at desc);
create index if not exists share_extraction_failures_decision_idx
  on public.share_extraction_failures (user_facing_decision, created_at desc);
create index if not exists share_extraction_failures_failure_class_idx
  on public.share_extraction_failures (failure_class, created_at desc);
create index if not exists share_extraction_failures_address_present_idx
  on public.share_extraction_failures (address_present, created_at desc);
create index if not exists share_extraction_failures_user_idx
  on public.share_extraction_failures (user_id, created_at desc);

alter table public.share_extraction_failures enable row level security;

drop policy if exists "share_extraction_failures: no client access" on public.share_extraction_failures;

create policy "share_extraction_failures: no client access"
  on public.share_extraction_failures
  for all
  to authenticated, anon
  using (false)
  with check (false);
