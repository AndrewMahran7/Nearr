-- Premium Requests: normal recognition is free; one token is reserved only
-- after an explicit, owner-authorized escalation of an eligible completed job.

set check_function_bodies = off;

-- Release reservations left by the previous per-share model before changing
-- active jobs to the free lane. The existing RPC is idempotent and ledgered.
do $$
declare v_job record;
begin
  for v_job in
    select share_job_id from public.place_find_reservations
    where status = 'reserved' and share_job_id is not null
  loop
    perform * from public.settle_place_find_use(
      v_job.share_job_id,
      'release',
      'premium_request_rollout_normal_free'
    );
  end loop;
end;
$$;

alter table public.share_jobs drop constraint if exists share_jobs_billing_mode_check;
alter table public.share_jobs add constraint share_jobs_billing_mode_check check (
  billing_mode in (
    'unmetered_legacy','onboarding_free','metered','blocked_anonymous',
    'normal_free','premium_request'
  )
);

alter table public.share_jobs
  add column if not exists premium_request_id uuid unique,
  add column if not exists premium_state text not null default 'not_eligible',
  add column if not exists premium_eligibility_reason text,
  add column if not exists premium_requested_at timestamptz,
  add column if not exists premium_started_at timestamptz,
  add column if not exists premium_completed_at timestamptz,
  add column if not exists premium_settlement_reason text,
  add column if not exists premium_result_chargeable boolean,
  add column if not exists premium_cost_components jsonb not null default '{}'::jsonb;

alter table public.share_jobs drop constraint if exists share_jobs_premium_state_check;
alter table public.share_jobs add constraint share_jobs_premium_state_check check (
  premium_state in (
    'not_eligible','eligible','awaiting_token','reserved','processing',
    'useful_result','no_useful_result','failed','cancelled'
  )
);
alter table public.share_jobs drop constraint if exists share_jobs_premium_cost_components_check;
alter table public.share_jobs add constraint share_jobs_premium_cost_components_check
  check (jsonb_typeof(premium_cost_components) = 'object');

-- Existing in-flight/out-of-balance submissions continue automatically for
-- free. Completed historical ledger entries remain immutable.
update public.share_jobs
set billing_mode = 'normal_free',
    status = case when status = 'awaiting_purchase' then 'queued' else status end,
    progress_stage = case when status = 'awaiting_purchase' then 'queued' else progress_stage end,
    billing_outcome = case
      when status in ('awaiting_purchase','queued','processing_metadata') then 'unmetered:normal_free'
      else billing_outcome
    end,
    billing_settled_at = case
      when status in ('awaiting_purchase','queued','processing_metadata') then coalesce(billing_settled_at, now())
      else billing_settled_at
    end,
    updated_at = now()
where billing_mode in ('metered','blocked_anonymous','onboarding_free')
  and status in ('awaiting_purchase','queued','processing_metadata');

-- Backfill only the narrow structured insufficient-result cohort. Anything
-- ambiguous stays NOT_ELIGIBLE and can never be promoted by presentation copy.
update public.share_jobs
set premium_state = 'eligible',
    premium_eligibility_reason = coalesce(nullif(failure_code,''), 'analysis_insufficient')
where status = 'needs_help'
  and analysis_attempted is true
  and (failure_category = 'analysis_insufficient' or failure_code in (
    'insufficient_evidence','no_result','no_trustworthy_place','recognition_recovery_exhausted'
  ))
  and saved_place_id is null
  and coalesce(jsonb_array_length(
    case when jsonb_typeof(candidate_payload->'candidates') = 'array'
      then candidate_payload->'candidates' else '[]'::jsonb end
  ), 0) = 0;

-- A second task represents the one durable Premium obligation on the same
-- original job; the normal recognition task remains immutable history.
alter table public.share_media_tasks
  add column if not exists premium_request_id uuid references public.share_jobs(premium_request_id) on delete cascade;

alter table public.share_media_tasks drop constraint if exists share_media_tasks_task_kind_check;
alter table public.share_media_tasks add constraint share_media_tasks_task_kind_check
  check (task_kind in ('recognition','premium_recognition','ai_note_enrichment'));
alter table public.share_media_tasks drop constraint if exists share_media_tasks_target_check;
alter table public.share_media_tasks add constraint share_media_tasks_target_check check (
  (task_kind in ('recognition','premium_recognition') and share_job_id is not null and saved_place_id is null and target_place_id is null)
  or
  (task_kind = 'ai_note_enrichment' and share_job_id is null and saved_place_id is not null and target_place_id is not null)
);
alter table public.share_media_tasks drop constraint if exists share_media_tasks_premium_identity_check;
alter table public.share_media_tasks add constraint share_media_tasks_premium_identity_check check (
  (task_kind = 'premium_recognition' and premium_request_id is not null)
  or (task_kind <> 'premium_recognition' and premium_request_id is null)
);
create unique index if not exists share_media_tasks_premium_request_uidx
  on public.share_media_tasks(premium_request_id) where task_kind = 'premium_recognition';
