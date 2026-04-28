-- ---------------------------------------------------------------------------
-- analytics_events  (lightweight product analytics)
-- ---------------------------------------------------------------------------
--
-- Single append-only table that the client writes to via `lib/analytics.ts`.
-- Designed so we can answer product/growth questions (WAU, WAD, save success
-- rate, retention, funnel) directly from the Supabase SQL Editor — no
-- dashboard, no third-party SDK.
--
-- Conventions:
--   * `event_name` is snake_case, e.g. 'save_started', 'open_in_maps_tapped'.
--   * `properties` is free-form JSONB. Keep keys snake_case, never include
--     PII (no email, no full URL with personal tokens, no auth tokens).
--   * `user_id` may be null for anonymous events fired before sign-in.
--     `anonymous_id` (a stable per-install uuid stored in AsyncStorage) is
--     used to stitch pre-/post-signup behavior.
--   * Inserts only — clients can never UPDATE/DELETE/SELECT their own
--     events. Read access is service-role only (Supabase SQL Editor uses
--     service role).
--
-- Run via Supabase CLI: `supabase db push`
-- Or paste this file into the Supabase SQL Editor.

set check_function_bodies = off;

create extension if not exists "pgcrypto";

create table if not exists public.analytics_events (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        references auth.users(id) on delete set null,
  anonymous_id  text,
  event_name    text        not null,
  properties    jsonb       not null default '{}'::jsonb,
  platform      text,
  app_version   text,
  build_number  text,
  created_at    timestamptz not null default now()
);

-- Indexes for the common analytical access patterns.
create index if not exists analytics_events_event_created_idx
  on public.analytics_events (event_name, created_at desc);
create index if not exists analytics_events_user_created_idx
  on public.analytics_events (user_id, created_at desc);
create index if not exists analytics_events_created_idx
  on public.analytics_events (created_at desc);
-- GIN over properties so queries like
--   where properties @> '{"source_type":"instagram"}'
-- stay cheap as the table grows.
create index if not exists analytics_events_properties_gin_idx
  on public.analytics_events using gin (properties jsonb_path_ops);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.analytics_events enable row level security;

-- Drop any prior policies (idempotent re-runs).
drop policy if exists "analytics_events: auth insert"  on public.analytics_events;
drop policy if exists "analytics_events: anon insert"  on public.analytics_events;
drop policy if exists "analytics_events: no client read" on public.analytics_events;

-- Authenticated users can insert events that belong to them OR are anonymous
-- (user_id is null). We deliberately allow user_id = null inserts so that
-- pre-sign-in events (e.g. share_received from a cold-start share intent
-- before auth resolves) still land. We DO NOT allow inserting events on
-- behalf of another user.
create policy "analytics_events: auth insert"
  on public.analytics_events
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

-- Allow the anon role to insert anonymous-only rows. This lets the app
-- record `session_started` / `share_received` before the user is signed in.
-- Forbidden from claiming a user_id.
create policy "analytics_events: anon insert"
  on public.analytics_events
  for insert
  to anon
  with check (user_id is null);

-- No SELECT/UPDATE/DELETE policies for client roles. Only the service role
-- (Supabase SQL Editor, server scripts) can read this table, which is what
-- we want for product analytics.
