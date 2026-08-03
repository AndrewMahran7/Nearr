-- Durable per-logical-place outcomes for Phase 2 automatic saving.
--
-- A share_job may resolve multiple independent places. This ledger is the
-- source of truth for each logical result and makes automatic saves atomic,
-- replay-safe, owner-bound, and auditable without changing the legacy
-- share_jobs.saved_place_id compatibility pointer.

set check_function_bodies = off;

create table if not exists public.share_job_place_results (
  id                    uuid primary key default gen_random_uuid(),
  share_job_id          uuid not null references public.share_jobs(id) on delete cascade,
  share_media_task_id   uuid references public.share_media_tasks(id) on delete set null,
  share_media_run_id    uuid references public.share_media_runs(id) on delete set null,
  user_id               uuid not null references auth.users(id) on delete cascade,
  logical_result_id     text not null,
  google_place_id       text,
  place_id              uuid references public.places(id) on delete set null,
  saved_place_id        uuid references public.saved_places(id) on delete set null,
  outcome               text not null check (outcome in (
                          'auto_saved',
                          'already_saved',
                          'candidate_confirmation',
                          'manual_fallback',
                          'failed'
                        )),
  origin                text not null check (origin in ('automatic', 'user_confirmed')),
  confidence_score      numeric check (
                          confidence_score is null or
                          (confidence_score >= 0 and confidence_score <= 1)
                        ),
  rule_version          text not null,
  reason_codes          jsonb not null default '[]'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  finalized_at          timestamptz,
  unique (share_job_id, logical_result_id),
  check (length(trim(logical_result_id)) between 1 and 160),
  check (length(trim(rule_version)) between 1 and 80),
  check (jsonb_typeof(reason_codes) = 'array'),
  check (
    outcome not in ('auto_saved', 'already_saved') or
    (saved_place_id is not null and place_id is not null and google_place_id is not null)
  )
);

create index if not exists share_job_place_results_user_created_idx
  on public.share_job_place_results (user_id, created_at desc);
create index if not exists share_job_place_results_job_idx
  on public.share_job_place_results (share_job_id);
create index if not exists share_job_place_results_saved_place_idx
  on public.share_job_place_results (saved_place_id)
  where saved_place_id is not null;

drop trigger if exists share_job_place_results_set_updated_at
  on public.share_job_place_results;
create trigger share_job_place_results_set_updated_at
  before update on public.share_job_place_results
  for each row execute function public.set_updated_at();

alter table public.share_job_place_results enable row level security;

drop policy if exists "share_job_place_results: owner select"
  on public.share_job_place_results;
create policy "share_job_place_results: owner select"
  on public.share_job_place_results
  for select using (auth.uid() = user_id);

revoke all on table public.share_job_place_results from public, anon, authenticated;
grant select on table public.share_job_place_results to authenticated;
grant select, insert, update, delete on table public.share_job_place_results to service_role;

