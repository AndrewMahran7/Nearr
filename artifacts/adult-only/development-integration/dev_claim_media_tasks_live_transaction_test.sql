-- Nearr-Dev only. Exercise the installed claim RPC against the preserved,
-- due, age-pending task. Any attempted lease is rolled back.
begin;
set local statement_timeout = '15s';
do $$
declare
  v_before integer;
  v_after integer;
  v_claimed integer := 0;
  v_guard_error boolean := false;
begin
  select count(*) into v_before
    from public.share_media_tasks t
   where t.status = 'queued'
     and coalesce(t.next_attempt_at, now()) <= now()
     and not public.is_adult_eligible_for_ai(t.user_id);
  if v_before < 1 then
    raise exception 'no due ineligible Development task fixture';
  end if;

  begin
    select count(*) into v_claimed from public.claim_media_tasks(1, 60);
  exception when others then
    if position('age_eligibility_required' in sqlerrm) = 0 then raise; end if;
    v_guard_error := true;
  end;
  if not v_guard_error and v_claimed <> 0 then
    raise exception 'claim RPC leased an ineligible task';
  end if;

  select count(*) into v_after
    from public.share_media_tasks t
   where t.status = 'queued'
     and coalesce(t.next_attempt_at, now()) <= now()
     and not public.is_adult_eligible_for_ai(t.user_id);
  if v_after <> v_before then
    raise exception 'ineligible queued-task count changed during claim test';
  end if;
end;
$$;
rollback;
select 'installed claim_media_tasks denied due pending task and rolled back' as result;
