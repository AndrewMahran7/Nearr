-- Stable Nearr categories, granular Google provider metadata, and owner-only
-- automatic-save undo. Forward-only and nullable for older app builds.

set check_function_bodies = off;

alter table public.places
  add column if not exists short_formatted_address text,
  add column if not exists google_primary_type text,
  add column if not exists google_types text[],
  add column if not exists google_type_label text,
  add column if not exists containing_places jsonb,
  add column if not exists business_status text;

alter table public.saved_places
  add column if not exists category text,
  add column if not exists category_source text,
  add column if not exists category_confidence numeric,
  add column if not exists category_model_version text,
  add column if not exists category_user_overridden boolean not null default false,
  add column if not exists categorized_at timestamptz;

alter table public.saved_places
  drop constraint if exists saved_places_category_check,
  add constraint saved_places_category_check check (
    category is null or category in (
      'restaurant', 'cafe', 'bakery', 'bar', 'hotel', 'park',
      'hiking_trail', 'beach', 'scenic_spot', 'attraction', 'museum',
      'shopping', 'entertainment', 'nightlife', 'fitness', 'wellness',
      'transportation', 'education', 'service', 'other'
    )
  ),
  drop constraint if exists saved_places_category_source_check,
  add constraint saved_places_category_source_check check (
    category_source is null or category_source in (
      'google_primary_type', 'google_types', 'ai', 'user', 'fallback'
    )
  ),
  drop constraint if exists saved_places_category_confidence_check,
  add constraint saved_places_category_confidence_check check (
    category_confidence is null or
    (category_confidence >= 0 and category_confidence <= 1)
  );

create index if not exists saved_places_user_category_idx
  on public.saved_places (user_id, category)
  where category is not null;

alter table public.share_job_place_results
  add column if not exists original_saved_place_id uuid,
  add column if not exists undone_at timestamptz,
  add column if not exists undo_action text,
  add column if not exists replacement_saved_place_id uuid references public.saved_places(id) on delete set null;

update public.share_job_place_results
   set original_saved_place_id = saved_place_id
 where original_saved_place_id is null and saved_place_id is not null;

alter table public.share_job_place_results
  drop constraint if exists share_job_place_results_outcome_check,
  add constraint share_job_place_results_outcome_check check (outcome in (
    'auto_saved', 'already_saved', 'candidate_confirmation',
    'manual_fallback', 'failed', 'undone_by_user'
  )),
  drop constraint if exists share_job_place_results_undo_action_check,
  add constraint share_job_place_results_undo_action_check check (
    undo_action is null or undo_action in ('removed', 'corrected')
  );

do $$
declare
  v_constraint record;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.share_job_place_results'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) like '%saved_place_id IS NOT NULL%'
       and pg_get_constraintdef(c.oid) like '%google_place_id IS NOT NULL%'
  loop
    execute format(
      'alter table public.share_job_place_results drop constraint %I',
      v_constraint.conname
    );
  end loop;
end;
$$;

alter table public.share_job_place_results
  add constraint share_job_place_results_saved_audit_check check (
    outcome not in ('auto_saved', 'already_saved') or
    (original_saved_place_id is not null and place_id is not null and google_place_id is not null)
  ),
  add constraint share_job_place_results_undo_shape_check check (
    outcome <> 'undone_by_user' or
    (undone_at is not null and undo_action is not null and original_saved_place_id is not null)
  );

create index if not exists share_job_place_results_recent_auto_idx
  on public.share_job_place_results (user_id, finalized_at desc)
  where origin = 'automatic';
create index if not exists share_job_place_results_original_saved_idx
  on public.share_job_place_results (user_id, original_saved_place_id)
  where original_saved_place_id is not null;

create or replace function public.preserve_share_result_original_saved_place()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.original_saved_place_id is null and new.saved_place_id is not null then
    new.original_saved_place_id := new.saved_place_id;
  end if;
  return new;
end;
$$;

drop trigger if exists share_job_place_results_preserve_original_saved
  on public.share_job_place_results;
create trigger share_job_place_results_preserve_original_saved
  before insert or update on public.share_job_place_results
  for each row execute function public.preserve_share_result_original_saved_place();

revoke all on function public.preserve_share_result_original_saved_place() from public, anon, authenticated;

