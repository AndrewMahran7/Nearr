-- Nearr-Dev only. Attempts to requeue existing terminal rows must fail
-- before any AFTER trigger or external dispatch; explicit rollback follows.
begin;
do $$
declare v_job uuid; v_task uuid;
begin
  select j.id into v_job from public.share_jobs j
  where j.status <> 'queued'
    and not public.is_adult_eligible_for_ai(j.user_id)
  order by j.created_at desc limit 1;
  if v_job is null then raise exception 'no ineligible Dev share-job fixture'; end if;
  begin
    update public.share_jobs set status='queued' where id=v_job;
    raise exception 'ineligible share job was requeued';
  exception when others then
    if sqlerrm <> 'age_eligibility_required' then raise; end if;
  end;

  select t.id into v_task from public.share_media_tasks t
  where t.status <> 'queued'
    and not public.is_adult_eligible_for_ai(t.user_id)
  order by t.created_at desc limit 1;
  if v_task is null then raise exception 'no ineligible Dev media-task fixture'; end if;
  begin
    update public.share_media_tasks set status='queued' where id=v_task;
    raise exception 'ineligible media task was requeued';
  exception when others then
    if sqlerrm <> 'age_eligibility_required' then raise; end if;
  end;
end;
$$;
rollback;
select 'share-job and media-task requeue guards passed and rolled back' as result;
