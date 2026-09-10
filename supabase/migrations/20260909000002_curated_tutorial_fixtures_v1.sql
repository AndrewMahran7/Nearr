-- Curated onboarding tutorial fixtures are independently verified product
-- truth. They intentionally live outside Recognition Cache V2 and can only be
-- read or managed by service-role server surfaces.

set check_function_bodies = off;

create table public.onboarding_tutorial_fixtures (
  id uuid primary key default gen_random_uuid(),
  identity_key text not null,
  identity_version integer not null check (identity_version > 0),
  platform text not null check (platform in ('tiktok','instagram','youtube','facebook','snapchat')),
  content_id text not null check (length(trim(content_id)) between 1 and 160),
  canonical_url text not null check (canonical_url ~ '^https://'),
  place_id uuid not null references public.places(id) on delete restrict,
  status text not null default 'stale' check (status in ('active','quarantined','stale','disabled')),
  role text not null default 'backup' check (role in ('primary','backup')),
  priority integer not null default 0 check (priority between 0 and 10000),
  provenance text not null default 'onboarding_tutorial_verified'
    check (provenance = 'onboarding_tutorial_verified'),
  verification_revision bigint not null default 1 check (verification_revision > 0),
  verified_at timestamptz not null,
  verified_by text not null check (length(trim(verified_by)) between 3 and 160),
  expected_media_sha256 text check (expected_media_sha256 is null or expected_media_sha256 ~ '^[0-9a-f]{64}$'),
  last_observed_media_sha256 text check (last_observed_media_sha256 is null or last_observed_media_sha256 ~ '^[0-9a-f]{64}$'),
  health_state text not null default 'unknown' check (health_state in (
    'healthy','unknown','degraded','unavailable','identity_mismatch','fingerprint_mismatch','quarantined'
  )),
  last_health_checked_at timestamptz,
  health_expires_at timestamptz,
  last_health_error_code text check (last_health_error_code is null or length(last_health_error_code) <= 120),
  disabled_at timestamptz,
  disabled_reason text check (disabled_reason is null or length(disabled_reason) <= 240),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (identity_key = 'v' || identity_version::text || ':' || platform || ':' || content_id),
  check (
    expected_media_sha256 is null or
    expected_media_sha256 = last_observed_media_sha256
  ),
  check (
    status <> 'active' or (
      health_state = 'healthy' and
      last_health_checked_at is not null and
      health_expires_at is not null and
      health_expires_at > last_health_checked_at and
      disabled_at is null and
      disabled_reason is null
    )
  ),
  check (
    status <> 'disabled' or
    (disabled_at is not null and disabled_reason is not null)
  )
);

-- One source can have audit history, but only one active mapping. This makes a
-- conflicting current place impossible even under concurrent registration.
create unique index onboarding_tutorial_fixtures_one_active_identity_idx
  on public.onboarding_tutorial_fixtures(identity_key, identity_version)
  where status = 'active';
create index onboarding_tutorial_fixtures_orchestration_idx
  on public.onboarding_tutorial_fixtures(status, role, priority desc, created_at);
create index onboarding_tutorial_fixtures_place_idx
  on public.onboarding_tutorial_fixtures(place_id);
drop trigger if exists onboarding_tutorial_fixtures_set_updated_at
  on public.onboarding_tutorial_fixtures;
create trigger onboarding_tutorial_fixtures_set_updated_at
  before update on public.onboarding_tutorial_fixtures
  for each row execute function public.set_updated_at();

