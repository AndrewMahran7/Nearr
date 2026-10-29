-- Local qualification candidate. No sales, provider, region or catalog is enabled.
-- Reuses the durable legacy purchase ledger; never converts or deletes old grants.
set check_function_bodies = off;

alter table public.nearr_plus_config add column subscription_benefit text not null default 'unlimited'
  check(subscription_benefit='unlimited');
alter table public.nearr_plus_config add column token_catalog_verified boolean not null default false;
alter table public.nearr_plus_config add column revenuecat_project_id text;
alter table public.nearr_plus_config add column revenuecat_token_product_ids jsonb not null default '{}'::jsonb;
alter table public.nearr_plus_config add column paid_find_policy_enabled boolean not null default false;
alter table public.nearr_plus_config add column legacy_obligations_reconciled boolean not null default false;
alter table public.nearr_plus_config add column legacy_obligations_evidence_reference text;
alter table public.nearr_plus_config add constraint paid_find_policy_qualified check
  (not paid_find_policy_enabled or (release_mode='paid' and enforce_allowance and release_qualified
    and catalog_verified and token_catalog_verified and free_finds=3
    and product_id='com.nearr.plus.unlimited.monthly.v1' and legacy_obligations_reconciled
    and nullif(btrim(legacy_obligations_evidence_reference),'') is not null));
-- plus_finds is retained only for the old product's historical obligation.
update public.nearr_plus_config set sales_enabled=false,enforce_allowance=false,
  release_qualified=false,catalog_verified=false,token_catalog_verified=false,
  paid_find_policy_enabled=false,release_mode='paid',
  product_id='com.nearr.plus.unlimited.monthly.v1',offering_id='nearr_paid_v1';

create table public.nearr_paid_finds (
  -- No FK to share_jobs: deletion cannot erase a financial idempotency key.
  job_id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  source_hash text not null,
  state text not null check(state in ('reserved','consumed','released','exempt')),
  funding text not null check(funding in ('plus','free','token','legacy_plus','exempt')),
  free_period timestamptz,
  legacy_period_key text,
  lot_id uuid references public.place_find_lots(id),
  cycle integer not null default 1 check(cycle>0),
  reason text,
  reserved_at timestamptz not null default now(),
  settled_at timestamptz,
  check((state='reserved')=(settled_at is null))
);
create index nearr_paid_finds_usage on public.nearr_paid_finds(user_id,free_period,state);
create unique index nearr_paid_finds_source_consumed on public.nearr_paid_finds(user_id,source_hash)
  where state='consumed';
create table public.nearr_paid_source_receipts (
  user_id uuid not null references auth.users(id) on delete cascade,
  source_hash text not null, job_id uuid not null references public.nearr_paid_finds(job_id),
  primary key(user_id,source_hash)
);
create table public.nearr_paid_wallet_owners (
  wallet_id uuid primary key references public.place_find_wallets(id),
  user_id uuid not null references auth.users(id) on delete cascade,
  transfer_grant_id uuid not null unique,
  transferred_at timestamptz not null default now()
);
create table public.nearr_legacy_plus_entitlements (like public.nearr_plus_entitlements including all);
alter table public.nearr_legacy_plus_entitlements add foreign key(user_id) references auth.users(id) on delete cascade;
insert into public.nearr_legacy_plus_entitlements select * from public.nearr_plus_entitlements where product_id='nearr_plus_monthly_v1';
create table public.nearr_paid_purchase_states (
  environment text not null check(environment in ('SANDBOX','PRODUCTION')),
  transaction_id text not null,
  wallet_id uuid not null references public.place_find_wallets(id),
  product_id text not null references public.place_find_products(product_id),
  state text not null check(state in ('verified','revoked')),
  event_type text not null check(event_type in ('NON_RENEWING_PURCHASE','CANCELLATION','REFUND_REVERSED')),
  occurred_at timestamptz not null,
  verified_at timestamptz not null,
  primary key(environment,transaction_id)
);
alter table public.nearr_paid_finds enable row level security;
alter table public.nearr_paid_purchase_states enable row level security;
alter table public.nearr_paid_source_receipts enable row level security;
alter table public.nearr_paid_wallet_owners enable row level security;
alter table public.nearr_legacy_plus_entitlements enable row level security;
revoke all on public.nearr_paid_finds,public.nearr_paid_purchase_states,public.nearr_paid_source_receipts,public.nearr_paid_wallet_owners,public.nearr_legacy_plus_entitlements from public,anon,authenticated;
grant all on public.nearr_paid_finds,public.nearr_paid_purchase_states,public.nearr_paid_source_receipts,public.nearr_paid_wallet_owners,public.nearr_legacy_plus_entitlements to service_role;

create function public.nearr_paid_owns_wallet(p_user_id uuid,p_wallet_id uuid) returns boolean
language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.place_find_wallets where id=p_wallet_id and user_id=p_user_id)
    or exists(select 1 from public.nearr_paid_wallet_owners where wallet_id=p_wallet_id and user_id=p_user_id)
$$;
revoke all on function public.nearr_paid_owns_wallet(uuid,uuid) from public,anon,authenticated;

create function public.nearr_paid_lock() returns void
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'paid_find_requires_read_committed'; end if;
  -- Same first lock as config/entitlement writers. These functions never lock
  -- or modify a share_jobs row after this lock (job triggers already own it).
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus_release_policy',0));
end $$;

