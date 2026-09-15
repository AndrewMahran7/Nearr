-- Nearr Token Monetization V1 (Nearr-Dev rollout definition; replayed after current main).
-- PostgreSQL is the only balance/spend authority. RevenueCat verifies store
-- purchases and delivers fulfillment events; RevenueCat In-App Currency is
-- deliberately not associated with these products to avoid a second wallet.

set check_function_bodies = off;

-- This cutoff is DEV-ONLY. It must not be copied to a future Production
-- rollout. The feature stays disabled until both this row and the verified
-- Nearr-Dev Edge secret opt in.
create table if not exists public.token_monetization_config (
  environment_name text primary key check (environment_name in ('development')),
  enabled boolean not null default false,
  rollout_cutoff timestamptz not null,
  monthly_allowance_start_month date not null,
  revenuecat_project_id text,
  revenuecat_app_id text,
  revenuecat_allowed_stores text[] not null default array['TEST_STORE']::text[],
  updated_at timestamptz not null default now()
);
alter table public.token_monetization_config add column if not exists
  revenuecat_allowed_stores text[] not null default array['TEST_STORE']::text[];
insert into public.token_monetization_config(
  environment_name, enabled, rollout_cutoff, monthly_allowance_start_month
) values ('development', false, '2026-09-06 00:00:00+00', '2026-10-01')
on conflict (environment_name) do nothing;

update public.place_find_products set active=false where product_kind='dev_mock';
insert into public.place_find_products(
  product_id,use_count,product_kind,sort_order,active
) values
  ('com.nearr.tokens.20.v1',20,'storekit_consumable',10,true),
  ('com.nearr.tokens.50.v1',50,'storekit_consumable',20,true),
  ('com.nearr.tokens.100.v1',100,'storekit_consumable',30,true)
on conflict (product_id) do nothing;

alter table public.place_find_lots drop constraint if exists place_find_lots_source_kind_check;
alter table public.place_find_lots add constraint place_find_lots_source_kind_check check (
  source_kind in (
    'free_lifetime','beta_grant','welcome_grant','monthly_allowance',
    'dev_mock_purchase','storekit_purchase','revenuecat_purchase',
    'credit_back','admin_adjustment'
  )
);
alter table public.place_find_reservations
  add column if not exists source_identity text;
update public.place_find_reservations r
   set source_identity=coalesce(nullif(j.canonical_url,''),'job:'||r.share_job_id::text)
  from public.share_jobs j
 where r.share_job_id=j.id and r.source_identity is null;
-- Historical retries can legitimately leave several settled rows for one
-- canonical source, so this is intentionally not a unique migration-time
-- constraint. Creation is serialized by the canonical advisory lock and the
-- existing share_job_id uniqueness protects each live reservation.
create index if not exists place_find_reservation_source_idx
  on public.place_find_reservations(wallet_id,source_identity,updated_at desc)
  where source_identity is not null;

alter table public.place_find_ledger drop constraint if exists place_find_ledger_entry_type_check;
alter table public.place_find_ledger add constraint place_find_ledger_entry_type_check check (
  entry_type in (
    'free_grant','monthly_grant','dev_mock_purchase','storekit_purchase',
    'revenuecat_purchase','reserve','consume','release','expire',
    'refund_revoke','refund_reversal','credit_back','admin_adjustment'
  )
);

alter table public.place_find_purchase_transactions
  add column if not exists revenuecat_event_id text,
  add column if not exists store text,
  add column if not exists refunded_at timestamptz;

create table if not exists public.token_qualifying_save_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  activity_key text not null unique,
  activity_kind text not null check (activity_kind in ('manual','video')),
  saved_place_id uuid references public.saved_places(id) on delete set null,
  share_job_id uuid references public.share_jobs(id) on delete set null,
  occurred_at timestamptz not null,
  activity_month date generated always as
    ((date_trunc('month', occurred_at at time zone 'UTC'))::date) stored,
  evidence_kind text not null default 'live' check (evidence_kind in ('live','historical_reconstruction')),
  created_at timestamptz not null default now()
);
create index if not exists token_qualifying_save_user_month_idx
  on public.token_qualifying_save_events(user_id,activity_month);