create table public.onboarding_tutorial_fixture_events (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.onboarding_tutorial_fixtures(id) on delete cascade,
  event_type text not null check (event_type in (
    'registered','resolved','health_passed','stale','quarantined','disabled','reactivated'
  )),
  from_status text check (from_status is null or from_status in ('active','quarantined','stale','disabled')),
  to_status text not null check (to_status in ('active','quarantined','stale','disabled')),
  verification_revision bigint not null check (verification_revision > 0),
  actor text not null check (length(trim(actor)) between 3 and 160),
  reason_code text not null check (length(trim(reason_code)) between 3 and 120),
  source_job_id uuid references public.share_jobs(id) on delete set null,
  correction_event_id uuid references public.recognition_correction_events(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  detail jsonb not null default '{}'::jsonb check (octet_length(detail::text) <= 8192),
  created_at timestamptz not null default now()
);
create index onboarding_tutorial_fixture_events_fixture_idx
  on public.onboarding_tutorial_fixture_events(fixture_id, created_at desc);

alter table public.share_jobs
  add column resolution_source text,
  add column tutorial_fixture_id uuid references public.onboarding_tutorial_fixtures(id) on delete set null,
  add column tutorial_fixture_revision bigint,
  add column tutorial_fixture_role text;

alter table public.share_jobs
  add constraint share_jobs_resolution_source_check check (
    resolution_source is null or resolution_source in ('tutorial_fixture','recognition_cache_v2','fresh_recognition')
  ),
  add constraint share_jobs_tutorial_fixture_revision_check check (
    tutorial_fixture_revision is null or tutorial_fixture_revision > 0
  ),
  add constraint share_jobs_tutorial_fixture_role_check check (
    tutorial_fixture_role is null or tutorial_fixture_role in ('primary','backup')
  ),
  add constraint share_jobs_tutorial_fixture_shape_check check (
    (resolution_source = 'tutorial_fixture' and tutorial_fixture_id is not null and
      tutorial_fixture_revision is not null and tutorial_fixture_role is not null)
    or
    (resolution_source is distinct from 'tutorial_fixture' and tutorial_fixture_id is null and
      tutorial_fixture_revision is null and tutorial_fixture_role is null)
  );
create index share_jobs_tutorial_fixture_idx
  on public.share_jobs(tutorial_fixture_id, created_at desc)
  where tutorial_fixture_id is not null;

-- This is the sole runtime eligibility boundary. The function returns nothing
-- for every unsafe state, including expired health, a changed fingerprint,
-- missing/merged place, or permanently closed place.
create or replace function public.resolve_onboarding_tutorial_fixture(
  p_identity_key text,
  p_identity_version integer,
  p_platform text,
  p_content_id text,
  p_canonical_url text
)
returns table(
  fixture_id uuid,
  fixture_revision bigint,
  fixture_role text,
  fixture_priority integer,
  fixture_canonical_url text,
  fixture_place_id uuid,
  google_place_id text,
  place_name text,
  formatted_address text,
  latitude numeric,
  longitude numeric,
  google_primary_type text,
  google_types text[],
  google_type_label text,
  business_status text
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  select
    f.id, f.verification_revision, f.role, f.priority, f.canonical_url, f.place_id,
    p.google_place_id, p.name, p.formatted_address, p.latitude, p.longitude,
    p.google_primary_type, p.google_types, p.google_type_label, p.business_status
  from public.onboarding_tutorial_fixtures f
  join public.places p on p.id = f.place_id
  where f.identity_key = trim(p_identity_key)
    and f.identity_version = p_identity_version
    and f.platform = lower(trim(p_platform))
    and f.content_id = trim(p_content_id)
    and f.canonical_url = trim(p_canonical_url)
    and f.status = 'active'
    and f.provenance = 'onboarding_tutorial_verified'
    and f.verification_revision > 0
    and f.health_state = 'healthy'
    and f.health_expires_at > now()
    and (f.expected_media_sha256 is null or f.expected_media_sha256 = f.last_observed_media_sha256)
    and p.google_place_id is not null
    and length(trim(p.name)) > 0
    and p.latitude between -90 and 90
    and p.longitude between -180 and 180
    and p.merged_into_place_id is null
    and coalesce(p.business_status, '') <> 'CLOSED_PERMANENTLY'
  order by f.verification_revision desc, f.priority desc, f.created_at desc
  limit 1;
$$;

revoke all on function public.resolve_onboarding_tutorial_fixture(text,integer,text,text,text)
  from public, anon, authenticated;
grant execute on function public.resolve_onboarding_tutorial_fixture(text,integer,text,text,text)
  to service_role;

-- A normal Wrong Place/correction event remains the authority. If its source
-- came from a fixture, quarantine that global fixture in the same transaction.
create or replace function public.quarantine_onboarding_tutorial_fixture_from_feedback()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job record;
  v_fixture record;
begin
  select sj.id, sj.tutorial_fixture_id, sj.tutorial_fixture_revision
    into v_job
    from public.share_jobs sj
   where sj.user_id = new.user_id
     and sj.saved_place_id = new.saved_place_id
     and sj.recognition_identity_key = new.identity_key
     and sj.resolution_source = 'tutorial_fixture'
     and sj.tutorial_fixture_id is not null
   order by sj.completed_at desc nulls last, sj.created_at desc
   limit 1;

  if v_job.tutorial_fixture_id is null then return new; end if;

  select f.status, f.verification_revision into v_fixture
    from public.onboarding_tutorial_fixtures f
   where f.id = v_job.tutorial_fixture_id
     and f.place_id = new.previous_place_id
   for update;
  if v_fixture.status is null then return new; end if;

  update public.onboarding_tutorial_fixtures set
    status = 'quarantined',
    health_state = 'quarantined',
    last_health_error_code = 'user_wrong_place',
    disabled_at = null,
    disabled_reason = null,
    updated_at = now()
  where id = v_job.tutorial_fixture_id;

  insert into public.onboarding_tutorial_fixture_events(
    fixture_id,event_type,from_status,to_status,verification_revision,actor,
    reason_code,source_job_id,correction_event_id,user_id,detail
  ) values (
    v_job.tutorial_fixture_id,'quarantined',v_fixture.status,'quarantined',
    v_fixture.verification_revision,'user_feedback','user_wrong_place',v_job.id,
    new.id,new.user_id,jsonb_build_object(
      'served_fixture_revision',v_job.tutorial_fixture_revision,
      'assertion_kind',new.assertion_kind,
      'previous_place_id',new.previous_place_id
    )
  );
  return new;
end;
$$;

drop trigger if exists recognition_correction_quarantine_tutorial_fixture
  on public.recognition_correction_events;
create trigger recognition_correction_quarantine_tutorial_fixture
  after insert on public.recognition_correction_events
  for each row execute function public.quarantine_onboarding_tutorial_fixture_from_feedback();

alter table public.onboarding_tutorial_fixtures enable row level security;
alter table public.onboarding_tutorial_fixture_events enable row level security;
revoke all on table public.onboarding_tutorial_fixtures from public, anon, authenticated;
revoke all on table public.onboarding_tutorial_fixture_events from public, anon, authenticated;
grant select, insert, update, delete on table public.onboarding_tutorial_fixtures to service_role;
grant select, insert, update, delete on table public.onboarding_tutorial_fixture_events to service_role;

comment on table public.onboarding_tutorial_fixtures is
  'Independently verified onboarding tutorial source-to-place mappings; never organic recognition evidence.';
comment on column public.onboarding_tutorial_fixtures.health_expires_at is
  'Request-time expiry gate populated by the Development fixture health check.';
