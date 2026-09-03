-- Nearr place-find monetization, semantically ported onto the 2026-09-03
-- share-job pipeline. The database is the balance authority. One share job
-- owns at most one reservation, including cache hits, retries and multi-place.

set check_function_bodies = off;
create extension if not exists "pgcrypto";

alter table public.share_jobs drop constraint if exists share_jobs_status_check;
alter table public.share_jobs add constraint share_jobs_status_check check (status in (
  'awaiting_purchase','queued','processing_metadata','completed','needs_help','failed','cancelled'
));
alter table public.share_jobs
  add column if not exists billing_mode text not null default 'unmetered_legacy'
    check (billing_mode in ('unmetered_legacy','onboarding_free','metered','blocked_anonymous')),
  add column if not exists billing_outcome text,
  add column if not exists billing_settled_at timestamptz;

drop index if exists public.share_jobs_active_url_uidx;
create unique index share_jobs_active_url_uidx
  on public.share_jobs (user_id, canonical_url)
  where status in ('awaiting_purchase','queued','processing_metadata');

create table public.place_find_products (
  product_id text primary key,
  use_count integer not null check (use_count > 0),
  product_kind text not null check (product_kind in ('dev_mock','storekit_consumable')),
  mock_display_price text,
  mock_price_cents integer check (mock_price_cents is null or mock_price_cents > 0),
  sort_order integer not null default 0,
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    product_kind <> 'dev_mock'
    or (mock_display_price is not null and mock_price_cents is not null)
  )
);

-- Explicitly fake identifiers. The granting endpoint additionally requires
-- the exact Nearr-Dev project, a server flag and a server-side user allowlist.
insert into public.place_find_products(
  product_id,use_count,product_kind,mock_display_price,mock_price_cents,sort_order,active
) values
  ('dev.mock.nearr.place_finds.10',10,'dev_mock','$3.99',399,10,false),
  ('dev.mock.nearr.place_finds.25',25,'dev_mock','$8.99',899,20,false),
  ('dev.mock.nearr.place_finds.50',50,'dev_mock','$15.99',1599,30,false)
on conflict (product_id) do update set
  use_count=excluded.use_count,
  mock_display_price=excluded.mock_display_price,
  mock_price_cents=excluded.mock_price_cents,
  sort_order=excluded.sort_order,
  active=false,
  updated_at=now();

create table public.place_find_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  app_account_token uuid not null default gen_random_uuid() unique,
  available_uses integer not null default 0 check (available_uses >= 0),
  reserved_uses integer not null default 0 check (reserved_uses >= 0),
  status text not null default 'active' check (status in ('active','closed','merged')),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.place_find_free_grant_claims (
  claim_key text primary key,
  grant_version text not null,
  wallet_id uuid not null references public.place_find_wallets(id),
  claimed_at timestamptz not null default now()
);

create table public.place_find_lots (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.place_find_wallets(id),
  source_kind text not null check (source_kind in ('free_lifetime','dev_mock_purchase','storekit_purchase','admin_adjustment')),
  source_reference text not null,
  granted_uses integer not null check (granted_uses > 0),
  available_uses integer not null check (available_uses >= 0),
  reserved_uses integer not null default 0 check (reserved_uses >= 0),
  consumed_uses integer not null default 0 check (consumed_uses >= 0),
  revoked_uses integer not null default 0 check (revoked_uses >= 0),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (available_uses + reserved_uses + consumed_uses + revoked_uses = granted_uses),
  unique (wallet_id, source_kind, source_reference)
);
create index place_find_lots_spend_idx
  on public.place_find_lots(wallet_id, expires_at, created_at)
  where available_uses > 0;

create table public.place_find_reservations (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.place_find_wallets(id),
  lot_id uuid not null references public.place_find_lots(id),
  share_job_id uuid unique references public.share_jobs(id) on delete set null,
  status text not null default 'reserved' check (status in ('reserved','consumed','released')),
  cycle integer not null default 1 check (cycle > 0),
  outcome_code text,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  updated_at timestamptz not null default now()
);
create index place_find_reservations_open_idx
  on public.place_find_reservations(reserved_at) where status='reserved';

