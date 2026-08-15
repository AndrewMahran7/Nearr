-- Extend saved_places.source_type for the cross-platform media-evidence
-- expansion (Instagram/TikTok -> + YouTube, Facebook, Snapchat).
--
-- `source_type` is a CHECK-constrained column, not free text, so new platform
-- identities require a forward migration (smallest one that unblocks them):
-- the column-level CHECK, and the identical validation inside
-- `auto_save_share_job_place_result` (the media-finalize save path), which
-- re-validates independently of the column constraint. Both currently allow
-- only ('manual','tiktok','instagram','link').
--
-- The constraint name is discovered dynamically rather than assumed, since
-- the original (20260426000001_init_schema.sql) declared it as an inline
-- column CHECK with no explicit name — Postgres auto-generates one, and this
-- migration must not silently no-op if that generated name differs from the
-- conventional guess.

do $$
declare
  v_constraint_name text;
begin
  select con.conname into v_constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'saved_places'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%source_type%'
  limit 1;

  if v_constraint_name is not null then
    execute format('alter table public.saved_places drop constraint %I', v_constraint_name);
  end if;
end $$;

alter table public.saved_places
  add constraint saved_places_source_type_check
  check (source_type in ('manual', 'tiktok', 'instagram', 'youtube', 'facebook', 'snapchat', 'link'));

-- Re-validate the media-finalize save path with the same expanded set. Body
-- is otherwise byte-identical to 20260814000001_saved_place_source_enrichment.sql.
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
  if p_source_type not in ('manual', 'tiktok', 'instagram', 'youtube', 'facebook', 'snapchat', 'link') then
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
    -- The user already saved this place (manually, or from an earlier post).
    -- Keep their row exactly as it is — id, place_id, notes, radius, reminder
    -- settings, visit/archive state, counts, created_at.
    --
    -- ONE conditional statement, because source_url + source_type are ONE
    -- logical source identity. Writing them per-field could leave
    -- `source_url = <Reel A>, source_type = 'tiktok'`, which names a post that
    -- does not exist. The saved_places row is already locked FOR UPDATE above,
    -- so this is atomic against other calls of this function.
    --
    --   * nothing attached yet   → attach the incoming pair together
    --     ('manual' with no URL counts as nothing attached)
    --   * SAME post already here → may complete its own missing type; legacy
    --     rows stored a real URL beside `manual`/null
    --   * DIFFERENT post         → the WHERE clause excludes the row entirely,
    --     so neither half is touched
    v_reused := true;
    update public.saved_places sp
       set source_url = case
             when coalesce(trim(sp.source_url), '') = '' then p_source_url
             else sp.source_url
           end,
           source_type = p_source_type,
           updated_at = now()
     where sp.id = v_saved_place_id
       and (
         coalesce(trim(sp.source_url), '') = ''
         or (sp.source_url = p_source_url and coalesce(sp.source_type, 'manual') = 'manual')
       );
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
