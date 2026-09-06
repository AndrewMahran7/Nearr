-- Place Video Gallery V1: one durable representative frame per canonical
-- place/source identity. Additive; intended for Nearr-Dev first.

create table if not exists public.place_video_media (
  id uuid primary key default gen_random_uuid(),
  place_id uuid not null references public.places(id) on delete cascade,
  identity_key text not null,
  identity_version integer not null default 1 check (identity_version > 0),
  platform text not null check (platform in ('tiktok','instagram','youtube','facebook','snapchat','link')),
  content_id text not null,
  canonical_url text not null,
  original_url text,
  creator_handle text,
  creator_name text,
  representative_frame_storage_path text,
  representative_frame_timestamp_seconds numeric,
  community_visibility text not null default 'UNKNOWN' check (community_visibility in (
    'OWNER_ONLY','PUBLIC_SOURCE_ELIGIBLE','PUBLIC_SOURCE_UNAVAILABLE','PRIVATE_SOURCE','UNKNOWN'
  )),
  source_reachability text not null default 'UNKNOWN' check (source_reachability in (
    'REACHABLE','UNAVAILABLE','UNKNOWN'
  )),
  public_access_verified_at timestamptz,
  is_synthetic boolean not null default false,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (place_id, identity_key),
  check (representative_frame_timestamp_seconds is null or representative_frame_timestamp_seconds >= 0),
  check (community_visibility <> 'PUBLIC_SOURCE_ELIGIBLE' or (
    source_reachability = 'REACHABLE' and public_access_verified_at is not null and is_synthetic = false
  ))
);

create index if not exists place_video_media_place_recent_idx
  on public.place_video_media (place_id, created_at desc, id);
create index if not exists place_video_media_community_idx
  on public.place_video_media (place_id, created_at desc)
  where community_visibility = 'PUBLIC_SOURCE_ELIGIBLE'
    and source_reachability = 'REACHABLE'
    and is_synthetic = false;

drop trigger if exists place_video_media_set_updated_at on public.place_video_media;
create trigger place_video_media_set_updated_at
  before update on public.place_video_media
  for each row execute function public.set_updated_at();

alter table public.place_video_media enable row level security;
revoke all on public.place_video_media from public, anon, authenticated;
grant all on public.place_video_media to service_role;