create table public.place_find_ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references public.place_find_wallets(id),
  lot_id uuid references public.place_find_lots(id),
  reservation_id uuid references public.place_find_reservations(id),
  share_job_id uuid references public.share_jobs(id) on delete set null,
  transaction_id text,
  entry_type text not null check (entry_type in (
    'free_grant','dev_mock_purchase','storekit_purchase','reserve','consume','release',
    'refund_revoke','refund_reversal','admin_adjustment'
  )),
  available_delta integer not null default 0,
  reserved_delta integer not null default 0,
  reason_code text,
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check (available_delta <> 0 or reserved_delta <> 0)
);
create index place_find_ledger_wallet_idx
  on public.place_find_ledger(wallet_id, created_at desc, id desc);

create table public.place_find_purchase_transactions (
  environment text not null check (environment in ('DevMock','Sandbox','Production')),
  transaction_id text not null,
  wallet_id uuid not null references public.place_find_wallets(id),
  product_id text not null references public.place_find_products(product_id),
  app_account_token uuid not null,
  purchased_at timestamptz not null,
  verified_at timestamptz not null default now(),
  granted_uses integer not null check (granted_uses > 0),
  signed_transaction_sha256 text,
  status text not null default 'verified' check (status in ('verified','refunded','refund_reversed')),
  revoked_unspent_uses integer not null default 0 check (revoked_unspent_uses >= 0),
  spent_use_shortfall integer not null default 0 check (spent_use_shortfall >= 0),
  primary key(environment, transaction_id)
);

create table public.app_store_server_notifications (
  notification_uuid uuid primary key,
  notification_type text not null,
  subtype text,
  environment text,
  transaction_id text,
  signed_payload_sha256 text not null,
  result_code text not null,
  processed_at timestamptz not null default now()
);

