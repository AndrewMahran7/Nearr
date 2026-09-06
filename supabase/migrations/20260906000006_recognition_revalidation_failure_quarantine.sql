-- A worker claim temporarily marks the affected answer REVALIDATING. A
-- technical completion must put that answer back in durable quarantine while
-- the retry waits; source-level blocking alone is safe but leaves misleading
-- answer state and weakens operational introspection.
create or replace function public.sync_recognition_technical_failure_quarantine_v2()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.decision = 'TECHNICAL_FAILURE'
     and new.state in ('RETRY_WAIT', 'FAILED')
     and (old.state is distinct from new.state or old.decision is distinct from new.decision) then
    update public.recognition_cache_answers_v2
       set state = 'QUARANTINED', updated_at = now()
     where identity_key = new.identity_key
       and (new.slot_key = '*' or slot_key = new.slot_key)
       and state in ('QUARANTINED', 'REVALIDATING');

    update public.recognition_source_states
       set state = 'QUARANTINED', updated_at = now()
     where identity_key = new.identity_key
       and state in ('QUARANTINED', 'REVALIDATING');
  end if;
  return new;
end;
$$;

drop trigger if exists recognition_revalidation_failure_quarantine_v2
  on public.recognition_revalidation_tasks;
create trigger recognition_revalidation_failure_quarantine_v2
  after update of state, decision on public.recognition_revalidation_tasks
  for each row execute function public.sync_recognition_technical_failure_quarantine_v2();

revoke all on function public.sync_recognition_technical_failure_quarantine_v2()
  from public, anon, authenticated;
grant execute on function public.sync_recognition_technical_failure_quarantine_v2()
  to service_role;
