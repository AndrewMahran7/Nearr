-- DEPRECATED — superseded by supabase/migrations/20260426000001_init_schema.sql
-- This file is kept only as a historical reference for the early prototype.
-- Do NOT run this against a fresh project. Apply the migration instead.

-- Nearr V1 schema. Run in Supabase SQL editor.

create extension if not exists "pgcrypto";

create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  google_place_id text,
  name text not null,
  address text,
  latitude double precision not null,
  longitude double precision not null,
  notes text,
  source_url text,
  source_type text check (source_type in ('manual','tiktok','instagram','link')),
  radius_miles double precision,
  radius_minutes double precision,
  created_at timestamptz not null default now()
);

create index if not exists places_user_idx on public.places(user_id);

create table if not exists public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  default_radius_miles double precision default 1,
  default_radius_minutes double precision,
  radius_unit text not null default 'miles' check (radius_unit in ('miles','minutes')),
  notifications_enabled boolean not null default true,
  quiet_hours_start text,
  quiet_hours_end text
);

-- Row-Level Security
alter table public.places enable row level security;
alter table public.user_settings enable row level security;

drop policy if exists "places: owner read" on public.places;
drop policy if exists "places: owner write" on public.places;
create policy "places: owner read" on public.places for select using (auth.uid() = user_id);
create policy "places: owner write" on public.places for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "settings: owner read" on public.user_settings;
drop policy if exists "settings: owner write" on public.user_settings;
create policy "settings: owner read" on public.user_settings for select using (auth.uid() = user_id);
create policy "settings: owner write" on public.user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
