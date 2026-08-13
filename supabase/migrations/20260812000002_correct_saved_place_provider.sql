-- Owner-scoped, atomic provider correction with same-user deduplication.

set check_function_bodies = off;

create or replace function public.correct_saved_place_provider(
  p_saved_place_id uuid,
  p_place_id uuid,
  p_corrected_google_place_id text,
  p_category text,
  p_category_source text,
  p_category_confidence numeric,
  p_category_model_version text
)
returns table(
  saved_place_id uuid,
  merged_saved_place_id uuid,
  source_job_id uuid,
  source_result_id uuid,
  source_rule_version text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_source public.saved_places%rowtype;
  v_existing public.saved_places%rowtype;
  v_result public.share_job_place_results%rowtype;
begin
  if v_user_id is null then raise exception 'authentication_required'; end if;
  if p_saved_place_id is null or p_place_id is null then raise exception 'place_required'; end if;

  select * into v_source
    from public.saved_places
   where id = p_saved_place_id and user_id = v_user_id
   for update;
  if v_source.id is null then raise exception 'saved_place_not_found'; end if;
  if not exists (select 1 from public.places where id = p_place_id) then
    raise exception 'replacement_place_not_found';
  end if;

  select r.* into v_result
    from public.share_job_place_results r
   where r.user_id = v_user_id
     and (r.saved_place_id = v_source.id or r.original_saved_place_id = v_source.id)
   order by r.finalized_at desc nulls last, r.created_at desc
   limit 1;

  -- Lost-response retry: the provider was already corrected. Return the same
  -- identity and context without applying a second mutation.
  if v_source.place_id = p_place_id then
    return query select v_source.id, null::uuid, v_result.share_job_id,
      v_result.id, v_result.rule_version;
    return;
  end if;

  select * into v_existing
    from public.saved_places
   where user_id = v_user_id and place_id = p_place_id and id <> v_source.id
   for update;

  if v_existing.id is not null then
    -- Keep the item being corrected as the logical identity. Move every
    -- same-user reference off the pre-existing duplicate before deleting it.
    update public.notification_events as ne
       set saved_place_id = v_source.id
     where ne.saved_place_id = v_existing.id and ne.user_id = v_user_id;

    update public.share_jobs as sj
       set saved_place_id = case
             when sj.saved_place_id = v_existing.id then v_source.id
             else sj.saved_place_id
           end,
           candidate_payload = case
             when jsonb_typeof(coalesce(sj.candidate_payload->'savedPlaceIds', '[]'::jsonb)) = 'array'
             then jsonb_set(
               coalesce(sj.candidate_payload, '{}'::jsonb),
               '{savedPlaceIds}',
               coalesce((
                 select jsonb_agg(
                   case when value = to_jsonb(v_existing.id::text)
                     then to_jsonb(v_source.id::text) else value end
                 )
                 from jsonb_array_elements(coalesce(sj.candidate_payload->'savedPlaceIds', '[]'::jsonb))
               ), '[]'::jsonb),
               true
             )
             else sj.candidate_payload
           end,
           updated_at = now()
     where sj.user_id = v_user_id
       and (sj.saved_place_id = v_existing.id
         or coalesce(sj.candidate_payload->'savedPlaceIds', '[]'::jsonb)
              @> jsonb_build_array(v_existing.id::text));

    update public.share_job_place_results as r
       set saved_place_id = case when r.saved_place_id = v_existing.id then v_source.id else r.saved_place_id end,
           original_saved_place_id = case when r.original_saved_place_id = v_existing.id then v_source.id else r.original_saved_place_id end,
           replacement_saved_place_id = case when r.replacement_saved_place_id = v_existing.id then v_source.id else r.replacement_saved_place_id end,
           updated_at = now()
     where r.user_id = v_user_id
       and (r.saved_place_id = v_existing.id
         or r.original_saved_place_id = v_existing.id
         or r.replacement_saved_place_id = v_existing.id);

    -- Merge only same-user state. The correction row's social context and
    -- reminder choices win; useful history from the duplicate is retained.
    update public.saved_places as sp
       set notes = coalesce(nullif(v_source.notes, ''), v_existing.notes),
           ai_note = coalesce(nullif(v_source.ai_note, ''), v_existing.ai_note),
           source_type = coalesce(v_source.source_type, v_existing.source_type),
           source_url = coalesce(nullif(v_source.source_url, ''), v_existing.source_url),
           radius_value = coalesce(v_source.radius_value, v_existing.radius_value),
           radius_unit = coalesce(v_source.radius_unit, v_existing.radius_unit),
           notifications_enabled = v_source.notifications_enabled or v_existing.notifications_enabled,
           last_notified_at = case
             when v_source.last_notified_at is null then v_existing.last_notified_at
             when v_existing.last_notified_at is null then v_source.last_notified_at
             else greatest(v_source.last_notified_at, v_existing.last_notified_at)
           end,
           notification_count = greatest(v_source.notification_count, v_existing.notification_count),
           reminder_opportunity_count = greatest(v_source.reminder_opportunity_count, v_existing.reminder_opportunity_count),
           visited_at = coalesce(v_source.visited_at, v_existing.visited_at),
           created_at = least(v_source.created_at, v_existing.created_at)
     where sp.id = v_source.id and sp.user_id = v_user_id;

    delete from public.saved_places as sp
     where sp.id = v_existing.id and sp.user_id = v_user_id;
  end if;

  update public.saved_places as sp
     set place_id = p_place_id,
         category = case when sp.category_user_overridden then sp.category else p_category end,
         category_source = case when sp.category_user_overridden then sp.category_source else p_category_source end,
         category_confidence = case when sp.category_user_overridden then sp.category_confidence else p_category_confidence end,
         category_model_version = case when sp.category_user_overridden then sp.category_model_version else p_category_model_version end,
         categorized_at = case when sp.category_user_overridden then sp.categorized_at else now() end,
         updated_at = now()
   where sp.id = v_source.id and sp.user_id = v_user_id;

  update public.share_job_place_results as r
     set google_place_id = p_corrected_google_place_id,
         place_id = p_place_id,
         saved_place_id = v_source.id,
         updated_at = now()
   where r.user_id = v_user_id and r.saved_place_id = v_source.id;

  return query select v_source.id, v_existing.id, v_result.share_job_id,
    v_result.id, v_result.rule_version;
end;
$$;

revoke all on function public.correct_saved_place_provider(uuid, uuid, text, text, text, numeric, text)
  from public, anon, authenticated;
grant execute on function public.correct_saved_place_provider(uuid, uuid, text, text, text, numeric, text)
  to authenticated;
