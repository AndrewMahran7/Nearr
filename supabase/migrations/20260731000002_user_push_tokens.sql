-- Expo push token registry (Phase 1 of async share jobs).
--
-- Nearr previously used ONLY local notifications (expo-notifications
-- scheduleNotificationAsync with trigger:null). Server-sent job-completion
-- notifications require a persisted Expo push token per user/device.
--
-- This table is DISTINCT from the place-reminder local notifications:
--   - place reminders  = local, scheduled on-device (unchanged)
--   - share-job results = remote push, sent by the process-share-jobs worker
--
-- Additive + reversible. Run via Supabase CLI: supabase db push

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- user_push_tokens
-- ---------------------------------------------------------------------------
create table if not exists public.user_push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  -- Expo push token string, e.g. "ExponentPushToken[xxxxxxxx]".
  token         text not null,
  platform      text check (platform is null or platform in ('ios', 'android', 'web')),
  -- Stable-ish per-install id (Constants.sessionId / installationId) so a
  -- single device replaces its own token on refresh instead of piling up.
  device_id     text,
  -- Deactivated when Expo reports the token as invalid (DeviceNotRegistered).
  enabled       boolean not null default true,
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- One row per physical token. Re-registering the same token upserts.
  unique (token)
);

create index if not exists user_push_tokens_user_idx
  on public.user_push_tokens (user_id);
-- Worker fan-out: fetch a user's active tokens.
create index if not exists user_push_tokens_user_enabled_idx
  on public.user_push_tokens (user_id)
  where enabled;

drop trigger if exists user_push_tokens_set_updated_at on public.user_push_tokens;
create trigger user_push_tokens_set_updated_at
  before update on public.user_push_tokens
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Row-Level Security — owner-only. The worker reads tokens via the service
-- role (bypasses RLS) to fan out pushes.
-- ---------------------------------------------------------------------------
alter table public.user_push_tokens enable row level security;

drop policy if exists "user_push_tokens: owner select" on public.user_push_tokens;
drop policy if exists "user_push_tokens: owner insert" on public.user_push_tokens;
drop policy if exists "user_push_tokens: owner update" on public.user_push_tokens;
drop policy if exists "user_push_tokens: owner delete" on public.user_push_tokens;

create policy "user_push_tokens: owner select" on public.user_push_tokens
  for select using (auth.uid() = user_id);
create policy "user_push_tokens: owner insert" on public.user_push_tokens
  for insert with check (auth.uid() = user_id);
create policy "user_push_tokens: owner update" on public.user_push_tokens
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_push_tokens: owner delete" on public.user_push_tokens
  for delete using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- register_push_token(): safe, last-writer-wins registration.
--
-- A physical device's Expo token is per-device (NOT per-user). If the device
-- switches Nearr accounts, the token must be REASSIGNED to the signed-in user
-- so pushes only ever reach the current account. Owner-only RLS cannot do the
-- reassignment (the old row belongs to the previous user), so this SECURITY
-- DEFINER function performs it — but it can ONLY ever claim a token FOR the
-- caller (user_id is forced to auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.register_push_token(
  p_token text,
  p_platform text default null,
  p_device_id text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;
  if p_token is null or length(trim(p_token)) = 0 then
    raise exception 'invalid_token';
  end if;

  insert into public.user_push_tokens (user_id, token, platform, device_id, enabled, last_seen_at)
  values (v_uid, trim(p_token), p_platform, p_device_id, true, now())
  on conflict (token) do update
    set user_id = excluded.user_id,
        platform = coalesce(excluded.platform, public.user_push_tokens.platform),
        device_id = coalesce(excluded.device_id, public.user_push_tokens.device_id),
        enabled = true,
        last_seen_at = now(),
        updated_at = now()
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.register_push_token(text, text, text) from public;
grant execute on function public.register_push_token(text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback):
--   drop function if exists public.register_push_token(text, text, text);
--   drop table if exists public.user_push_tokens;   -- cascades trigger + policies
-- ---------------------------------------------------------------------------
