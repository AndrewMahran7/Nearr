-- Independent, disabled-by-default Plus experiment. Never reactivates tokens,
-- changes historic balances, deletes saves, or creates held purchase jobs.
set check_function_bodies = off;

create table public.nearr_plus_config (
  id boolean primary key default true check (id),
  sales_enabled boolean not null default false,
  enforce_allowance boolean not null default false,
  release_qualified boolean not null default false,
  catalog_verified boolean not null default false,
  environment text not null default 'SANDBOX' check (environment in ('SANDBOX','PRODUCTION')),
  product_id text not null default 'nearr_plus_monthly_v1',
  entitlement_id text not null default 'nearr_plus',
  offering_id text not null default 'nearr_plus_v1',
  revenuecat_app_id text,
  free_finds integer not null default 3 check (free_finds between 1 and 100),
  plus_finds integer not null default 10 check (plus_finds between 1 and 1000),
  check (plus_finds > free_finds),
  check (not (sales_enabled or enforce_allowance) or
    (release_qualified and catalog_verified and revenuecat_app_id is not null))
);
insert into public.nearr_plus_config(id) values(true);

create table public.nearr_plus_customers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  app_user_id text not null unique default ('np_' || gen_random_uuid()::text),
  created_at timestamptz not null default now(),
  check (app_user_id ~ '^np_[0-9a-f-]{36}$')
);
create table public.nearr_plus_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state text not null check (state in ('free','active','trial','intro','grace','cancelled','expired','revoked')),
  product_id text,
  period_start timestamptz,
  expires_at timestamptz,
  access_until timestamptz,
  period_key text,
  verified_at timestamptz not null,
  environment text not null check (environment in ('SANDBOX','PRODUCTION')),
  updated_at timestamptz not null default now()
);
create table public.nearr_plus_webhook_events (
  event_id text primary key check (length(event_id) between 1 and 200),
  event_type text not null check (length(event_type) between 1 and 80),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  processed_at timestamptz not null default now()
);
create table public.nearr_plus_recognitions (
  job_id uuid primary key references public.share_jobs(id) on delete cascade deferrable initially deferred,
  user_id uuid not null references auth.users(id) on delete cascade,
  state text not null check (state in ('reserved','consumed','released')),
  period_key text,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  check ((state='reserved') = (settled_at is null))
);
create index nearr_plus_recognitions_usage on public.nearr_plus_recognitions(user_id,reserved_at);
-- Only coarse opted-in adult funnel events. No content, location, prices,
-- identities from outside Nearr, advertising identifiers or SDK attributes.
create table public.nearr_plus_funnel_events (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  event_name text not null check (event_name in ('offering_seen','product_displayed','purchase_initiated','purchase_cancelled','restore_completed')),
  created_at timestamptz not null default now()
);

alter table public.nearr_plus_config enable row level security;
alter table public.nearr_plus_customers enable row level security;
alter table public.nearr_plus_entitlements enable row level security;
alter table public.nearr_plus_webhook_events enable row level security;
alter table public.nearr_plus_recognitions enable row level security;
alter table public.nearr_plus_funnel_events enable row level security;
revoke all on public.nearr_plus_config,public.nearr_plus_customers,public.nearr_plus_entitlements,
  public.nearr_plus_webhook_events,public.nearr_plus_recognitions,public.nearr_plus_funnel_events
  from public,anon,authenticated;
grant all on public.nearr_plus_config,public.nearr_plus_customers,public.nearr_plus_entitlements,
  public.nearr_plus_webhook_events,public.nearr_plus_recognitions,public.nearr_plus_funnel_events to service_role;