create unique index if not exists share_media_tasks_premium_job_uidx
  on public.share_media_tasks(share_job_id) where task_kind = 'premium_recognition';

create or replace function public.share_media_tasks_enforce_owner()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_owner uuid; v_target uuid; v_premium_id uuid;
begin
  if new.task_kind in ('recognition','premium_recognition') then
    select sj.user_id,sj.premium_request_id into v_owner,v_premium_id
      from public.share_jobs sj where sj.id=new.share_job_id;
    if v_owner is null then raise exception 'share_media_tasks: parent share_job % not found',new.share_job_id; end if;
    if new.task_kind='premium_recognition' and new.premium_request_id is distinct from v_premium_id then
      raise exception 'share_media_tasks: premium request identity mismatch';
    end if;
  elsif new.task_kind='ai_note_enrichment' then
    select sp.user_id,sp.place_id into v_owner,v_target from public.saved_places sp where sp.id=new.saved_place_id;
    if v_owner is null then raise exception 'share_media_tasks: saved_place % not found',new.saved_place_id; end if;
    if new.target_place_id is distinct from v_target then raise exception 'share_media_tasks: target mismatch'; end if;
  else
    raise exception 'share_media_tasks: invalid task_kind %',new.task_kind;
  end if;
  if new.user_id is distinct from v_owner then raise exception 'share_media_tasks: owner mismatch'; end if;
  return new;
end;
$$;

-- New shares always enter the free lane, even at zero balance. Wallet creation
-- remains here solely to preserve the one-time five-token grant contract.
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

-- Service-role only. The Edge function derives p_user_id from a verified JWT.
-- Row + wallet locks make concurrent taps and purchase-resume calls idempotent.
create or replace function public.request_premium_recognition(p_user_id uuid,p_job_id uuid)
returns table(
  job_id uuid,premium_request_id uuid,premium_state text,available_uses integer,
  requires_purchase boolean,replayed boolean
)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype; v_available integer:=0; v_request_id uuid; v_resuming boolean:=false;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=p_user_id for update;
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

