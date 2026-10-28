-- Prepared only: does not enable a release, sales, allowance, region or provider.
-- Existing paid/unavailable behavior is the default. No ledger or saved data reset.
alter table public.nearr_plus_config add column release_mode text not null default 'paid'
  check (release_mode in ('paid','free_only'));

-- Replace only the original joint catalog gate, whose generated name can vary.
do $$
declare v_names text[];
begin
  select array_agg(conname) into v_names from pg_constraint
    where conrelid='public.nearr_plus_config'::regclass and contype='c'
      and pg_get_constraintdef(oid) like '%sales_enabled%'
      and pg_get_constraintdef(oid) like '%enforce_allowance%'
      and pg_get_constraintdef(oid) like '%catalog_verified%';
  if coalesce(array_length(v_names,1),0) <> 1 then raise exception 'plus_original_catalog_gate_ambiguous'; end if;
  execute format('alter table public.nearr_plus_config drop constraint %I',v_names[1]);
end $$;

alter table public.nearr_plus_config
  add constraint nearr_plus_sales_qualified check (not sales_enabled or
    (release_mode='paid' and release_qualified and catalog_verified and nullif(btrim(revenuecat_app_id),'') is not null)),
  add constraint nearr_plus_allowance_qualified check (not enforce_allowance or
    (release_qualified and (release_mode='free_only' or
      (catalog_verified and nullif(btrim(revenuecat_app_id),'') is not null)))),
  add constraint nearr_free_only_qualified check (release_mode<>'free_only' or
    (release_qualified and enforce_allowance and not sales_enabled and free_finds=3));

-- Initial free launch only, never a generic paid-to-free downgrade. Even an
-- expired/free receipt or a customer awaiting checkout can represent obligations
-- not yet reflected by an active local entitlement. All related writes share
-- this transaction lock, so an in-flight identity/grant cannot race activation.
-- Legacy Pro/billing data outside these tables still needs release reconciliation.
-- Advisory locks need a fresh READ COMMITTED snapshot after waiting. Reject
-- stronger/fixed-snapshot write transactions instead of trusting stale reads.
create function public.guard_nearr_free_only_activation()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'plus_release_requires_read_committed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus_release_policy',0));
  if new.release_mode='free_only' and (tg_op='INSERT' or old.release_mode<>'free_only') and (
    exists(select 1 from public.nearr_plus_customers) or exists(select 1 from public.nearr_plus_entitlements)
  ) then raise exception 'free_only_existing_paid_history'; end if;
  return new;
end $$;
revoke all on function public.guard_nearr_free_only_activation() from public,anon,authenticated;
create trigger nearr_free_only_activation before insert or update on public.nearr_plus_config
for each row execute function public.guard_nearr_free_only_activation();

create function public.guard_nearr_paid_customer_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'plus_release_requires_read_committed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus_release_policy',0));
  if exists(select 1 from public.nearr_plus_config where id and release_mode='free_only') then
    raise exception 'plus_free_only_customer_blocked'; end if;
  return new;
end $$;
revoke all on function public.guard_nearr_paid_customer_write() from public,anon,authenticated;
create trigger nearr_paid_customer_write before insert or update on public.nearr_plus_customers
for each row execute function public.guard_nearr_paid_customer_write();

create function public.guard_nearr_paid_entitlement_write()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'plus_release_requires_read_committed'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus_release_policy',0));
  if new.state in ('active','trial','intro','grace','cancelled') and new.access_until>now()
    and exists(select 1 from public.nearr_plus_config where id and release_mode='free_only') then
    raise exception 'plus_free_only_paid_grant_blocked'; end if;
  return new;
end $$;
revoke all on function public.guard_nearr_paid_entitlement_write() from public,anon,authenticated;
create trigger nearr_paid_entitlement_write before insert or update on public.nearr_plus_entitlements
for each row execute function public.guard_nearr_paid_entitlement_write();

-- Acquire release policy before any per-user/period locks. A multi-identity
-- webhook must not hold the release lock while waiting for a single-user sync
-- that has already taken its user lock and is itself waiting for release policy.
-- Keep the original snapshot validation, freshness and usage-transfer contract.
create or replace function public.apply_nearr_plus_snapshot(p_user_id uuid,p_snapshot jsonb)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.nearr_plus_config%rowtype; v_verified timestamptz; v_written integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus_release_policy',0));
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
    update public.nearr_plus_recognitions set period_key=p_snapshot->>'periodKey'
      where user_id=p_user_id and period_key is null
        and reserved_at >= date_trunc('month',now() at time zone 'UTC') at time zone 'UTC';
  end if;
end $$;

create or replace function public.nearr_plus_usage(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_cfg public.nearr_plus_config%rowtype; v_ent public.nearr_plus_entitlements%rowtype;
  v_start timestamptz; v_limit integer; v_used integer; v_reserved integer; v_paid boolean; v_stale boolean;
begin
  select * into strict v_cfg from public.nearr_plus_config where id;
  select * into v_ent from public.nearr_plus_entitlements where user_id=p_user_id;
  v_paid:=v_cfg.release_mode='paid' and coalesce(v_ent.state in ('active','trial','intro','grace','cancelled') and v_ent.access_until>now()
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

create or replace function public.reserve_nearr_plus_recognition(p_user_id uuid,p_job_id uuid)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare v_usage jsonb; v_existing public.nearr_plus_recognitions%rowtype; v_period_key text;
begin
  if not exists(select 1 from public.nearr_plus_config where id and enforce_allowance) then return; end if;
  if not public.is_account_eligible_for_ai(p_user_id) then raise exception 'plus_recognition_ineligible'; end if;
  perform pg_advisory_xact_lock(hashtextextended('nearr_plus:'||p_user_id::text,0));
  select e.period_key into v_period_key from public.nearr_plus_entitlements e
    join public.nearr_plus_config c on c.id and c.release_mode='paid'
    where e.user_id=p_user_id and e.state in ('active','trial','intro','grace','cancelled') and e.access_until>now();
  if v_period_key is not null then perform pg_advisory_xact_lock(hashtextextended('nearr_plus_period:'||v_period_key,0)); end if;
  select * into v_existing from public.nearr_plus_recognitions where job_id=p_job_id;
  if found then
    if v_existing.user_id<>p_user_id then raise exception 'plus_owner_mismatch'; end if;
    if v_existing.state in ('reserved','consumed') then return; end if;
  end if;
  update public.nearr_plus_recognitions set state='released',settled_at=now()
    where user_id=p_user_id and state='reserved' and reserved_at<now()-interval '7 days'
    and exists(select 1 from public.share_jobs j where j.id=job_id and j.status in ('needs_help','completed','failed','cancelled'));
  v_usage:=public.nearr_plus_usage(p_user_id);
  if (v_usage->>'verificationRequired')::boolean then raise exception 'plus_verification_required'; end if;
  if (v_usage->>'remaining')::integer<=0 then raise exception 'plus_allowance_exhausted'; end if;
  insert into public.nearr_plus_recognitions(job_id,user_id,state,period_key) values(p_job_id,p_user_id,'reserved',v_period_key)
  on conflict(job_id) do update set state='reserved',reserved_at=now(),settled_at=null,period_key=excluded.period_key;
end $$;
