-- The function returns columns named active and active_until. Qualify table
-- columns explicitly so PL/pgSQL never confuses them with output parameters.

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
  select c.* into v_cfg from public.token_monetization_config c where c.environment_name='development';
  if not coalesce(v_cfg.enabled,false) then raise exception 'token_monetization_disabled';end if;
  if p_project_id is distinct from v_cfg.revenuecat_project_id or p_app_id is distinct from v_cfg.revenuecat_app_id then raise exception 'revenuecat_context_mismatch';end if;
  if p_purchase_environment<>'SANDBOX' then raise exception 'production_event_forbidden';end if;
  if not(upper(coalesce(p_store,''))=any(v_cfg.revenuecat_allowed_stores)) then raise exception 'revenuecat_store_mismatch';end if;
  select p.* into v_product from public.nearr_pro_products p where p.product_id=p_product_id and p.active=true;
  if not found or not(p_entitlement_ids ? v_product.entitlement_id) then raise exception 'unapproved_subscription_product';end if;
  if exists(select 1 from public.revenuecat_webhook_events e where e.event_id=p_event_id) then
    select a.* into v_access from public.nearr_pro_access a where a.user_id=p_user_id;
    return query select 'duplicate_event',public.has_active_nearr_pro(p_user_id),v_access.active_until,true;return;
  end if;
  insert into public.revenuecat_webhook_events(event_id,event_type,project_id,app_id,purchase_environment,app_user_id,
    product_id,transaction_id,payload_sha256,result_code,event_timestamp_at,expiration_at,original_transaction_id,entitlement_ids,event_reason)
  values(p_event_id,p_event_type,p_project_id,p_app_id,p_purchase_environment,p_user_id::text,p_product_id,p_transaction_id,
    p_payload_sha256,'processing',p_event_at,p_expiration_at,p_original_transaction_id,p_entitlement_ids,p_reason);
  select a.* into v_access from public.nearr_pro_access a where a.user_id=p_user_id for update;
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
      update public.nearr_pro_access as a set will_renew=false,
        active_until=greatest(a.active_until,coalesce(p_expiration_at,a.active_until)),
        status=case when coalesce(p_expiration_at,a.active_until)<=now() then 'revoked' else 'cancelled_active' end,
        latest_event_at=greatest(a.latest_event_at,p_event_at),latest_event_id=p_event_id,updated_at=now() where a.user_id=p_user_id;
      v_result:=case when coalesce(p_expiration_at,v_access.active_until)<=now() then 'pro_revoked' else 'pro_cancelled_active' end;
    end if;
  elsif p_event_type='BILLING_ISSUE' then
    if v_had_access and (p_event_at>=v_access.latest_event_at or coalesce(p_expiration_at,'epoch')>=v_access.active_until) then
      update public.nearr_pro_access as a set active_until=greatest(a.active_until,coalesce(p_expiration_at,a.active_until)),
        status=case when greatest(a.active_until,coalesce(p_expiration_at,a.active_until))>now() then 'billing_issue' else 'expired' end,
        latest_event_at=greatest(a.latest_event_at,p_event_at),latest_event_id=p_event_id,updated_at=now() where a.user_id=p_user_id;
      v_result:='billing_issue_recorded';
    else v_result:='stale_billing_issue_ignored';v_replayed:=true;end if;
  elsif p_event_type='EXPIRATION' then
    if v_had_access and coalesce(p_expiration_at,'epoch')>=v_access.active_until then
      update public.nearr_pro_access as a set active_until=coalesce(p_expiration_at,a.active_until),status='expired',will_renew=false,
        latest_event_at=greatest(a.latest_event_at,p_event_at),latest_event_id=p_event_id,updated_at=now() where a.user_id=p_user_id;
      v_result:='pro_expired';
    else v_result:='stale_expiration_ignored';v_replayed:=true;end if;
  elsif p_event_type in ('PRODUCT_CHANGE','SUBSCRIPTION_PAUSED') then v_result:='subscription_change_recorded';
  else raise exception 'unsupported_subscription_event';end if;
  update public.revenuecat_webhook_events e set result_code=v_result,processed_at=now() where e.event_id=p_event_id;
  select a.* into v_access from public.nearr_pro_access a where a.user_id=p_user_id;
  v_active:=public.has_active_nearr_pro(p_user_id);
  insert into public.analytics_events(user_id,event_name,properties) values(
    p_user_id,'pro_subscription_event',jsonb_build_object('event_type',p_event_type,'result',v_result,'active',v_active,'test',true));
  return query select v_result,v_active,v_access.active_until,v_replayed;
end;
$$;

revoke all on function public.process_revenuecat_subscription_event(text,text,text,text,text,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text,text)
  from public,anon,authenticated;
grant execute on function public.process_revenuecat_subscription_event(text,text,text,text,text,text,uuid,text,text,text,timestamptz,timestamptz,timestamptz,jsonb,text,text)
  to service_role;