create or replace function public.undo_auto_saved_place(
  p_saved_place_id uuid,
  p_action text default 'removed',
  p_replacement_saved_place_id uuid default null
)
returns table(
  undone boolean,
  already_undone boolean,
  share_job_id uuid,
  removed_saved_place_id uuid,
  replacement_saved_place_id uuid,
  undone_at timestamptz
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_result public.share_job_place_results%rowtype;
  v_undone_at timestamptz;
  v_saved_ids jsonb;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_saved_place_id is null then raise exception 'saved_place_id_required'; end if;
  if p_action not in ('removed', 'corrected') then raise exception 'invalid_undo_action'; end if;
  if p_action = 'corrected' and p_replacement_saved_place_id is null then
    raise exception 'replacement_saved_place_required';
  end if;
  if p_action = 'removed' and p_replacement_saved_place_id is not null then
    raise exception 'replacement_not_allowed_for_removal';
  end if;
  if p_replacement_saved_place_id = p_saved_place_id then
    raise exception 'replacement_must_differ';
  end if;
  if p_replacement_saved_place_id is not null and not exists (
    select 1 from public.saved_places sp
     where sp.id = p_replacement_saved_place_id and sp.user_id = v_user_id
  ) then
    raise exception 'replacement_not_owned';
  end if;

  select r.* into v_result
    from public.share_job_place_results r
   where r.user_id = v_user_id
     and r.original_saved_place_id = p_saved_place_id
     and r.origin = 'automatic'
     and r.outcome in ('auto_saved', 'undone_by_user')
   order by r.created_at
   limit 1
   for update;

  if v_result.id is null then raise exception 'automatic_save_not_found'; end if;
  if v_result.outcome = 'undone_by_user' then
    return query select false, true, v_result.share_job_id, p_saved_place_id,
      v_result.replacement_saved_place_id, v_result.undone_at;
    return;
  end if;

  v_undone_at := now();
  update public.share_job_place_results
     set outcome = 'undone_by_user',
         undo_action = p_action,
         undone_at = v_undone_at,
         replacement_saved_place_id = p_replacement_saved_place_id,
         saved_place_id = null,
         updated_at = v_undone_at
   where id = v_result.id;

  delete from public.saved_places
   where id = p_saved_place_id and user_id = v_user_id;

  select coalesce(jsonb_agg(value), '[]'::jsonb) into v_saved_ids
    from jsonb_array_elements(
      case
        when jsonb_typeof(coalesce((select candidate_payload from public.share_jobs where id = v_result.share_job_id)->'savedPlaceIds', '[]'::jsonb)) = 'array'
          then coalesce((select candidate_payload from public.share_jobs where id = v_result.share_job_id)->'savedPlaceIds', '[]'::jsonb)
        else '[]'::jsonb
      end
    ) as ids(value)
   where value <> to_jsonb(p_saved_place_id::text);

  if p_replacement_saved_place_id is not null and not (v_saved_ids @> jsonb_build_array(p_replacement_saved_place_id::text)) then
    v_saved_ids := v_saved_ids || jsonb_build_array(p_replacement_saved_place_id::text);
  end if;

  update public.share_jobs
     set saved_place_id = case
           when saved_place_id = p_saved_place_id then p_replacement_saved_place_id
           else saved_place_id
         end,
         candidate_payload = jsonb_set(coalesce(candidate_payload, '{}'::jsonb), '{savedPlaceIds}', v_saved_ids, true),
         updated_at = now()
   where id = v_result.share_job_id and user_id = v_user_id;

  return query select true, false, v_result.share_job_id, p_saved_place_id,
    p_replacement_saved_place_id, v_undone_at;
end;
$$;

revoke all on function public.undo_auto_saved_place(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.undo_auto_saved_place(uuid, text, uuid) to authenticated;

create or replace function public.set_saved_place_category(
  p_saved_place_id uuid,
  p_category text
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_category not in (
    'restaurant', 'cafe', 'bakery', 'bar', 'hotel', 'park',
    'hiking_trail', 'beach', 'scenic_spot', 'attraction', 'museum',
    'shopping', 'entertainment', 'nightlife', 'fitness', 'wellness',
    'transportation', 'education', 'service', 'other'
  ) then raise exception 'invalid_category'; end if;

  update public.saved_places
     set category = p_category,
         category_source = 'user',
         category_confidence = 1,
         category_model_version = 'nearr-category-2026-08-03.v1',
         category_user_overridden = true,
         categorized_at = now(),
         updated_at = now()
   where id = p_saved_place_id and user_id = v_user_id;
  return found;
end;
$$;

revoke all on function public.set_saved_place_category(uuid, text) from public, anon, authenticated;
grant execute on function public.set_saved_place_category(uuid, text) to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'share_job_place_results'
     ) then
    alter publication supabase_realtime add table public.share_job_place_results;
  end if;
end;
$$;