create function public.apply_nearr_plus_snapshot(p_user_id uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.nearr_plus_config%rowtype; v_verified timestamptz; v_written integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus:'||p_user_id::text,0));
  select * into strict v_cfg from public.nearr_plus_config where id;
  if not exists(select 1 from public.nearr_plus_customers where user_id=p_user_id) then
    raise exception 'plus_customer_not_found'; end if;
  v_verified := (p_snapshot->>'verifiedAt')::timestamptz;
  if v_verified is null or v_verified > now()+interval '1 minute' or v_verified < now()-interval '15 minutes'
     or p_snapshot->>'environment' is distinct from v_cfg.environment
     or ((p_snapshot->>'state') <> 'free' and p_snapshot->>'productId' is distinct from v_cfg.product_id)
     or ((p_snapshot->>'state') in ('active','trial','intro','grace','cancelled') and
       ((p_snapshot->>'periodStart') is null or (p_snapshot->>'expiresAt') is null or (p_snapshot->>'accessUntil') is null
         or (p_snapshot->>'periodKey') is null)) then
    raise exception 'plus_snapshot_invalid'; end if;
  insert into public.nearr_plus_entitlements(user_id,state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key)
  values(p_user_id,p_snapshot->>'state',p_snapshot->>'productId',(p_snapshot->>'periodStart')::timestamptz,
    (p_snapshot->>'expiresAt')::timestamptz,(p_snapshot->>'accessUntil')::timestamptz,v_verified,v_cfg.environment,p_snapshot->>'periodKey')
  on conflict(user_id) do update set state=excluded.state,product_id=excluded.product_id,
    period_start=excluded.period_start,expires_at=excluded.expires_at,access_until=excluded.access_until,
    verified_at=excluded.verified_at,environment=excluded.environment,period_key=excluded.period_key,updated_at=now()
  where public.nearr_plus_entitlements.verified_at < excluded.verified_at
    or (public.nearr_plus_entitlements.verified_at = excluded.verified_at
      and excluded.state in ('free','expired','revoked')
      and public.nearr_plus_entitlements.state <> 'revoked');
  get diagnostics v_written = row_count;
  if v_written>0 and p_snapshot->>'state' in ('active','trial','intro','grace','cancelled') then
    perform pg_advisory_xact_lock(hashtextextended('nearr_plus_period:'||(p_snapshot->>'periodKey'),0));
    -- The first paid period includes free finds already used this UTC month.
    -- Keep the original ledger and assign only previously unassigned free use;
    -- renewals and cross-account restores never erase or multiply that usage.
    update public.nearr_plus_recognitions set period_key=p_snapshot->>'periodKey'
      where user_id=p_user_id and period_key is null
        and reserved_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  end if;
end $$;

-- The receipt event and every transfer-side refresh commit together. A failed
-- API read occurs before this RPC; a failed write rolls back event dedup too.
create function public.apply_nearr_plus_webhook(p_event_id text,p_event_type text,p_payload_sha256 text,p_snapshots jsonb)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_hash text; v_snapshot jsonb; v_inserted integer;
begin
  if jsonb_typeof(p_snapshots) is distinct from 'array' or jsonb_array_length(p_snapshots)>50 then
    raise exception 'plus_snapshots_invalid'; end if;
  insert into public.nearr_plus_webhook_events(event_id,event_type,payload_sha256)
  values(p_event_id,p_event_type,p_payload_sha256) on conflict(event_id) do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted=0 then
    select payload_sha256 into v_hash from public.nearr_plus_webhook_events where event_id=p_event_id;
    if v_hash is distinct from p_payload_sha256 then raise exception 'plus_event_collision'; end if;
    return false;
  end if;
  for v_snapshot in select value from jsonb_array_elements(p_snapshots) order by value->>'userId' loop
    perform public.apply_nearr_plus_snapshot((v_snapshot->>'userId')::uuid,v_snapshot->'snapshot');
  end loop;
  return true;
end $$;

create function public.nearr_plus_usage(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.nearr_plus_config%rowtype; v_ent public.nearr_plus_entitlements%rowtype;
  v_start timestamptz; v_limit integer; v_used integer; v_reserved integer; v_paid boolean; v_stale boolean;
begin
  select * into strict v_cfg from public.nearr_plus_config where id;
  select * into v_ent from public.nearr_plus_entitlements where user_id=p_user_id;
  v_paid:=coalesce(v_ent.state in ('active','trial','intro','grace','cancelled') and v_ent.access_until>now()
    and v_ent.environment=v_cfg.environment and v_ent.product_id=v_cfg.product_id,false);
  v_stale:=v_paid and v_ent.verified_at<now()-interval '15 minutes';
  v_start:=case when v_paid then v_ent.period_start else date_trunc('month',now() at time zone 'UTC') at time zone 'UTC' end;
  v_limit:=case when v_paid then v_cfg.plus_finds else v_cfg.free_finds end;
  select count(*) filter(where state='consumed'),count(*) filter(where state='reserved')
    into v_used,v_reserved from public.nearr_plus_recognitions
    where (user_id=p_user_id and reserved_at>=v_start) or (v_paid and period_key=v_ent.period_key);
  return jsonb_build_object('limit',v_limit,'used',v_used,'reserved',v_reserved,'remaining',greatest(0,v_limit-v_used-v_reserved),
    'periodStart',v_start,'paid',v_paid and not v_stale,'verificationRequired',v_stale,'enforced',v_cfg.enforce_allowance);
end $$;

create function public.reserve_nearr_plus_recognition(p_user_id uuid,p_job_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_usage jsonb; v_existing public.nearr_plus_recognitions%rowtype; v_period_key text;
begin
  if not exists(select 1 from public.nearr_plus_config where id and enforce_allowance) then return; end if;
  -- AI permission is separate from financial entitlement. Buying cannot bypass it.
  if not public.is_account_eligible_for_ai(p_user_id) then raise exception 'plus_recognition_ineligible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus:'||p_user_id::text,0));
  select period_key into v_period_key from public.nearr_plus_entitlements where user_id=p_user_id
    and state in ('active','trial','intro','grace','cancelled') and access_until>now();
  -- One store renewal has one allowance even after a cross-account restore.
  if v_period_key is not null then perform pg_advisory_xact_lock(hashtextextended('nearr_plus_period:'||v_period_key,0)); end if;
  select * into v_existing from public.nearr_plus_recognitions where job_id=p_job_id;
  if found then
    if v_existing.user_id<>p_user_id then raise exception 'plus_owner_mismatch'; end if;
    if v_existing.state in ('reserved','consumed') then return; end if;
  end if;
  -- Expired review reservations never re-dispatch recognition. Late confirmation
  -- may consume the existing result, and will count against future requests.
  update public.nearr_plus_recognitions set state='released',settled_at=now()
    where user_id=p_user_id and state='reserved' and reserved_at<now()-interval '7 days'
    and exists(select 1 from public.share_jobs j where j.id=job_id and j.status in ('needs_help','completed','failed','cancelled'));
  v_usage:=public.nearr_plus_usage(p_user_id);
  if (v_usage->>'verificationRequired')::boolean then raise exception 'plus_verification_required'; end if;
  if (v_usage->>'remaining')::integer<=0 then raise exception 'plus_allowance_exhausted'; end if;
  insert into public.nearr_plus_recognitions(job_id,user_id,state,period_key) values(p_job_id,p_user_id,'reserved',v_period_key)
  on conflict(job_id) do update set state='reserved',reserved_at=now(),settled_at=null,period_key=excluded.period_key;
end $$;

create function public.nearr_plus_reserve_job_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if tg_op='INSERT' or (old.status in ('failed','cancelled','needs_help','completed') and new.status='queued') then
    perform public.reserve_nearr_plus_recognition(new.user_id,new.id);
  end if;
  return new;
end $$;
-- AFTER INSERT runs inside the enqueue transaction and avoids orphan quota
-- reservations when an INSERT ON CONFLICT resolves to an existing job.
create trigger nearr_plus_reserve_job after insert or update of status on public.share_jobs
for each row execute function public.nearr_plus_reserve_job_trigger();

create function public.settle_nearr_plus_recognition(p_job_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype; v_success boolean;
begin
  select * into v_job from public.share_jobs where id=p_job_id;
  if not found or not exists(select 1 from public.nearr_plus_recognitions where job_id=p_job_id) then return; end if;
  -- Never trust an SDK success bit, a candidate label, or a foreign saved place.
  v_success:=exists(select 1 from public.saved_places s where s.id=v_job.saved_place_id and s.user_id=v_job.user_id)
    or exists(select 1 from public.share_job_place_results r join public.saved_places s on s.id=r.saved_place_id
      where r.share_job_id=p_job_id and r.user_id=v_job.user_id and s.user_id=v_job.user_id
      and r.outcome in ('auto_saved','already_saved'));
  if v_success then
    update public.nearr_plus_recognitions set state='consumed',settled_at=now() where job_id=p_job_id and state<>'consumed';
  elsif v_job.status in ('failed','cancelled') or
      (v_job.status in ('completed','needs_help') and coalesce(v_job.decision,'') not in ('candidate_confirmation','candidate_picker','multi_candidate_confirmation')) then
    update public.nearr_plus_recognitions set state='released',settled_at=now() where job_id=p_job_id and state='reserved';
  end if;
end $$;
create function public.nearr_plus_settle_job_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.settle_nearr_plus_recognition(new.id); return new; end $$;
create trigger nearr_plus_settle_job after update of status,saved_place_id,decision on public.share_jobs
for each row execute function public.nearr_plus_settle_job_trigger();
create function public.nearr_plus_settle_result_trigger()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin perform public.settle_nearr_plus_recognition(new.share_job_id); return new; end $$;
create trigger nearr_plus_settle_result after insert or update of saved_place_id,outcome on public.share_job_place_results
for each row execute function public.nearr_plus_settle_result_trigger();

revoke all on function public.apply_nearr_plus_snapshot(uuid,jsonb),public.apply_nearr_plus_webhook(text,text,text,jsonb),
  public.nearr_plus_usage(uuid),public.reserve_nearr_plus_recognition(uuid,uuid),public.settle_nearr_plus_recognition(uuid),
  public.nearr_plus_reserve_job_trigger(),public.nearr_plus_settle_job_trigger(),public.nearr_plus_settle_result_trigger()
  from public,anon,authenticated;
grant execute on function public.apply_nearr_plus_snapshot(uuid,jsonb),public.apply_nearr_plus_webhook(text,text,text,jsonb),
  public.nearr_plus_usage(uuid),public.reserve_nearr_plus_recognition(uuid,uuid),public.settle_nearr_plus_recognition(uuid)
  to service_role;
