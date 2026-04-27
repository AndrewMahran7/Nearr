-- Nearr V1 schema (supersedes early prototype in supabase/schema.sql).
-- Run via the Supabase CLI (`supabase db push`) or paste into SQL editor.

set check_function_bodies = off;

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles  (1:1 with auth.users — user-level settings live here)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id                            uuid primary key references auth.users(id) on delete cascade,
  email                         text,
  default_radius_value          numeric not null default 1,
  default_radius_unit           text    not null default 'miles'
                                check (default_radius_unit in ('miles','minutes')),
  notifications_enabled         boolean not null default true,
  nearby_notifications_enabled  boolean not null default true,
  quiet_hours_enabled           boolean not null default false,
  quiet_hours_start             time,
  quiet_hours_end               time,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Auto-create a profile row on user signup so the client can always read one.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- places  (canonical place records — shared across users, keyed by Google place_id)
-- ---------------------------------------------------------------------------
create table if not exists public.places (
  id                  uuid primary key default gen_random_uuid(),
  google_place_id     text unique,
  name                text not null,
  formatted_address   text,
  latitude            numeric not null,
  longitude           numeric not null,
  category            text,
  google_maps_url     text,
  created_at          timestamptz not null default now()
);

create index if not exists places_lat_lng_idx on public.places(latitude, longitude);

-- ---------------------------------------------------------------------------
-- saved_places  (per-user save of a place, with overrides)
-- ---------------------------------------------------------------------------
create table if not exists public.saved_places (
  id                       uuid primary key default gen_random_uuid(),
  user_id                  uuid not null references auth.users(id) on delete cascade,
  place_id                 uuid not null references public.places(id) on delete cascade,
  radius_value             numeric,
  radius_unit              text check (radius_unit in ('miles','minutes')),
  notes                    text,
  source_type              text check (source_type in ('manual','tiktok','instagram','link')),
  source_url               text,
  notifications_enabled    boolean not null default true,
  last_notified_at         timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (user_id, place_id)
);

create index if not exists saved_places_user_idx on public.saved_places(user_id);
create index if not exists saved_places_place_idx on public.saved_places(place_id);

drop trigger if exists saved_places_set_updated_at on public.saved_places;
create trigger saved_places_set_updated_at
  before update on public.saved_places
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- notification_events  (audit trail / cooldown source of truth)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  saved_place_id   uuid not null references public.saved_places(id) on delete cascade,
  event_type       text not null check (event_type in ('nearby','entered','exited','silenced')),
  user_latitude    numeric,
  user_longitude   numeric,
  distance_meters  numeric,
  created_at       timestamptz not null default now()
);

create index if not exists notif_events_user_idx       on public.notification_events(user_id, created_at desc);
create index if not exists notif_events_saved_place_idx on public.notification_events(saved_place_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row-Level Security
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.places              enable row level security;
alter table public.saved_places        enable row level security;
alter table public.notification_events enable row level security;

-- profiles: a user can read/write only their own row.
drop policy if exists "profiles: self select" on public.profiles;
drop policy if exists "profiles: self upsert" on public.profiles;
drop policy if exists "profiles: self update" on public.profiles;
create policy "profiles: self select" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles: self upsert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles: self update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- places: any authenticated user can read; only authenticated users can insert
-- (we dedupe by google_place_id, so multiple users naturally share the same row).
-- No update / delete from clients.
drop policy if exists "places: auth read"   on public.places;
drop policy if exists "places: auth insert" on public.places;
create policy "places: auth read" on public.places
  for select to authenticated using (true);
create policy "places: auth insert" on public.places
  for insert to authenticated with check (true);

-- saved_places: owner-only.
drop policy if exists "saved_places: owner select" on public.saved_places;
drop policy if exists "saved_places: owner insert" on public.saved_places;
drop policy if exists "saved_places: owner update" on public.saved_places;
drop policy if exists "saved_places: owner delete" on public.saved_places;
create policy "saved_places: owner select" on public.saved_places
  for select using (auth.uid() = user_id);
create policy "saved_places: owner insert" on public.saved_places
  for insert with check (auth.uid() = user_id);
create policy "saved_places: owner update" on public.saved_places
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "saved_places: owner delete" on public.saved_places
  for delete using (auth.uid() = user_id);

-- notification_events: owner-only read/insert. No updates/deletes (audit log).
drop policy if exists "notif_events: owner select" on public.notification_events;
drop policy if exists "notif_events: owner insert" on public.notification_events;
create policy "notif_events: owner select" on public.notification_events
  for select using (auth.uid() = user_id);
create policy "notif_events: owner insert" on public.notification_events
  for insert with check (auth.uid() = user_id);
