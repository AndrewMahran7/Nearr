-- Preserve the normalized saved-place category through the V2 atomic cache
-- commit. places.category is provider-facing display text and must never be
-- copied into saved_places.category's closed Nearr taxonomy.

alter table public.recognition_cache_answers_v2
  add column if not exists saved_category text,
  add column if not exists saved_category_source text,
  add column if not exists saved_category_confidence numeric,
  add column if not exists saved_category_model_version text;

alter table public.recognition_cache_answers_v2
  drop constraint if exists recognition_cache_answers_v2_saved_category_check,
  add constraint recognition_cache_answers_v2_saved_category_check check (
    saved_category is null or saved_category in (
      'restaurant','cafe','bakery','bar','brewery','winery','dessert','hotel','resort',
      'hiking_trail','park','beach','waterfall','lake','marina','island','scenic_spot',
      'attraction','museum','shopping','entertainment','nightlife','sports','fitness',
      'wellness','transportation','education','service','other'
    )
  ),
  drop constraint if exists recognition_cache_answers_v2_saved_category_source_check,
  add constraint recognition_cache_answers_v2_saved_category_source_check check (
    saved_category_source is null or saved_category_source in (
      'google_primary_type','google_types','deterministic','ai','fallback'
    )
  );

create or replace function public.hydrate_recognition_answer_category_v2()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op='UPDATE' and new.place_id is distinct from old.place_id then
    new.saved_category:=null;
    new.saved_category_source:=null;
    new.saved_category_confidence:=null;
    new.saved_category_model_version:=null;
  end if;

  if new.saved_category is null and new.admitted_from_job_id is not null then
    select sp.category,sp.category_source,sp.category_confidence,sp.category_model_version
      into new.saved_category,new.saved_category_source,new.saved_category_confidence,new.saved_category_model_version
      from public.share_job_place_results r
      join public.saved_places sp on sp.id=r.saved_place_id
     where r.share_job_id=new.admitted_from_job_id and r.logical_result_id=new.slot_key
       and public.resolve_public_place_id(r.place_id)=public.resolve_public_place_id(new.place_id)
       and not sp.category_user_overridden
     limit 1;
  end if;

  -- A model-supported correction carries the correcting save's normalized
  -- automatic category, never a user-authored override or private text.
  if new.saved_category is null then
    select sp.category,sp.category_source,sp.category_confidence,sp.category_model_version
      into new.saved_category,new.saved_category_source,new.saved_category_confidence,new.saved_category_model_version
      from public.recognition_correction_events ce
      join public.saved_places sp on sp.user_id=ce.user_id
       and public.resolve_public_place_id(sp.place_id)=public.resolve_public_place_id(new.place_id)
     where ce.identity_key=new.identity_key and ce.slot_key in (new.slot_key,'*')
       and ce.replacement_place_id is not null and not sp.category_user_overridden
     order by ce.created_at desc limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists recognition_answer_category_v2 on public.recognition_cache_answers_v2;
create trigger recognition_answer_category_v2
  before insert or update of place_id,admitted_from_job_id on public.recognition_cache_answers_v2
  for each row execute function public.hydrate_recognition_answer_category_v2();

update public.recognition_cache_answers_v2 a set
  saved_category=sp.category,
  saved_category_source=sp.category_source,
  saved_category_confidence=sp.category_confidence,
  saved_category_model_version=sp.category_model_version
from public.share_job_place_results r
join public.saved_places sp on sp.id=r.saved_place_id and not sp.category_user_overridden
where a.admitted_from_job_id=r.share_job_id and a.slot_key=r.logical_result_id
  and public.resolve_public_place_id(a.place_id)=public.resolve_public_place_id(r.place_id)
  and a.saved_category is null;