create or replace function public.settle_premium_request(
  p_share_job_id uuid,p_action text,p_reason_code text,p_terminal_state text,
  p_chargeable boolean,p_cost_components jsonb default '{}'::jsonb
)
returns table(reservation_id uuid,status text,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype; v_result record; v_event text;
begin
  if p_action not in ('consume','release') then raise exception 'invalid_settlement_action'; end if;
  if p_terminal_state not in ('useful_result','no_useful_result','failed','cancelled') then
    raise exception 'invalid_premium_terminal_state';
  end if;
  if p_chargeable is distinct from (p_action='consume') then raise exception 'premium_chargeability_mismatch'; end if;
  select * into v_job from public.share_jobs where id=p_share_job_id for update;
  if not found or v_job.billing_mode<>'premium_request' or v_job.premium_request_id is null then
    raise exception 'premium_obligation_not_found';
  end if;
  if v_job.premium_state in ('useful_result','no_useful_result','failed','cancelled') then
    select r.id,r.status,true into v_result from public.place_find_reservations r where r.share_job_id=p_share_job_id;
    return query select v_result.id,v_result.status,true; return;
  end if;
  select * into v_result from public.settle_place_find_use(p_share_job_id,p_action,p_reason_code);
  update public.share_jobs set premium_state=p_terminal_state,premium_completed_at=now(),
    premium_settlement_reason=p_reason_code,premium_result_chargeable=p_chargeable,
    premium_cost_components=premium_cost_components||coalesce(p_cost_components,'{}'::jsonb),
    updated_at=now() where id=p_share_job_id;
  v_event:=case when p_action='consume' then 'premium_request_token_consumed' else 'premium_request_token_released' end;
  insert into public.analytics_events(user_id,event_name,properties) values(
    v_job.user_id,v_event,jsonb_build_object('share_job_id',p_share_job_id,'reason',p_reason_code)
  );
  insert into public.analytics_events(user_id,event_name,properties) values(
    v_job.user_id,case when p_chargeable then 'premium_request_useful_result' else 'premium_request_no_useful_result' end,jsonb_build_object(
      'share_job_id',p_share_job_id,'result_state',p_terminal_state,'chargeable',p_chargeable
    )
  );
  return query select v_result.reservation_id,v_result.status,false;
end;
$$;

-- Recognition claim eligibility now includes the explicit Premium task. Its
-- state transition is synchronized by the trigger immediately below.
create or replace function public.claim_media_tasks(
  p_limit integer default 2,p_lock_seconds integer default 600
)
returns setof public.share_media_tasks language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query update public.share_media_tasks mt set
    status='processing',attempts=mt.attempts+1,locked_at=now(),
    locked_until=now()+make_interval(secs=>greatest(p_lock_seconds,60)),
    progress_stage=coalesce(mt.progress_stage,'queued'),updated_at=now()
  where mt.id in (
    select c.id from public.share_media_tasks c
    where c.attempts<c.max_attempts and (c.next_attempt_at is null or c.next_attempt_at<=now())
      and (c.status='queued' or (c.status='processing' and c.locked_until is not null and c.locked_until<now()))
      and (
        (c.task_kind in ('recognition','premium_recognition') and exists(
          select 1 from public.share_jobs sj where sj.id=c.share_job_id and (
            sj.status='processing_metadata' or
            (c.task_kind='recognition' and sj.status='completed' and sj.saved_place_id is not null)
          )
        )) or
        (c.task_kind='ai_note_enrichment' and exists(
          select 1 from public.saved_places sp where sp.id=c.saved_place_id
            and sp.user_id=c.user_id and sp.place_id=c.target_place_id
            and sp.source_url=coalesce(c.canonical_url,c.source_url)
            and public.is_video_derived_saved_place(sp.source_type,sp.source_url)
            and coalesce(length(trim(sp.ai_note)),0)=0
        ))
      )
    order by c.created_at for update skip locked limit greatest(p_limit,1)
  ) returning mt.*;
end;
$$;

create or replace function public.sync_premium_media_task_state()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_changed integer;
begin
  if new.task_kind='premium_recognition' and new.status='processing' and old.status is distinct from new.status then
    update public.share_jobs set premium_state='processing',premium_started_at=coalesce(premium_started_at,now()),updated_at=now()
      where id=new.share_job_id and premium_request_id=new.premium_request_id and premium_state='reserved';
    get diagnostics v_changed=row_count;
    if v_changed>0 then
      insert into public.analytics_events(user_id,event_name,properties) values(
        new.user_id,'premium_request_started',jsonb_build_object('share_job_id',new.share_job_id)
      );
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists share_media_tasks_sync_premium_state on public.share_media_tasks;
create trigger share_media_tasks_sync_premium_state after update of status on public.share_media_tasks
  for each row execute function public.sync_premium_media_task_state();

create or replace function public.claim_stranded_media_parents(p_limit integer default 25)
returns setof public.share_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  return query select sj.* from public.share_jobs sj
  where sj.status='processing_metadata' and exists(
    select 1 from public.share_media_tasks mt where mt.share_job_id=sj.id
      and mt.task_kind=case when sj.billing_mode='premium_request' then 'premium_recognition' else 'recognition' end
      and mt.status in ('failed','cancelled')
  ) order by sj.updated_at for update skip locked limit greatest(p_limit,1);
end;
$$;

create or replace function public.cancel_share_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if not found or v_job.status not in ('awaiting_purchase','queued','processing_metadata') then return false; end if;
  update public.share_jobs set status='cancelled',completed_at=now(),updated_at=now() where id=p_job_id;
  if v_job.billing_mode='premium_request' then
    perform * from public.settle_premium_request(p_job_id,'release','premium_cancelled','cancelled',false,'{}'::jsonb);
  else
    perform * from public.settle_place_find_use(p_job_id,'release','user_cancelled_before_result');
  end if;
  return true;
end;
$$;

-- Normal free retries never reserve. A terminal Premium obligation is final;
-- transport retries happen within its durable media task before settlement.
create or replace function public.retry_share_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if not found or v_job.saved_place_id is not null or v_job.status<>'failed' or v_job.billing_mode='premium_request' then return false; end if;
  update public.share_jobs set status='queued',progress_stage='queued',attempts=0,
    locked_until=null,last_error=null,failure_reason=null,completed_at=null,
    billing_mode=case when billing_mode='metered' then 'normal_free' else billing_mode end,
    billing_outcome='unmetered:normal_free_retry',billing_settled_at=now(),updated_at=now()
    where id=p_job_id;
  return true;
end;
$$;

-- Dev pack identifiers stay stable while quantities and prices move together.
update public.place_find_products set use_count=10,mock_display_price='$7.99',mock_price_cents=799,updated_at=now()
  where product_id='dev.mock.nearr.place_finds.10';
update public.place_find_products set use_count=30,mock_display_price='$20.99',mock_price_cents=2099,updated_at=now()
  where product_id='dev.mock.nearr.place_finds.25';
update public.place_find_products set use_count=75,mock_display_price='$44.99',mock_price_cents=4499,updated_at=now()
  where product_id='dev.mock.nearr.place_finds.50';

revoke all on function public.request_premium_recognition(uuid,uuid) from public,anon,authenticated;
revoke all on function public.settle_premium_request(uuid,text,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.request_premium_recognition(uuid,uuid) to service_role;
grant execute on function public.settle_premium_request(uuid,text,text,text,boolean,jsonb) to service_role;
revoke all on function public.claim_media_tasks(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_media_tasks(integer,integer) to service_role;
revoke all on function public.claim_stranded_media_parents(integer) from public,anon,authenticated;
grant execute on function public.claim_stranded_media_parents(integer) to service_role;
grant execute on function public.cancel_share_job(uuid),public.retry_share_job(uuid) to authenticated;
