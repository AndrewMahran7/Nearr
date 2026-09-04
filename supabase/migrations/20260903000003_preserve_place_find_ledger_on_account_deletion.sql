-- Preserve immutable accounting history while allowing the declared
-- place_find_ledger.share_job_id ON DELETE SET NULL action to run during
-- account deletion. Direct UPDATE/DELETE attempts remain rejected.

create or replace function public.reject_place_find_ledger_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_new public.place_find_ledger%rowtype;
begin
  if tg_op = 'UPDATE'
     and pg_trigger_depth() > 1
     and old.share_job_id is not null
     and new.share_job_id is null then
    v_new := new;
    v_new.share_job_id := old.share_job_id;
    if v_new is not distinct from old then
      return new;
    end if;
  end if;
  raise exception 'place_find_ledger_is_append_only';
end;
$$;

create or replace function public.close_place_find_wallet(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet_id uuid;
  v_res record;
begin
  select pfw.id
    into v_wallet_id
    from public.place_find_wallets as pfw
   where pfw.user_id = p_user_id
   for update;
  if not found then
    return true;
  end if;

  for v_res in
    select pfr.share_job_id
      from public.place_find_reservations as pfr
     where pfr.wallet_id = v_wallet_id
       and pfr.status = 'reserved'
       and pfr.share_job_id is not null
     for update
  loop
    perform *
      from public.settle_place_find_use(
        v_res.share_job_id,
        'release',
        'account_deleted'
      );
  end loop;

  update public.place_find_wallets as pfw
     set user_id = null,
         status = 'closed',
         version = pfw.version + 1,
         updated_at = now()
   where pfw.id = v_wallet_id;
  return true;
end;
$$;

revoke all on function public.reject_place_find_ledger_mutation() from public, anon, authenticated;
revoke all on function public.close_place_find_wallet(uuid) from public, anon, authenticated;
grant execute on function public.close_place_find_wallet(uuid) to service_role;
