-- Nearr-Dev monetization experiment V2.
-- Additive policy/configuration changes layered on the V1 authoritative wallet.
-- This migration is intentionally safe-by-default: it does not enable the experiment.

set check_function_bodies = off;

alter table public.token_monetization_config
  add column if not exists offer_version text not null default 'nearr_dev_v1_2026_09',
  add column if not exists monthly_allowance integer not null default 3 check (monthly_allowance > 0),
  add column if not exists reward_activated_at timestamptz not null default '2026-09-10 00:00:00+00';

update public.token_monetization_config set
  offer_version='nearr_dev_v2_2026_09',
  monthly_allowance=10,
  monthly_allowance_start_month='2026-09-01',
  reward_activated_at='2026-09-10 00:00:00+00',
  updated_at=now()
where environment_name='development';

alter table public.place_find_products
  add column if not exists package_id text,
  add column if not exists offer_version text,
  add column if not exists usd_target_cents integer check (usd_target_cents is null or usd_target_cents > 0);

update public.place_find_products set package_id=case product_id
    when 'com.nearr.tokens.20.v1' then 'tokens_20'
    when 'com.nearr.tokens.50.v1' then 'tokens_50'
    when 'com.nearr.tokens.100.v1' then 'tokens_100'
    else package_id end,
  offer_version=coalesce(offer_version,'nearr_dev_v1_2026_09')
where product_id in ('com.nearr.tokens.20.v1','com.nearr.tokens.50.v1','com.nearr.tokens.100.v1');

insert into public.place_find_products(
  product_id,use_count,product_kind,sort_order,active,package_id,offer_version,usd_target_cents
) values
  ('com.nearr.tokens.20.v2',20,'storekit_consumable',110,true,'tokens_20_v2','nearr_dev_v2_2026_09',120),
  ('com.nearr.tokens.50.v2',50,'storekit_consumable',120,true,'tokens_50_v2','nearr_dev_v2_2026_09',250),
  ('com.nearr.tokens.200.v2',200,'storekit_consumable',130,true,'tokens_200_v2','nearr_dev_v2_2026_09',500)
on conflict(product_id) do update set
  use_count=excluded.use_count,package_id=excluded.package_id,
  offer_version=excluded.offer_version,usd_target_cents=excluded.usd_target_cents,
  active=true,updated_at=now();