create table if not exists public.revenuecat_webhook_events (
  event_id text primary key,
  event_type text not null,
  project_id text not null,
  app_id text not null,
  purchase_environment text,
  app_user_id text,
  product_id text,
  transaction_id text,
  payload_sha256 text not null,
  result_code text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create index if not exists revenuecat_webhook_transaction_idx
  on public.revenuecat_webhook_events(transaction_id,received_at);

alter table public.token_monetization_config enable row level security;
alter table public.token_qualifying_save_events enable row level security;
alter table public.revenuecat_webhook_events enable row level security;
revoke all on public.token_monetization_config,public.token_qualifying_save_events,
  public.revenuecat_webhook_events from public,anon,authenticated;
grant select,insert,update,delete on public.token_monetization_config,
  public.token_qualifying_save_events,public.revenuecat_webhook_events to service_role;
grant select on public.token_qualifying_save_events to authenticated;
drop policy if exists token_activity_owner_read on public.token_qualifying_save_events;
create policy token_activity_owner_read on public.token_qualifying_save_events
  for select to authenticated using(user_id=auth.uid());

create or replace function public.grant_place_find_lot(
  p_wallet_id uuid,p_source_kind text,p_source_reference text,p_uses integer,
  p_expires_at timestamptz default null,p_reason_code text default null
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot_id uuid;
begin
  if p_uses<1 then raise exception 'invalid_grant_amount'; end if;
  insert into public.place_find_lots(
    wallet_id,source_kind,source_reference,granted_uses,available_uses,expires_at
  ) values(p_wallet_id,p_source_kind,p_source_reference,p_uses,p_uses,p_expires_at)
  on conflict(wallet_id,source_kind,source_reference) do nothing returning id into v_lot_id;
  if v_lot_id is null then return false; end if;
  update public.place_find_wallets w set available_uses=w.available_uses+p_uses,
    version=w.version+1,updated_at=now() where w.id=p_wallet_id;
  insert into public.place_find_ledger(
    wallet_id,lot_id,entry_type,available_delta,reason_code,idempotency_key
  ) values(
    p_wallet_id,v_lot_id,
    case when p_source_kind='monthly_allowance' then 'monthly_grant'
         when p_source_kind='revenuecat_purchase' then 'revenuecat_purchase'
         when p_source_kind='credit_back' then 'credit_back' else 'free_grant' end,
    p_uses,coalesce(p_reason_code,p_source_kind),
    'grant:'||p_source_kind||':'||p_wallet_id::text||':'||p_source_reference
  );
  return true;
end;
$$;

create or replace function public.expire_place_find_lots(p_wallet_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot record; v_total integer:=0;
begin
  for v_lot in select id,available_uses,source_reference from public.place_find_lots
    where wallet_id=p_wallet_id and source_kind='monthly_allowance'
      and available_uses>0 and expires_at<=now() for update
  loop
    update public.place_find_lots l set revoked_uses=l.revoked_uses+v_lot.available_uses,
      available_uses=0 where l.id=v_lot.id;
    update public.place_find_wallets w set available_uses=w.available_uses-v_lot.available_uses,
      version=w.version+1,updated_at=now() where w.id=p_wallet_id;
    insert into public.place_find_ledger(
      wallet_id,lot_id,entry_type,available_delta,reason_code,idempotency_key
    ) values(p_wallet_id,v_lot.id,'expire',-v_lot.available_uses,'monthly_end',
      'expire:'||v_lot.id::text) on conflict(idempotency_key) do nothing;
    v_total:=v_total+v_lot.available_uses;
  end loop;
  return v_total;
end;
$$;

create or replace function public.ensure_place_find_wallet(
  p_user_id uuid,p_is_anonymous boolean default false
) returns table(
  wallet_id uuid,available_uses integer,reserved_uses integer,
  app_account_token uuid,granted_free boolean
) language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.place_find_wallets%rowtype; v_user_created timestamptz;
  v_cfg public.token_monetization_config%rowtype; v_granted boolean:=false;
  v_month date; v_previous date; v_expiry timestamptz;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  insert into public.place_find_wallets(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_wallet from public.place_find_wallets
    where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'active_wallet_not_found'; end if;
  perform public.expire_place_find_lots(v_wallet.id);
  select * into v_cfg from public.token_monetization_config where environment_name='development';
  if coalesce(v_cfg.enabled,false) and not p_is_anonymous then
    select created_at into v_user_created from auth.users where id=p_user_id;
    -- An anonymous onboarding identity upgraded in place is a new account for
    -- grant purposes. Use the authoritative conversion timestamp when that
    -- newer onboarding schema is present, without coupling clean older DBs to it.
    if to_regclass('public.onboarding_v2_sessions') is not null then
      execute 'select greatest($2,coalesce(max(s.upgraded_at),$2)) from public.onboarding_v2_sessions s where s.permanent_user_id=$1'
        into v_user_created using p_user_id,v_user_created;
    end if;
    if v_user_created<v_cfg.rollout_cutoff then
      v_granted:=public.grant_place_find_lot(v_wallet.id,'beta_grant','beta_v1',10,null,'beta_v1') or v_granted;
    else
      v_granted:=public.grant_place_find_lot(v_wallet.id,'welcome_grant','welcome_v1',5,null,'welcome_v1') or v_granted;
    end if;
    v_month:=(date_trunc('month',now() at time zone 'UTC'))::date;
    v_previous:=(v_month-interval '1 month')::date;
    v_expiry:=((v_month+interval '1 month')::timestamp at time zone 'UTC');
    if v_month>=v_cfg.monthly_allowance_start_month and exists(
      select 1 from public.token_qualifying_save_events e
       where e.user_id=p_user_id and e.activity_month=v_previous
    ) then
      v_granted:=public.grant_place_find_lot(
        v_wallet.id,'monthly_allowance',to_char(v_month,'YYYY-MM'),3,v_expiry,'monthly_active_saver'
      ) or v_granted;
    end if;
  end if;
  select * into v_wallet from public.place_find_wallets where id=v_wallet.id;
  return query select v_wallet.id,v_wallet.available_uses,v_wallet.reserved_uses,
    v_wallet.app_account_token,v_granted;
end;
$$;

create or replace function public.reserve_place_find_use(p_user_id uuid,p_share_job_id uuid)
returns table(reservation_id uuid,available_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.place_find_wallets%rowtype; v_lot public.place_find_lots%rowtype;
  v_res public.place_find_reservations%rowtype; v_job public.share_jobs%rowtype;
  v_cycle integer; v_identity text;
begin
  select * into v_job from public.share_jobs where id=p_share_job_id and user_id=p_user_id for update;
  if not found then raise exception 'share_job_owner_mismatch'; end if;
  v_identity:=coalesce(nullif(v_job.canonical_url,''),'job:'||v_job.id::text);
  select * into v_wallet from public.place_find_wallets
    where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'wallet_not_found'; end if;
  perform public.expire_place_find_lots(v_wallet.id);
  select * into v_wallet from public.place_find_wallets where id=v_wallet.id for update;
  select * into v_res from public.place_find_reservations
    where wallet_id=v_wallet.id and source_identity=v_identity
    order by case status when 'reserved' then 1 when 'consumed' then 2 else 3 end,
      updated_at desc limit 1 for update;
  if found and v_res.status in ('reserved','consumed') then
    return query select v_res.id,v_wallet.available_uses,true; return;
  end if;
  if v_wallet.available_uses<1 then raise exception 'insufficient_place_finds'; end if;
  select l.* into v_lot from public.place_find_lots l
    where l.wallet_id=v_wallet.id and l.available_uses>0 and (l.expires_at is null or l.expires_at>now())
    order by case l.source_kind when 'monthly_allowance' then 1
      when 'beta_grant' then 2 when 'welcome_grant' then 2 when 'free_lifetime' then 2
      when 'revenuecat_purchase' then 3 when 'storekit_purchase' then 3
      when 'dev_mock_purchase' then 3 else 4 end,
      l.expires_at nulls last,l.created_at,l.id limit 1 for update;
  if not found then raise exception 'place_find_lot_not_found'; end if;
  update public.place_find_lots l set available_uses=l.available_uses-1,reserved_uses=l.reserved_uses+1 where l.id=v_lot.id;
  update public.place_find_wallets w set available_uses=w.available_uses-1,reserved_uses=w.reserved_uses+1,
    version=w.version+1,updated_at=now() where w.id=v_wallet.id returning * into v_wallet;
  if v_res.id is null then
    insert into public.place_find_reservations(wallet_id,lot_id,share_job_id,source_identity)
      values(v_wallet.id,v_lot.id,p_share_job_id,v_identity) returning * into v_res;
  else
    v_cycle:=v_res.cycle+1;
    update public.place_find_reservations set lot_id=v_lot.id,share_job_id=p_share_job_id,
      status='reserved',cycle=v_cycle,outcome_code=null,reserved_at=now(),settled_at=null,updated_at=now()
      where id=v_res.id returning * into v_res;
  end if;
  insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,share_job_id,
    entry_type,available_delta,reserved_delta,reason_code,idempotency_key)
  values(v_wallet.id,v_lot.id,v_res.id,p_share_job_id,'reserve',-1,1,'share_started',
    'reserve:'||v_res.id::text||':'||v_res.cycle::text);
  insert into public.analytics_events(user_id,event_name,properties)
    values(p_user_id,'token_reserved',jsonb_build_object('share_job_id',p_share_job_id));
  return query select v_res.id,v_wallet.available_uses,false;
end;
$$;

-- Terminal state and token settlement commit together. Worker retries may
-- also call settle_place_find_use explicitly; the ledger operation is
-- idempotent, so both paths converge without a charge-without-save window.
create or replace function public.settle_metered_share_job_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action text; v_reason text;
begin
  if new.billing_mode is distinct from 'metered' then return new; end if;
  if new.status='completed' and new.saved_place_id is not null then
    v_action:='consume'; v_reason:='useful_saved_place';
  elsif new.status='needs_help' then
    v_action:='hold'; v_reason:='awaiting_user_confirmation';
  elsif new.status in ('failed','cancelled') then
    v_action:='release'; v_reason:=case when new.status='cancelled' then 'user_abandoned'
      else coalesce(new.failure_reason,'no_useful_result') end;
  else
    return new;
  end if;
  perform * from public.settle_place_find_use(new.id,v_action,v_reason);
  return new;
end;
$$;
drop trigger if exists share_jobs_settle_metered_token on public.share_jobs;
create trigger share_jobs_settle_metered_token
  after update of status,saved_place_id on public.share_jobs
  for each row when (
    new.billing_mode='metered' and
    (old.status is distinct from new.status or old.saved_place_id is distinct from new.saved_place_id)
  ) execute function public.settle_metered_share_job_transition();

-- Reconcile only this V1's metered obligations. The earlier Premium Request
-- state machine owns its own terminal states and must not be settled through
-- the generic token transition path.
create or replace function public.release_stale_place_find_reservations(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row record; v_count integer:=0;
begin
  for v_row in
    select r.id as reservation_id,r.share_job_id,r.wallet_id,r.lot_id,r.cycle,
      (l.expires_at<=now() or exists(
        select 1 from public.place_find_purchase_transactions t
        where t.wallet_id=r.wallet_id and t.transaction_id=l.source_reference and t.status='refunded'
      )) as revoke_on_release,
      case when l.expires_at<=now() then 'expire'
        when exists(select 1 from public.place_find_purchase_transactions t
          where t.wallet_id=r.wallet_id and t.transaction_id=l.source_reference and t.status='refunded')
        then 'refund_revoke' else 'release' end as release_entry_type,
      case when j.billing_outcome like 'pending_consume:%' then 'consume' else 'release' end as settlement_action,
      case when j.id is null then 'missing_job'
           when j.billing_outcome like 'pending_consume:%' then split_part(j.billing_outcome,':',2)
           when j.billing_outcome like 'pending_release:%' then split_part(j.billing_outcome,':',2)
           when j.status='cancelled' then 'cancelled'
           when j.status='failed' then coalesce(j.failure_reason,'technical_failure')
           else 'worker_retry_exhausted' end as reason
    from public.place_find_reservations r
      join public.place_find_lots l on l.id=r.lot_id
      left join public.share_jobs j on j.id=r.share_job_id
    where r.status='reserved' and r.reserved_at<now()-interval '5 minutes'
      and (j.id is null or j.billing_mode='metered') and (
        j.id is null or j.status in ('cancelled','failed') or
        j.billing_outcome like 'pending_consume:%' or j.billing_outcome like 'pending_release:%' or
        (j.status='processing_metadata' and j.attempts>=j.max_attempts and j.locked_until<now())
      )
    order by r.reserved_at for update of r skip locked limit greatest(1,least(p_limit,500))
  loop
    if v_row.share_job_id is not null then
      perform * from public.settle_place_find_use(v_row.share_job_id,v_row.settlement_action,v_row.reason);
    else
      update public.place_find_lots l set
        available_uses=case when v_row.revoke_on_release then l.available_uses else l.available_uses+1 end,
        reserved_uses=l.reserved_uses-1,
        revoked_uses=case when v_row.revoke_on_release then l.revoked_uses+1 else l.revoked_uses end
        where l.id=v_row.lot_id;
      update public.place_find_wallets w set
        available_uses=w.available_uses+case when v_row.revoke_on_release then 0 else 1 end,
        reserved_uses=w.reserved_uses-1,version=w.version+1,updated_at=now()
        where w.id=v_row.wallet_id;
      update public.place_find_reservations set status='released',outcome_code=v_row.reason,
        settled_at=now(),updated_at=now() where id=v_row.reservation_id;
      if v_row.release_entry_type='refund_revoke' then
        update public.place_find_purchase_transactions t set
          revoked_unspent_uses=t.revoked_unspent_uses+1,
          spent_use_shortfall=greatest(0,t.spent_use_shortfall-1)
          where environment='Sandbox' and wallet_id=v_row.wallet_id
            and transaction_id=(select source_reference from public.place_find_lots where id=v_row.lot_id)
            and status='refunded';
      end if;
      insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,entry_type,
        available_delta,reserved_delta,reason_code,idempotency_key)
      select v_row.wallet_id,v_row.lot_id,v_row.reservation_id,
        v_row.release_entry_type,
        case when v_row.revoke_on_release then 0 else 1 end,
        -1,v_row.reason,'release:orphan:'||v_row.reservation_id::text||':'||v_row.cycle::text
        from public.place_find_lots l where l.id=v_row.lot_id
      on conflict(idempotency_key) do nothing;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.settle_place_find_use(
  p_share_job_id uuid,p_action text,p_reason_code text
) returns table(reservation_id uuid,status text,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_res public.place_find_reservations%rowtype; v_lot public.place_find_lots%rowtype;
  v_user_id uuid; v_revoke_on_release boolean:=false; v_refunded_lot boolean:=false;
begin
  if p_action not in ('consume','release','hold') then raise exception 'invalid_settlement_action'; end if;
  select * into v_res from public.place_find_reservations where share_job_id=p_share_job_id for update;
  if not found then
    update public.share_jobs set billing_outcome='unmetered:'||p_reason_code,
      billing_settled_at=coalesce(billing_settled_at,now()) where id=p_share_job_id;
    return;
  end if;
  if p_action='hold' then
    update public.share_jobs set billing_outcome='reserved:'||p_reason_code,billing_settled_at=null
      where id=p_share_job_id;
    return query select v_res.id,v_res.status,true; return;
  end if;
  if (p_action='consume' and v_res.status='consumed') or
     (p_action='release' and v_res.status='released') then
    return query select v_res.id,v_res.status,true; return;
  end if;
  -- A user-confirmed manual fallback may arrive after a failed job released;
  -- it remains a free manual save and cannot retroactively consume.
  if v_res.status<>'reserved' then
    return query select v_res.id,v_res.status,true; return;
  end if;
  select * into v_lot from public.place_find_lots where id=v_res.lot_id for update;
  select user_id into v_user_id from public.place_find_wallets where id=v_res.wallet_id;
  if p_action='consume' then
    update public.place_find_lots l set reserved_uses=l.reserved_uses-1,consumed_uses=l.consumed_uses+1 where l.id=v_res.lot_id;
    update public.place_find_wallets w set reserved_uses=w.reserved_uses-1,version=w.version+1,updated_at=now() where w.id=v_res.wallet_id;
    update public.place_find_reservations set status='consumed',outcome_code=p_reason_code,
      settled_at=now(),updated_at=now() where id=v_res.id returning * into v_res;
    insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,share_job_id,
      entry_type,reserved_delta,reason_code,idempotency_key)
    values(v_res.wallet_id,v_res.lot_id,v_res.id,p_share_job_id,'consume',-1,p_reason_code,
      'consume:'||v_res.id::text||':'||v_res.cycle::text);
    insert into public.token_qualifying_save_events(
      user_id,activity_key,activity_kind,saved_place_id,share_job_id,occurred_at
    ) select v_user_id,'video:job:'||j.id::text,'video',j.saved_place_id,j.id,
      coalesce(j.completed_at,now()) from public.share_jobs j where j.id=p_share_job_id
    on conflict(activity_key) do nothing;
    insert into public.analytics_events(user_id,event_name,properties)
      values(v_user_id,'token_consumed',jsonb_build_object(
        'share_job_id',p_share_job_id,'reason',p_reason_code,'origin',v_lot.source_kind));
  else
    v_refunded_lot:=exists(
      select 1 from public.place_find_purchase_transactions t
       where t.wallet_id=v_res.wallet_id and t.transaction_id=v_lot.source_reference
         and t.status='refunded'
    );
    v_revoke_on_release:=v_lot.expires_at<=now() or v_refunded_lot;
    if v_revoke_on_release then
      update public.place_find_lots l set reserved_uses=l.reserved_uses-1,revoked_uses=l.revoked_uses+1 where l.id=v_res.lot_id;
      update public.place_find_wallets w set reserved_uses=w.reserved_uses-1,
        version=w.version+1,updated_at=now() where w.id=v_res.wallet_id;
      if v_refunded_lot then
        update public.place_find_purchase_transactions t set
          revoked_unspent_uses=t.revoked_unspent_uses+1,
          spent_use_shortfall=greatest(0,t.spent_use_shortfall-1)
          where environment='Sandbox' and wallet_id=v_res.wallet_id
            and transaction_id=v_lot.source_reference and t.status='refunded';
      end if;
    else
      update public.place_find_lots l set available_uses=l.available_uses+1,reserved_uses=l.reserved_uses-1 where l.id=v_res.lot_id;
      update public.place_find_wallets w set available_uses=w.available_uses+1,reserved_uses=w.reserved_uses-1,
        version=w.version+1,updated_at=now() where w.id=v_res.wallet_id;
    end if;
    update public.place_find_reservations set status='released',outcome_code=p_reason_code,
      settled_at=now(),updated_at=now() where id=v_res.id returning * into v_res;
    insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,share_job_id,
      entry_type,available_delta,reserved_delta,reason_code,idempotency_key)
    values(v_res.wallet_id,v_res.lot_id,v_res.id,p_share_job_id,
      case when v_refunded_lot then 'refund_revoke'
        when v_revoke_on_release then 'expire' else 'release' end,
      case when v_revoke_on_release then 0 else 1 end,-1,p_reason_code,
      'release:'||v_res.id::text||':'||v_res.cycle::text);
    insert into public.analytics_events(user_id,event_name,properties)
      values(v_user_id,'token_released',jsonb_build_object('share_job_id',p_share_job_id,'reason',p_reason_code));
  end if;
  update public.share_jobs set billing_outcome=p_action||':'||p_reason_code,billing_settled_at=now()
    where id=p_share_job_id;
  return query select v_res.id,v_res.status,false;
end;
$$;

create or replace function public.create_share_job_for_user(
  p_user_id uuid,p_source_url text,p_canonical_url text,p_source_platform text,
  p_idempotency_key text default null,p_dedupe_window_seconds integer default 90,
  p_is_anonymous boolean default false,p_force_rerun boolean default false,
  p_enforce_tokens boolean default false
) returns table(job_id uuid,status text,duplicate boolean,requires_purchase boolean,available_uses integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.share_jobs%rowtype; v_job public.share_jobs%rowtype;
  v_available integer:=0; v_enforce boolean:=false; v_lock_key bigint; v_claimed integer:=0;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  select p_enforce_tokens and enabled into v_enforce from public.token_monetization_config
    where environment_name='development';
  v_enforce:=coalesce(v_enforce,false);
  v_lock_key:=hashtextextended(p_user_id::text||':'||coalesce(p_canonical_url,p_source_url,''),0);
  perform pg_advisory_xact_lock(v_lock_key);
  if v_enforce and not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id,false);
    select w.available_uses into v_available from public.place_find_wallets w where w.user_id=p_user_id;
  end if;
  if nullif(trim(p_idempotency_key),'') is not null then
    select sj.* into v_existing from public.share_jobs sj
      where sj.user_id=p_user_id and sj.idempotency_key=p_idempotency_key limit 1;
    if found then return query select v_existing.id,v_existing.status,true,
      v_existing.status='awaiting_purchase',v_available; return; end if;
  end if;
  select sj.* into v_existing from public.share_jobs sj
   where sj.user_id=p_user_id and sj.canonical_url=p_canonical_url
     and sj.status in ('awaiting_purchase','queued','processing_metadata')
   order by sj.created_at desc limit 1;
  if found then return query select v_existing.id,v_existing.status,true,
    v_existing.status='awaiting_purchase',v_available; return; end if;
  -- A successful canonical source is the permanent billing identity. Re-share
  -- opens the existing result; force-rerun cannot manufacture another charge.
  select sj.* into v_existing from public.share_jobs sj
   where sj.user_id=p_user_id and sj.canonical_url=p_canonical_url and sj.status='completed'
   order by sj.completed_at desc nulls last,sj.created_at desc limit 1;
  if found then return query select v_existing.id,v_existing.status,true,false,v_available; return; end if;
  insert into public.share_jobs(user_id,source_url,canonical_url,source_platform,status,
    progress_stage,idempotency_key,billing_mode)
  values(p_user_id,p_source_url,p_canonical_url,p_source_platform,
    case when v_enforce then 'awaiting_purchase' else 'queued' end,
    case when v_enforce then 'awaiting_purchase' else 'queued' end,
    p_idempotency_key,case when not v_enforce then 'unmetered_legacy'
      when p_is_anonymous then 'blocked_anonymous' else 'metered' end)
  returning * into v_job;
  if v_enforce and p_is_anonymous then
    -- Preserve the existing guided-demo allowance without accepting a
    -- client-controlled tutorial flag or granting an anonymous wallet.
    insert into public.place_find_onboarding_claims(anonymous_user_id,share_job_id)
      values(p_user_id,v_job.id) on conflict(anonymous_user_id) do nothing;
    get diagnostics v_claimed=row_count;
    if v_claimed=1 then
      update public.share_jobs set status='queued',progress_stage='queued',billing_mode='onboarding_free'
        where id=v_job.id returning * into v_job;
    end if;
  elsif v_enforce then
    begin
      perform * from public.reserve_place_find_use(p_user_id,v_job.id);
      update public.share_jobs set status='queued',progress_stage='queued' where id=v_job.id returning * into v_job;
      select w.available_uses into v_available from public.place_find_wallets w where w.user_id=p_user_id;
    exception when raise_exception then
      if sqlerrm<>'insufficient_place_finds' then raise; end if;
    end;
  end if;
  if v_enforce and v_job.status='awaiting_purchase' then
    insert into public.analytics_events(user_id,event_name,properties) values(
      p_user_id,'token_zero_balance_exposed',jsonb_build_object(
        'share_job_id',v_job.id,'anonymous',p_is_anonymous
      )
    );
  end if;
  return query select v_job.id,v_job.status,false,v_job.status='awaiting_purchase',v_available;
end;
$$;

create or replace function public.resume_place_find_job(p_user_id uuid,p_job_id uuid)
returns table(job_id uuid,status text,available_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype; v_available integer:=0;
begin
  select sj.* into v_job from public.share_jobs sj
    where sj.id=p_job_id and sj.user_id=p_user_id for update;
  if not found then raise exception 'share_job_not_found'; end if;
  if v_job.status<>'awaiting_purchase' then
    select w.available_uses into v_available from public.place_find_wallets w where w.user_id=p_user_id;
    return query select v_job.id,v_job.status,coalesce(v_available,0),true; return;
  end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  perform * from public.reserve_place_find_use(p_user_id,p_job_id);
  update public.share_jobs sj set status='queued',progress_stage='queued',billing_mode='metered',updated_at=now()
    where sj.id=p_job_id returning * into v_job;
  select w.available_uses into v_available from public.place_find_wallets w where w.user_id=p_user_id;
  insert into public.analytics_events(user_id,event_name,properties) values(
    p_user_id,'token_pending_job_resumed',jsonb_build_object('share_job_id',p_job_id)
  );
  return query select v_job.id,v_job.status,v_available,false;
end;
$$;

create or replace function public.cancel_share_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if not found or v_job.status not in ('awaiting_purchase','queued','processing_metadata','needs_help') then return false; end if;
  update public.share_jobs set status='cancelled',completed_at=now(),updated_at=now() where id=p_job_id;
  if v_job.billing_mode='premium_request' then
    perform * from public.settle_premium_request(p_job_id,'release','premium_cancelled','cancelled',false,'{}'::jsonb);
  else
    perform * from public.settle_place_find_use(p_job_id,'release','user_abandoned');
  end if;
  return true;
end;
$$;

create or replace function public.retry_share_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if not found or v_job.saved_place_id is not null or v_job.status<>'failed'
    or v_job.billing_mode='premium_request' then return false; end if;
  if v_job.billing_mode='metered' then
    perform * from public.ensure_place_find_wallet(v_uid,false);
    begin
      perform * from public.reserve_place_find_use(v_uid,p_job_id);
    exception when raise_exception then
      if sqlerrm<>'insufficient_place_finds' then raise; end if;
      update public.share_jobs set status='awaiting_purchase',progress_stage='awaiting_purchase',
        attempts=0,locked_until=null,last_error=null,failure_reason=null,completed_at=null,updated_at=now()
       where id=p_job_id; return true;
    end;
  end if;
  update public.share_jobs set status='queued',progress_stage='queued',attempts=0,
    locked_until=null,last_error=null,failure_reason=null,completed_at=null,updated_at=now()
   where id=p_job_id;
  return true;
end;
$$;

create or replace function public.record_manual_save_activity(p_saved_place_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_created timestamptz;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select created_at into v_created from public.saved_places
    where id=p_saved_place_id and user_id=v_uid and source_type='manual';
  if not found then return false; end if;
  insert into public.token_qualifying_save_events(
    user_id,activity_key,activity_kind,saved_place_id,occurred_at
  ) values(v_uid,'manual:saved:'||p_saved_place_id::text,'manual',p_saved_place_id,v_created)
  on conflict(activity_key) do nothing;
  return true;
end;
$$;

-- Record qualifying manual activity in the same transaction that commits the
-- save. Service-role imports and video-generated saves are excluded here;
-- video evidence is written only when its metered job is successfully settled.
create or replace function public.capture_manual_save_activity()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if new.source_type='manual' and auth.uid() is not null and auth.uid()=new.user_id then
    insert into public.token_qualifying_save_events(
      user_id,activity_key,activity_kind,saved_place_id,occurred_at
    ) values(
      new.user_id,'manual:saved:'||new.id::text,'manual',new.id,new.created_at
    ) on conflict(activity_key) do nothing;
  end if;
  return new;
end;
$$;
drop trigger if exists saved_places_capture_manual_token_activity on public.saved_places;
create trigger saved_places_capture_manual_token_activity
  after insert on public.saved_places
  for each row execute function public.capture_manual_save_activity();

-- Narrow support-only credit-back. There is intentionally no authenticated
-- client grant endpoint.
create or replace function public.credit_back_place_find_use(
  p_share_job_id uuid,p_reason_code text,p_support_reference text
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_res public.place_find_reservations%rowtype;
begin
  if length(trim(coalesce(p_support_reference,'')))<3 then raise exception 'support_reference_required'; end if;
  select * into v_res from public.place_find_reservations
    where share_job_id=p_share_job_id and status='consumed';
  if not found then raise exception 'consumed_reservation_not_found'; end if;
  return public.grant_place_find_lot(v_res.wallet_id,'credit_back',p_support_reference,1,null,p_reason_code);
end;
$$;

create or replace function public.process_revenuecat_token_event(
  p_event_id text,p_event_type text,p_project_id text,p_app_id text,
  p_purchase_environment text,p_store text,p_user_id uuid,p_product_id text,
  p_transaction_id text,p_purchased_at timestamptz,p_payload_sha256 text
) returns table(result_code text,available_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.token_monetization_config%rowtype; v_product public.place_find_products%rowtype;
  v_wallet public.place_find_wallets%rowtype; v_tx public.place_find_purchase_transactions%rowtype;
  v_lot public.place_find_lots%rowtype; v_revoke integer:=0; v_replayed boolean:=false;
begin
  select * into v_cfg from public.token_monetization_config where environment_name='development';
  if not coalesce(v_cfg.enabled,false) then raise exception 'token_monetization_disabled'; end if;
  if p_project_id is distinct from v_cfg.revenuecat_project_id or p_app_id is distinct from v_cfg.revenuecat_app_id
    then raise exception 'revenuecat_context_mismatch'; end if;
  if p_purchase_environment<>'SANDBOX' then raise exception 'production_event_forbidden'; end if;
  if not (upper(coalesce(p_store,''))=any(v_cfg.revenuecat_allowed_stores))
    then raise exception 'revenuecat_store_mismatch'; end if;
  if exists(select 1 from public.revenuecat_webhook_events where event_id=p_event_id) then
    select w.available_uses into available_uses from public.place_find_wallets w where w.user_id=p_user_id;
    return query select 'duplicate_event'::text,coalesce(available_uses,0),true; return;
  end if;
  select * into v_product from public.place_find_products
    where product_id=p_product_id and product_kind='storekit_consumable' and active;
  if not found then raise exception 'unapproved_product'; end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  select * into v_wallet from public.place_find_wallets where user_id=p_user_id for update;
  insert into public.revenuecat_webhook_events(
    event_id,event_type,project_id,app_id,purchase_environment,app_user_id,
    product_id,transaction_id,payload_sha256,result_code
  ) values(p_event_id,p_event_type,p_project_id,p_app_id,p_purchase_environment,
    p_user_id::text,p_product_id,p_transaction_id,p_payload_sha256,'processing');
  if p_event_type='NON_RENEWING_PURCHASE' then
    select * into v_tx from public.place_find_purchase_transactions
      where environment='Sandbox' and transaction_id=p_transaction_id;
    if found then
      if v_tx.wallet_id<>v_wallet.id then raise exception 'transaction_owner_mismatch'; end if;
      if v_tx.product_id<>p_product_id then raise exception 'transaction_context_mismatch'; end if;
      v_replayed:=true;
    else
      insert into public.place_find_purchase_transactions(
        environment,transaction_id,wallet_id,product_id,app_account_token,purchased_at,
        granted_uses,status,revenuecat_event_id,store
      ) values('Sandbox',p_transaction_id,v_wallet.id,p_product_id,v_wallet.app_account_token,
        p_purchased_at,v_product.use_count,'verified',p_event_id,p_store);
      perform public.grant_place_find_lot(v_wallet.id,'revenuecat_purchase',p_transaction_id,
        v_product.use_count,null,p_product_id);
      insert into public.analytics_events(user_id,event_name,properties) values(
        p_user_id,'token_purchase_verified',jsonb_build_object(
          'product_id',p_product_id,'tokens',v_product.use_count,'store',p_store
        )
      );

      -- RevenueCat delivery can be delayed or out of order. If a refund was
      -- received first, reconcile it now unless a later reversal superseded it.
      if exists(
        select 1 from public.revenuecat_webhook_events c
        where c.transaction_id=p_transaction_id and c.event_type='CANCELLATION'
          and c.result_code='pending_purchase'
          and not exists(
            select 1 from public.revenuecat_webhook_events rr
            where rr.transaction_id=c.transaction_id and rr.event_type='REFUND_REVERSED'
              and rr.received_at>c.received_at
          )
      ) then
        select * into v_tx from public.place_find_purchase_transactions
          where environment='Sandbox' and transaction_id=p_transaction_id for update;
        select * into v_lot from public.place_find_lots
          where wallet_id=v_tx.wallet_id and source_kind='revenuecat_purchase'
            and source_reference=p_transaction_id for update;
        v_revoke:=coalesce(v_lot.available_uses,0);
        update public.place_find_lots l set available_uses=0,
          revoked_uses=l.revoked_uses+v_revoke where l.id=v_lot.id;
        update public.place_find_wallets w set available_uses=w.available_uses-v_revoke,
          version=w.version+1,updated_at=now() where w.id=v_tx.wallet_id;
        update public.place_find_purchase_transactions set status='refunded',refunded_at=now(),
          revoked_unspent_uses=v_revoke,spent_use_shortfall=granted_uses-v_revoke
          where environment='Sandbox' and transaction_id=p_transaction_id;
        if v_revoke>0 then
          insert into public.place_find_ledger(
            wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key
          ) values(
            v_tx.wallet_id,v_lot.id,p_transaction_id,'refund_revoke',-v_revoke,
            'store_refund_delivered_before_purchase','refund:Sandbox:'||p_transaction_id
          );
        end if;
        update public.revenuecat_webhook_events e set
          result_code='refunded_after_delayed_purchase',processed_at=now()
          where e.transaction_id=p_transaction_id and e.event_type='CANCELLATION'
            and e.result_code='pending_purchase';
      end if;
    end if;
    update public.revenuecat_webhook_events set result_code=case
        when v_replayed then 'duplicate_transaction'
        when v_revoke>0 then 'credited_then_refunded'
        else 'credited' end,
      processed_at=now() where event_id=p_event_id;
  elsif p_event_type='CANCELLATION' then
    select * into v_tx from public.place_find_purchase_transactions
      where environment='Sandbox' and transaction_id=p_transaction_id for update;
    if not found then
      update public.revenuecat_webhook_events set result_code=case when exists(
          select 1 from public.revenuecat_webhook_events rr
          where rr.transaction_id=p_transaction_id and rr.event_type='REFUND_REVERSED'
            and rr.received_at>=(select received_at from public.revenuecat_webhook_events where event_id=p_event_id)
        ) then 'superseded_by_refund_reversal' else 'pending_purchase' end,
        processed_at=now() where event_id=p_event_id;
    elsif v_tx.wallet_id<>v_wallet.id then raise exception 'transaction_owner_mismatch';
    elsif v_tx.product_id<>p_product_id then raise exception 'transaction_context_mismatch';
    elsif v_tx.status='refunded' then v_replayed:=true;
    else
      select * into v_lot from public.place_find_lots
        where wallet_id=v_tx.wallet_id and source_kind='revenuecat_purchase'
          and source_reference=p_transaction_id for update;
      v_revoke:=coalesce(v_lot.available_uses,0);
      update public.place_find_lots l set available_uses=0,revoked_uses=l.revoked_uses+v_revoke where l.id=v_lot.id;
      update public.place_find_wallets w set available_uses=w.available_uses-v_revoke,
        version=w.version+1,updated_at=now() where w.id=v_tx.wallet_id;
      update public.place_find_purchase_transactions set status='refunded',refunded_at=now(),
        revoked_unspent_uses=v_revoke,spent_use_shortfall=granted_uses-v_revoke where environment='Sandbox' and transaction_id=p_transaction_id;
      if v_revoke>0 then insert into public.place_find_ledger(
        wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key
      ) values(v_tx.wallet_id,v_lot.id,p_transaction_id,'refund_revoke',-v_revoke,'store_refund',
        'refund:Sandbox:'||p_transaction_id); end if;
      update public.revenuecat_webhook_events set result_code='refunded',processed_at=now() where event_id=p_event_id;
    end if;
  elsif p_event_type='REFUND_REVERSED' then
    select * into v_tx from public.place_find_purchase_transactions
      where environment='Sandbox' and transaction_id=p_transaction_id for update;
    if not found then
      v_replayed:=true;
      update public.revenuecat_webhook_events set result_code='pending_refund_reversal',
        processed_at=now() where event_id=p_event_id;
    elsif v_tx.wallet_id<>v_wallet.id then raise exception 'transaction_owner_mismatch';
    elsif v_tx.product_id<>p_product_id then raise exception 'transaction_context_mismatch';
    elsif v_tx.status<>'refunded' then
      v_replayed:=true;
      update public.revenuecat_webhook_events set result_code='refund_reversal_not_needed',
        processed_at=now() where event_id=p_event_id;
    else
      select * into v_lot from public.place_find_lots where wallet_id=v_tx.wallet_id
        and source_kind='revenuecat_purchase' and source_reference=p_transaction_id for update;
      v_revoke:=v_tx.revoked_unspent_uses;
      update public.place_find_lots l set available_uses=l.available_uses+v_revoke,
        revoked_uses=l.revoked_uses-v_revoke where l.id=v_lot.id;
      update public.place_find_wallets w set available_uses=w.available_uses+v_revoke,
        version=w.version+1,updated_at=now() where w.id=v_tx.wallet_id;
      update public.place_find_purchase_transactions set status='refund_reversed',
        revoked_unspent_uses=0 where environment='Sandbox' and transaction_id=p_transaction_id;
      if v_revoke>0 then insert into public.place_find_ledger(
        wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key
      ) values(v_tx.wallet_id,v_lot.id,p_transaction_id,'refund_reversal',v_revoke,'store_refund_reversed',
        'refund_reversed:Sandbox:'||p_transaction_id); end if;
      update public.revenuecat_webhook_events set result_code='refund_reversed',processed_at=now() where event_id=p_event_id;
    end if;
  else raise exception 'unsupported_revenuecat_event';
  end if;
  select w.available_uses into available_uses from public.place_find_wallets w where w.id=v_wallet.id;
  return query select coalesce((select e.result_code from public.revenuecat_webhook_events e where e.event_id=p_event_id),'processed'),
    coalesce(available_uses,0),v_replayed;
end;
$$;

create or replace function public.grant_due_monthly_allowances(p_limit integer default 500)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user record; v_count integer:=0;
begin
  for v_user in select distinct e.user_id from public.token_qualifying_save_events e
    where e.activity_month=((date_trunc('month',now() at time zone 'UTC'))::date-interval '1 month')::date
      and e.user_id is not null
    limit greatest(1,least(p_limit,5000))
  loop
    perform * from public.ensure_place_find_wallet(v_user.user_id,false); v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

-- Repeat-safe rollout batch for accounts that have not opened the app. Run in
-- bounded pages after enabling Dev; ensure_place_find_wallet owns the exact
-- beta-versus-welcome decision and immutable ledger entry.
create or replace function public.grant_initial_token_allocations(p_limit integer default 500)
returns table(processed integer,granted integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_user record; v_processed integer:=0; v_granted integer:=0; v_did_grant boolean;
begin
  for v_user in
    select u.id from auth.users u
    left join public.place_find_wallets w on w.user_id=u.id
    where coalesce(u.is_anonymous,false)=false and not exists(
      select 1 from public.place_find_lots l where l.wallet_id=w.id
        and l.source_kind in ('beta_grant','welcome_grant')
    ) order by u.created_at,u.id limit greatest(1,least(p_limit,5000))
  loop
    select e.granted_free into v_did_grant from public.ensure_place_find_wallet(v_user.id,false) e;
    v_processed:=v_processed+1;
    if coalesce(v_did_grant,false) then v_granted:=v_granted+1; end if;
  end loop;
  return query select v_processed,v_granted;
end;
$$;

-- Best-effort reconstruction for the first October cycle. created_at is
-- authoritative and unlike updated_at cannot be changed by edits. Deleted
-- pre-migration saves cannot be reconstructed and are documented as a limit.
insert into public.token_qualifying_save_events(
  user_id,activity_key,activity_kind,saved_place_id,occurred_at,evidence_kind
) select sp.user_id,'historical:saved:'||sp.id::text,
  case when sp.source_type='manual' then 'manual' else 'video' end,
  sp.id,sp.created_at,'historical_reconstruction'
from public.saved_places sp
where sp.created_at>='2026-09-01 00:00:00+00' and sp.created_at<'2026-10-01 00:00:00+00'
on conflict(activity_key) do nothing;

revoke all on function public.grant_place_find_lot(uuid,text,text,integer,timestamptz,text),
  public.expire_place_find_lots(uuid),public.process_revenuecat_token_event(text,text,text,text,text,text,uuid,text,text,timestamptz,text),
  public.credit_back_place_find_use(uuid,text,text),public.grant_due_monthly_allowances(integer),
  public.grant_initial_token_allocations(integer)
  from public,anon,authenticated;
grant execute on function public.grant_place_find_lot(uuid,text,text,integer,timestamptz,text),
  public.expire_place_find_lots(uuid),public.process_revenuecat_token_event(text,text,text,text,text,text,uuid,text,text,timestamptz,text),
  public.credit_back_place_find_use(uuid,text,text),public.grant_due_monthly_allowances(integer),
  public.grant_initial_token_allocations(integer),
  public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean,boolean,boolean)
  to service_role;
revoke all on function public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean,boolean,boolean)
  from public,anon,authenticated;
revoke all on function public.record_manual_save_activity(uuid) from public,anon;
grant execute on function public.record_manual_save_activity(uuid) to authenticated,service_role;
revoke all on function public.capture_manual_save_activity() from public,anon,authenticated;
revoke all on function public.settle_metered_share_job_transition() from public,anon,authenticated;

-- Dry-run (Nearr-Dev only, before enabling):
-- select count(*) as beta_accounts from auth.users u
--  where u.created_at < (select rollout_cutoff from public.token_monetization_config where environment_name='development');
-- select count(*) as welcome_accounts from auth.users u
--  where u.created_at >= (select rollout_cutoff from public.token_monetization_config where environment_name='development');
