-- Development-only onboarding QA runtime. This deliberately does not read or
-- mutate wallets, token lots, purchases, subscriptions, or RevenueCat state.

set check_function_bodies = off;

alter table public.onboarding_tutorial_fixtures
  add column if not exists tutorial_use text not null default 'demo';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'onboarding_tutorial_fixtures_clean_use_check'
      and conrelid = 'public.onboarding_tutorial_fixtures'::regclass
  ) then
    alter table public.onboarding_tutorial_fixtures
      add constraint onboarding_tutorial_fixtures_clean_use_check
      check (tutorial_use in ('demo','practice','both'));
  end if;
end;
$$;

-- The independently qualified practice mapping is onboarding product data,
-- separate from both Recognition Cache V2 and monetization entitlements.
do $$
declare
  v_place_id uuid;
begin
  select p.id into v_place_id
    from public.places as p
   where p.google_place_id = 'ChIJ3dEbnTMh3YARhAvz8VeCxJg'
     and p.merged_into_place_id is null
   order by p.created_at
   limit 1;
  if v_place_id is null then raise exception 'onboarding_practice_place_missing'; end if;

  update public.onboarding_tutorial_fixtures set
    place_id = v_place_id,
    status = 'active',
    role = 'backup',
    priority = 850,
    provenance = 'onboarding_tutorial_verified',
    verification_revision = greatest(verification_revision, 1),
    verified_at = now(),
    verified_by = 'onb2-07-clean-onboarding-qa',
    health_state = 'healthy',
    last_health_checked_at = now(),
    health_expires_at = now() + interval '7 days',
    last_health_error_code = null,
    disabled_at = null,
    disabled_reason = null,
    tutorial_use = 'practice',
    updated_at = now()
  where identity_key = 'v1:instagram:DUWyZkfgbT4'
    and identity_version = 1;

  if not found then
    insert into public.onboarding_tutorial_fixtures(
      id, identity_key, identity_version, platform, content_id, canonical_url,
      place_id, status, role, priority, provenance, verification_revision,
      verified_at, verified_by, health_state, last_health_checked_at,
      health_expires_at, tutorial_use
    ) values (
      '2b6fc7fe-2d88-46e8-a8ae-140680862da7',
      'v1:instagram:DUWyZkfgbT4', 1, 'instagram', 'DUWyZkfgbT4',
      'https://www.instagram.com/reel/DUWyZkfgbT4/', v_place_id,
      'active', 'backup', 850, 'onboarding_tutorial_verified', 1,
      now(), 'onb2-07-clean-onboarding-qa', 'healthy', now(),
      now() + interval '7 days', 'practice'
    );
  end if;
end;
$$;

alter table public.share_jobs add column if not exists submission_path text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'share_jobs_onboarding_qa_submission_path_check'
      and conrelid = 'public.share_jobs'::regclass
  ) then
    alter table public.share_jobs
      add constraint share_jobs_onboarding_qa_submission_path_check
      check (submission_path is null or submission_path in ('share_extension','host_app','background_import'));
  end if;
end;
$$;

create or replace function public.create_onboarding_qa_share_job_for_user(
  p_user_id uuid,
  p_source_url text,
  p_canonical_url text,
  p_source_platform text,
  p_idempotency_key text default null,
  p_dedupe_window_seconds integer default 90
) returns table(
  job_id uuid,
  status text,
  duplicate boolean,
  requires_purchase boolean,
  available_uses integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.share_jobs%rowtype;
  v_job public.share_jobs%rowtype;
  v_lock_key bigint;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  v_lock_key := hashtextextended(
    p_user_id::text || ':' || coalesce(p_canonical_url, p_source_url, ''), 0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  if nullif(trim(p_idempotency_key), '') is not null then
    select sj.* into v_existing from public.share_jobs as sj
     where sj.user_id = p_user_id and sj.idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return query select v_existing.id, v_existing.status, true, false, 0;
      return;
    end if;
  end if;

  select sj.* into v_existing from public.share_jobs as sj
   where sj.user_id = p_user_id
     and sj.canonical_url = p_canonical_url
     and sj.recognition_run_mode = 'normal'
     and sj.status in ('queued','processing_metadata')
     and sj.created_at >= now() - make_interval(secs => greatest(p_dedupe_window_seconds, 1))
   order by sj.created_at desc
   limit 1;
  if found then
    return query select v_existing.id, v_existing.status, true, false, 0;
    return;
  end if;

  insert into public.share_jobs(
    user_id, source_url, canonical_url, source_platform, status,
    progress_stage, idempotency_key, billing_mode, billing_outcome,
    billing_settled_at, recognition_run_mode
  ) values (
    p_user_id, p_source_url, p_canonical_url, p_source_platform, 'queued',
    'queued', p_idempotency_key, 'normal_free',
    'unmetered:onboarding_qa', now(), 'normal'
  ) returning * into v_job;

  return query select v_job.id, v_job.status, false, false, 0;
end;
$$;

revoke all on function public.create_onboarding_qa_share_job_for_user(uuid,text,text,text,text,integer)
  from public, anon, authenticated;
grant execute on function public.create_onboarding_qa_share_job_for_user(uuid,text,text,text,text,integer)
  to service_role;

create or replace function public.record_onboarding_qa_submission_path(
  p_user_id uuid,
  p_job_id uuid,
  p_path text
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_path not in ('share_extension','host_app','background_import') then
    raise exception 'invalid_submission_path';
  end if;
  update public.share_jobs as sj
     set submission_path = coalesce(sj.submission_path, p_path), updated_at = now()
   where sj.id = p_job_id and sj.user_id = p_user_id;
  if not found then raise exception 'share_job_not_owned'; end if;
end;
$$;

revoke all on function public.record_onboarding_qa_submission_path(uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.record_onboarding_qa_submission_path(uuid,uuid,text)
  to service_role;

comment on function public.create_onboarding_qa_share_job_for_user(uuid,text,text,text,text,integer) is
  'Nearr-Dev onboarding QA job creation: idempotent and explicitly independent of monetization state.';