create or replace function public.commit_recognition_cache_save_v2(
  p_user_id uuid,p_identity_key text,p_answer_ids uuid[],p_expected_feedback_revision bigint,
  p_policy_version text,p_recognition_version text
)
returns table(answer_id uuid,slot_key text,saved_place_id uuid,place_id uuid,reused boolean)
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_auth uuid:=auth.uid(); v_source public.recognition_source_states%rowtype;
declare v_answer record; v_saved_id uuid; v_reused boolean; v_requested integer;
begin
  if p_user_id is null or (v_auth is not null and v_auth is distinct from p_user_id) then raise exception 'not_owner'; end if;
  v_requested:=coalesce(array_length(p_answer_ids,1),0);
  if v_requested<1 or v_requested>10 then raise exception 'invalid_answer_set'; end if;
  select * into v_source from public.recognition_source_states where identity_key=p_identity_key for update;
  if v_source.identity_key is null or v_source.state<>'ELIGIBLE' or v_source.whole_source_quarantined or
     v_source.feedback_revision<>p_expected_feedback_revision or v_source.policy_version<>p_policy_version or
     v_source.recognition_version<>p_recognition_version then raise exception 'recognition_cache_stale'; end if;
  if (select count(*) from public.recognition_cache_answers_v2 a where a.id=any(p_answer_ids)
      and a.identity_key=p_identity_key and a.state='ELIGIBLE' and a.feedback_revision=v_source.feedback_revision
      and a.evidence_revision=v_source.evidence_revision and a.policy_version=p_policy_version
      and a.recognition_version=p_recognition_version and a.terminal_status='success'
      and a.semantic_check_passed and a.geographic_check_passed and a.evidence_sufficient
      and not a.strong_contradiction)<>v_requested then raise exception 'recognition_cache_stale'; end if;

  for v_answer in select a.* from public.recognition_cache_answers_v2 a
    where a.id=any(p_answer_ids) order by a.slot_key for update
  loop
    if exists(select 1 from public.recognition_identity_support s where s.user_id=p_user_id
      and s.identity_key=p_identity_key and s.slot_key in (v_answer.slot_key,'*')
      and public.resolve_public_place_id(s.place_id)<>public.resolve_public_place_id(v_answer.place_id))
      then raise exception 'user_identity_conflict'; end if;
    select sp.id into v_saved_id from public.saved_places sp where sp.user_id=p_user_id
      and public.resolve_public_place_id(sp.place_id)=public.resolve_public_place_id(v_answer.place_id)
      order by sp.created_at limit 1 for update;
    v_reused:=v_saved_id is not null;
    if v_saved_id is null then
      insert into public.saved_places(user_id,place_id,source_type,source_url,ai_note,category,category_source,
        category_confidence,category_model_version,category_user_overridden,categorized_at)
      values(p_user_id,public.resolve_public_place_id(v_answer.place_id),
        case when v_source.platform in ('tiktok','instagram','youtube','facebook','snapchat') then v_source.platform else 'link' end,
        v_source.canonical_url,v_source.source_ai_note,v_answer.saved_category,v_answer.saved_category_source,
        v_answer.saved_category_confidence,v_answer.saved_category_model_version,false,
        case when v_answer.saved_category is null then null else now() end)
      returning id into v_saved_id;
    end if;
    perform public.attach_saved_place_source(p_user_id,v_saved_id,v_source.identity_key,v_source.identity_version,
      case when v_source.platform in ('tiktok','instagram','youtube','facebook','snapchat') then v_source.platform else 'link' end,
      v_source.content_id,v_source.canonical_url,v_source.canonical_url,null,null,null,v_source.source_ai_note,null);
    answer_id:=v_answer.id; slot_key:=v_answer.slot_key; saved_place_id:=v_saved_id;
    place_id:=public.resolve_public_place_id(v_answer.place_id); reused:=v_reused; return next;
  end loop;
end;
$$;

revoke all on function public.hydrate_recognition_answer_category_v2() from public,anon,authenticated;
grant execute on function public.hydrate_recognition_answer_category_v2() to service_role;
revoke all on function public.commit_recognition_cache_save_v2(uuid,text,uuid[],bigint,text,text) from public,anon,authenticated;
grant execute on function public.commit_recognition_cache_save_v2(uuid,text,uuid[],bigint,text,text) to service_role;