create table if not exists public.nearr_pro_products (
  product_id text primary key,
  entitlement_id text not null,
  package_id text not null,
  offer_version text not null,
  usd_target_cents integer not null check (usd_target_cents > 0),
  active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.nearr_pro_products(
  product_id,entitlement_id,package_id,offer_version,usd_target_cents,active
) values(
  'com.nearr.pro.monthly.v1','nearr_pro','$rc_monthly','nearr_dev_v2_2026_09',100,true
) on conflict(product_id) do update set
  entitlement_id=excluded.entitlement_id,package_id=excluded.package_id,
  offer_version=excluded.offer_version,usd_target_cents=excluded.usd_target_cents,
  active=true,updated_at=now();

create table if not exists public.nearr_pro_access (
  user_id uuid primary key references auth.users(id) on delete cascade,
  product_id text not null references public.nearr_pro_products(product_id),
  entitlement_id text not null,
  original_transaction_id text,
  latest_transaction_id text,
  active_until timestamptz not null,
  status text not null check(status in ('active','cancelled_active','billing_issue','expired','revoked')),
  will_renew boolean not null default true,
  latest_event_at timestamptz not null,
  latest_event_id text not null,
  updated_at timestamptz not null default now()
);
create index if not exists nearr_pro_access_active_idx on public.nearr_pro_access(active_until) where status not in ('expired','revoked');

alter table public.revenuecat_webhook_events
  add column if not exists event_timestamp_at timestamptz,
  add column if not exists expiration_at timestamptz,
  add column if not exists original_transaction_id text,
  add column if not exists entitlement_ids jsonb,
  add column if not exists event_reason text;

alter table public.share_jobs add column if not exists submission_path text;
alter table public.share_jobs drop constraint if exists share_jobs_submission_path_check;
alter table public.share_jobs add constraint share_jobs_submission_path_check check(
  submission_path is null or submission_path in ('share_extension','host_app','background_import')
);
alter table public.share_jobs drop constraint if exists share_jobs_billing_mode_check;
alter table public.share_jobs add constraint share_jobs_billing_mode_check check(
  billing_mode in ('normal_free','premium_request','unmetered_legacy','onboarding_free',
    'metered','blocked_anonymous','source_replay_free','pro')
);

alter table public.place_find_lots drop constraint if exists place_find_lots_source_kind_check;
alter table public.place_find_lots add constraint place_find_lots_source_kind_check check (
  source_kind in (
    'free_lifetime','beta_grant','welcome_grant','monthly_allowance','earned_reward',
    'dev_mock_purchase','storekit_purchase','revenuecat_purchase','credit_back','admin_adjustment'
  )
);
alter table public.place_find_ledger drop constraint if exists place_find_ledger_entry_type_check;
alter table public.place_find_ledger add constraint place_find_ledger_entry_type_check check (
  entry_type in (
    'free_grant','monthly_grant','reward_grant','dev_mock_purchase','storekit_purchase',
    'revenuecat_purchase','reserve','consume','release','expire','refund_revoke',
    'refund_reversal','credit_back','admin_adjustment'
  )
);

create table if not exists public.token_reward_definitions (
  reward_key text primary key,
  offer_version text not null,
  title text not null,
  description text not null,
  target_count integer not null check(target_count > 0),
  reward_tokens integer not null check(reward_tokens > 0),
  sort_order integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.token_reward_definitions(
  reward_key,offer_version,title,description,target_count,reward_tokens,sort_order,active
) values
  ('save_5_videos_v1','nearr_dev_v2_2026_09','Save 5 videos','Find useful places from five different videos.',5,8,10,true),
  ('share_extension_save_v1','nearr_dev_v2_2026_09','Share a video to Nearr','Save a useful place using the share extension.',1,2,20,true)
on conflict(reward_key) do update set title=excluded.title,description=excluded.description,
  target_count=excluded.target_count,reward_tokens=excluded.reward_tokens,
  sort_order=excluded.sort_order,active=excluded.active,updated_at=now();

create table if not exists public.token_reward_claims (
  user_id uuid not null references auth.users(id) on delete cascade,
  reward_key text not null references public.token_reward_definitions(reward_key),
  wallet_id uuid not null references public.place_find_wallets(id),
  progress_at_claim integer not null,
  reward_tokens integer not null,
  claimed_at timestamptz not null default now(),
  primary key(user_id,reward_key)
);

create table if not exists public.monetization_offer_exposures (
  user_id uuid not null references auth.users(id) on delete cascade,
  offer_version text not null,
  surface text not null,
  displayed_products jsonb not null default '[]'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key(user_id,offer_version,surface)
);

alter table public.nearr_pro_products enable row level security;
alter table public.nearr_pro_access enable row level security;
alter table public.token_reward_definitions enable row level security;
alter table public.token_reward_claims enable row level security;
alter table public.monetization_offer_exposures enable row level security;
revoke all on public.nearr_pro_products,public.nearr_pro_access,public.token_reward_definitions,
  public.token_reward_claims,public.monetization_offer_exposures from public,anon,authenticated;
grant all on public.nearr_pro_products,public.nearr_pro_access,public.token_reward_definitions,
  public.token_reward_claims,public.monetization_offer_exposures to service_role;
grant select on public.nearr_pro_products,public.nearr_pro_access,public.token_reward_definitions,
  public.token_reward_claims to authenticated;
drop policy if exists nearr_pro_product_read on public.nearr_pro_products;
create policy nearr_pro_product_read on public.nearr_pro_products for select to authenticated using(active);
drop policy if exists nearr_pro_owner_read on public.nearr_pro_access;
create policy nearr_pro_owner_read on public.nearr_pro_access for select to authenticated using(user_id=auth.uid());
drop policy if exists token_reward_definition_read on public.token_reward_definitions;
create policy token_reward_definition_read on public.token_reward_definitions for select to authenticated using(active);
drop policy if exists token_reward_claim_owner_read on public.token_reward_claims;
create policy token_reward_claim_owner_read on public.token_reward_claims for select to authenticated using(user_id=auth.uid());

create or replace function public.has_active_nearr_pro(p_user_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.nearr_pro_access p where p.user_id=p_user_id
    and p.active_until>now() and p.status not in ('expired','revoked'));
$$;

create or replace function public.grant_place_find_lot(
  p_wallet_id uuid,p_source_kind text,p_source_reference text,p_uses integer,
  p_expires_at timestamptz default null,p_reason_code text default null
) returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare v_lot_id uuid;
begin
  if p_uses<1 then raise exception 'invalid_grant_amount';end if;
  insert into public.place_find_lots(wallet_id,source_kind,source_reference,granted_uses,available_uses,expires_at)
    values(p_wallet_id,p_source_kind,p_source_reference,p_uses,p_uses,p_expires_at)
    on conflict(wallet_id,source_kind,source_reference) do nothing returning id into v_lot_id;
  if v_lot_id is null then return false;end if;
  update public.place_find_wallets set available_uses=available_uses+p_uses,version=version+1,updated_at=now()
    where id=p_wallet_id;
  insert into public.place_find_ledger(wallet_id,lot_id,entry_type,available_delta,reason_code,idempotency_key)
  values(p_wallet_id,v_lot_id,case when p_source_kind='monthly_allowance' then 'monthly_grant'
      when p_source_kind='earned_reward' then 'reward_grant'
      when p_source_kind='revenuecat_purchase' then 'revenuecat_purchase'
      when p_source_kind='credit_back' then 'credit_back' else 'free_grant' end,
    p_uses,coalesce(p_reason_code,p_source_kind),
    'grant:'||p_source_kind||':'||p_wallet_id::text||':'||p_source_reference);
  return true;
end;
$$;

-- Grant or top up only the current UTC month. A prior 3-token grant becomes 10
-- by adding exactly seven to that lot, including when some tokens are spent or reserved.
create or replace function public.ensure_monthly_allowance_v2(p_wallet_id uuid)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.token_monetization_config%rowtype; v_month date; v_expiry timestamptz;
  v_lot public.place_find_lots%rowtype; v_delta integer:=0;
begin
  select * into v_cfg from public.token_monetization_config where environment_name='development';
  if not coalesce(v_cfg.enabled,false) then return 0; end if;
  v_month:=(date_trunc('month',now() at time zone 'UTC'))::date;
  if v_month<v_cfg.monthly_allowance_start_month then return 0; end if;
  v_expiry:=((v_month+interval '1 month')::timestamp at time zone 'UTC');
  select * into v_lot from public.place_find_lots where wallet_id=p_wallet_id
    and source_kind='monthly_allowance' and source_reference=to_char(v_month,'YYYY-MM') for update;
  if not found then
    perform public.grant_place_find_lot(p_wallet_id,'monthly_allowance',to_char(v_month,'YYYY-MM'),
      v_cfg.monthly_allowance,v_expiry,'monthly_unconditional_v2');
    return v_cfg.monthly_allowance;
  end if;
  v_delta:=greatest(0,v_cfg.monthly_allowance-v_lot.granted_uses);
  if v_delta=0 then return 0; end if;
  if exists(select 1 from public.place_find_ledger where idempotency_key=
    'monthly_top_up:v2:'||p_wallet_id::text||':'||to_char(v_month,'YYYY-MM')) then return 0; end if;
  update public.place_find_lots set granted_uses=granted_uses+v_delta,
    available_uses=available_uses+v_delta,expires_at=v_expiry where id=v_lot.id;
  update public.place_find_wallets set available_uses=available_uses+v_delta,
    version=version+1,updated_at=now() where id=p_wallet_id;
  insert into public.place_find_ledger(wallet_id,lot_id,entry_type,available_delta,reason_code,idempotency_key)
    values(p_wallet_id,v_lot.id,'monthly_grant',v_delta,'monthly_v1_to_v2_top_up',
      'monthly_top_up:v2:'||p_wallet_id::text||':'||to_char(v_month,'YYYY-MM'));
  return v_delta;
end;
$$;

create or replace function public.ensure_place_find_wallet(
  p_user_id uuid,p_is_anonymous boolean default false
) returns table(wallet_id uuid,available_uses integer,reserved_uses integer,
  app_account_token uuid,granted_free boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_wallet public.place_find_wallets%rowtype; v_user_created timestamptz;
  v_cfg public.token_monetization_config%rowtype; v_granted boolean:=false;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  insert into public.place_find_wallets(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into v_wallet from public.place_find_wallets where user_id=p_user_id and status='active' for update;
  if not found then raise exception 'active_wallet_not_found'; end if;
  perform public.expire_place_find_lots(v_wallet.id);
  select * into v_cfg from public.token_monetization_config where environment_name='development';
  if coalesce(v_cfg.enabled,false) and not p_is_anonymous then
    select created_at into v_user_created from auth.users where id=p_user_id;
    if to_regclass('public.onboarding_v2_sessions') is not null then
      execute 'select greatest($2,coalesce(max(s.upgraded_at),$2)) from public.onboarding_v2_sessions s where s.permanent_user_id=$1'
        into v_user_created using p_user_id,v_user_created;
    end if;
    -- Preserve the existing beta cutoff and gift. V2 never creates a welcome lot.
    if v_user_created<v_cfg.rollout_cutoff then
      v_granted:=public.grant_place_find_lot(v_wallet.id,'beta_grant','beta_v1',10,null,'beta_v1') or v_granted;
    end if;
    v_granted:=(public.ensure_monthly_allowance_v2(v_wallet.id)>0) or v_granted;
  end if;
  select * into v_wallet from public.place_find_wallets where id=v_wallet.id;
  return query select v_wallet.id,v_wallet.available_uses,v_wallet.reserved_uses,
    v_wallet.app_account_token,v_granted;
end;
$$;

create or replace function public.token_reward_progress_count(p_user_id uuid,p_reward_key text)
returns integer language plpgsql stable security definer set search_path=public,pg_temp as $$
declare v_activation timestamptz; v_count integer:=0;
begin
  select reward_activated_at into v_activation from public.token_monetization_config where environment_name='development';
  if p_reward_key='save_5_videos_v1' then
    select count(distinct coalesce(nullif(j.canonical_url,''),j.source_url))::integer into v_count
      from public.token_qualifying_save_events e join public.share_jobs j on j.id=e.share_job_id
     where e.user_id=p_user_id and e.activity_kind='video' and e.evidence_kind='live'
       and e.occurred_at>=v_activation and j.billing_mode in ('metered','pro')
       and j.submission_path in ('share_extension','host_app') and j.saved_place_id is not null;
  elsif p_reward_key='share_extension_save_v1' then
    select count(distinct coalesce(nullif(j.canonical_url,''),j.source_url))::integer into v_count
      from public.token_qualifying_save_events e join public.share_jobs j on j.id=e.share_job_id
     where e.user_id=p_user_id and e.activity_kind='video' and e.evidence_kind='live'
       and e.occurred_at>=v_activation and j.billing_mode in ('metered','pro')
       and j.submission_path='share_extension' and j.saved_place_id is not null;
  end if;
  return coalesce(v_count,0);
end;
$$;

create or replace function public.get_token_reward_status(p_user_id uuid)
returns table(reward_key text,title text,description text,target_count integer,reward_tokens integer,
  progress_count integer,state text,claimed_at timestamptz)
language sql stable security definer set search_path=public,pg_temp as $$
  select d.reward_key,d.title,d.description,d.target_count,d.reward_tokens,
    least(d.target_count,public.token_reward_progress_count(p_user_id,d.reward_key)),
    case when c.claimed_at is not null then 'claimed'
      when public.token_reward_progress_count(p_user_id,d.reward_key)>=d.target_count then 'ready'
      else 'in_progress' end,c.claimed_at
  from public.token_reward_definitions d left join public.token_reward_claims c
    on c.user_id=p_user_id and c.reward_key=d.reward_key
  where d.active order by d.sort_order,d.reward_key;
$$;

create or replace function public.claim_token_reward(p_user_id uuid,p_reward_key text)
returns table(claimed boolean,replayed boolean,reward_tokens integer,available_uses integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_definition public.token_reward_definitions%rowtype; v_wallet public.place_find_wallets%rowtype;
  v_progress integer; v_inserted integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_reward_key,0));
  select * into v_definition from public.token_reward_definitions where reward_key=p_reward_key and active;
  if not found then raise exception 'reward_not_found'; end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  select * into v_wallet from public.place_find_wallets where user_id=p_user_id and status='active' for update;
  if exists(select 1 from public.token_reward_claims where user_id=p_user_id and reward_key=p_reward_key) then
    return query select true,true,v_definition.reward_tokens,v_wallet.available_uses; return;
  end if;
  v_progress:=public.token_reward_progress_count(p_user_id,p_reward_key);
  if v_progress<v_definition.target_count then raise exception 'reward_not_ready'; end if;
  insert into public.token_reward_claims(user_id,reward_key,wallet_id,progress_at_claim,reward_tokens)
    values(p_user_id,p_reward_key,v_wallet.id,v_progress,v_definition.reward_tokens)
    on conflict(user_id,reward_key) do nothing;
  get diagnostics v_inserted=row_count;
  if v_inserted=0 then
    return query select true,true,v_definition.reward_tokens,v_wallet.available_uses; return;
  end if;
  perform public.grant_place_find_lot(v_wallet.id,'earned_reward',p_reward_key,
    v_definition.reward_tokens,null,p_reward_key);
  select * into v_wallet from public.place_find_wallets where id=v_wallet.id;
  insert into public.analytics_events(user_id,event_name,properties) values(
    p_user_id,'token_reward_claimed',jsonb_build_object('reward_key',p_reward_key,'tokens',v_definition.reward_tokens)
  );
  return query select true,false,v_definition.reward_tokens,v_wallet.available_uses;
end;
$$;

create or replace function public.record_share_job_submission_path(p_user_id uuid,p_job_id uuid,p_path text)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if p_path not in ('share_extension','host_app','background_import') then raise exception 'invalid_submission_path'; end if;
  update public.share_jobs set submission_path=coalesce(submission_path,p_path)
    where id=p_job_id and user_id=p_user_id;
  return found;
end;
$$;

create or replace function public.settle_monetized_share_job_transition()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare v_action text; v_reason text;
begin
  if new.billing_mode='metered' then
    if new.status='completed' and new.saved_place_id is not null then
      v_action:='consume';v_reason:='useful_saved_place';
    elsif new.status='needs_help' and new.saved_place_id is not null then
      v_action:='consume';v_reason:='useful_partial_saved_place';
    elsif new.status='needs_help' then v_action:='hold';v_reason:='awaiting_user_confirmation';
    elsif new.status in ('failed','cancelled') then
      v_action:='release';v_reason:=case when new.status='cancelled' then 'user_abandoned' else coalesce(new.failure_reason,'no_useful_result') end;
    else return new; end if;
    perform * from public.settle_place_find_use(new.id,v_action,v_reason);
  elsif new.billing_mode='pro' and new.status in ('completed','needs_help','failed','cancelled') then
    if new.saved_place_id is not null and new.status in ('completed','needs_help') then
      insert into public.token_qualifying_save_events(user_id,activity_key,activity_kind,saved_place_id,share_job_id,occurred_at)
        values(new.user_id,'video:job:'||new.id::text,'video',new.saved_place_id,new.id,coalesce(new.completed_at,now()))
        on conflict(activity_key) do nothing;
      update public.share_jobs set billing_outcome='pro_covered:useful_saved_place',billing_settled_at=now() where id=new.id;
      insert into public.analytics_events(user_id,event_name,properties) values(
        new.user_id,'pro_video_find_succeeded',jsonb_build_object('share_job_id',new.id,'source_platform',new.source_platform));
    else
      update public.share_jobs set billing_outcome='pro_covered:no_useful_result',billing_settled_at=now() where id=new.id;
      insert into public.analytics_events(user_id,event_name,properties) values(
        new.user_id,'pro_video_find_failed',jsonb_build_object('share_job_id',new.id,'status',new.status,'reason',coalesce(new.failure_reason,new.needs_help_reason)));
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists share_jobs_settle_metered_token on public.share_jobs;
drop trigger if exists share_jobs_settle_monetized_access on public.share_jobs;
create trigger share_jobs_settle_monetized_access after update of status,saved_place_id on public.share_jobs
  for each row when(new.billing_mode in ('metered','pro') and
    (old.status is distinct from new.status or old.saved_place_id is distinct from new.saved_place_id))
  execute function public.settle_monetized_share_job_transition();

-- V2 creation persists one immutable authorization decision per job. A Pro
-- job remains Pro-covered if access expires while work is in flight.
create or replace function public.create_share_job_for_user(
  p_user_id uuid,p_source_url text,p_canonical_url text,p_source_platform text,
  p_idempotency_key text default null,p_dedupe_window_seconds integer default 90,
  p_is_anonymous boolean default false,p_force_rerun boolean default false,
  p_enforce_tokens boolean default false
) returns table(job_id uuid,status text,duplicate boolean,requires_purchase boolean,available_uses integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_existing public.share_jobs%rowtype;v_job public.share_jobs%rowtype;
  v_available integer:=0;v_enforce boolean:=false;v_lock_key bigint;v_claimed integer:=0;
  v_pro boolean:=false;v_prior_completed boolean:=false;
begin
  if p_user_id is null then raise exception 'missing_user_id'; end if;
  perform p_dedupe_window_seconds,p_force_rerun;
  select p_enforce_tokens and enabled into v_enforce from public.token_monetization_config where environment_name='development';
  v_enforce:=coalesce(v_enforce,false);
  v_lock_key:=hashtextextended(p_user_id::text||':'||coalesce(p_canonical_url,p_source_url,''),0);
  perform pg_advisory_xact_lock(v_lock_key);
  if v_enforce and not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id,false);
    v_pro:=public.has_active_nearr_pro(p_user_id);
    select w.available_uses into v_available from public.place_find_wallets w where w.user_id=p_user_id;
  end if;
  if nullif(trim(p_idempotency_key),'') is not null then
    select * into v_existing from public.share_jobs where user_id=p_user_id and idempotency_key=p_idempotency_key limit 1;
    if found then return query select v_existing.id,v_existing.status,true,v_existing.status='awaiting_purchase',v_available;return;end if;
  end if;
  select * into v_existing from public.share_jobs where user_id=p_user_id and canonical_url=p_canonical_url
    and recognition_run_mode='normal' and status in ('awaiting_purchase','queued','processing_metadata') order by created_at desc limit 1;
  if found then return query select v_existing.id,v_existing.status,true,v_existing.status='awaiting_purchase',v_available;return;end if;
  v_prior_completed:=exists(select 1 from public.share_jobs where user_id=p_user_id and canonical_url=p_canonical_url
    and recognition_run_mode='normal' and status='completed');
  insert into public.share_jobs(user_id,source_url,canonical_url,source_platform,status,progress_stage,
    idempotency_key,billing_mode,billing_outcome,billing_settled_at,recognition_run_mode)
  values(p_user_id,p_source_url,p_canonical_url,p_source_platform,
    case when not v_enforce or v_pro or v_prior_completed then 'queued' else 'awaiting_purchase' end,
    case when not v_enforce or v_pro or v_prior_completed then 'queued' else 'awaiting_purchase' end,p_idempotency_key,
    case when not v_enforce then 'normal_free' when p_is_anonymous then 'blocked_anonymous'
      when v_prior_completed then 'source_replay_free' when v_pro then 'pro' else 'metered' end,
    case when v_prior_completed then 'unmetered:previously_charged_source'
      when not v_enforce then 'unmetered:normal_free' else null end,
    case when v_prior_completed or not v_enforce then now() else null end,'normal') returning * into v_job;
  if v_enforce and p_is_anonymous then
    insert into public.place_find_onboarding_claims(anonymous_user_id,share_job_id) values(p_user_id,v_job.id)
      on conflict(anonymous_user_id) do nothing;get diagnostics v_claimed=row_count;
    if v_claimed=1 then update public.share_jobs set status='queued',progress_stage='queued',billing_mode='onboarding_free'
      where id=v_job.id returning * into v_job;end if;
  elsif v_enforce and not v_pro and not v_prior_completed then
    begin
      perform * from public.reserve_place_find_use(p_user_id,v_job.id);
      update public.share_jobs set status='queued',progress_stage='queued' where id=v_job.id returning * into v_job;
      select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
    exception when raise_exception then if sqlerrm<>'insufficient_place_finds' then raise;end if;end;
  elsif v_pro then
    insert into public.analytics_events(user_id,event_name,properties) values(
      p_user_id,'pro_video_find_authorized',jsonb_build_object('share_job_id',v_job.id));
  elsif v_prior_completed then
    insert into public.analytics_events(user_id,event_name,properties) values(
      p_user_id,'video_find_source_replay_free',jsonb_build_object('share_job_id',v_job.id));
  end if;
  if v_enforce and v_job.status='awaiting_purchase' then
    insert into public.analytics_events(user_id,event_name,properties) values(
      p_user_id,'token_zero_balance_exposed',jsonb_build_object('share_job_id',v_job.id,'anonymous',p_is_anonymous));
  end if;
  return query select v_job.id,v_job.status,false,v_job.status='awaiting_purchase',v_available;
end;
$$;

create or replace function public.resume_place_find_job(p_user_id uuid,p_job_id uuid)
returns table(job_id uuid,status text,available_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype;v_available integer:=0;v_pro boolean:=false;
begin
  select * into v_job from public.share_jobs where id=p_job_id and user_id=p_user_id for update;
  if not found then raise exception 'share_job_not_found';end if;
  if v_job.status<>'awaiting_purchase' then
    select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
    return query select v_job.id,v_job.status,coalesce(v_available,0),true;return;
  end if;
  perform * from public.ensure_place_find_wallet(p_user_id,false);
  v_pro:=public.has_active_nearr_pro(p_user_id);
  if not v_pro then perform * from public.reserve_place_find_use(p_user_id,p_job_id);end if;
  update public.share_jobs set status='queued',progress_stage='queued',billing_mode=case when v_pro then 'pro' else 'metered' end,updated_at=now()
    where id=p_job_id returning * into v_job;
  select available_uses into v_available from public.place_find_wallets where user_id=p_user_id;
  insert into public.analytics_events(user_id,event_name,properties) values(
    p_user_id,case when v_pro then 'pro_pending_job_resumed' else 'token_pending_job_resumed' end,
    jsonb_build_object('share_job_id',p_job_id));
  return query select v_job.id,v_job.status,v_available,false;
end;
$$;

create or replace function public.resume_pending_place_find_jobs(p_user_id uuid,p_limit integer default 25)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job record;v_count integer:=0;
begin
  for v_job in select id from public.share_jobs where user_id=p_user_id and status='awaiting_purchase'
    order by created_at for update skip locked limit greatest(1,least(p_limit,100))
  loop
    begin perform * from public.resume_place_find_job(p_user_id,v_job.id);v_count:=v_count+1;
    exception when raise_exception then if sqlerrm='insufficient_place_finds' then exit;else raise;end if;end;
  end loop;
  return v_count;
end;
$$;

create or replace function public.convert_pending_token_jobs_to_pro(p_user_id uuid,p_event_id text)
returns integer language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job record;v_count integer:=0;
begin
  for v_job in select j.id from public.share_jobs j join public.place_find_reservations r on r.share_job_id=j.id
    where j.user_id=p_user_id and j.billing_mode='metered' and j.status in ('queued','processing_metadata','needs_help')
      and r.status='reserved' for update of j skip locked
  loop
    perform * from public.settle_place_find_use(v_job.id,'release','upgraded_to_pro');
    update public.share_jobs set billing_mode='pro',billing_outcome='pro_authorized:'||p_event_id,billing_settled_at=null where id=v_job.id;
    v_count:=v_count+1;
  end loop;
  v_count:=v_count+public.resume_pending_place_find_jobs(p_user_id,100);
  return v_count;
end;
$$;

create or replace function public.process_revenuecat_subscription_event(
  p_event_id text,p_event_type text,p_project_id text,p_app_id text,p_purchase_environment text,p_store text,
  p_user_id uuid,p_product_id text,p_transaction_id text,p_original_transaction_id text,
  p_event_at timestamptz,p_purchased_at timestamptz,p_expiration_at timestamptz,
  p_entitlement_ids jsonb,p_reason text,p_payload_sha256 text
) returns table(result_code text,active boolean,active_until timestamptz,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.token_monetization_config%rowtype;v_product public.nearr_pro_products%rowtype;
  v_access public.nearr_pro_access%rowtype;v_result text:='ignored';v_active boolean:=false;
  v_replayed boolean:=false;v_had_access boolean:=false;
begin
  select * into v_cfg from public.token_monetization_config where environment_name='development';
  if not coalesce(v_cfg.enabled,false) then raise exception 'token_monetization_disabled';end if;
  if p_project_id is distinct from v_cfg.revenuecat_project_id or p_app_id is distinct from v_cfg.revenuecat_app_id then raise exception 'revenuecat_context_mismatch';end if;
  if p_purchase_environment<>'SANDBOX' then raise exception 'production_event_forbidden';end if;
  if not(upper(coalesce(p_store,''))=any(v_cfg.revenuecat_allowed_stores)) then raise exception 'revenuecat_store_mismatch';end if;
  select * into v_product from public.nearr_pro_products where product_id=p_product_id and active;
  if not found or not(p_entitlement_ids ? v_product.entitlement_id) then raise exception 'unapproved_subscription_product';end if;
  if exists(select 1 from public.revenuecat_webhook_events where event_id=p_event_id) then
    select * into v_access from public.nearr_pro_access where user_id=p_user_id;
    return query select 'duplicate_event',public.has_active_nearr_pro(p_user_id),v_access.active_until,true;return;
  end if;
  insert into public.revenuecat_webhook_events(event_id,event_type,project_id,app_id,purchase_environment,app_user_id,
    product_id,transaction_id,payload_sha256,result_code,event_timestamp_at,expiration_at,original_transaction_id,entitlement_ids,event_reason)
  values(p_event_id,p_event_type,p_project_id,p_app_id,p_purchase_environment,p_user_id::text,p_product_id,p_transaction_id,
    p_payload_sha256,'processing',p_event_at,p_expiration_at,p_original_transaction_id,p_entitlement_ids,p_reason);
  select * into v_access from public.nearr_pro_access where user_id=p_user_id for update;
  v_had_access:=found;
  if p_event_type in ('INITIAL_PURCHASE','RENEWAL','UNCANCELLATION','SUBSCRIPTION_EXTENDED','TEMPORARY_ENTITLEMENT_GRANT','REFUND_REVERSED') then
    if p_expiration_at is null then raise exception 'subscription_expiration_required';end if;
    if not v_had_access or p_event_at>=v_access.latest_event_at or p_expiration_at>v_access.active_until then
      insert into public.nearr_pro_access(user_id,product_id,entitlement_id,original_transaction_id,latest_transaction_id,
        active_until,status,will_renew,latest_event_at,latest_event_id)
      values(p_user_id,p_product_id,v_product.entitlement_id,p_original_transaction_id,p_transaction_id,p_expiration_at,
        'active',true,p_event_at,p_event_id)
      on conflict(user_id) do update set product_id=excluded.product_id,entitlement_id=excluded.entitlement_id,
        original_transaction_id=coalesce(nearr_pro_access.original_transaction_id,excluded.original_transaction_id),
        latest_transaction_id=excluded.latest_transaction_id,active_until=greatest(nearr_pro_access.active_until,excluded.active_until),
        status='active',will_renew=true,latest_event_at=greatest(nearr_pro_access.latest_event_at,excluded.latest_event_at),
        latest_event_id=case when excluded.latest_event_at>=nearr_pro_access.latest_event_at then excluded.latest_event_id else nearr_pro_access.latest_event_id end,updated_at=now();
      perform public.convert_pending_token_jobs_to_pro(p_user_id,p_event_id);v_result:='pro_activated';
    else v_result:='stale_activation_ignored';v_replayed:=true;end if;
  elsif p_event_type='CANCELLATION' then
    if not v_had_access then v_result:='cancellation_without_access';
    elsif p_event_at<v_access.latest_event_at and coalesce(p_expiration_at,'epoch')<=v_access.active_until then v_result:='stale_cancellation_ignored';v_replayed:=true;
    else
      update public.nearr_pro_access set will_renew=false,
        active_until=greatest(active_until,coalesce(p_expiration_at,active_until)),
        status=case when coalesce(p_expiration_at,active_until)<=now() then 'revoked' else 'cancelled_active' end,
        latest_event_at=greatest(latest_event_at,p_event_at),latest_event_id=p_event_id,updated_at=now() where user_id=p_user_id;
      v_result:=case when coalesce(p_expiration_at,v_access.active_until)<=now() then 'pro_revoked' else 'pro_cancelled_active' end;
    end if;
  elsif p_event_type='BILLING_ISSUE' then
    if v_had_access and (p_event_at>=v_access.latest_event_at or coalesce(p_expiration_at,'epoch')>=v_access.active_until) then
      update public.nearr_pro_access set active_until=greatest(active_until,coalesce(p_expiration_at,active_until)),
        status=case when greatest(active_until,coalesce(p_expiration_at,active_until))>now() then 'billing_issue' else 'expired' end,
        latest_event_at=greatest(latest_event_at,p_event_at),latest_event_id=p_event_id,updated_at=now() where user_id=p_user_id;
      v_result:='billing_issue_recorded';
    else v_result:='stale_billing_issue_ignored';v_replayed:=true;end if;
  elsif p_event_type='EXPIRATION' then
    if v_had_access and coalesce(p_expiration_at,'epoch')>=v_access.active_until then
      update public.nearr_pro_access set active_until=coalesce(p_expiration_at,active_until),status='expired',will_renew=false,
        latest_event_at=greatest(latest_event_at,p_event_at),latest_event_id=p_event_id,updated_at=now() where user_id=p_user_id;
      v_result:='pro_expired';
    else v_result:='stale_expiration_ignored';v_replayed:=true;end if;
  elsif p_event_type in ('PRODUCT_CHANGE','SUBSCRIPTION_PAUSED') then v_result:='subscription_change_recorded';
  else raise exception 'unsupported_subscription_event';end if;
  update public.revenuecat_webhook_events set result_code=v_result,processed_at=now() where event_id=p_event_id;
  select * into v_access from public.nearr_pro_access where user_id=p_user_id;
  v_active:=public.has_active_nearr_pro(p_user_id);
  insert into public.analytics_events(user_id,event_name,properties) values(
    p_user_id,'pro_subscription_event',jsonb_build_object('event_type',p_event_type,'result',v_result,'active',v_active,'test',true));
  return query select v_result,v_active,v_access.active_until,v_replayed;
end;
$$;

revoke all on function public.has_active_nearr_pro(uuid),public.ensure_monthly_allowance_v2(uuid),
  public.token_reward_progress_count(uuid,text),public.get_token_reward_status(uuid),
  public.claim_token_reward(uuid,text),public.record_share_job_submission_path(uuid,uuid,text),
  public.resume_pending_place_find_jobs(uuid,integer),public.convert_pending_token_jobs_to_pro(uuid,text),
  public.process_revenuecat_subscription_event(text,text,text,text,text,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.has_active_nearr_pro(uuid),public.ensure_monthly_allowance_v2(uuid),
  public.token_reward_progress_count(uuid,text),public.get_token_reward_status(uuid),
  public.claim_token_reward(uuid,text),public.record_share_job_submission_path(uuid,uuid,text),
  public.resume_pending_place_find_jobs(uuid,integer),public.convert_pending_token_jobs_to_pro(uuid,text),
  public.process_revenuecat_subscription_event(text,text,text,text,text,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text,text)
  to service_role;
revoke all on function public.settle_monetized_share_job_transition() from public,anon,authenticated;

-- Rollback: disable token_monetization_config first. Existing V2 lots and event
-- history remain auditable; drop only the V2 trigger/functions/tables after all
-- in-flight jobs are terminal. Never rewrite old ledger entries.
