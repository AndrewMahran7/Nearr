-- Vayrin exact-content recognition cache + many source videos per saved place.
-- Additive and local-only in this branch; no deployment is performed here.

set check_function_bodies = off;

alter table public.share_jobs
  add column if not exists recognition_identity_key text,
  add column if not exists recognition_identity_version integer,
  add column if not exists recognition_content_id text;

create index if not exists share_jobs_recognition_identity_idx
  on public.share_jobs (recognition_identity_key)
  where recognition_identity_key is not null;

create table if not exists public.recognition_cache (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null unique,
  platform text not null check (platform in (
    'tiktok','instagram','youtube','facebook','snapchat','other','unknown'
  )),
  content_id text not null,
  canonical_url text not null,
  identity_version integer not null check (identity_version > 0),
  recognition_version text not null,
  result_type text not null check (result_type in ('verified_place','candidate_set')),
  trust_level text not null check (trust_level in (
    'USER_CONFIRMED','VERIFIED_AUTO_SAVE','CANDIDATE_SET'
  )),
  canonical_place_id uuid references public.places(id) on delete set null,
  candidate_payload jsonb,
  evidence_summary jsonb,
  confirmation_count integer not null default 0 check (confirmation_count >= 0),
  dispute_count integer not null default 0 check (dispute_count >= 0),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_verified_at timestamptz,
  confirmed_at timestamptz,
  invalidated_at timestamptz,
  invalidation_reason text check (invalidation_reason is null or invalidation_reason in (
    'user_correction','place_deleted','recognition_version_changed',
    'provider_identity_changed','source_mismatch','manual_admin_invalidation'
  )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (octet_length(coalesce(candidate_payload::text, '')) <= 65536),
  check (octet_length(coalesce(evidence_summary::text, '')) <= 16384),
  check (
    (result_type = 'verified_place' and canonical_place_id is not null)
    or result_type = 'candidate_set'
  )
);

create unique index if not exists recognition_cache_provider_identity_idx
  on public.recognition_cache (identity_version, platform, content_id);
create index if not exists recognition_cache_place_idx
  on public.recognition_cache (canonical_place_id)
  where canonical_place_id is not null;
create index if not exists recognition_cache_active_idx
  on public.recognition_cache (last_seen_at desc)
  where invalidated_at is null;

drop trigger if exists recognition_cache_set_updated_at on public.recognition_cache;
create trigger recognition_cache_set_updated_at
  before update on public.recognition_cache
  for each row execute function public.set_updated_at();

-- A normal machine replay cannot downgrade a valid human confirmation. A
-- re-run after one user's correction remains candidate-only until a person
-- confirms it; this prevents the same machine answer from immediately undoing
-- the dispute guardrail.
create or replace function public.recognition_cache_preserve_trust()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.trust_level = 'USER_CONFIRMED'
     and old.invalidated_at is null
     and new.trust_level <> 'USER_CONFIRMED' then
    new.trust_level := old.trust_level;
    new.result_type := old.result_type;
    new.canonical_place_id := old.canonical_place_id;
    new.candidate_payload := coalesce(old.candidate_payload, new.candidate_payload);
    new.confirmed_at := old.confirmed_at;
    new.confirmation_count := old.confirmation_count;
  elsif old.invalidation_reason = 'user_correction'
     and new.trust_level <> 'USER_CONFIRMED' then
    new.trust_level := 'CANDIDATE_SET';
    new.result_type := 'candidate_set';
    new.canonical_place_id := null;
    new.invalidated_at := null;
    new.invalidation_reason := null;
  end if;
  return new;
end;
$$;

drop trigger if exists recognition_cache_trust_guard on public.recognition_cache;
create trigger recognition_cache_trust_guard
  before update on public.recognition_cache
  for each row execute function public.recognition_cache_preserve_trust();

create table if not exists public.recognition_inflight (
  identity_key text primary key,
  owner_token uuid not null,
  lease_expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists recognition_inflight_expiry_idx
  on public.recognition_inflight (lease_expires_at);

create table if not exists public.recognition_cache_events (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'recognition_cache_hit','recognition_cache_miss','recognition_cache_candidate_hit',
    'recognition_cache_invalidated','recognition_singleflight_joined',
    'source_attached_existing_place','source_deduped'
  )),
  identity_key text,
  platform text,
  media_download_avoided boolean not null default false,
  gemini_calls_avoided integer not null default 0,
  sol_calls_avoided integer not null default 0,
  estimated_latency_ms_saved integer not null default 0,
  detail jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 4096),
  created_at timestamptz not null default now()
);
create index if not exists recognition_cache_events_created_idx
  on public.recognition_cache_events (created_at desc);

