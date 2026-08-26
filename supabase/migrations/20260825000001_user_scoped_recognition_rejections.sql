-- User correction is durable negative recognition evidence. It disputes one
-- machine conclusion for one user without deleting reusable global evidence or
-- poisoning recognition truth for everyone else.

create table if not exists public.recognition_rejections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  identity_key text not null,
  identity_version integer not null check (identity_version > 0),
  canonical_place_id uuid not null references public.places(id) on delete cascade,
  google_place_id text,
  source_saved_place_id uuid references public.saved_places(id) on delete set null,
  reason text not null check (reason in ('wrong_place','corrected_place')),
  rejected_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, identity_key, canonical_place_id)
);

create index if not exists recognition_rejections_user_identity_idx
  on public.recognition_rejections(user_id, identity_key, rejected_at desc);

drop trigger if exists recognition_rejections_set_updated_at on public.recognition_rejections;
create trigger recognition_rejections_set_updated_at
  before update on public.recognition_rejections
  for each row execute function public.set_updated_at();

alter table public.recognition_rejections enable row level security;
revoke all on public.recognition_rejections from public, anon, authenticated;
grant all on public.recognition_rejections to service_role;

-- USER_CONFIRMED remains the highest positive global truth. The former
-- `old.invalidation_reason = user_correction` branch is intentionally removed:
-- user corrections now live in recognition_rejections and are evaluated on a
-- user-aware cache read instead of downgrading the shared cache for everyone.
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
  end if;
  return new;
end;
$$;

-- Keep telemetry bounded by the existing closed vocabulary.
alter table public.recognition_cache_events
  drop constraint if exists recognition_cache_events_event_name_check;
alter table public.recognition_cache_events
  add constraint recognition_cache_events_event_name_check check (event_name in (
    'recognition_cache_hit','recognition_cache_miss','recognition_cache_candidate_hit',
    'recognition_cache_candidate_auto_save','recognition_cache_invalidated',
    'recognition_singleflight_joined','source_attached_existing_place','source_deduped',
    'candidate_semantic_mismatch','candidate_semantic_override',
    'autosave_blocked_semantic_mismatch','user_rejected_recognition',
    'cache_hit_disputed_result','disputed_candidate_suppressed',
    'recognition_recomputed_after_rejection'
  ));

-- Replace the old global invalidation behavior. A provider correction now
-- records the old conclusion only for the authenticated correcting user.
create or replace function public.dispute_recognition_after_place_correction()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid();
  v_google_place_id text;
begin
  if old.place_id is not distinct from new.place_id or v_uid is null or v_uid is distinct from new.user_id then
    return new;
  end if;
  select google_place_id into v_google_place_id from public.places where id = old.place_id;
  insert into public.recognition_rejections(
    user_id, identity_key, identity_version, canonical_place_id,
    google_place_id, source_saved_place_id, reason, rejected_at
  )
  select new.user_id, s.identity_key, s.identity_version, old.place_id,
    v_google_place_id, new.id, 'corrected_place', now()
  from public.saved_place_sources s
  where s.saved_place_id = new.id and s.user_id = new.user_id
  on conflict (user_id, identity_key, canonical_place_id) do update set
    google_place_id = coalesce(excluded.google_place_id, public.recognition_rejections.google_place_id),
    source_saved_place_id = excluded.source_saved_place_id,
    reason = 'corrected_place', rejected_at = excluded.rejected_at, updated_at = now();

  insert into public.recognition_cache_events(event_name,identity_key,platform,detail)
  select 'user_rejected_recognition', s.identity_key, s.platform,
    jsonb_build_object('reason','corrected_place')
  from public.saved_place_sources s
  where s.saved_place_id = new.id and s.user_id = new.user_id;
  return new;
end;
$$;

-- Explicit no-replacement rejection. Generic DELETE remains intentionally
-- unchanged: removing an item from a collection is not automatically a claim
-- that recognition was false.
create or replace function public.reject_saved_place_recognition(
  p_saved_place_id uuid,
  p_reason text default 'wrong_place'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_place_id uuid;
  v_google_place_id text;
  v_count integer := 0;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;
  if p_reason <> 'wrong_place' then raise exception 'invalid_rejection_reason'; end if;

  select sp.place_id, p.google_place_id into v_place_id, v_google_place_id
  from public.saved_places sp join public.places p on p.id = sp.place_id
  where sp.id = p_saved_place_id and sp.user_id = v_uid
  for update of sp;
  if v_place_id is null then raise exception 'saved_place_not_found'; end if;

  insert into public.recognition_rejections(
    user_id, identity_key, identity_version, canonical_place_id,
    google_place_id, source_saved_place_id, reason, rejected_at
  )
  select v_uid, s.identity_key, s.identity_version, v_place_id,
    v_google_place_id, p_saved_place_id, 'wrong_place', now()
  from public.saved_place_sources s
  where s.saved_place_id = p_saved_place_id and s.user_id = v_uid
  on conflict (user_id, identity_key, canonical_place_id) do update set
    google_place_id = coalesce(excluded.google_place_id, public.recognition_rejections.google_place_id),
    source_saved_place_id = excluded.source_saved_place_id,
    reason = 'wrong_place', rejected_at = excluded.rejected_at, updated_at = now();
  get diagnostics v_count = row_count;

  if v_count = 0 then raise exception 'recognition_source_missing'; end if;
  insert into public.recognition_cache_events(event_name,identity_key,platform,detail)
  select 'user_rejected_recognition', s.identity_key, s.platform,
    jsonb_build_object('reason','wrong_place')
  from public.saved_place_sources s
  where s.saved_place_id = p_saved_place_id and s.user_id = v_uid;

  delete from public.saved_places where id = p_saved_place_id and user_id = v_uid;
  return v_count;
end;
$$;

revoke all on function public.reject_saved_place_recognition(uuid,text)
  from public, anon, authenticated;
grant execute on function public.reject_saved_place_recognition(uuid,text)
  to authenticated;