-- Private bucket. Only the gallery Edge function creates signed URLs after it
-- has classified the caller as owner or privacy-safe community viewer.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('place-video-thumbnails', 'place-video-thumbnails', false, 786432, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = 786432,
  allowed_mime_types = array['image/jpeg'];

-- Existing owner sources become UNKNOWN placeholders. Nothing is made public
-- by migration/backfill; only a successful public-access worker callback can
-- explicitly promote visibility later.
insert into public.place_video_media (
  place_id, identity_key, identity_version, platform, content_id,
  canonical_url, original_url, creator_handle, creator_name,
  community_visibility, source_reachability, first_seen_at, last_seen_at
)
select
  sp.place_id, s.identity_key, s.identity_version, s.platform, s.content_id,
  s.canonical_url, s.original_url, s.creator_handle, s.creator_name,
  'UNKNOWN', 'UNKNOWN', min(s.first_attached_at), max(s.last_seen_at)
from public.saved_place_sources s
join public.saved_places sp on sp.id = s.saved_place_id
group by sp.place_id, s.identity_key, s.identity_version, s.platform, s.content_id,
  s.canonical_url, s.original_url, s.creator_handle, s.creator_name
on conflict (place_id, identity_key) do nothing;

-- Keep the canonical relation synchronized when a source is attached or a
-- saved place is corrected/merged. Conflict means another saver already gave
-- the same source to the surviving canonical place, so one media tile wins.
create or replace function public.sync_saved_place_source_video_media()
returns trigger language plpgsql security definer set search_path = public, storage, pg_temp as $$
declare v_place_id uuid;
begin
  select place_id into v_place_id from public.saved_places where id = new.saved_place_id;
  if v_place_id is null then return new; end if;
  insert into public.place_video_media (
    place_id, identity_key, identity_version, platform, content_id,
    canonical_url, original_url, creator_handle, creator_name,
    community_visibility, source_reachability, first_seen_at, last_seen_at
  ) values (
    v_place_id, new.identity_key, new.identity_version, new.platform, new.content_id,
    new.canonical_url, new.original_url, new.creator_handle, new.creator_name,
    'UNKNOWN', 'UNKNOWN', new.first_attached_at, new.last_seen_at
  ) on conflict (place_id, identity_key) do update set
    last_seen_at = greatest(public.place_video_media.last_seen_at, excluded.last_seen_at),
    original_url = coalesce(public.place_video_media.original_url, excluded.original_url),
    creator_handle = coalesce(public.place_video_media.creator_handle, excluded.creator_handle),
    creator_name = coalesce(public.place_video_media.creator_name, excluded.creator_name);
  return new;
end;
$$;

drop trigger if exists saved_place_sources_video_media_sync on public.saved_place_sources;
create trigger saved_place_sources_video_media_sync
  after insert or update of saved_place_id, identity_key, last_seen_at on public.saved_place_sources
  for each row execute function public.sync_saved_place_source_video_media();

create or replace function public.sync_saved_place_video_media_after_place_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare source_row public.saved_place_sources%rowtype;
begin
  if old.place_id is not distinct from new.place_id then return new; end if;
  for source_row in select * from public.saved_place_sources where saved_place_id = new.id loop
    insert into public.place_video_media (
      place_id, identity_key, identity_version, platform, content_id, canonical_url,
      original_url, creator_handle, creator_name, representative_frame_storage_path,
      representative_frame_timestamp_seconds, community_visibility, source_reachability,
      public_access_verified_at, is_synthetic, first_seen_at, last_seen_at
    ) select
      new.place_id, m.identity_key, m.identity_version, m.platform, m.content_id, m.canonical_url,
      m.original_url, m.creator_handle, m.creator_name, m.representative_frame_storage_path,
      m.representative_frame_timestamp_seconds, m.community_visibility, m.source_reachability,
      m.public_access_verified_at, m.is_synthetic, m.first_seen_at, m.last_seen_at
    from public.place_video_media m
    where m.place_id = old.place_id and m.identity_key = source_row.identity_key
    on conflict (place_id, identity_key) do update set
      representative_frame_storage_path = coalesce(public.place_video_media.representative_frame_storage_path, excluded.representative_frame_storage_path),
      representative_frame_timestamp_seconds = coalesce(public.place_video_media.representative_frame_timestamp_seconds, excluded.representative_frame_timestamp_seconds),
      -- Fail closed when two canonical histories disagree. Any explicit
      -- restriction outranks an eligible row during a place merge.
      community_visibility = case
        when public.place_video_media.community_visibility = 'PRIVATE_SOURCE' or excluded.community_visibility = 'PRIVATE_SOURCE' then 'PRIVATE_SOURCE'
        when public.place_video_media.community_visibility = 'OWNER_ONLY' or excluded.community_visibility = 'OWNER_ONLY' then 'OWNER_ONLY'
        when public.place_video_media.community_visibility = 'PUBLIC_SOURCE_UNAVAILABLE' or excluded.community_visibility = 'PUBLIC_SOURCE_UNAVAILABLE' then 'PUBLIC_SOURCE_UNAVAILABLE'
        when public.place_video_media.community_visibility = 'PUBLIC_SOURCE_ELIGIBLE' or excluded.community_visibility = 'PUBLIC_SOURCE_ELIGIBLE' then 'PUBLIC_SOURCE_ELIGIBLE'
        else public.place_video_media.community_visibility
      end,
      source_reachability = case when public.place_video_media.source_reachability = 'REACHABLE' or excluded.source_reachability = 'REACHABLE' then 'REACHABLE' else public.place_video_media.source_reachability end,
      public_access_verified_at = greatest(public.place_video_media.public_access_verified_at, excluded.public_access_verified_at),
      last_seen_at = greatest(public.place_video_media.last_seen_at, excluded.last_seen_at);
  end loop;
  return new;
end;
$$;

drop trigger if exists saved_places_video_media_place_sync on public.saved_places;
create trigger saved_places_video_media_place_sync
  after update of place_id on public.saved_places
  for each row execute function public.sync_saved_place_video_media_after_place_change();

revoke all on function public.sync_saved_place_source_video_media() from public, anon, authenticated;
revoke all on function public.sync_saved_place_video_media_after_place_change() from public, anon, authenticated;