create table if not exists public.saved_place_sources (
  id uuid primary key default gen_random_uuid(),
  saved_place_id uuid not null references public.saved_places(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_key text not null,
  identity_version integer not null check (identity_version > 0),
  platform text not null check (platform in (
    'tiktok','instagram','youtube','facebook','snapchat','link'
  )),
  content_id text not null,
  canonical_url text not null,
  original_url text,
  creator_handle text,
  creator_name text,
  caption_excerpt text check (char_length(caption_excerpt) <= 1000),
  ai_note text check (char_length(ai_note) <= 1000),
  thumbnail_url text,
  is_primary boolean not null default false,
  first_attached_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (saved_place_id, identity_key)
);
create index if not exists saved_place_sources_saved_idx
  on public.saved_place_sources (saved_place_id, first_attached_at);
create index if not exists saved_place_sources_identity_idx
  on public.saved_place_sources (identity_key);
create unique index if not exists saved_place_sources_one_primary_idx
  on public.saved_place_sources (saved_place_id) where is_primary;

drop trigger if exists saved_place_sources_set_updated_at on public.saved_place_sources;
create trigger saved_place_sources_set_updated_at
  before update on public.saved_place_sources
  for each row execute function public.set_updated_at();

create or replace function public.saved_place_sources_enforce_owner()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid;
begin
  select user_id into v_owner from public.saved_places where id = new.saved_place_id;
  if v_owner is null then raise exception 'saved_place_not_found'; end if;
  if new.user_id is distinct from v_owner then raise exception 'saved_place_source_owner_mismatch'; end if;
  return new;
end;
$$;
drop trigger if exists saved_place_sources_owner_guard on public.saved_place_sources;
create trigger saved_place_sources_owner_guard
  before insert or update of saved_place_id, user_id on public.saved_place_sources
  for each row execute function public.saved_place_sources_enforce_owner();

alter table public.recognition_cache enable row level security;
alter table public.recognition_inflight enable row level security;
alter table public.recognition_cache_events enable row level security;
alter table public.saved_place_sources enable row level security;

revoke all on public.recognition_cache, public.recognition_inflight,
  public.recognition_cache_events from anon, authenticated;
revoke all on public.saved_place_sources from anon, authenticated;
grant all on public.recognition_cache, public.recognition_inflight,
  public.recognition_cache_events, public.saved_place_sources to service_role;
grant usage, select on sequence public.recognition_cache_events_id_seq to service_role;
grant select on public.saved_place_sources to authenticated;

drop policy if exists saved_place_sources_owner_select on public.saved_place_sources;
create policy saved_place_sources_owner_select on public.saved_place_sources
  for select to authenticated using (user_id = auth.uid());

-- Deterministic, idempotent compatibility backfill. Every existing social
-- save gets exactly one primary child without changing the parent row. Known
-- provider IDs use the same v1 key as application canonicalization; opaque
-- legacy links retain their trimmed URL as the fallback content fingerprint.
with legacy as (
  select
    sp.id as saved_place_id,
    sp.user_id,
    trim(sp.source_url) as source_url,
    lower(coalesce(nullif(sp.source_type, ''), 'link')) as raw_platform,
    sp.ai_note,
    sp.created_at,
    substring(trim(sp.source_url) from '(?i)tiktok\.com/[^?#]*/video/([0-9]+)') as tiktok_id,
    substring(trim(sp.source_url) from '(?i)instagram\.com/(?:[^/?#]+/)?(?:p|reel|reels|tv)/([A-Za-z0-9_-]+)') as instagram_id,
    coalesce(
      substring(trim(sp.source_url) from '(?i)(?:youtu\.be/|youtube\.com/(?:shorts|embed|live)/)([A-Za-z0-9_-]{6,20})'),
      substring(trim(sp.source_url) from '(?i)[?&]v=([A-Za-z0-9_-]{6,20})')
    ) as youtube_id,
    coalesce(
      substring(trim(sp.source_url) from '(?i)facebook\.com/(?:reel|videos)/([0-9]+)'),
      substring(trim(sp.source_url) from '(?i)[?&]v=([0-9]+)')
    ) as facebook_id
  from public.saved_places sp
  where coalesce(trim(sp.source_url), '') <> ''
    and lower(coalesce(sp.source_type, 'manual')) <> 'manual'
    and not exists (
      select 1 from public.saved_place_sources s where s.saved_place_id = sp.id
    )
), identified as (
  select *,
    case
      when raw_platform in ('tiktok','instagram','youtube','facebook','snapchat') then raw_platform
      else 'link'
    end as platform,
    coalesce(tiktok_id, instagram_id, youtube_id, facebook_id, source_url) as content_id,
    case
      when tiktok_id is not null then 'v1:tiktok:' || tiktok_id
      when instagram_id is not null then 'v1:instagram:' || instagram_id
      when youtube_id is not null then 'v1:youtube:' || youtube_id
      when facebook_id is not null then 'v1:facebook:' || facebook_id
      else 'v1:' || case
        when raw_platform in ('tiktok','instagram','youtube','facebook','snapchat') then raw_platform
        else 'other'
      end || ':' || source_url
    end as identity_key,
    -- Preserve the exact known-good legacy link for opening. The provider ID
    -- above is the canonical dedupe key; future live attachments can fill the
    -- stronger canonical URL without losing this original provenance.
    source_url as canonical_url
  from legacy
)
insert into public.saved_place_sources(
  saved_place_id,user_id,identity_key,identity_version,platform,content_id,
  canonical_url,original_url,ai_note,is_primary,first_attached_at,last_seen_at,
  created_at,updated_at
)
select
  saved_place_id,user_id,identity_key,1,platform,content_id,
  canonical_url,source_url,left(ai_note,1000),true,created_at,created_at,
  created_at,now()
from identified
on conflict (saved_place_id, identity_key) do nothing;

create or replace function public.claim_recognition_identity(
  p_identity_key text,
  p_owner_token uuid,
  p_lease_seconds integer default 600
)
returns table(claimed boolean, owner_token uuid, lease_expires_at timestamptz)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_row public.recognition_inflight%rowtype;
begin
  if p_identity_key is null or length(trim(p_identity_key)) not between 3 and 2048
    then raise exception 'invalid_identity_key'; end if;
  if p_owner_token is null then raise exception 'invalid_owner_token'; end if;
  insert into public.recognition_inflight(identity_key, owner_token, lease_expires_at)
  values (trim(p_identity_key), p_owner_token,
    now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 900)))
  on conflict (identity_key) do update set
    owner_token = excluded.owner_token,
    lease_expires_at = excluded.lease_expires_at,
    updated_at = now()
  where public.recognition_inflight.lease_expires_at <= now()
     or public.recognition_inflight.owner_token = excluded.owner_token;

  select * into v_row from public.recognition_inflight
   where identity_key = trim(p_identity_key);
  return query select v_row.owner_token = p_owner_token, v_row.owner_token, v_row.lease_expires_at;