-- Stop applying the old paid-period cap to free finds. Preserve historical rows.
create or replace function public.apply_nearr_plus_snapshot(p_user_id uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.nearr_plus_config%rowtype; t timestamptz;
begin
  perform public.nearr_paid_lock();
  select * into strict c from public.nearr_plus_config where id;
  if not exists(select 1 from public.nearr_plus_customers where user_id=p_user_id) then raise exception 'plus_customer_not_found'; end if;
  t:=(p_snapshot->>'verifiedAt')::timestamptz;
  if t is null or t>now()+interval '1 minute' or t<now()-interval '15 minutes'
    or p_snapshot->>'environment' is distinct from c.environment
    or (p_snapshot->>'state'<>'free' and p_snapshot->>'productId' is distinct from c.product_id)
    or (p_snapshot->>'state' in ('active','trial','intro','grace','cancelled') and
      ((p_snapshot->>'periodStart') is null or (p_snapshot->>'expiresAt') is null
        or (p_snapshot->>'accessUntil') is null or (p_snapshot->>'periodKey') is null))
    then raise exception 'plus_snapshot_invalid'; end if;
  insert into public.nearr_plus_entitlements(user_id,state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key)
    values(p_user_id,p_snapshot->>'state',p_snapshot->>'productId',(p_snapshot->>'periodStart')::timestamptz,
      (p_snapshot->>'expiresAt')::timestamptz,(p_snapshot->>'accessUntil')::timestamptz,t,c.environment,p_snapshot->>'periodKey')
    on conflict(user_id) do update set state=excluded.state,product_id=excluded.product_id,
      period_start=excluded.period_start,expires_at=excluded.expires_at,access_until=excluded.access_until,
      verified_at=excluded.verified_at,environment=excluded.environment,period_key=excluded.period_key,updated_at=now()
    where public.nearr_plus_entitlements.verified_at<excluded.verified_at
      or (public.nearr_plus_entitlements.verified_at=excluded.verified_at and excluded.state in ('free','expired','revoked')
        and public.nearr_plus_entitlements.state<>'revoked');
end $$;

create function public.nearr_paid_usage(p_user_id uuid,p_exclude_job uuid default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.nearr_plus_config%rowtype; e public.nearr_plus_entitlements%rowtype;
  m timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  next_month timestamptz:=(date_trunc('month',now() at time zone 'UTC')+interval '1 month') at time zone 'UTC';
  paid boolean; stale boolean; used_count integer; reserved_count integer; tokens integer; held integer;
  legacy_used integer; legacy_remaining integer:=0;
begin
  select * into strict c from public.nearr_plus_config where id;
  select * into e from public.nearr_plus_entitlements where user_id=p_user_id;
  paid:=coalesce(e.product_id=c.product_id and e.environment=c.environment and e.access_until>now()
    and e.state in ('active','trial','intro','grace','cancelled'),false);
  stale:=coalesce(e.product_id=c.product_id and e.environment=c.environment
    and e.state in ('active','trial','intro','grace','cancelled')
    and (e.access_until<=now() or e.verified_at<now()-interval '15 minutes' or e.verified_at>now()+interval '1 minute'),false);
  select count(*) filter(where state='consumed'),count(*) filter(where state='reserved')
    into used_count,reserved_count from public.nearr_paid_finds
    where user_id=p_user_id and funding='free' and free_period=m and job_id is distinct from p_exclude_job;
  -- Historical free consumption survives deployment; do not reset the month.
  used_count:=used_count+(select count(*) from public.nearr_plus_recognitions
    where user_id=p_user_id and state='consumed' and period_key is null and settled_at>=m);
  select * into e from public.nearr_legacy_plus_entitlements where user_id=p_user_id;
  if not paid and e.product_id='nearr_plus_monthly_v1' and e.environment=c.environment
    and e.state in ('active','trial','intro','grace','cancelled') and e.access_until<=now() then stale:=true; end if;
  if e.product_id='nearr_plus_monthly_v1' and e.environment=c.environment and e.access_until>now()
    and e.state in ('active','trial','intro','grace','cancelled') then
    if not paid and (e.verified_at<now()-interval '15 minutes' or e.verified_at>now()+interval '1 minute') then stale:=true; end if;
    select count(*) into legacy_used from public.nearr_plus_recognitions where period_key=e.period_key and state in ('consumed','reserved');
    legacy_remaining:=greatest(0,c.plus_finds-legacy_used-(select count(*) from public.nearr_paid_finds
      where legacy_period_key=e.period_key and funding='legacy_plus' and state in ('consumed','reserved') and job_id is distinct from p_exclude_job));
  end if;
  select coalesce(sum(l.available_uses),0),coalesce(sum(l.reserved_uses),0) into tokens,held
    from public.place_find_lots l join public.place_find_wallets w on w.id=l.wallet_id
    where public.nearr_paid_owns_wallet(p_user_id,w.id) and w.status='active' and l.source_kind in ('storekit_purchase','revenuecat_purchase')
    and not exists(select 1 from public.place_find_purchase_transactions t where t.wallet_id=w.id
      and t.status='refunded' and (l.source_reference=t.transaction_id or l.source_reference=upper(t.environment)||':'||t.transaction_id));
  return jsonb_build_object('unlimited',paid and not stale,'paid',paid and not stale,'verificationRequired',stale,
    'free',jsonb_build_object('limit',3,'used',used_count,'reserved',reserved_count,'remaining',greatest(0,3-used_count-reserved_count),
      'periodStart',m,'resetAt',next_month),
    'tokens',jsonb_build_object('available',tokens,'reserved',held,'nonExpiring',true),
    'legacyPlusRemaining',legacy_remaining,'paymentPriority','plus_free_tokens',
    'canSubmit',not stale and (paid or legacy_remaining>0 or used_count+reserved_count<3 or tokens>0),
    'limit',case when paid then null else 3 end,'remaining',case when paid then null else greatest(0,3-used_count-reserved_count) end,
    'used',used_count,'reserved',reserved_count,'enforced',c.paid_find_policy_enabled,'periodStart',m,'periodEnd',next_month);
end $$;
create or replace function public.nearr_plus_usage(p_user_id uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$ select public.nearr_paid_usage(p_user_id) $$;

-- Exactly one place-find reservation/ledger cycle. Purchased lots never expire.
create function public.nearr_paid_release_token(p_find public.nearr_paid_finds,p_reason text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare l public.place_find_lots%rowtype; revoked boolean;
begin
  if p_find.funding<>'token' or p_find.state<>'reserved' or p_find.lot_id is null then return; end if;
  select * into strict l from public.place_find_lots where id=p_find.lot_id for update;
  revoked:=exists(select 1 from public.place_find_purchase_transactions t where t.wallet_id=l.wallet_id and t.status='refunded'
    and (l.source_reference=t.transaction_id or l.source_reference=upper(t.environment)||':'||t.transaction_id));
  update public.place_find_lots set reserved_uses=reserved_uses-1,
    available_uses=available_uses+case when revoked then 0 else 1 end,
    revoked_uses=revoked_uses+case when revoked then 1 else 0 end where id=l.id;
  update public.place_find_wallets set reserved_uses=reserved_uses-1,
    available_uses=available_uses+case when revoked then 0 else 1 end,version=version+1,updated_at=now() where id=l.wallet_id;
  insert into public.place_find_ledger(wallet_id,lot_id,entry_type,available_delta,reserved_delta,reason_code,idempotency_key)
    values(l.wallet_id,l.id,case when revoked then 'refund_revoke' else 'release' end,
      case when revoked then 0 else 1 end,-1,p_reason,'paid-release:'||p_find.job_id||':'||p_find.cycle);
  if revoked then update public.place_find_purchase_transactions set revoked_unspent_uses=revoked_unspent_uses+1,
    spent_use_shortfall=greatest(0,spent_use_shortfall-1) where wallet_id=l.wallet_id and status='refunded'
      and (l.source_reference=transaction_id or l.source_reference=upper(environment)||':'||transaction_id); end if;
end $$;

create function public.nearr_paid_allocate(p_user_id uuid,p_job_id uuid,p_hash text,p_settle boolean default false)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare u jsonb; f public.nearr_paid_finds%rowtype; l public.place_find_lots%rowtype; mode text; cycle_no integer;
  m timestamptz:=date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
begin
  perform public.nearr_paid_lock();
  select * into f from public.nearr_paid_finds where job_id=p_job_id;
  if found and f.state in ('consumed','exempt') then return; end if;
  if found and f.user_id is distinct from p_user_id then raise exception 'paid_find_owner_mismatch'; end if;
  if not p_settle and f.state='reserved' then return; end if;
  if exists(select 1 from public.nearr_paid_source_receipts where user_id=p_user_id and source_hash=p_hash and job_id<>p_job_id) then
    perform public.nearr_paid_release_token(f,'source_replay');
    insert into public.nearr_paid_finds(job_id,user_id,source_hash,state,funding,settled_at,reason)
      values(p_job_id,p_user_id,p_hash,'exempt','exempt',now(),'source_replay')
      on conflict(job_id) do update set state='exempt',funding='exempt',settled_at=now(),reason='source_replay',lot_id=null;
    return;
  end if;
  if exists(select 1 from public.nearr_paid_finds where user_id=p_user_id and source_hash=p_hash and state='reserved' and job_id<>p_job_id) then raise exception 'paid_find_duplicate_in_flight'; end if;
  -- Final settlement re-evaluates Plus and the current UTC month. Release a
  -- previous hold first, in this same transaction; a failed allocation rolls back.
  perform public.nearr_paid_release_token(f,'reallocate');
  u:=public.nearr_paid_usage(p_user_id,p_job_id);
  if (u->>'verificationRequired')::boolean then raise exception 'plus_verification_required'; end if;
  mode:=case when (u->>'unlimited')::boolean then 'plus'
    when (u->>'legacyPlusRemaining')::integer>0 then 'legacy_plus'
    when (u#>>'{free,remaining}')::integer>0 then 'free'
    when (u#>>'{tokens,available}')::integer>0 then 'token' else null end;
  if mode is null then raise exception 'plus_allowance_exhausted'; end if;
  cycle_no:=coalesce(f.cycle,0)+1;
  if mode='token' then
    select l0.* into strict l from public.place_find_lots l0 join public.place_find_wallets w on w.id=l0.wallet_id
      where public.nearr_paid_owns_wallet(p_user_id,w.id) and w.status='active' and l0.available_uses>0 and l0.source_kind in ('storekit_purchase','revenuecat_purchase')
      and not exists(select 1 from public.place_find_purchase_transactions t where t.wallet_id=w.id and t.status='refunded'
        and (l0.source_reference=t.transaction_id or l0.source_reference=upper(t.environment)||':'||t.transaction_id))
      order by l0.created_at,l0.id limit 1 for update of l0;
    update public.place_find_lots set available_uses=available_uses-1,reserved_uses=reserved_uses+1 where id=l.id;
    update public.place_find_wallets set available_uses=available_uses-1,reserved_uses=reserved_uses+1,version=version+1,updated_at=now() where id=l.wallet_id;
    insert into public.place_find_ledger(wallet_id,lot_id,entry_type,available_delta,reserved_delta,reason_code,idempotency_key)
      values(l.wallet_id,l.id,'reserve',-1,1,'paid_find','paid-reserve:'||p_job_id||':'||cycle_no);
  end if;
  insert into public.nearr_paid_finds(job_id,user_id,source_hash,state,funding,free_period,legacy_period_key,lot_id,cycle)
    values(p_job_id,p_user_id,p_hash,'reserved',mode,case when mode='free' then m end,
      case when mode='legacy_plus' then (select period_key from public.nearr_legacy_plus_entitlements where user_id=p_user_id) end,l.id,cycle_no)
    on conflict(job_id) do update set state='reserved',source_hash=excluded.source_hash,funding=excluded.funding,free_period=excluded.free_period,
      legacy_period_key=excluded.legacy_period_key,lot_id=excluded.lot_id,cycle=excluded.cycle,reserved_at=now(),settled_at=null,reason=null;
end $$;

create or replace function public.reserve_nearr_plus_recognition(p_user_id uuid,p_job_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.share_jobs%rowtype; h text;
begin
  perform public.nearr_paid_lock();
  if not exists(select 1 from public.nearr_plus_config where id and paid_find_policy_enabled) then return; end if;
  if not public.is_account_eligible_for_ai(p_user_id) then raise exception 'plus_recognition_ineligible'; end if;
  perform public.reap_nearr_paid_reservations(p_user_id);
  select * into strict j from public.share_jobs where id=p_job_id and user_id=p_user_id;
  h:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(nullif(j.canonical_url,''),'job:'||p_job_id),'UTF8')),'hex');
  perform public.nearr_paid_allocate(p_user_id,p_job_id,h);
end $$;

create or replace function public.settle_nearr_plus_recognition(p_job_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.share_jobs%rowtype; f public.nearr_paid_finds%rowtype; l public.place_find_lots%rowtype;
  useful boolean; reason_code text; original_hash text; final_hash text;
begin
  perform public.nearr_paid_lock();
  select * into j from public.share_jobs where id=p_job_id;
  select * into f from public.nearr_paid_finds where job_id=p_job_id;
  if not found or f.state in ('consumed','exempt') then return; end if;
  -- Cancellation/authorization outrank an old or racing saved_place_id.
  reason_code:=case when j.user_id is distinct from f.user_id then 'owner_changed'
    when j.status in ('failed','cancelled') then j.status
    when not public.is_account_eligible_for_ai(j.user_id) then 'authorization_revoked'
    when j.resolution_source='recognition_cache_v2' or coalesce(j.extraction_payload#>>'{recognitionCache,hit}','false')='true' then 'cached_completion'
    when j.resolution_source='tutorial_fixture' or j.extraction_payload->>'resolutionSource'='tutorial_fixture' or j.extraction_payload ? 'tutorialFixture' then 'tutorial_fixture' end;
  if reason_code is not null then
    perform public.nearr_paid_release_token(f,reason_code);
    update public.nearr_paid_finds set state=case when reason_code in ('cached_completion','tutorial_fixture') then 'exempt' else 'released' end,
      settled_at=now(),reason=reason_code where job_id=p_job_id;
    return;
  end if;
  useful:=j.status in ('completed','needs_help') and (
    exists(select 1 from public.share_job_place_results r join public.saved_places s on s.id=r.saved_place_id
      join public.places p on p.id=r.place_id and p.id=s.place_id and p.google_place_id=r.google_place_id
      where r.share_job_id=j.id and r.user_id=j.user_id and s.user_id=j.user_id and r.outcome in ('auto_saved','already_saved')
        and nullif(btrim(r.google_place_id),'') is not null)
    or exists(select 1 from public.saved_places s join public.places p on p.id=s.place_id
      join public.saved_place_sources src on src.saved_place_id=s.id
      where s.id=j.saved_place_id and s.user_id=j.user_id and src.user_id=j.user_id
        and nullif(btrim(p.google_place_id),'') is not null
        and (src.canonical_url=j.canonical_url or src.identity_key=j.recognition_identity_key)));
  if not useful then
    if j.status in ('completed','needs_help') and coalesce(j.decision,'') not in ('candidate_confirmation','candidate_picker','multi_candidate_confirmation') then
      perform public.nearr_paid_release_token(f,'no_verified_save');
      update public.nearr_paid_finds set state='released',settled_at=now(),reason='no_verified_save' where job_id=p_job_id;
    end if;
    return;
  end if;
  -- A manual save after a terminal failure/cancellation is not retroactively billed.
  if f.state='released' and f.reason in ('failed','cancelled','authorization_revoked','owner_changed') then return; end if;
  original_hash:=f.source_hash;
  final_hash:=pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(nullif(j.recognition_identity_key,''),nullif(j.canonical_url,''),'job:'||j.id),'UTF8')),'hex');
  perform public.nearr_paid_allocate(j.user_id,j.id,final_hash,true);
  select * into strict f from public.nearr_paid_finds where job_id=p_job_id;
  if f.state='exempt' then return; end if;
  if f.funding='token' then
    select * into strict l from public.place_find_lots where id=f.lot_id for update;
    update public.place_find_lots set reserved_uses=reserved_uses-1,consumed_uses=consumed_uses+1 where id=l.id;
    update public.place_find_wallets set reserved_uses=reserved_uses-1,version=version+1,updated_at=now() where id=l.wallet_id;
    insert into public.place_find_ledger(wallet_id,lot_id,entry_type,reserved_delta,reason_code,idempotency_key)
      values(l.wallet_id,l.id,'consume',-1,'verified_saved_source','paid-consume:'||p_job_id);
  end if;
  update public.nearr_paid_finds set state='consumed',settled_at=now(),reason='verified_saved_source' where job_id=p_job_id;
  insert into public.nearr_paid_source_receipts(user_id,source_hash,job_id) values(j.user_id,f.source_hash,j.id) on conflict do nothing;
  insert into public.nearr_paid_source_receipts(user_id,source_hash,job_id) values(j.user_id,original_hash,j.id),
    (j.user_id,pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(coalesce(nullif(j.canonical_url,''),'job:'||j.id),'UTF8')),'hex'),j.id) on conflict do nothing;
end $$;

-- Release held tokens when users delete/cancel jobs; retain the immutable key.
create function public.nearr_paid_deleted_job() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.nearr_paid_finds%rowtype;
begin
  perform public.nearr_paid_lock();
  select * into f from public.nearr_paid_finds where job_id=old.id;
  if f.state='reserved' then
    perform public.nearr_paid_release_token(f,'job_deleted');
    update public.nearr_paid_finds set state='released',settled_at=now(),reason='job_deleted' where job_id=old.id;
  end if;
  return old;
end $$;
create trigger nearr_paid_deleted_job before delete on public.share_jobs for each row execute function public.nearr_paid_deleted_job();

-- These new entrypoints are service-only. Existing trigger entrypoints retain
-- their original grants; clients cannot select a funding class or mint a find.
revoke all on function public.nearr_paid_lock(),public.nearr_paid_usage(uuid,uuid),
  public.nearr_paid_release_token(public.nearr_paid_finds,text),public.nearr_paid_allocate(uuid,uuid,text,boolean),
  public.nearr_paid_deleted_job() from public,anon,authenticated;
grant execute on function public.nearr_paid_usage(uuid,uuid) to service_role;

-- Trusted RevenueCat callbacks only. The Edge endpoint authenticates the shared
-- secret and validates app/store/environment/primary customer before this RPC.
-- Subscriber v1 non_subscriptions IDs are NOT StoreKit transaction IDs.
create function public.apply_nearr_paid_purchase(p_user_id uuid,p_purchase jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.nearr_plus_config%rowtype; w public.place_find_wallets%rowtype;
  t public.place_find_purchase_transactions%rowtype; s public.nearr_paid_purchase_states%rowtype;
  l public.place_find_lots%rowtype; qty integer; env text; tx text; product text; kind text;
  occurred timestamptz; purchased timestamptz; verified timestamptz; reference text; amount integer;
  requested_state text; lot_count integer;
begin
  perform public.nearr_paid_lock();
  select * into strict c from public.nearr_plus_config where id;
  tx:=p_purchase->>'transactionId'; product:=p_purchase->>'productId'; kind:=p_purchase->>'eventType';
  env:=case c.environment when 'SANDBOX' then 'Sandbox' else 'Production' end;
  occurred:=(p_purchase->>'occurredAt')::timestamptz;
  purchased:=(p_purchase->>'purchasedAt')::timestamptz;
  verified:=(p_purchase->>'verifiedAt')::timestamptz;
  qty:=case product when 'com.nearr.tokens.20.v2' then 20 when 'com.nearr.tokens.50.v2' then 50 when 'com.nearr.tokens.200.v2' then 200 end;
  if not c.token_catalog_verified or c.release_mode<>'paid' or qty is null
    or p_purchase->>'environment' is distinct from c.environment or tx is null or tx !~ '^[A-Za-z0-9._-]{1,200}$'
    or kind not in ('NON_RENEWING_PURCHASE','CANCELLATION','REFUND_REVERSED') or kind is null
    or occurred is null or occurred>now()+interval '1 minute' or purchased is null or purchased>now()+interval '1 minute' or occurred<purchased
    or verified is null or verified<now()-interval '15 minutes' or verified>now()+interval '1 minute'
    or not exists(select 1 from public.nearr_plus_customers where user_id=p_user_id and app_user_id=p_purchase->>'appUserId')
    or not exists(select 1 from public.place_find_products where product_id=product and use_count=qty and product_kind='storekit_consumable')
    then raise exception 'paid_purchase_invalid'; end if;
  insert into public.place_find_wallets(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into strict w from public.place_find_wallets where user_id=p_user_id for update;
  if w.status<>'active' then raise exception 'paid_wallet_closed'; end if;
  select * into t from public.place_find_purchase_transactions where environment=env and transaction_id=tx for update;
  if found and (not public.nearr_paid_owns_wallet(p_user_id,t.wallet_id) or t.product_id<>product or t.granted_uses<>qty or t.purchased_at is distinct from purchased) then raise exception 'paid_transaction_owner_or_product_mismatch'; end if;
  if t.transaction_id is not null then select * into strict w from public.place_find_wallets where id=t.wallet_id for update; end if;
  select * into s from public.nearr_paid_purchase_states where environment=c.environment and transaction_id=tx;
  if found and (s.wallet_id<>w.id or s.product_id<>product) then raise exception 'paid_transaction_owner_or_product_mismatch'; end if;
  if kind='REFUND_REVERSED' and exists(select 1 from public.nearr_paid_recovery_receipts r
    where r.environment=env and r.transaction_id=tx and r.state='revoked' and occurred<=r.verified_at) then return; end if;
  -- Ordinary purchase redelivery can never undo a refund. Only an explicit,
  -- newer refund reversal can restore the unspent revoked portion.
  if s.transaction_id is not null and (kind='NON_RENEWING_PURCHASE'
    or (kind='REFUND_REVERSED' and occurred<=s.occurred_at)
    or (kind='CANCELLATION' and s.event_type<>'NON_RENEWING_PURCHASE' and occurred<s.occurred_at)) then return; end if;
  requested_state:=case when kind='CANCELLATION' then 'revoked'
    when kind='NON_RENEWING_PURCHASE' and t.status='refunded' then 'revoked' else 'verified' end;
  reference:=c.environment||':'||tx;
  -- Reconcile a legacy credit in the SAME shared transaction table. It must
  -- already have exactly one matching lot; never mint a second historic grant.
  if t.transaction_id is not null then
    select count(*) into lot_count from public.place_find_lots where wallet_id=w.id
      and source_kind in ('storekit_purchase','revenuecat_purchase') and source_reference in (tx,reference);
    if lot_count<>1 then raise exception 'legacy_purchase_lot_reconciliation_required'; end if;
    select * into strict l from public.place_find_lots where wallet_id=w.id
      and source_kind in ('storekit_purchase','revenuecat_purchase') and source_reference in (tx,reference) for update;
  else
    insert into public.place_find_purchase_transactions(environment,transaction_id,wallet_id,product_id,app_account_token,purchased_at,verified_at,granted_uses,status)
      values(env,tx,w.id,product,w.app_account_token,purchased,verified,qty,'verified');
    perform public.grant_place_find_lot(w.id,'revenuecat_purchase',reference,qty,null,product);
    select * into strict l from public.place_find_lots where wallet_id=w.id and source_kind='revenuecat_purchase' and source_reference=reference for update;
  end if;
  if requested_state='revoked' then
    amount:=l.available_uses;
    update public.place_find_lots set available_uses=0,revoked_uses=revoked_uses+amount where id=l.id;
    update public.place_find_wallets set available_uses=available_uses-amount,version=version+1,updated_at=now() where id=w.id;
    update public.place_find_purchase_transactions set status='refunded',verified_at=verified,
      revoked_unspent_uses=l.revoked_uses+amount,spent_use_shortfall=l.consumed_uses+l.reserved_uses
      where environment=env and transaction_id=tx;
    if amount>0 then insert into public.place_find_ledger(wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key)
      values(w.id,l.id,tx,'refund_revoke',-amount,'trusted_store_refund','paid-refund:'||reference||':'||occurred::text); end if;
  elsif kind='REFUND_REVERSED' and (s.state='revoked' or t.status='refunded') then
    amount:=l.revoked_uses;
    update public.place_find_lots set available_uses=available_uses+amount,revoked_uses=0 where id=l.id;
    update public.place_find_wallets set available_uses=available_uses+amount,version=version+1,updated_at=now() where id=w.id;
    update public.place_find_purchase_transactions set status='refund_reversed',verified_at=verified,revoked_unspent_uses=0
      where environment=env and transaction_id=tx;
    if amount>0 then insert into public.place_find_ledger(wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key)
      values(w.id,l.id,tx,'refund_reversal',amount,'trusted_store_refund_reversal','paid-reversal:'||reference||':'||occurred::text); end if;
  end if;
  insert into public.nearr_paid_purchase_states(environment,transaction_id,wallet_id,product_id,state,event_type,occurred_at,verified_at)
    values(c.environment,tx,w.id,product,requested_state,kind,occurred,verified)
    on conflict(environment,transaction_id) do update set state=excluded.state,event_type=excluded.event_type,occurred_at=excluded.occurred_at,verified_at=excluded.verified_at;
end $$;

create function public.apply_nearr_paid_webhook(p_event_id text,p_event_type text,p_payload_sha256 text,p_snapshots jsonb,p_purchase_user uuid default null,p_purchase jsonb default null)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
declare applied boolean; s jsonb;
begin
  perform public.nearr_paid_lock();
  applied:=public.apply_nearr_plus_webhook(p_event_id,p_event_type,p_payload_sha256,p_snapshots);
  if applied then
    for s in select value from jsonb_array_elements(p_snapshots) loop
      if s ? 'legacySnapshot' then perform public.apply_nearr_legacy_plus_snapshot((s->>'userId')::uuid,s->'legacySnapshot'); end if;
    end loop;
  end if;
  if applied and p_purchase is not null then perform public.apply_nearr_paid_purchase(p_purchase_user,p_purchase); end if;
  return applied;
end $$;

create function public.nearr_paid_recent_purchases(p_user_id uuid) returns jsonb
language sql security definer set search_path=public,pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('transactionId',t.transaction_id,'productId',t.product_id,
    'purchasedAt',t.purchased_at,'state',case when t.status='refunded' then 'revoked' else 'verified' end)
    order by t.purchased_at desc),'[]'::jsonb)
  from (select t.* from public.place_find_purchase_transactions t join public.place_find_wallets w on w.id=t.wallet_id
    join public.nearr_plus_config c on c.id and upper(t.environment)=c.environment
    where public.nearr_paid_owns_wallet(p_user_id,w.id) and t.product_id in ('com.nearr.tokens.20.v2','com.nearr.tokens.50.v2','com.nearr.tokens.200.v2')
    order by t.purchased_at desc limit 100) t
$$;
revoke all on function public.apply_nearr_paid_purchase(uuid,jsonb),
  public.apply_nearr_paid_webhook(text,text,text,jsonb,uuid,jsonb),public.nearr_paid_recent_purchases(uuid)
  from public,anon,authenticated;
grant execute on function public.apply_nearr_paid_purchase(uuid,jsonb),
  public.apply_nearr_paid_webhook(text,text,text,jsonb,uuid,jsonb),public.nearr_paid_recent_purchases(uuid) to service_role;

-- Preserve the original APIs for old jobs while preventing two independent
-- charging systems from owning a newly admitted paid-launch job.
alter function public.reserve_place_find_use(uuid,uuid) rename to reserve_place_find_use_legacy_20261029;
alter function public.settle_place_find_use(uuid,text,text) rename to settle_place_find_use_legacy_20261029;
create function public.reserve_place_find_use(p_user_id uuid,p_share_job_id uuid)
returns table(reservation_id uuid,available_uses integer,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.nearr_plus_config where id and paid_find_policy_enabled) then
    perform public.reserve_nearr_plus_recognition(p_user_id,p_share_job_id);
    return query select p_share_job_id,(public.nearr_paid_usage(p_user_id)#>>'{tokens,available}')::integer,true;
  else return query select * from public.reserve_place_find_use_legacy_20261029(p_user_id,p_share_job_id); end if;
end $$;
create function public.settle_place_find_use(p_share_job_id uuid,p_action text,p_reason_code text)
returns table(reservation_id uuid,status text,replayed boolean)
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if exists(select 1 from public.nearr_paid_finds where job_id=p_share_job_id) then
    perform public.settle_nearr_plus_recognition(p_share_job_id);
    return query select f.job_id,f.state,true from public.nearr_paid_finds f where f.job_id=p_share_job_id;
  else return query select * from public.settle_place_find_use_legacy_20261029(p_share_job_id,p_action,p_reason_code); end if;
end $$;
revoke all on function public.reserve_place_find_use(uuid,uuid),public.settle_place_find_use(uuid,text,text),
  public.reserve_place_find_use_legacy_20261029(uuid,uuid),public.settle_place_find_use_legacy_20261029(uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_place_find_use(uuid,uuid),public.settle_place_find_use(uuid,text,text) to service_role;

create function public.guard_nearr_paid_launch_activation() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.nearr_paid_lock();
  if new.paid_find_policy_enabled and not old.paid_find_policy_enabled then
    if exists(select 1 from public.token_monetization_config where enabled) then raise exception 'legacy_token_experiment_must_be_disabled'; end if;
    if exists(select 1 from public.place_find_reservations where status='reserved')
      or exists(select 1 from public.nearr_plus_recognitions where state='reserved') then raise exception 'legacy_reservations_require_reconciliation'; end if;
    if new.revenuecat_project_id is null or jsonb_typeof(new.revenuecat_token_product_ids)<>'object'
      or (select count(*) from jsonb_each_text(new.revenuecat_token_product_ids))<>3
      or exists(select 1 from (values('com.nearr.tokens.20.v2'),('com.nearr.tokens.50.v2'),('com.nearr.tokens.200.v2')) p(id)
        where nullif(new.revenuecat_token_product_ids->>p.id,'') is null)
      then raise exception 'paid_recovery_catalog_required'; end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_nearr_paid_launch_activation() from public,anon,authenticated;
create trigger nearr_paid_launch_activation before update on public.nearr_plus_config
  for each row execute function public.guard_nearr_paid_launch_activation();

create function public.apply_nearr_legacy_plus_snapshot(p_user_id uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.nearr_plus_config%rowtype; t timestamptz;
begin
  perform public.nearr_paid_lock();
  select * into strict c from public.nearr_plus_config where id;
  t:=(p_snapshot->>'verifiedAt')::timestamptz;
  if t is null or t<now()-interval '15 minutes' or t>now()+interval '1 minute'
    or p_snapshot->>'environment' is distinct from c.environment
    or (p_snapshot->>'state'<>'free' and p_snapshot->>'productId' is distinct from 'nearr_plus_monthly_v1')
    or not exists(select 1 from public.nearr_plus_customers where user_id=p_user_id)
    or (p_snapshot->>'state' in ('active','trial','intro','grace','cancelled') and
      ((p_snapshot->>'periodStart') is null or (p_snapshot->>'expiresAt') is null or (p_snapshot->>'accessUntil') is null or (p_snapshot->>'periodKey') is null))
    then raise exception 'legacy_plus_snapshot_invalid'; end if;
  insert into public.nearr_legacy_plus_entitlements(user_id,state,product_id,period_start,expires_at,access_until,verified_at,environment,period_key)
    values(p_user_id,p_snapshot->>'state',p_snapshot->>'productId',(p_snapshot->>'periodStart')::timestamptz,
      (p_snapshot->>'expiresAt')::timestamptz,(p_snapshot->>'accessUntil')::timestamptz,t,c.environment,p_snapshot->>'periodKey')
    on conflict(user_id) do update set state=excluded.state,product_id=excluded.product_id,period_start=excluded.period_start,
      expires_at=excluded.expires_at,access_until=excluded.access_until,verified_at=excluded.verified_at,environment=excluded.environment,
      period_key=excluded.period_key,updated_at=now()
    where public.nearr_legacy_plus_entitlements.verified_at<excluded.verified_at
      or (public.nearr_legacy_plus_entitlements.verified_at=excluded.verified_at and excluded.state in ('free','expired','revoked'));
end $$;
create function public.apply_nearr_paid_subscriber(p_user_id uuid,p_snapshot jsonb,p_legacy_snapshot jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
begin
  perform public.nearr_paid_lock();
  perform public.apply_nearr_plus_snapshot(p_user_id,p_snapshot);
  perform public.apply_nearr_legacy_plus_snapshot(p_user_id,p_legacy_snapshot);
end $$;

-- Transfer source replay rights, not ownership of a permanent customer's money.
-- The existing audited onboarding RPC authorizes the job owner change.
create function public.nearr_paid_owner_changed() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.nearr_paid_finds%rowtype;
begin
  if new.user_id is not distinct from old.user_id then return new; end if;
  perform public.nearr_paid_lock();
  select * into f from public.nearr_paid_finds where job_id=new.id;
  if f.state='consumed' then
    insert into public.nearr_paid_source_receipts(user_id,source_hash,job_id)
      select new.user_id,r.source_hash,r.job_id from public.nearr_paid_source_receipts r where r.job_id=f.job_id on conflict do nothing;
  elsif f.state='reserved' then
    perform public.nearr_paid_release_token(f,'owner_changed');
    update public.nearr_paid_finds set state='released',settled_at=now(),reason='owner_changed' where job_id=f.job_id;
  end if;
  return new;
end $$;
create trigger nearr_paid_owner_changed after update of user_id on public.share_jobs
  for each row execute function public.nearr_paid_owner_changed();

create function public.reap_nearr_paid_reservations(p_user_id uuid) returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare f public.nearr_paid_finds%rowtype; n integer:=0;
begin
  perform public.nearr_paid_lock();
  for f in select * from public.nearr_paid_finds where user_id=p_user_id and state='reserved'
    and reserved_at<now()-interval '7 days' order by reserved_at,job_id limit 100 loop
    perform public.nearr_paid_release_token(f,'reservation_expired');
    update public.nearr_paid_finds set state='released',settled_at=now(),reason='reservation_expired' where job_id=f.job_id;
    n:=n+1;
  end loop;
  return n;
end $$;
revoke all on function public.apply_nearr_legacy_plus_snapshot(uuid,jsonb),public.apply_nearr_paid_subscriber(uuid,jsonb,jsonb),
  public.nearr_paid_owner_changed(),public.reap_nearr_paid_reservations(uuid) from public,anon,authenticated;
grant execute on function public.apply_nearr_paid_subscriber(uuid,jsonb,jsonb),public.reap_nearr_paid_reservations(uuid) to service_role;

create function public.nearr_paid_onboarding_wallet_transfer() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare w public.place_find_wallets%rowtype;
begin
  if new.status<>'completed' or old.status='completed' or new.destination_user_id is null then return new; end if;
  perform public.nearr_paid_lock();
  -- This alias is created only by the accepted transfer grant, never StoreKit
  -- login/restore, a client claim or an unrelated permanent-account switch.
  if not exists(select 1 from auth.users where id=new.source_user_id and is_anonymous)
    or not exists(select 1 from auth.users where id=new.destination_user_id and not is_anonymous) then return new; end if;
  select * into w from public.place_find_wallets where user_id=new.source_user_id and status='active' for update;
  if not found then return new; end if;
  if w.reserved_uses<>0 then raise exception 'onboarding_wallet_reservations_require_reconciliation'; end if;
  insert into public.nearr_paid_wallet_owners(wallet_id,user_id,transfer_grant_id)
    values(w.id,new.destination_user_id,new.id) on conflict(wallet_id) do nothing;
  -- Wallet/lot/transaction/ledger IDs stay identical. Detach the former anonymous
  -- auth row so its later cleanup cannot close or orphan the transferred money.
  update public.place_find_wallets set user_id=null,version=version+1,updated_at=now() where id=w.id;
  return new;
end $$;
revoke all on function public.nearr_paid_onboarding_wallet_transfer() from public,anon,authenticated;
create trigger nearr_paid_onboarding_wallet_transfer after update of status on public.onboarding_account_transfer_grants
  for each row execute function public.nearr_paid_onboarding_wallet_transfer();

-- An API recovery is a current server read, never a synthetic webhook event.
-- Keep the recovery proof separate so it cannot advance a refund-event watermark.
create table public.nearr_paid_recovery_receipts (
  environment text not null, transaction_id text not null,
  revenuecat_purchase_id text not null, revenuecat_product_id text not null,
  request_started_at timestamptz not null, verified_at timestamptz not null,
  state text not null check(state in ('verified','revoked')),
  primary key(environment,transaction_id),
  foreign key(environment,transaction_id) references public.place_find_purchase_transactions(environment,transaction_id)
);
alter table public.nearr_paid_recovery_receipts enable row level security;
revoke all on public.nearr_paid_recovery_receipts from public,anon,authenticated;
grant all on public.nearr_paid_recovery_receipts to service_role;
create function public.apply_nearr_paid_recovery(p_user_id uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare c public.nearr_plus_config%rowtype; t public.place_find_purchase_transactions%rowtype;
  w public.place_find_wallets%rowtype; l public.place_find_lots%rowtype;
  qty integer; env text; tx text; product text; purchased timestamptz; verified timestamptz; started timestamptz; reference text; amount integer;
begin
  perform public.nearr_paid_lock();
  select * into strict c from public.nearr_plus_config where id;
  tx:=p_snapshot->>'transactionId'; product:=p_snapshot->>'productId';
  purchased:=(p_snapshot->>'purchasedAt')::timestamptz;
  started:=(p_snapshot->>'requestStartedAt')::timestamptz; verified:=(p_snapshot->>'verifiedAt')::timestamptz;
  qty:=case product when 'com.nearr.tokens.20.v2' then 20 when 'com.nearr.tokens.50.v2' then 50 when 'com.nearr.tokens.200.v2' then 200 end;
  env:=case c.environment when 'SANDBOX' then 'Sandbox' else 'Production' end;
  if not c.token_catalog_verified or c.release_mode<>'paid' or qty is null
    or p_snapshot->>'source' is distinct from 'revenuecat_v2'
    or c.revenuecat_project_id is null or p_snapshot->>'projectId' is distinct from c.revenuecat_project_id
    or p_snapshot->>'appId' is distinct from c.revenuecat_app_id
    or (c.revenuecat_token_product_ids->>product) is null
    or p_snapshot->>'revenueCatProductId' is distinct from c.revenuecat_token_product_ids->>product
    or nullif(p_snapshot->>'revenueCatPurchaseId','') is null
    or p_snapshot->>'environment' is distinct from c.environment or tx is null or tx !~ '^[A-Za-z0-9._-]{1,200}$'
    or p_snapshot->>'state' not in ('verified','revoked') or p_snapshot->>'state' is null
    or started is null or verified is null or verified<started or verified-started>interval '15 seconds'
    or verified<now()-interval '1 minute' or verified>now()+interval '1 minute' or purchased is null or purchased>verified+interval '1 minute'
    or not exists(select 1 from public.nearr_plus_customers where user_id=p_user_id and app_user_id=p_snapshot->>'appUserId')
    or not exists(select 1 from public.place_find_products where product_id=product and use_count=qty and product_kind='storekit_consumable')
    then raise exception 'paid_recovery_invalid'; end if;
  select * into t from public.place_find_purchase_transactions where environment=env and transaction_id=tx for update;
  if found then
    if not public.nearr_paid_owns_wallet(p_user_id,t.wallet_id) or t.product_id<>product or t.purchased_at is distinct from purchased or t.granted_uses<>qty
      then raise exception 'paid_recovery_owner_or_transaction_mismatch'; end if;
    if exists(select 1 from public.nearr_paid_recovery_receipts r where r.environment=env and r.transaction_id=tx
      and r.verified_at>verified) then return; end if;
    if p_snapshot->>'state'='revoked' then
      -- A callback that occurred after this GET began wins over an in-flight
      -- older snapshot. Otherwise a verified refund must quarantine unspent
      -- funds immediately, not leave known refunded credits spendable.
      if exists(select 1 from public.nearr_paid_purchase_states s where s.environment=c.environment
        and s.transaction_id=tx and s.occurred_at>started) then return; end if;
      select * into strict w from public.place_find_wallets where id=t.wallet_id for update;
      select * into strict l from public.place_find_lots where wallet_id=w.id
        and source_kind in ('storekit_purchase','revenuecat_purchase') and source_reference in(tx,c.environment||':'||tx) for update;
      amount:=l.available_uses;
      update public.place_find_lots set available_uses=0,revoked_uses=revoked_uses+amount where id=l.id;
      update public.place_find_wallets set available_uses=available_uses-amount,version=version+1,updated_at=now() where id=w.id;
      update public.place_find_purchase_transactions set status='refunded',verified_at=verified,
        revoked_unspent_uses=l.revoked_uses+amount,spent_use_shortfall=l.consumed_uses+l.reserved_uses where environment=env and transaction_id=tx;
      if amount>0 then insert into public.place_find_ledger(wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key)
        values(w.id,l.id,tx,'refund_revoke',-amount,'verified_recovery_refund','paid-recovery-refund:'||env||':'||tx||':'||verified::text); end if;
      insert into public.nearr_paid_recovery_receipts(environment,transaction_id,revenuecat_purchase_id,revenuecat_product_id,request_started_at,verified_at,state)
        values(env,tx,p_snapshot->>'revenueCatPurchaseId',p_snapshot->>'revenueCatProductId',started,verified,'revoked')
        on conflict(environment,transaction_id) do update set state='revoked',request_started_at=excluded.request_started_at,verified_at=excluded.verified_at
        where public.nearr_paid_recovery_receipts.verified_at<=excluded.verified_at;
    end if;
    -- No replay, fresh owned response, or cross-device restore reissues tokens
    -- or revives an existing refund. Explicit newer refund reversal is required.
    return;
  end if;
  insert into public.place_find_wallets(user_id) values(p_user_id) on conflict(user_id) do nothing;
  select * into strict w from public.place_find_wallets where user_id=p_user_id for update;
  if w.status<>'active' then raise exception 'paid_wallet_closed'; end if;
  reference:=c.environment||':'||tx;
  insert into public.place_find_purchase_transactions(environment,transaction_id,wallet_id,product_id,app_account_token,purchased_at,verified_at,granted_uses,status)
    values(env,tx,w.id,product,w.app_account_token,purchased,verified,qty,case when p_snapshot->>'state'='revoked' then 'refunded' else 'verified' end);
  perform public.grant_place_find_lot(w.id,'revenuecat_purchase',reference,qty,null,product);
  select * into strict l from public.place_find_lots where wallet_id=w.id and source_kind='revenuecat_purchase' and source_reference=reference for update;
  if p_snapshot->>'state'='revoked' then
    update public.place_find_lots set available_uses=0,revoked_uses=qty where id=l.id;
    update public.place_find_wallets set available_uses=available_uses-qty,version=version+1,updated_at=now() where id=w.id;
    update public.place_find_purchase_transactions set revoked_unspent_uses=qty where environment=env and transaction_id=tx;
    insert into public.place_find_ledger(wallet_id,lot_id,transaction_id,entry_type,available_delta,reason_code,idempotency_key)
      values(w.id,l.id,tx,'refund_revoke',-qty,'verified_recovery_refund','paid-recovery-refund:'||reference);
  end if;
  insert into public.nearr_paid_recovery_receipts(environment,transaction_id,revenuecat_purchase_id,revenuecat_product_id,request_started_at,verified_at,state)
    values(env,tx,p_snapshot->>'revenueCatPurchaseId',p_snapshot->>'revenueCatProductId',started,verified,p_snapshot->>'state');
end $$;
revoke all on function public.apply_nearr_paid_recovery(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.apply_nearr_paid_recovery(uuid,jsonb) to service_role;
