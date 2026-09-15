-- Repair the Development token-aware share-job RPC without changing its
-- response contract or monetization policy.
--
-- The RETURNS TABLE fields are PL/pgSQL variables. Unqualified references to
-- share_jobs.status and place_find_wallets.available_uses therefore collided
-- with the public output fields of the same names. Every relation read below
-- is aliased and every expression-side column reference is qualified.
--
-- The nine-argument overload intentionally has no defaults. The canonical
-- eight-argument overload retains its existing defaults, so PostgREST can
-- resolve an eight-field legacy request to that overload and a nine-field
-- token-aware request to this one deterministically.

-- PostgreSQL does not allow CREATE OR REPLACE to remove existing parameter
-- defaults. Recreating this one overload is therefore required to remove the
-- REST ambiguity; the migration is transactional and the live object has no
-- database dependents.
drop function public.create_share_job_for_user(
  uuid, text, text, text, text, integer, boolean, boolean, boolean
);

create function public.create_share_job_for_user(
  p_user_id uuid,
  p_source_url text,
  p_canonical_url text,
  p_source_platform text,
  p_idempotency_key text,
  p_dedupe_window_seconds integer,
  p_is_anonymous boolean,
  p_force_rerun boolean,
  p_enforce_tokens boolean
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
  v_available integer := 0;
  v_enforce boolean := false;
  v_lock_key bigint;
  v_claimed integer := 0;
  v_pro boolean := false;
  v_prior_completed boolean := false;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  perform p_dedupe_window_seconds, p_force_rerun;

  select p_enforce_tokens and config.enabled
    into v_enforce
    from public.token_monetization_config as config
   where config.environment_name = 'development';
  v_enforce := coalesce(v_enforce, false);

  v_lock_key := hashtextextended(
    p_user_id::text || ':' || coalesce(p_canonical_url, p_source_url, ''),
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  if v_enforce and not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id, false);
    v_pro := public.has_active_nearr_pro(p_user_id);
    select wallet.available_uses
      into v_available
      from public.place_find_wallets as wallet
     where wallet.user_id = p_user_id;
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select job.*
      into v_existing
      from public.share_jobs as job
     where job.user_id = p_user_id
       and job.idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return query select
        v_existing.id,
        v_existing.status,
        true,
        v_existing.status = 'awaiting_purchase',
        v_available;
      return;
    end if;
  end if;

  select job.*
    into v_existing
    from public.share_jobs as job
   where job.user_id = p_user_id
     and job.canonical_url = p_canonical_url
     and job.recognition_run_mode = 'normal'
     and job.status in ('awaiting_purchase', 'queued', 'processing_metadata')
   order by job.created_at desc
   limit 1;
  if found then
    return query select
      v_existing.id,
      v_existing.status,
      true,
      v_existing.status = 'awaiting_purchase',
      v_available;
    return;
  end if;

  v_prior_completed := exists(
    select 1
      from public.share_jobs as job
     where job.user_id = p_user_id
       and job.canonical_url = p_canonical_url
       and job.recognition_run_mode = 'normal'
       and job.status = 'completed'
  );

  insert into public.share_jobs as job(
    user_id,
    source_url,
    canonical_url,
    source_platform,
    status,
    progress_stage,
    idempotency_key,
    billing_mode,
    billing_outcome,
    billing_settled_at,
    recognition_run_mode
  ) values (
    p_user_id,
    p_source_url,
    p_canonical_url,
    p_source_platform,
    case when not v_enforce or v_pro or v_prior_completed then 'queued' else 'awaiting_purchase' end,
    case when not v_enforce or v_pro or v_prior_completed then 'queued' else 'awaiting_purchase' end,
    p_idempotency_key,
    case
      when not v_enforce then 'normal_free'
      when p_is_anonymous then 'blocked_anonymous'
      when v_prior_completed then 'source_replay_free'
      when v_pro then 'pro'
      else 'metered'
    end,
    case
      when v_prior_completed then 'unmetered:previously_charged_source'
      when not v_enforce then 'unmetered:normal_free'
      else null
    end,
    case when v_prior_completed or not v_enforce then now() else null end,
    'normal'
  ) returning job.* into v_job;

  if v_enforce and p_is_anonymous then
    insert into public.place_find_onboarding_claims(anonymous_user_id, share_job_id)
    values (p_user_id, v_job.id)
    on conflict (anonymous_user_id) do nothing;
    get diagnostics v_claimed = row_count;

    if v_claimed = 1 then
      update public.share_jobs as job
         set status = 'queued',
             progress_stage = 'queued',
             billing_mode = 'onboarding_free'
       where job.id = v_job.id
      returning job.* into v_job;
    end if;
  elsif v_enforce and not v_pro and not v_prior_completed then
    begin
      perform * from public.reserve_place_find_use(p_user_id, v_job.id);
      update public.share_jobs as job
         set status = 'queued',
             progress_stage = 'queued'
       where job.id = v_job.id
      returning job.* into v_job;

      select wallet.available_uses
        into v_available
        from public.place_find_wallets as wallet
       where wallet.user_id = p_user_id;
    exception
      when raise_exception then
        if sqlerrm <> 'insufficient_place_finds' then
          raise;
        end if;
    end;
  elsif v_pro then
    insert into public.analytics_events(user_id, event_name, properties)
    values (
      p_user_id,
      'pro_video_find_authorized',
      jsonb_build_object('share_job_id', v_job.id)
    );
  elsif v_prior_completed then
    insert into public.analytics_events(user_id, event_name, properties)
    values (
      p_user_id,
      'video_find_source_replay_free',
      jsonb_build_object('share_job_id', v_job.id)
    );
  end if;

  if v_enforce and v_job.status = 'awaiting_purchase' then
    insert into public.analytics_events(user_id, event_name, properties)
    values (
      p_user_id,
      'token_zero_balance_exposed',
      jsonb_build_object('share_job_id', v_job.id, 'anonymous', p_is_anonymous)
    );
  end if;

  return query select
    v_job.id,
    v_job.status,
    false,
    v_job.status = 'awaiting_purchase',
    v_available;
end;
$$;

alter function public.create_share_job_for_user(
  uuid, text, text, text, text, integer, boolean, boolean, boolean
) owner to postgres;

revoke all on function public.create_share_job_for_user(
  uuid, text, text, text, text, integer, boolean, boolean, boolean
) from public, anon, authenticated;

grant execute on function public.create_share_job_for_user(
  uuid, text, text, text, text, integer, boolean, boolean, boolean
) to service_role;

comment on function public.create_share_job_for_user(
  uuid, text, text, text, text, integer, boolean, boolean, boolean
) is null;

notify pgrst, 'reload schema';
