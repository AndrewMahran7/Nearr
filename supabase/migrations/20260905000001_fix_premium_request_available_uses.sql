-- The Premium rewrite introduced an OUT parameter named available_uses. In
-- PL/pgSQL, unqualified table references to that name are ambiguous and made
-- both the normal-free creation RPC and the Premium Request RPC fail at runtime.
-- Reinstall the functions with qualified wallet reads. No data shape changes.

create or replace function public.create_share_job_for_user(
  p_user_id uuid,p_source_url text,p_canonical_url text,p_source_platform text,
  p_idempotency_key text default null,p_dedupe_window_seconds integer default 90,
  p_is_anonymous boolean default false,p_force_rerun boolean default false
)
returns table(job_id uuid,status text,duplicate boolean,requires_purchase boolean,available_uses integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing record; v_job public.share_jobs%rowtype; v_lock_key bigint; v_available integer:=0;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  v_lock_key:=hashtextextended(p_user_id::text||':'||coalesce(p_canonical_url,p_source_url,''),0);
  perform pg_advisory_xact_lock(v_lock_key);
  if not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id,false);
    select pfw.available_uses into v_available
      from public.place_find_wallets as pfw where pfw.user_id=p_user_id;
  end if;
  if nullif(trim(p_idempotency_key),'') is not null then
    select sj.* into v_existing from public.share_jobs sj
      where sj.user_id=p_user_id and sj.idempotency_key=p_idempotency_key limit 1;
    if found then return query select v_existing.id,v_existing.status,true,false,v_available; return; end if;
  end if;
  select sj.* into v_existing from public.share_jobs sj
    where sj.user_id=p_user_id and sj.canonical_url=p_canonical_url
      and sj.status in ('queued','processing_metadata')
      and sj.created_at>=now()-make_interval(secs=>greatest(p_dedupe_window_seconds,1))
    order by sj.created_at desc limit 1;
  if found then return query select v_existing.id,v_existing.status,true,false,v_available; return; end if;
  if not p_force_rerun then
    select sj.* into v_existing from public.share_jobs sj
      where sj.user_id=p_user_id and sj.canonical_url=p_canonical_url and sj.status='completed'
      order by sj.completed_at desc nulls last,sj.created_at desc limit 1;
    if found then return query select v_existing.id,v_existing.status,true,false,v_available; return; end if;
  end if;
  insert into public.share_jobs(
    user_id,source_url,canonical_url,source_platform,status,progress_stage,
    idempotency_key,billing_mode,billing_outcome,billing_settled_at
  ) values(
    p_user_id,p_source_url,p_canonical_url,p_source_platform,'queued','queued',
    p_idempotency_key,'normal_free','unmetered:normal_free',now()
  ) returning * into v_job;
  return query select v_job.id,v_job.status,false,false,v_available;
end;
$$;

create or replace function public.request_premium_recognition(p_user_id uuid,p_job_id uuid)
returns table(
  job_id uuid,premium_request_id uuid,premium_state text,available_uses integer,
  requires_purchase boolean,replayed boolean
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype; v_available integer:=0; v_request_id uuid; v_resuming boolean:=false;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  select sj.* into v_job from public.share_jobs as sj
    where sj.id=p_job_id and sj.user_id=p_user_id for update;
  if not found then raise exception 'premium_job_not_found'; end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  select pfw.available_uses into v_available
    from public.place_find_wallets as pfw where pfw.user_id=p_user_id;

  if v_job.premium_state in ('reserved','processing','useful_result','no_useful_result','failed','cancelled') then
    return query select v_job.id,v_job.premium_request_id,v_job.premium_state,v_available,false,true;
    return;
  end if;
  if v_job.premium_state not in ('eligible','awaiting_token') then raise exception 'premium_job_not_eligible'; end if;
  v_resuming:=v_job.premium_state='awaiting_token';

  v_request_id:=coalesce(v_job.premium_request_id,gen_random_uuid());
  update public.share_jobs set premium_request_id=v_request_id,
    premium_requested_at=coalesce(premium_requested_at,now()),updated_at=now()
    where id=v_job.id;

  begin
    perform * from public.reserve_place_find_use(p_user_id,p_job_id);
  exception when raise_exception then
    if sqlerrm<>'insufficient_place_finds' then raise; end if;
    update public.share_jobs set premium_state='awaiting_token',updated_at=now() where id=v_job.id;
    if v_job.premium_state<>'awaiting_token' then
      insert into public.analytics_events(user_id,event_name,properties) values(
        p_user_id,'premium_request_blocked_zero_balance',jsonb_build_object('share_job_id',p_job_id)
      );
    end if;
    return query select v_job.id,v_request_id,'awaiting_token'::text,v_available,true,false;
    return;
  end;

  insert into public.share_media_tasks(
    task_kind,premium_request_id,share_job_id,user_id,source_url,canonical_url,
    platform,status,progress_stage
  ) values(
    'premium_recognition',v_request_id,v_job.id,p_user_id,v_job.source_url,
    v_job.canonical_url,coalesce(v_job.source_platform,'unknown'),'queued','queued'
  ) on conflict do nothing;

  update public.share_jobs set status='processing_metadata',progress_stage='checking_video',
    decision=null,saved_place_id=null,candidate_payload=null,suggested_query=null,
    needs_help_reason=null,failure_reason=null,failure_category=null,failure_code=null,
    completed_at=null,billing_mode='premium_request',billing_outcome='pending_premium',
    billing_settled_at=null,premium_state='reserved',premium_settlement_reason=null,
    premium_result_chargeable=null,premium_cost_components=jsonb_build_object(
      'premium_recognition',jsonb_build_object('tokens',1,'model','gpt-5.6-sol')
    ),updated_at=now()
    where id=v_job.id returning * into v_job;
  select pfw.available_uses into v_available
    from public.place_find_wallets as pfw where pfw.user_id=p_user_id;
  insert into public.analytics_events(user_id,event_name,properties) values(
    p_user_id,'premium_request_reserved',jsonb_build_object('share_job_id',p_job_id,'token_cost',1)
  );
  if v_resuming then
    insert into public.analytics_events(user_id,event_name,properties) values(
      p_user_id,'premium_request_resumed_after_purchase',jsonb_build_object('share_job_id',p_job_id)
    );
  end if;
  return query select v_job.id,v_request_id,v_job.premium_state,v_available,false,false;
end;
$$;

revoke all on function public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean,boolean)
  from public,anon,authenticated;
revoke all on function public.request_premium_recognition(uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean,boolean)
  to service_role;
grant execute on function public.request_premium_recognition(uuid,uuid) to service_role;
