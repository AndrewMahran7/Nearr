-- ---------------------------------------------------------------------------
-- share_agent_runs  (shadow-mode persistence for the new extraction agent)
-- ---------------------------------------------------------------------------
--
-- Stage 1 of the share-extraction rebuild. The new backend AI agent runs
-- ALONGSIDE the existing pipeline in the process-share-link Edge Function.
-- Its result is persisted here for offline comparison; it does NOT affect
-- user-facing behavior in this stage.
--
-- The table is intentionally write-only for the service role. No RLS
-- policies grant client (auth/anon) access — these rows contain debugging
-- traces that should never be exposed to end users.
--
-- Run via Supabase CLI:    `supabase db push`
-- Or paste into the Supabase SQL Editor.

set check_function_bodies = off;

create extension if not exists "pgcrypto";

create table if not exists public.share_agent_runs (
  id                uuid        primary key default gen_random_uuid(),
  -- Optional — null for unauthenticated requests so we never block the insert.
  user_id           uuid        references auth.users(id) on delete set null,
  -- The share URL the agent reasoned over. Free-form text; never trusted as
  -- a foreign key.
  url               text        not null,
  -- Detected platform (matches lib/shareAgent/types.ts ShareAgentPlatform).
  platform          text        not null,
  prompt_version    text        not null,
  model_used        text        not null,
  -- The agent's own decision before the safety gate: auto_save |
  -- candidate_confirmation | manual_fallback | failed.
  agent_decision    text        not null,
  -- The deterministic safety gate's verdict. This is the source of truth
  -- for "would we have auto-saved?".
  safety_decision   text        not null,
  safe_to_auto_save boolean     not null default false,
  confidence        text        not null,
  -- Free-form reasoning text from the agent. May contain caption/bio
  -- excerpts. Service-role only.
  reasoning         text,
  -- Tool invocations array (sanitized; never raw HTML/secrets).
  tool_calls        jsonb       not null default '[]'::jsonb,
  -- Candidates the agent considered.
  candidates        jsonb       not null default '[]'::jsonb,
  -- Evidence keys the safety gate accepted/rejected.
  evidence_used     jsonb       not null default '[]'::jsonb,
  -- Total agent latency in ms (model + tools).
  latency_ms        integer,
  -- Non-fatal warnings encountered during the run.
  errors            jsonb       not null default '[]'::jsonb,
  -- The raw agent proposal + safety verdict for forensic inspection.
  raw_response      jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists share_agent_runs_created_idx
  on public.share_agent_runs (created_at desc);
create index if not exists share_agent_runs_decision_idx
  on public.share_agent_runs (safety_decision, created_at desc);
create index if not exists share_agent_runs_platform_idx
  on public.share_agent_runs (platform, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.share_agent_runs enable row level security;

-- Drop any prior policies (idempotent re-runs).
drop policy if exists "share_agent_runs: no client access" on public.share_agent_runs;

-- Defensive deny-all for non-service roles. The service role bypasses RLS
-- entirely, so it can still insert/select. Clients (authenticated/anon)
-- have no policies and therefore no access.
create policy "share_agent_runs: no client access"
  on public.share_agent_runs
  for all
  to authenticated, anon
  using (false)
  with check (false);