create table public.place_find_onboarding_claims (
  anonymous_user_id uuid primary key,
  share_job_id uuid not null unique references public.share_jobs(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.reject_place_find_ledger_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'place_find_ledger_is_append_only'; end;
$$;
create trigger place_find_ledger_no_mutation
  before update or delete on public.place_find_ledger
  for each row execute function public.reject_place_find_ledger_mutation();

alter table public.place_find_products enable row level security;
alter table public.place_find_wallets enable row level security;
alter table public.place_find_free_grant_claims enable row level security;
alter table public.place_find_lots enable row level security;
alter table public.place_find_reservations enable row level security;
alter table public.place_find_ledger enable row level security;
alter table public.place_find_purchase_transactions enable row level security;
alter table public.app_store_server_notifications enable row level security;
alter table public.place_find_onboarding_claims enable row level security;

revoke all on public.place_find_products,public.place_find_wallets,
  public.place_find_free_grant_claims,public.place_find_lots,
  public.place_find_reservations,public.place_find_ledger,
  public.place_find_purchase_transactions,public.app_store_server_notifications,
  public.place_find_onboarding_claims from public,anon,authenticated;
grant select on public.place_find_products,public.place_find_wallets,
  public.place_find_reservations,public.place_find_ledger to authenticated;
grant all on public.place_find_products,public.place_find_wallets,
  public.place_find_free_grant_claims,public.place_find_lots,
  public.place_find_reservations,public.place_find_ledger,
  public.place_find_purchase_transactions,public.app_store_server_notifications,
  public.place_find_onboarding_claims to service_role;

create policy place_find_products_authenticated_read on public.place_find_products
  for select to authenticated using (active);
create policy place_find_wallet_owner_read on public.place_find_wallets
  for select to authenticated using (user_id=auth.uid());
create policy place_find_reservation_owner_read on public.place_find_reservations
  for select to authenticated using (exists (
    select 1 from public.place_find_wallets w where w.id=wallet_id and w.user_id=auth.uid()
  ));
create policy place_find_ledger_owner_read on public.place_find_ledger
  for select to authenticated using (exists (
    select 1 from public.place_find_wallets w where w.id=wallet_id and w.user_id=auth.uid()
  ));

create or replace function public.ensure_place_find_wallet(
  p_user_id uuid,
  p_is_anonymous boolean default false
)
returns table(wallet_id uuid, available_uses integer, reserved_uses integer, app_account_token uuid, granted_free boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.place_find_wallets%rowtype; v_lot_id uuid; v_granted boolean:=false;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  insert into public.place_find_wallets(user_id) values(p_user_id)
    on conflict(user_id) do nothing;
  select * into v_wallet from public.place_find_wallets
    where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'active_wallet_not_found'; end if;

  if not p_is_anonymous then
    insert into public.place_find_free_grant_claims(claim_key,grant_version,wallet_id)
      values('user:'||p_user_id::text,'lifetime_v1',v_wallet.id)
      on conflict(claim_key) do nothing;
    if found then
      insert into public.place_find_lots(
        wallet_id,source_kind,source_reference,granted_uses,available_uses
      ) values(v_wallet.id,'free_lifetime','lifetime_v1',5,5)
      returning id into v_lot_id;
      update public.place_find_wallets set available_uses=available_uses+5,
        version=version+1,updated_at=now() where id=v_wallet.id returning * into v_wallet;
      insert into public.place_find_ledger(
        wallet_id,lot_id,entry_type,available_delta,reason_code,idempotency_key
      ) values(v_wallet.id,v_lot_id,'free_grant',5,'lifetime_v1','free:lifetime:v1:'||p_user_id::text);
      v_granted:=true;
    end if;
  end if;
  return query select v_wallet.id,v_wallet.available_uses,v_wallet.reserved_uses,
    v_wallet.app_account_token,v_granted;
end;
$$;

create or replace function public.reserve_place_find_use(p_user_id uuid,p_share_job_id uuid)
returns table(reservation_id uuid, available_uses integer, replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.place_find_wallets%rowtype; v_lot public.place_find_lots%rowtype;
  v_res public.place_find_reservations%rowtype; v_cycle integer;
begin
  select * into v_res from public.place_find_reservations where share_job_id=p_share_job_id for update;
  if found and v_res.status in ('reserved','consumed') then
    select * into v_wallet from public.place_find_wallets where id=v_res.wallet_id;
    return query select v_res.id,v_wallet.available_uses,true; return;
  end if;
  select * into v_wallet from public.place_find_wallets
    where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'wallet_not_found'; end if;
  if v_wallet.available_uses<1 then raise exception 'insufficient_place_finds'; end if;
  if not exists(select 1 from public.share_jobs where id=p_share_job_id and user_id=p_user_id)
    then raise exception 'share_job_owner_mismatch'; end if;
  select * into v_lot from public.place_find_lots
    where wallet_id=v_wallet.id and available_uses>0 and (expires_at is null or expires_at>now())
    order by expires_at nulls last,created_at,id limit 1 for update;
  if not found then raise exception 'place_find_lot_not_found'; end if;
  update public.place_find_lots set available_uses=available_uses-1,reserved_uses=reserved_uses+1
    where id=v_lot.id;
  update public.place_find_wallets set available_uses=available_uses-1,reserved_uses=reserved_uses+1,
    version=version+1,updated_at=now() where id=v_wallet.id returning * into v_wallet;
  if v_res.id is null then
    insert into public.place_find_reservations(wallet_id,lot_id,share_job_id)
      values(v_wallet.id,v_lot.id,p_share_job_id) returning * into v_res;
  else
    v_cycle:=v_res.cycle+1;
    update public.place_find_reservations set lot_id=v_lot.id,status='reserved',cycle=v_cycle,
      outcome_code=null,reserved_at=now(),settled_at=null,updated_at=now()
      where id=v_res.id returning * into v_res;
  end if;
  insert into public.place_find_ledger(
    wallet_id,lot_id,reservation_id,share_job_id,entry_type,available_delta,reserved_delta,
    reason_code,idempotency_key
  ) values(v_wallet.id,v_lot.id,v_res.id,p_share_job_id,'reserve',-1,1,'share_started',
    'reserve:'||p_share_job_id::text||':'||v_res.cycle::text);
  insert into public.analytics_events(user_id,event_name,properties)
    values(p_user_id,'use_reserved',jsonb_build_object('share_job_id',p_share_job_id));
  return query select v_res.id,v_wallet.available_uses,false;
end;
$$;

create or replace function public.settle_place_find_use(
  p_share_job_id uuid,p_action text,p_reason_code text
)
returns table(reservation_id uuid,status text,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_res public.place_find_reservations%rowtype; v_user_id uuid;
begin
  if p_action not in ('consume','release') then raise exception 'invalid_settlement_action'; end if;
  select * into v_res from public.place_find_reservations where share_job_id=p_share_job_id for update;
  if not found then
    update public.share_jobs set billing_outcome='unmetered:'||p_reason_code,
      billing_settled_at=coalesce(billing_settled_at,now()) where id=p_share_job_id;
    return;
  end if;
  if v_res.status=p_action||'d' or (p_action='consume' and v_res.status='consumed') then
    return query select v_res.id,v_res.status,true; return;
  end if;
  if v_res.status<>'reserved' then raise exception 'reservation_terminal_conflict'; end if;
  select user_id into v_user_id from public.place_find_wallets where id=v_res.wallet_id;
  if p_action='consume' then
    update public.place_find_lots set reserved_uses=reserved_uses-1,consumed_uses=consumed_uses+1 where id=v_res.lot_id;
    update public.place_find_wallets set reserved_uses=reserved_uses-1,version=version+1,updated_at=now() where id=v_res.wallet_id;
    update public.place_find_reservations set status='consumed',outcome_code=p_reason_code,
      settled_at=now(),updated_at=now() where id=v_res.id returning * into v_res;
    insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,share_job_id,entry_type,
      reserved_delta,reason_code,idempotency_key)
      values(v_res.wallet_id,v_res.lot_id,v_res.id,p_share_job_id,'consume',-1,p_reason_code,
        'consume:'||p_share_job_id::text||':'||v_res.cycle::text);
    insert into public.analytics_events(user_id,event_name,properties)
      values(v_user_id,'use_consumed',jsonb_build_object('share_job_id',p_share_job_id,'reason',p_reason_code));
  else
    update public.place_find_lots set available_uses=available_uses+1,reserved_uses=reserved_uses-1 where id=v_res.lot_id;
    update public.place_find_wallets set available_uses=available_uses+1,reserved_uses=reserved_uses-1,
      version=version+1,updated_at=now() where id=v_res.wallet_id;
    update public.place_find_reservations set status='released',outcome_code=p_reason_code,
      settled_at=now(),updated_at=now() where id=v_res.id returning * into v_res;
    insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,share_job_id,entry_type,
      available_delta,reserved_delta,reason_code,idempotency_key)
      values(v_res.wallet_id,v_res.lot_id,v_res.id,p_share_job_id,'release',1,-1,p_reason_code,
        'release:'||p_share_job_id::text||':'||v_res.cycle::text);
    insert into public.analytics_events(user_id,event_name,properties)
      values(v_user_id,'use_released',jsonb_build_object('share_job_id',p_share_job_id,'reason',p_reason_code));
  end if;
  update public.share_jobs set billing_outcome=p_action||':'||p_reason_code,billing_settled_at=now()
    where id=p_share_job_id;
  return query select v_res.id,v_res.status,false;
end;
$$;

drop function if exists public.create_share_job_for_user(uuid,text,text,text,text,integer);
drop function if exists public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean);
create function public.create_share_job_for_user(
  p_user_id uuid,p_source_url text,p_canonical_url text,p_source_platform text,
  p_idempotency_key text default null,p_dedupe_window_seconds integer default 90,
  p_is_anonymous boolean default false,p_force_rerun boolean default false
)
returns table(job_id uuid,status text,duplicate boolean,requires_purchase boolean,available_uses integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing record; v_job public.share_jobs%rowtype; v_lock_key bigint;
  v_claimed integer:=0; v_available integer:=0;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  v_lock_key:=hashtextextended(p_user_id::text||':'||coalesce(p_canonical_url,p_source_url,''),0);
  perform pg_advisory_xact_lock(v_lock_key);
  if not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id,false);
    select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
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
      and sj.created_at>=now()-make_interval(secs=>greatest(p_dedupe_window_seconds,1))
    order by sj.created_at desc limit 1;
  if found then return query select v_existing.id,v_existing.status,true,
    v_existing.status='awaiting_purchase',v_available; return; end if;

  -- Re-sharing an already completed URL opens its durable prior result for
  -- free. A deliberate "find again" request is a new metered job.
  if not p_force_rerun then
    select sj.* into v_existing from public.share_jobs sj
      where sj.user_id=p_user_id and sj.canonical_url=p_canonical_url
        and sj.status='completed'
      order by sj.completed_at desc nulls last,sj.created_at desc limit 1;
    if found then return query select v_existing.id,v_existing.status,true,false,v_available; return; end if;
  end if;

  insert into public.share_jobs(user_id,source_url,canonical_url,source_platform,status,
    progress_stage,idempotency_key,billing_mode)
  values(p_user_id,p_source_url,p_canonical_url,p_source_platform,'awaiting_purchase',
    'awaiting_purchase',p_idempotency_key,
    case when p_is_anonymous then 'blocked_anonymous' else 'metered' end)
  returning * into v_job;

  if p_is_anonymous then
    insert into public.place_find_onboarding_claims(anonymous_user_id,share_job_id)
      values(p_user_id,v_job.id) on conflict(anonymous_user_id) do nothing;
    get diagnostics v_claimed=row_count;
    if v_claimed=1 then
      update public.share_jobs set status='queued',progress_stage='queued',billing_mode='onboarding_free'
        where id=v_job.id returning * into v_job;
    end if;
  else
    begin
      perform * from public.reserve_place_find_use(p_user_id,v_job.id);
      update public.share_jobs set status='queued',progress_stage='queued' where id=v_job.id returning * into v_job;
      select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
    exception when raise_exception then
      if sqlerrm<>'insufficient_place_finds' then raise; end if;
    end;
  end if;
  return query select v_job.id,v_job.status,false,v_job.status='awaiting_purchase',v_available;
end;
$$;

create or replace function public.resume_place_find_job(p_user_id uuid,p_job_id uuid)
returns table(job_id uuid,status text,available_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype; v_available integer;
begin
  select * into v_job from public.share_jobs where id=p_job_id and user_id=p_user_id for update;
  if not found then raise exception 'share_job_not_found'; end if;
  if v_job.status<>'awaiting_purchase' then
    select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
    return query select v_job.id,v_job.status,v_available,true; return;
  end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  perform * from public.reserve_place_find_use(p_user_id,p_job_id);
  update public.share_jobs set status='queued',progress_stage='queued',billing_mode='metered',updated_at=now()
    where id=p_job_id returning * into v_job;
  select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
  return query select v_job.id,v_job.status,v_available,false;
end;
$$;

create or replace function public.apply_dev_mock_place_find_purchase(
  p_user_id uuid,p_product_id text,p_client_purchase_id text
)
returns table(wallet_id uuid,available_uses integer,granted_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.place_find_wallets%rowtype; v_product public.place_find_products%rowtype;
  v_lot_id uuid; v_tx text:='mock:'||p_user_id::text||':'||p_client_purchase_id;
begin
  if coalesce(length(trim(p_client_purchase_id)),0) not between 8 and 100 then raise exception 'invalid_purchase_id'; end if;
  select * into v_product from public.place_find_products
    where product_id=p_product_id and product_kind='dev_mock' and active;
  if not found then raise exception 'mock_product_not_allowed'; end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  select * into v_wallet from public.place_find_wallets where user_id=p_user_id for update;
  if exists(select 1 from public.place_find_purchase_transactions
    where environment='DevMock' and transaction_id=v_tx) then
    return query select v_wallet.id,v_wallet.available_uses,v_product.use_count,true; return;
  end if;
  insert into public.place_find_purchase_transactions(environment,transaction_id,wallet_id,
    product_id,app_account_token,purchased_at,granted_uses)
    values('DevMock',v_tx,v_wallet.id,p_product_id,v_wallet.app_account_token,now(),v_product.use_count);
  insert into public.place_find_lots(wallet_id,source_kind,source_reference,granted_uses,available_uses)
    values(v_wallet.id,'dev_mock_purchase',v_tx,v_product.use_count,v_product.use_count)
    returning id into v_lot_id;
  update public.place_find_wallets set available_uses=available_uses+v_product.use_count,
    version=version+1,updated_at=now() where id=v_wallet.id returning * into v_wallet;
  insert into public.place_find_ledger(wallet_id,lot_id,transaction_id,entry_type,available_delta,
    reason_code,idempotency_key)
    values(v_wallet.id,v_lot_id,v_tx,'dev_mock_purchase',v_product.use_count,p_product_id,'purchase:DevMock:'||v_tx);
  return query select v_wallet.id,v_wallet.available_uses,v_product.use_count,false;
end;
$$;

create or replace function public.release_stale_place_find_reservations(p_limit integer default 100)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_row record; v_count integer:=0;
begin
  for v_row in
    select r.id as reservation_id,r.share_job_id,r.wallet_id,r.lot_id,r.cycle,w.user_id,
      case when j.billing_outcome like 'pending_consume:%' then 'consume' else 'release' end as settlement_action,
      case when j.id is null then 'missing_job'
           when j.billing_outcome like 'pending_consume:%' then split_part(j.billing_outcome,':',2)
           when j.billing_outcome like 'pending_release:%' then split_part(j.billing_outcome,':',2)
           when j.status='cancelled' then 'cancelled'
           when j.status='failed' then coalesce(j.failure_reason,'technical_failure')
           else 'worker_retry_exhausted' end as reason
    from public.place_find_reservations r
      join public.place_find_wallets w on w.id=r.wallet_id
      left join public.share_jobs j on j.id=r.share_job_id
    where r.status='reserved' and r.reserved_at<now()-interval '5 minutes' and (
      j.id is null or j.status in ('cancelled','failed') or
      j.billing_outcome like 'pending_consume:%' or j.billing_outcome like 'pending_release:%' or
      (j.status='processing_metadata' and j.attempts>=j.max_attempts and j.locked_until<now())
    ) order by r.reserved_at for update of r skip locked limit greatest(1,least(p_limit,500))
  loop
    if v_row.share_job_id is not null then
      perform * from public.settle_place_find_use(v_row.share_job_id,v_row.settlement_action,v_row.reason);
    else
      update public.place_find_lots set available_uses=available_uses+1,reserved_uses=reserved_uses-1
        where id=v_row.lot_id;
      update public.place_find_wallets set available_uses=available_uses+1,reserved_uses=reserved_uses-1,
        version=version+1,updated_at=now() where id=v_row.wallet_id;
      update public.place_find_reservations set status='released',outcome_code=v_row.reason,
        settled_at=now(),updated_at=now() where id=v_row.reservation_id;
      insert into public.place_find_ledger(wallet_id,lot_id,reservation_id,entry_type,
        available_delta,reserved_delta,reason_code,idempotency_key)
        values(v_row.wallet_id,v_row.lot_id,v_row.reservation_id,'release',1,-1,v_row.reason,
          'release:orphan:'||v_row.reservation_id::text||':'||v_row.cycle::text)
        on conflict(idempotency_key) do nothing;
    end if;
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.close_place_find_wallet(p_user_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet_id uuid; v_res record;
begin
  select id into v_wallet_id from public.place_find_wallets where user_id=p_user_id for update;
  if not found then return true; end if;
  for v_res in select share_job_id from public.place_find_reservations
    where wallet_id=v_wallet_id and status='reserved' and share_job_id is not null
    for update
  loop
    perform * from public.settle_place_find_use(v_res.share_job_id,'release','account_deleted');
  end loop;
  update public.place_find_wallets set status='closed',updated_at=now() where id=v_wallet_id;
  return true;
end;
$$;

-- Cancellation releases atomically. Onboarding jobs have no reservation and
-- simply record an unmetered terminal outcome.
create or replace function public.cancel_share_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_updated integer;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  update public.share_jobs set status='cancelled',completed_at=now(),updated_at=now()
    where id=p_job_id and user_id=v_uid and status in ('awaiting_purchase','queued','processing_metadata');
  get diagnostics v_updated=row_count;
  if v_updated>0 then perform * from public.settle_place_find_use(p_job_id,'release','user_cancelled_before_result'); end if;
  return v_updated>0;
end;
$$;

-- An explicit retry remains the same submitted video/job. If its previous
-- technical attempt released the reservation, reserve that same job again;
-- with no balance it moves to the preserved awaiting-purchase state.
create or replace function public.retry_share_job(p_job_id uuid)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_job public.share_jobs%rowtype;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  select * into v_job from public.share_jobs where id=p_job_id and user_id=v_uid for update;
  if not found or v_job.saved_place_id is not null or v_job.status<>'failed' then return false; end if;
  if v_job.billing_mode='metered' then
    begin
      perform * from public.reserve_place_find_use(v_uid,p_job_id);
    exception when raise_exception then
      if sqlerrm<>'insufficient_place_finds' then raise; end if;
      update public.share_jobs set status='awaiting_purchase',progress_stage='awaiting_purchase',
        attempts=0,locked_until=null,last_error=null,failure_reason=null,completed_at=null,updated_at=now()
        where id=p_job_id;
      return true;
    end;
  end if;
  update public.share_jobs set status='queued',progress_stage='queued',attempts=0,
    locked_until=null,last_error=null,failure_reason=null,completed_at=null,updated_at=now()
    where id=p_job_id;
  return true;
end;
$$;

-- Account-wide queue clearing must include preserved out-of-balance posts.
create or replace function public.archive_active_queue_for_user(p_job_ids uuid[] default null)
returns table(archived_count bigint,cutoff timestamptz)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_uid uuid:=auth.uid(); v_cutoff timestamptz:=transaction_timestamp(); v_count bigint;
begin
  if v_uid is null then raise exception 'not_authenticated'; end if;
  with archived as (
    update public.share_jobs sj set queue_archived_at=v_cutoff
    where sj.user_id=v_uid and sj.queue_archived_at is null and sj.created_at<=v_cutoff and (
      (p_job_ids is not null and sj.id=any(p_job_ids)) or
      (p_job_ids is null and (
        sj.status in ('awaiting_purchase','queued','processing_metadata','needs_help','failed') or
        exists(select 1 from public.share_job_place_results r where r.share_job_id=sj.id
          and r.user_id=v_uid and r.origin='automatic' and r.outcome='auto_saved'
          and r.finalized_at>=v_cutoff-interval '24 hours' and r.finalized_at<=v_cutoff)
      ))
    ) returning 1
  ) select count(*)::bigint into v_count from archived;
  return query select v_count,v_cutoff;
end;
$$;

revoke all on function public.ensure_place_find_wallet(uuid,boolean) from public,anon,authenticated;
revoke all on function public.reserve_place_find_use(uuid,uuid) from public,anon,authenticated;
revoke all on function public.settle_place_find_use(uuid,text,text) from public,anon,authenticated;
revoke all on function public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean,boolean) from public,anon,authenticated;
revoke all on function public.resume_place_find_job(uuid,uuid) from public,anon,authenticated;
revoke all on function public.apply_dev_mock_place_find_purchase(uuid,text,text) from public,anon,authenticated;
revoke all on function public.release_stale_place_find_reservations(integer) from public,anon,authenticated;
revoke all on function public.close_place_find_wallet(uuid) from public,anon,authenticated;
revoke all on function public.cancel_share_job(uuid) from public,anon;
revoke all on function public.retry_share_job(uuid) from public,anon;
revoke all on function public.archive_active_queue_for_user(uuid[]) from public,anon;
grant execute on function public.ensure_place_find_wallet(uuid,boolean),
  public.reserve_place_find_use(uuid,uuid),public.settle_place_find_use(uuid,text,text),
  public.create_share_job_for_user(uuid,text,text,text,text,integer,boolean,boolean),
  public.resume_place_find_job(uuid,uuid),public.apply_dev_mock_place_find_purchase(uuid,text,text),
  public.release_stale_place_find_reservations(integer),public.close_place_find_wallet(uuid) to service_role;
grant execute on function public.cancel_share_job(uuid) to authenticated;
grant execute on function public.retry_share_job(uuid) to authenticated;
grant execute on function public.archive_active_queue_for_user(uuid[]) to authenticated,service_role;
