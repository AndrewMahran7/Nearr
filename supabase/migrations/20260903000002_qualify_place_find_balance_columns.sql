-- Repair PL/pgSQL output-variable/table-column ambiguity introduced by
-- 20260903000001. Function signatures, security, grants, and monetization
-- behavior are intentionally unchanged.

create or replace function public.ensure_place_find_wallet(
  p_user_id uuid,
  p_is_anonymous boolean default false
)
returns table(
  wallet_id uuid,
  available_uses integer,
  reserved_uses integer,
  app_account_token uuid,
  granted_free boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.place_find_wallets%rowtype;
  v_lot_id uuid;
  v_granted boolean := false;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  insert into public.place_find_wallets(user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select pfw.*
    into v_wallet
    from public.place_find_wallets as pfw
   where pfw.user_id = p_user_id
     and pfw.status = 'active'
   for update;

  if not found then
    raise exception 'active_wallet_not_found';
  end if;

  if not p_is_anonymous then
    insert into public.place_find_free_grant_claims(claim_key, grant_version, wallet_id)
    values ('user:' || p_user_id::text, 'lifetime_v1', v_wallet.id)
    on conflict (claim_key) do nothing;

    if found then
      insert into public.place_find_lots(
        wallet_id,
        source_kind,
        source_reference,
        granted_uses,
        available_uses
      )
      values (v_wallet.id, 'free_lifetime', 'lifetime_v1', 5, 5)
      returning id into v_lot_id;

      update public.place_find_wallets as pfw
         set available_uses = pfw.available_uses + 5,
             version = pfw.version + 1,
             updated_at = now()
       where pfw.id = v_wallet.id
      returning pfw.* into v_wallet;

      insert into public.place_find_ledger(
        wallet_id,
        lot_id,
        entry_type,
        available_delta,
        reason_code,
        idempotency_key
      )
      values (
        v_wallet.id,
        v_lot_id,
        'free_grant',
        5,
        'lifetime_v1',
        'free:lifetime:v1:' || p_user_id::text
      );
      v_granted := true;
    end if;
  end if;

  return query
  select
    v_wallet.id,
    v_wallet.available_uses,
    v_wallet.reserved_uses,
    v_wallet.app_account_token,
    v_granted;
end;
$$;

create or replace function public.reserve_place_find_use(
  p_user_id uuid,
  p_share_job_id uuid
)
returns table(reservation_id uuid, available_uses integer, replayed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.place_find_wallets%rowtype;
  v_lot public.place_find_lots%rowtype;
  v_res public.place_find_reservations%rowtype;
  v_cycle integer;
begin
  select pfr.*
    into v_res
    from public.place_find_reservations as pfr
   where pfr.share_job_id = p_share_job_id
   for update;

  if found and v_res.status in ('reserved', 'consumed') then
    select pfw.*
      into v_wallet
      from public.place_find_wallets as pfw
     where pfw.id = v_res.wallet_id;
    return query select v_res.id, v_wallet.available_uses, true;
    return;
  end if;

  select pfw.*
    into v_wallet
    from public.place_find_wallets as pfw
   where pfw.user_id = p_user_id
     and pfw.status = 'active'
   for update;

  if not found then
    raise exception 'wallet_not_found';
  end if;
  if v_wallet.available_uses < 1 then
    raise exception 'insufficient_place_finds';
  end if;
  if not exists (
    select 1
      from public.share_jobs as sj
     where sj.id = p_share_job_id
       and sj.user_id = p_user_id
  ) then
    raise exception 'share_job_owner_mismatch';
  end if;

  select pfl.*
    into v_lot
    from public.place_find_lots as pfl
   where pfl.wallet_id = v_wallet.id
     and pfl.available_uses > 0
     and (pfl.expires_at is null or pfl.expires_at > now())
   order by pfl.expires_at nulls last, pfl.created_at, pfl.id
   limit 1
   for update;

  if not found then
    raise exception 'place_find_lot_not_found';
  end if;

  update public.place_find_lots as pfl
     set available_uses = pfl.available_uses - 1,
         reserved_uses = pfl.reserved_uses + 1
   where pfl.id = v_lot.id;

  update public.place_find_wallets as pfw
     set available_uses = pfw.available_uses - 1,
         reserved_uses = pfw.reserved_uses + 1,
         version = pfw.version + 1,
         updated_at = now()
   where pfw.id = v_wallet.id
  returning pfw.* into v_wallet;

  if v_res.id is null then
    insert into public.place_find_reservations(wallet_id, lot_id, share_job_id)
    values (v_wallet.id, v_lot.id, p_share_job_id)
    returning * into v_res;
  else
    v_cycle := v_res.cycle + 1;
    update public.place_find_reservations
       set lot_id = v_lot.id,
           status = 'reserved',
           cycle = v_cycle,
           outcome_code = null,
           reserved_at = now(),
           settled_at = null,
           updated_at = now()
     where id = v_res.id
    returning * into v_res;
  end if;

  insert into public.place_find_ledger(
    wallet_id,
    lot_id,
    reservation_id,
    share_job_id,
    entry_type,
    available_delta,
    reserved_delta,
    reason_code,
    idempotency_key
  )
  values (
    v_wallet.id,
    v_lot.id,
    v_res.id,
    p_share_job_id,
    'reserve',
    -1,
    1,
    'share_started',
    'reserve:' || p_share_job_id::text || ':' || v_res.cycle::text
  );

  insert into public.analytics_events(user_id, event_name, properties)
  values (
    p_user_id,
    'use_reserved',
    jsonb_build_object('share_job_id', p_share_job_id)
  );

  return query select v_res.id, v_wallet.available_uses, false;
end;
$$;

create or replace function public.create_share_job_for_user(
  p_user_id uuid,
  p_source_url text,
  p_canonical_url text,
  p_source_platform text,
  p_idempotency_key text default null,
  p_dedupe_window_seconds integer default 90,
  p_is_anonymous boolean default false,
  p_force_rerun boolean default false
)
returns table(
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
  v_existing record;
  v_job public.share_jobs%rowtype;
  v_lock_key bigint;
  v_claimed integer := 0;
  v_available integer := 0;
begin
  if p_user_id is null then
    raise exception 'missing_user_id';
  end if;

  v_lock_key := hashtextextended(
    p_user_id::text || ':' || coalesce(p_canonical_url, p_source_url, ''),
    0
  );
  perform pg_advisory_xact_lock(v_lock_key);

  if not p_is_anonymous then
    perform * from public.ensure_place_find_wallet(p_user_id, false);
    select pfw.available_uses
      into v_available
      from public.place_find_wallets as pfw
     where pfw.user_id = p_user_id;
  end if;

  if nullif(trim(p_idempotency_key), '') is not null then
    select sj.*
      into v_existing
      from public.share_jobs as sj
     where sj.user_id = p_user_id
       and sj.idempotency_key = p_idempotency_key
     limit 1;
    if found then
      return query
      select
        v_existing.id,
        v_existing.status,
        true,
        v_existing.status = 'awaiting_purchase',
        v_available;
      return;
    end if;
  end if;

  select sj.*
    into v_existing
    from public.share_jobs as sj
   where sj.user_id = p_user_id
     and sj.canonical_url = p_canonical_url
     and sj.status in ('awaiting_purchase', 'queued', 'processing_metadata')
     and sj.created_at >= now() - make_interval(secs => greatest(p_dedupe_window_seconds, 1))
   order by sj.created_at desc
   limit 1;

  if found then
    return query
    select
      v_existing.id,
      v_existing.status,
      true,
      v_existing.status = 'awaiting_purchase',
      v_available;
    return;
  end if;

  if not p_force_rerun then
    select sj.*
      into v_existing
      from public.share_jobs as sj
     where sj.user_id = p_user_id
       and sj.canonical_url = p_canonical_url
       and sj.status = 'completed'
     order by sj.completed_at desc nulls last, sj.created_at desc
     limit 1;
    if found then
      return query select v_existing.id, v_existing.status, true, false, v_available;
      return;
    end if;
  end if;

  insert into public.share_jobs(
    user_id,
    source_url,
    canonical_url,
    source_platform,
    status,
    progress_stage,
    idempotency_key,
    billing_mode
  )
  values (
    p_user_id,
    p_source_url,
    p_canonical_url,
    p_source_platform,
    'awaiting_purchase',
    'awaiting_purchase',
    p_idempotency_key,
    case when p_is_anonymous then 'blocked_anonymous' else 'metered' end
  )
  returning * into v_job;

  if p_is_anonymous then
    insert into public.place_find_onboarding_claims(anonymous_user_id, share_job_id)
    values (p_user_id, v_job.id)
    on conflict (anonymous_user_id) do nothing;
    get diagnostics v_claimed = row_count;
    if v_claimed = 1 then
      update public.share_jobs
         set status = 'queued',
             progress_stage = 'queued',
             billing_mode = 'onboarding_free'
       where id = v_job.id
      returning * into v_job;
    end if;
  else
    begin
      perform * from public.reserve_place_find_use(p_user_id, v_job.id);
      update public.share_jobs
         set status = 'queued',
             progress_stage = 'queued'
       where id = v_job.id
      returning * into v_job;

      select pfw.available_uses
        into v_available
        from public.place_find_wallets as pfw
       where pfw.user_id = p_user_id;
    exception when raise_exception then
      if sqlerrm <> 'insufficient_place_finds' then
        raise;
      end if;
    end;
  end if;

  return query
  select
    v_job.id,
    v_job.status,
    false,
    v_job.status = 'awaiting_purchase',
    v_available;
end;
$$;

create or replace function public.resume_place_find_job(
  p_user_id uuid,
  p_job_id uuid
)
returns table(job_id uuid, status text, available_uses integer, replayed boolean)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_job public.share_jobs%rowtype;
  v_available integer;
begin
  select sj.*
    into v_job
    from public.share_jobs as sj
   where sj.id = p_job_id
     and sj.user_id = p_user_id
   for update;

  if not found then
    raise exception 'share_job_not_found';
  end if;

  if v_job.status <> 'awaiting_purchase' then
    select pfw.available_uses
      into v_available
      from public.place_find_wallets as pfw
     where pfw.user_id = p_user_id;
    return query select v_job.id, v_job.status, v_available, true;
    return;
  end if;

  perform * from public.ensure_place_find_wallet(p_user_id, false);
  perform * from public.reserve_place_find_use(p_user_id, p_job_id);

  update public.share_jobs
     set status = 'queued',
         progress_stage = 'queued',
         billing_mode = 'metered',
         updated_at = now()
   where id = p_job_id
  returning * into v_job;

  select pfw.available_uses
    into v_available
    from public.place_find_wallets as pfw
   where pfw.user_id = p_user_id;

  return query select v_job.id, v_job.status, v_available, false;
end;
$$;

create or replace function public.apply_dev_mock_place_find_purchase(
  p_user_id uuid,
  p_product_id text,
  p_client_purchase_id text
)
returns table(
  wallet_id uuid,
  available_uses integer,
  granted_uses integer,
  replayed boolean
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.place_find_wallets%rowtype;
  v_product public.place_find_products%rowtype;
  v_lot_id uuid;
  v_tx text := 'mock:' || p_user_id::text || ':' || p_client_purchase_id;
begin
  if coalesce(length(trim(p_client_purchase_id)), 0) not between 8 and 100 then
    raise exception 'invalid_purchase_id';
  end if;

  select pfp.*
    into v_product
    from public.place_find_products as pfp
   where pfp.product_id = p_product_id
     and pfp.product_kind = 'dev_mock'
     and pfp.active;

  if not found then
    raise exception 'mock_product_not_allowed';
  end if;

  perform * from public.ensure_place_find_wallet(p_user_id, false);
  select pfw.*
    into v_wallet
    from public.place_find_wallets as pfw
   where pfw.user_id = p_user_id
   for update;

  if exists (
    select 1
      from public.place_find_purchase_transactions as pfpt
     where pfpt.environment = 'DevMock'
       and pfpt.transaction_id = v_tx
  ) then
    return query select v_wallet.id, v_wallet.available_uses, v_product.use_count, true;
    return;
  end if;

  insert into public.place_find_purchase_transactions(
    environment,
    transaction_id,
    wallet_id,
    product_id,
    app_account_token,
    purchased_at,
    granted_uses
  )
  values (
    'DevMock',
    v_tx,
    v_wallet.id,
    p_product_id,
    v_wallet.app_account_token,
    now(),
    v_product.use_count
  );

  insert into public.place_find_lots(
    wallet_id,
    source_kind,
    source_reference,
    granted_uses,
    available_uses
  )
  values (
    v_wallet.id,
    'dev_mock_purchase',
    v_tx,
    v_product.use_count,
    v_product.use_count
  )
  returning id into v_lot_id;

  update public.place_find_wallets as pfw
     set available_uses = pfw.available_uses + v_product.use_count,
         version = pfw.version + 1,
         updated_at = now()
   where pfw.id = v_wallet.id
  returning pfw.* into v_wallet;

  insert into public.place_find_ledger(
    wallet_id,
    lot_id,
    transaction_id,
    entry_type,
    available_delta,
    reason_code,
    idempotency_key
  )
  values (
    v_wallet.id,
    v_lot_id,
    v_tx,
    'dev_mock_purchase',
    v_product.use_count,
    p_product_id,
    'purchase:DevMock:' || v_tx
  );

  return query select v_wallet.id, v_wallet.available_uses, v_product.use_count, false;
end;
$$;

revoke all on function public.ensure_place_find_wallet(uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.reserve_place_find_use(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.create_share_job_for_user(uuid, text, text, text, text, integer, boolean, boolean)
  from public, anon, authenticated;
revoke all on function public.resume_place_find_job(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.apply_dev_mock_place_find_purchase(uuid, text, text)
  from public, anon, authenticated;

grant execute on function public.ensure_place_find_wallet(uuid, boolean) to service_role;
grant execute on function public.reserve_place_find_use(uuid, uuid) to service_role;
grant execute on function public.create_share_job_for_user(uuid, text, text, text, text, integer, boolean, boolean) to service_role;
grant execute on function public.resume_place_find_job(uuid, uuid) to service_role;
grant execute on function public.apply_dev_mock_place_find_purchase(uuid, text, text) to service_role;