end;
$$;
revoke all on function public.claim_recognition_identity(text,uuid,integer) from public, anon, authenticated;
grant execute on function public.claim_recognition_identity(text,uuid,integer) to service_role;

create or replace function public.release_recognition_identity(
  p_identity_key text, p_owner_token uuid
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  delete from public.recognition_inflight
   where identity_key = p_identity_key and owner_token = p_owner_token;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
revoke all on function public.release_recognition_identity(text,uuid) from public, anon, authenticated;
grant execute on function public.release_recognition_identity(text,uuid) to service_role;

create or replace function public.attach_saved_place_source(
  p_user_id uuid,
  p_saved_place_id uuid,
  p_identity_key text,
  p_identity_version integer,
  p_platform text,
  p_content_id text,
  p_canonical_url text,
  p_original_url text default null,
  p_creator_handle text default null,
  p_creator_name text default null,
  p_caption_excerpt text default null,
  p_ai_note text default null,
  p_thumbnail_url text default null
)
returns table(attached boolean, deduped boolean, source_id uuid)
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_auth uuid := auth.uid();
  v_owner uuid;
  v_id uuid;
  v_primary boolean;
  v_platform text;
begin
  if v_auth is not null and v_auth is distinct from p_user_id then raise exception 'not_owner'; end if;
  select user_id into v_owner from public.saved_places where id = p_saved_place_id for update;
  if v_owner is null or v_owner is distinct from p_user_id then raise exception 'saved_place_not_owned'; end if;
  if coalesce(length(trim(p_identity_key)), 0) = 0 or coalesce(length(trim(p_canonical_url)), 0) = 0
    then raise exception 'invalid_source_identity'; end if;
  v_platform := case when lower(p_platform) in ('tiktok','instagram','youtube','facebook','snapchat')
    then lower(p_platform) else 'link' end;
  v_primary := not exists (select 1 from public.saved_place_sources where saved_place_id = p_saved_place_id);

  begin
    insert into public.saved_place_sources(
      saved_place_id,user_id,identity_key,identity_version,platform,content_id,
      canonical_url,original_url,creator_handle,creator_name,caption_excerpt,
      ai_note,thumbnail_url,is_primary
    ) values (
      p_saved_place_id,p_user_id,trim(p_identity_key),p_identity_version,v_platform,trim(p_content_id),
      trim(p_canonical_url),nullif(trim(p_original_url),''),nullif(trim(p_creator_handle),''),
      nullif(trim(p_creator_name),''),left(nullif(trim(p_caption_excerpt),''),1000),
      left(nullif(trim(p_ai_note),''),1000),nullif(trim(p_thumbnail_url),''),v_primary
    ) on conflict (saved_place_id, identity_key) do nothing returning id into v_id;
  exception when unique_violation then
    -- Two different first sources raced for the primary slot. The existing
    -- primary wins; retry this source as secondary.
    insert into public.saved_place_sources(
      saved_place_id,user_id,identity_key,identity_version,platform,content_id,
      canonical_url,original_url,creator_handle,creator_name,caption_excerpt,
      ai_note,thumbnail_url,is_primary
    ) values (
      p_saved_place_id,p_user_id,trim(p_identity_key),p_identity_version,v_platform,trim(p_content_id),
      trim(p_canonical_url),nullif(trim(p_original_url),''),nullif(trim(p_creator_handle),''),
      nullif(trim(p_creator_name),''),left(nullif(trim(p_caption_excerpt),''),1000),
      left(nullif(trim(p_ai_note),''),1000),nullif(trim(p_thumbnail_url),''),false
    ) on conflict (saved_place_id, identity_key) do nothing returning id into v_id;
  end;

  if v_id is null then
    update public.saved_place_sources set
      last_seen_at = now(),
      creator_handle = coalesce(creator_handle, nullif(trim(p_creator_handle),'')),
      creator_name = coalesce(creator_name, nullif(trim(p_creator_name),'')),
      caption_excerpt = coalesce(caption_excerpt, left(nullif(trim(p_caption_excerpt),''),1000)),
      ai_note = coalesce(ai_note, left(nullif(trim(p_ai_note),''),1000)),
      thumbnail_url = coalesce(thumbnail_url, nullif(trim(p_thumbnail_url),''))
    where saved_place_id = p_saved_place_id and identity_key = trim(p_identity_key)
    returning id into v_id;
    return query select false, true, v_id;
    return;
  end if;

  -- Compatibility: the first source remains mirrored on saved_places for old
  -- clients and existing share/open behavior. Later sources never overwrite it.
  if v_primary then
    update public.saved_places set
      source_type = v_platform,
      source_url = trim(p_canonical_url),
      ai_note = coalesce(ai_note, left(nullif(trim(p_ai_note),''),1000)),
      updated_at = now()
    where id = p_saved_place_id and coalesce(trim(source_url),'') = '';
  end if;
  return query select true, false, v_id;
end;
$$;
revoke all on function public.attach_saved_place_source(
  uuid,uuid,text,integer,text,text,text,text,text,text,text,text,text
) from public, anon;
grant execute on function public.attach_saved_place_source(
  uuid,uuid,text,integer,text,text,text,text,text,text,text,text,text
) to authenticated, service_role;

-- One correction disputes global machine truth but does not replace it with
-- the correcting user's answer. Source rows move with the saved-place id.
create or replace function public.dispute_recognition_after_place_correction()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if old.place_id is distinct from new.place_id then
    update public.recognition_cache rc set
      invalidated_at = now(),
      invalidation_reason = 'user_correction',
      dispute_count = rc.dispute_count + 1
    where rc.identity_key in (
      select s.identity_key from public.saved_place_sources s where s.saved_place_id = new.id
    );
    insert into public.recognition_cache_events(event_name,identity_key,platform,detail)
    select 'recognition_cache_invalidated',s.identity_key,s.platform,
      jsonb_build_object('reason','user_correction')
    from public.saved_place_sources s where s.saved_place_id = new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists saved_places_dispute_recognition on public.saved_places;
create trigger saved_places_dispute_recognition
  after update of place_id on public.saved_places
  for each row execute function public.dispute_recognition_after_place_correction();

-- Client confirmation promotes the exact content identity independently of
-- the user's saved-place ownership. Candidate payload remains bounded and the
-- cache contains no user id.
create or replace function public.resolve_share_job(p_job_id uuid, p_saved_place_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_saved_owner uuid;
  v_place_id uuid;
  v_updated integer;
  v_decision text;
  v_identity_key text;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  if p_saved_place_id is null then raise exception 'invalid_saved_place_id'; end if;
  select user_id, place_id into v_saved_owner, v_place_id
    from public.saved_places where id = p_saved_place_id;
  if v_saved_owner is distinct from v_uid then raise exception 'saved_place_not_owned'; end if;

  update public.share_jobs set
    status='completed', saved_place_id=p_saved_place_id, completed_at=now(),
    progress_stage='completed', updated_at=now()
  where id=p_job_id and user_id=v_uid and status in ('needs_help','failed')
  returning decision, recognition_identity_key into v_decision, v_identity_key;
  get diagnostics v_updated = row_count;

  if v_updated > 0 and v_decision is distinct from 'multi_candidate_confirmation' then
    update public.recognition_cache rc set
      result_type='verified_place', trust_level='USER_CONFIRMED',
      canonical_place_id=v_place_id, confirmation_count=rc.confirmation_count+1,
      confirmed_at=now(), last_verified_at=now(), last_seen_at=now(),
      invalidated_at=null, invalidation_reason=null
    where rc.identity_key=v_identity_key;
  end if;
  return v_updated > 0;
end;
$$;
revoke all on function public.resolve_share_job(uuid,uuid) from public, anon, authenticated;
grant execute on function public.resolve_share_job(uuid,uuid) to authenticated;

-- Service-role invalidation helper; no admin UI in V1.
create or replace function public.invalidate_recognition_cache(
  p_identity_key text, p_reason text
)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_count integer;
begin
  if p_reason not in ('user_correction','place_deleted','recognition_version_changed',
    'provider_identity_changed','source_mismatch','manual_admin_invalidation')
    then raise exception 'invalid_invalidation_reason'; end if;
  update public.recognition_cache set invalidated_at=now(), invalidation_reason=p_reason
   where identity_key=p_identity_key;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$$;
revoke all on function public.invalidate_recognition_cache(text,text) from public, anon, authenticated;
grant execute on function public.invalidate_recognition_cache(text,text) to service_role;

-- Manual rollback (data-preserving order): drop the new triggers/functions,
-- then the four new tables; the three nullable share_jobs columns may remain.
