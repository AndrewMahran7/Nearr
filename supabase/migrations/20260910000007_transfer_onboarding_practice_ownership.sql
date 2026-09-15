-- Preserve the bounded practice job and saved place when an anonymous
-- onboarding session is transferred to a permanent account.
set check_function_bodies = off;

create or replace function public.sync_onboarding_practice_entitlement_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_entitlement public.onboarding_practice_entitlements%rowtype;
  v_job_ids uuid[] := array[]::uuid[];
  v_source_saved uuid;
  v_destination_saved uuid;
  v_place_id uuid;
begin
  if old.user_id is not distinct from new.user_id or new.user_id is null then return new; end if;

  select e.* into v_entitlement
    from public.onboarding_practice_entitlements as e
   where e.onboarding_session_id = new.id
   for update;
  if not found then return new; end if;

  select coalesce(array_agg(distinct ev.share_job_id), array[]::uuid[]) into v_job_ids
    from public.onboarding_practice_entitlement_events as ev
   where ev.onboarding_session_id = new.id and ev.share_job_id is not null;

  select j.saved_place_id into v_source_saved
    from public.share_jobs as j
   where j.id = any(v_job_ids) and j.user_id = old.user_id and j.saved_place_id is not null
   order by j.completed_at desc nulls last
   limit 1
   for update;

  if v_source_saved is not null then
    select sp.place_id into v_place_id from public.saved_places as sp
     where sp.id = v_source_saved and sp.user_id = old.user_id for update;
    if v_place_id is not null then
      select sp.id into v_destination_saved from public.saved_places as sp
       where sp.user_id = new.user_id and sp.place_id = v_place_id for update;
      if v_destination_saved is not null then
        update public.share_jobs set saved_place_id=v_destination_saved where id=any(v_job_ids);
        update public.share_job_place_results set saved_place_id=v_destination_saved where share_job_id=any(v_job_ids);
        delete from public.saved_places where id=v_source_saved and user_id=old.user_id;
      else
        update public.saved_places set user_id=new.user_id where id=v_source_saved and user_id=old.user_id;
        v_destination_saved := v_source_saved;
        update public.notification_events set user_id=new.user_id
         where saved_place_id=v_destination_saved and user_id=old.user_id;
      end if;
    end if;
  end if;

  update public.share_jobs set user_id=new.user_id,idempotency_key=null where id=any(v_job_ids) and user_id=old.user_id;
  update public.share_media_tasks set user_id=new.user_id where share_job_id=any(v_job_ids) and user_id=old.user_id;
  update public.share_job_place_results set user_id=new.user_id where share_job_id=any(v_job_ids) and user_id=old.user_id;
  update public.share_media_runs set user_id=new.user_id where share_job_id=any(v_job_ids) and user_id=old.user_id;
  update public.onboarding_practice_entitlements set user_id=new.user_id,updated_at=now()
    where onboarding_session_id=new.id;
  insert into public.onboarding_practice_entitlement_events(
    onboarding_session_id,user_id,fixture_id,event_type,reason_code,detail
  ) values(
    new.id,new.user_id,v_entitlement.selected_fixture_id,'owner_transferred','onboarding_owner_changed',
    jsonb_build_object('job_count',coalesce(array_length(v_job_ids,1),0),'saved_place_transferred',v_source_saved is not null)
  );
  return new;
end;
$$;

comment on function public.sync_onboarding_practice_entitlement_owner() is
  'Transfers only the server-audited bounded practice jobs/save when onboarding ownership changes.';