create or replace function public.auto_save_share_job_place_result(
  p_share_job_id uuid,
  p_share_media_task_id uuid,
  p_share_media_run_id uuid,
  p_logical_result_id text,
  p_google_place_id text,
  p_name text,
  p_formatted_address text,
  p_latitude numeric,
  p_longitude numeric,
  p_category text,
  p_source_type text,
  p_source_url text,
  p_confidence_score numeric,
  p_rule_version text,
  p_reason_codes jsonb default '[]'::jsonb
)
returns table(saved_place_id uuid, place_id uuid, reused boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.share_jobs%rowtype;
  v_existing public.share_job_place_results%rowtype;
  v_place_id uuid;
  v_saved_place_id uuid;
  v_reused boolean := false;
begin
  select * into v_job
    from public.share_jobs
   where id = p_share_job_id
   for update;

  if v_job.id is null then raise exception 'share_job_not_found'; end if;
  if v_job.status <> 'processing_metadata' then raise exception 'share_job_not_processing'; end if;
  if p_logical_result_id is null or length(trim(p_logical_result_id)) not between 1 and 160 then
    raise exception 'invalid_logical_result_id';
  end if;
  if p_google_place_id is null or length(trim(p_google_place_id)) = 0 then
    raise exception 'missing_google_place_id';
  end if;
  if p_name is null or length(trim(p_name)) = 0 then raise exception 'missing_place_name'; end if;
  if p_latitude is null or p_latitude < -90 or p_latitude > 90 or
     p_longitude is null or p_longitude < -180 or p_longitude > 180 then
    raise exception 'invalid_coordinates';
  end if;
  if p_confidence_score is null or p_confidence_score < 0 or p_confidence_score > 1 then
    raise exception 'invalid_confidence_score';
  end if;
  if p_rule_version is null or length(trim(p_rule_version)) not between 1 and 80 then
    raise exception 'invalid_rule_version';
  end if;
  if p_reason_codes is null or jsonb_typeof(p_reason_codes) <> 'array' then
    raise exception 'invalid_reason_codes';
  end if;
  if p_source_type not in ('manual', 'tiktok', 'instagram', 'link') then
    raise exception 'invalid_source_type';
  end if;

  if p_share_media_task_id is not null and not exists (
    select 1 from public.share_media_tasks mt
     where mt.id = p_share_media_task_id
       and mt.share_job_id = v_job.id
       and mt.user_id = v_job.user_id
  ) then
    raise exception 'media_task_link_mismatch';
  end if;
  if p_share_media_run_id is not null and not exists (
    select 1 from public.share_media_runs mr
     where mr.id = p_share_media_run_id
       and mr.share_job_id = v_job.id
       and mr.user_id = v_job.user_id
       and (p_share_media_task_id is null or mr.share_media_task_id = p_share_media_task_id)
  ) then
    raise exception 'media_run_link_mismatch';
  end if;

  select * into v_existing
    from public.share_job_place_results r
   where r.share_job_id = v_job.id
     and r.logical_result_id = trim(p_logical_result_id)
   for update;

  if v_existing.id is not null then
    if v_existing.google_place_id is distinct from trim(p_google_place_id) then
      raise exception 'logical_result_candidate_conflict';
    end if;
    if v_existing.outcome in ('auto_saved', 'already_saved') and
       v_existing.saved_place_id is not null and v_existing.place_id is not null then
      return query select v_existing.saved_place_id, v_existing.place_id,
        v_existing.outcome = 'already_saved';
      return;
    end if;
  end if;

  insert into public.places (
    google_place_id, name, formatted_address, latitude, longitude, category, google_maps_url
  ) values (
    trim(p_google_place_id), trim(p_name), nullif(trim(p_formatted_address), ''),
    p_latitude, p_longitude, nullif(trim(p_category), ''), null
  )
  on conflict (google_place_id) do update set
    name = excluded.name,
    formatted_address = coalesce(excluded.formatted_address, public.places.formatted_address),
    latitude = excluded.latitude,
    longitude = excluded.longitude,
    category = coalesce(excluded.category, public.places.category)
  returning id into v_place_id;

  select sp.id into v_saved_place_id
    from public.saved_places sp
   where sp.user_id = v_job.user_id and sp.place_id = v_place_id
   for update;

  if v_saved_place_id is null then
    insert into public.saved_places (
      user_id, place_id, radius_value, radius_unit, source_type, source_url, notes
    ) values (
      v_job.user_id, v_place_id, null, null, p_source_type, p_source_url, null
    )
    returning id into v_saved_place_id;
  else
    v_reused := true;
    update public.saved_places
       set source_type = p_source_type, source_url = p_source_url, updated_at = now()
     where id = v_saved_place_id;
  end if;

  insert into public.share_job_place_results (
    share_job_id, share_media_task_id, share_media_run_id, user_id,
    logical_result_id, google_place_id, place_id, saved_place_id,
    outcome, origin, confidence_score, rule_version, reason_codes, finalized_at
  ) values (
    v_job.id, p_share_media_task_id, p_share_media_run_id, v_job.user_id,
    trim(p_logical_result_id), trim(p_google_place_id), v_place_id, v_saved_place_id,
    case when v_reused then 'already_saved' else 'auto_saved' end,
    'automatic', p_confidence_score, trim(p_rule_version), p_reason_codes, now()
  )
  on conflict (share_job_id, logical_result_id) do update set
    share_media_task_id = excluded.share_media_task_id,
    share_media_run_id = excluded.share_media_run_id,
    google_place_id = excluded.google_place_id,
    place_id = excluded.place_id,
    saved_place_id = excluded.saved_place_id,
    outcome = excluded.outcome,
    origin = excluded.origin,
    confidence_score = excluded.confidence_score,
    rule_version = excluded.rule_version,
    reason_codes = excluded.reason_codes,
    finalized_at = excluded.finalized_at,
    updated_at = now();

  return query select v_saved_place_id, v_place_id, v_reused;
end;
$$;

revoke all on function public.auto_save_share_job_place_result(
  uuid, uuid, uuid, text, text, text, text, numeric, numeric, text,
  text, text, numeric, text, jsonb
) from public, anon, authenticated;
grant execute on function public.auto_save_share_job_place_result(
  uuid, uuid, uuid, text, text, text, text, numeric, numeric, text,
  text, text, numeric, text, jsonb
) to service_role;