-- ---------------------------------------------------------------------------
-- feedback  (in-app, founder-led product feedback)
-- ---------------------------------------------------------------------------
--
-- Users send feedback from inside the app (Settings → "Send feedback").
-- Append-only from the client: authenticated users may INSERT feedback
-- attributed to themselves; only the service role (Supabase SQL Editor,
-- server scripts) can read it. Mirrors the conventions of
-- `analytics_events` (see 20260427000001_analytics_events.sql).
--
-- `metadata` is free-form JSONB — keep keys snake_case, never store auth
-- tokens or full URLs with personal tokens. `email` is optional and only
-- used to follow up.
--
-- Run via Supabase CLI: `supabase db push`
-- Or paste this file into the Supabase SQL Editor.

set check_function_bodies = off;

create extension if not exists "pgcrypto";

create table if not exists public.feedback (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete set null,
  email      text,
  category   text        not null,
  message    text        not null,
  metadata   jsonb       not null default '{}'::jsonb,
  status     text        not null default 'new',
  created_at timestamptz not null default now()
);

-- Common triage access patterns.
create index if not exists feedback_created_idx
  on public.feedback (created_at desc);
create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);
create index if not exists feedback_category_created_idx
  on public.feedback (category, created_at desc);
create index if not exists feedback_user_created_idx
  on public.feedback (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.feedback enable row level security;

-- Idempotent re-runs.
drop policy if exists "feedback: auth insert own" on public.feedback;

-- Authenticated users may insert feedback attributed to themselves only.
-- They cannot insert on behalf of another user, and cannot insert anonymous
-- (user_id null) rows — Settings feedback requires auth. Anonymous pre-auth
-- feedback, if ever needed, would be a separate policy + entry point.
create policy "feedback: auth insert own"
  on public.feedback
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- No SELECT/UPDATE/DELETE policies for client roles. Only the service role
-- can read/triage feedback, which is what we want.
