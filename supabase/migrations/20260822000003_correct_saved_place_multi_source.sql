-- Preserve every source when provider correction converges two same-user
-- saved places. The production correction body remains the authority; this
-- wrapper snapshots the row that body deduplicates, then restores its child
-- sources under the retained saved_place id.

alter function public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)
  rename to correct_saved_place_provider_single_source_legacy;

revoke all on function public.correct_saved_place_provider_single_source_legacy(
  uuid,uuid,text,text,text,numeric,text
) from public, anon, authenticated;

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
  v_uid uuid := auth.uid();
  v_merge_source_id uuid;
  v_sources jsonb := '[]'::jsonb;
  v_result record;
  v_source jsonb;
begin
  if v_uid is null then raise exception 'authentication_required'; end if;

  select id into v_merge_source_id
    from public.saved_places
   where user_id = v_uid and place_id = p_place_id and id <> p_saved_place_id
   for update;

  if v_merge_source_id is not null then
    select coalesce(jsonb_agg(to_jsonb(s) order by s.first_attached_at, s.id), '[]'::jsonb)
      into v_sources
      from public.saved_place_sources s
     where s.saved_place_id = v_merge_source_id and s.user_id = v_uid;
  end if;

  select * into v_result
    from public.correct_saved_place_provider_single_source_legacy(
      p_saved_place_id, p_place_id, p_corrected_google_place_id,
      p_category, p_category_source, p_category_confidence,
      p_category_model_version
    );

  -- The legacy function has now atomically converged saved_places and updated
  -- all existing references. Restore only the deleted duplicate's public
  -- source children. Exact identities already present on the retained row are
  -- deduped and only fill missing metadata.
  for v_source in select value from jsonb_array_elements(v_sources)
  loop
    insert into public.saved_place_sources(
      saved_place_id,user_id,identity_key,identity_version,platform,content_id,
      canonical_url,original_url,creator_handle,creator_name,caption_excerpt,
      ai_note,thumbnail_url,is_primary,first_attached_at,last_seen_at,created_at,updated_at
    ) values (
      v_result.saved_place_id,v_uid,v_source->>'identity_key',
      (v_source->>'identity_version')::integer,v_source->>'platform',v_source->>'content_id',
      v_source->>'canonical_url',v_source->>'original_url',v_source->>'creator_handle',
      v_source->>'creator_name',v_source->>'caption_excerpt',v_source->>'ai_note',
      v_source->>'thumbnail_url',false,
      (v_source->>'first_attached_at')::timestamptz,
      (v_source->>'last_seen_at')::timestamptz,
      (v_source->>'created_at')::timestamptz,now()
    ) on conflict (saved_place_id, identity_key) do update set
      last_seen_at = greatest(public.saved_place_sources.last_seen_at, excluded.last_seen_at),
      creator_handle = coalesce(public.saved_place_sources.creator_handle, excluded.creator_handle),
      creator_name = coalesce(public.saved_place_sources.creator_name, excluded.creator_name),
      caption_excerpt = coalesce(public.saved_place_sources.caption_excerpt, excluded.caption_excerpt),
      ai_note = coalesce(public.saved_place_sources.ai_note, excluded.ai_note),
      thumbnail_url = coalesce(public.saved_place_sources.thumbnail_url, excluded.thumbnail_url);
  end loop;

  if not exists (
    select 1 from public.saved_place_sources
     where saved_place_id = v_result.saved_place_id and is_primary
  ) then
    update public.saved_place_sources set is_primary = true
     where id = (
       select id from public.saved_place_sources
        where saved_place_id = v_result.saved_place_id
        order by first_attached_at, id limit 1
     );
  end if;

  return query select
    v_result.saved_place_id,
    v_result.merged_saved_place_id,
    v_result.source_job_id,
    v_result.source_result_id,
    v_result.source_rule_version;
end;
$$;

revoke all on function public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)
  from public, anon, authenticated;
grant execute on function public.correct_saved_place_provider(uuid,uuid,text,text,text,numeric,text)
  to authenticated;
