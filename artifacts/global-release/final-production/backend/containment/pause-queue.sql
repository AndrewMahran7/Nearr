-- Operational, additive Production containment; NOT a blanket migration push.
-- No UPDATE/DELETE/TRUNCATE of user/queue/billing/notification records.
-- No configurable bypass; removing the gate requires a separate reviewed release.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '15s';

do $$ begin
  if not exists(select 1 from supabase_migrations.schema_migrations where version='20261009000006')
    or to_regprocedure('public.begin_share_job_notification_provider_attempt(uuid,uuid)') is null then
    raise exception 'production_notification_contract_missing';
  end if;
  if to_regprocedure('public.nearr_containment_new_job()') is not null then
    raise exception 'containment_already_installed_inspect_instead_of_overwriting';
  end if;
end $$;

create function public.nearr_containment_new_job() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  raise exception using errcode='PT503',message='recognition_temporarily_unavailable';
end $$;
revoke all on function public.nearr_containment_new_job() from public,anon,authenticated,service_role;
create trigger nearr_containment_new_job before insert on public.share_jobs
for each row execute function public.nearr_containment_new_job();

create function public.nearr_containment_new_media() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  -- Ordinary manual saves may enqueue this optional supplement from an AFTER
  -- trigger. Skip it (also skipping ON CONFLICT rearming), so the user's save
  -- commits and existing supplemental tasks remain byte-for-byte unchanged.
  if new.task_kind='ai_note_enrichment' then return null; end if;
  raise exception using errcode='PT503',message='recognition_temporarily_unavailable';
end $$;
revoke all on function public.nearr_containment_new_media() from public,anon,authenticated,service_role;
create trigger nearr_containment_new_media before insert on public.share_media_tasks
for each row execute function public.nearr_containment_new_media();

create function public.nearr_containment_claim() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.status in ('queued','processing','processing_metadata') and (
    new.status is distinct from old.status or new.attempts is distinct from old.attempts
    or new.locked_until is distinct from old.locked_until
  ) then
    raise exception using errcode='PT503',message='recognition_temporarily_unavailable';
  end if;
  -- User cancellation, manual completion, owner transfer and notification-only
  -- writes remain possible. This gate alone cannot recall already claimed work.
  return new;
end $$;
revoke all on function public.nearr_containment_claim() from public,anon,authenticated,service_role;
create trigger nearr_containment_claim before update of status,attempts,locked_until on public.share_jobs
for each row execute function public.nearr_containment_claim();
create trigger nearr_containment_claim before update of status,attempts,locked_until on public.share_media_tasks
for each row execute function public.nearr_containment_claim();

comment on function public.nearr_containment_claim() is 'nearr-production-pause-v1: retained fail-closed until a separately qualified release';
commit;
