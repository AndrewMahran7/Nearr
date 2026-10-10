-- Run only on a local clone with 20261009000006 applied. Entire fixture rolls back.
begin;
alter table public.share_jobs disable trigger share_jobs_kick_worker;
update public.share_jobs set notification_receipt_status = 'accepted'
  where notification_status = 'submitted' and notification_ticket_ids is not null;

do $$
declare
  v_user uuid;
  v_job uuid := gen_random_uuid();
  v_old_attempt uuid;
  v_new_attempt uuid;
  v_row public.share_jobs%rowtype;
  v_count integer;
  v_other uuid := gen_random_uuid();
  v_pre_send uuid := gen_random_uuid();
  v_pre_attempt uuid;
begin
  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'fixture_user_missing'; end if;
  if exists (select 1 from public.share_jobs where notification_status in ('pending','sending','retryable_failed')) then
    raise exception 'nonfixture_notification_claimable';
  end if;

  insert into public.share_jobs(id,user_id,source_url,status,notification_status,notification_payload)
  values(v_job,v_user,'https://fixtures.nearr.invalid/at-most-once','completed','pending',
    jsonb_build_object('title','Test','body','Test','data',
      jsonb_build_object('jobId',v_job::text,'type','share_job_completed')));
  select * into v_row from public.claim_share_job_notifications(1,180);
  if v_row.id is distinct from v_job or v_row.notification_status <> 'sending'
     or v_row.notification_attempt_started_at is not null
     or v_row.notification_logical_id <> 'n1:'||v_job::text||':c' then
    raise exception 'pending_claim_invalid';
  end if;
  v_old_attempt := v_row.notification_attempt_id;
  select count(*) into v_count from public.claim_share_job_notifications(1,180);
  if v_count <> 0 then raise exception 'duplicate_immediate_claim'; end if;

  -- Crash before the durable marker: stale preparing is safe to reclaim.
  update public.share_jobs set notification_last_attempt_at=now()-interval '181 seconds' where id=v_job;
  select * into v_row from public.claim_share_job_notifications(1,180);
  v_new_attempt := v_row.notification_attempt_id;
  if v_row.id is distinct from v_job or v_new_attempt=v_old_attempt then
    raise exception 'pre_send_recovery_failed';
  end if;
  select count(*) into v_count from public.begin_share_job_notification_provider_attempt(v_job,v_old_attempt);
  if v_count <> 0 then raise exception 'stale_worker_crossed_provider_boundary'; end if;
  select * into v_row from public.begin_share_job_notification_provider_attempt(v_job,v_new_attempt);
  if v_row.id is distinct from v_job or v_row.notification_attempt_started_at is null then
    raise exception 'durable_provider_marker_missing';
  end if;

  -- Crash/timeout after the marker: never reclaim for a second send.
  update public.share_jobs set notification_last_attempt_at=now()-interval '181 seconds' where id=v_job;
  select count(*) into v_count from public.claim_share_job_notifications(1,180);
  if v_count <> 0 then raise exception 'ambiguous_provider_attempt_reclaimed'; end if;
  select * into v_row from public.share_jobs where id=v_job;
  if v_row.notification_status <> 'delivery_unknown' or v_row.status <> 'completed'
     or v_row.notification_attempt_id <> v_new_attempt then
    raise exception 'ambiguous_attempt_not_observational';
  end if;

  -- A late known ticket can still be recorded for the SAME attempt without
  -- resending; receipt polling is separate from the send claim.
  if not public.finish_share_job_notification_provider_attempt(
    v_job,v_new_attempt,'submitted',
    jsonb_build_array(jsonb_build_object('ticketId','ticket-1','tokenId','token-1',
      'logicalId','n1:'||v_job::text||':c','attemptId',v_new_attempt::text)),null
  ) then raise exception 'late_ticket_not_persisted'; end if;
  select * into v_row from public.share_jobs where id=v_job;
  if v_row.notification_status <> 'submitted' or v_row.notification_submitted_at is null
     or v_row.notification_receipt_status <> 'pending'
     or v_row.notification_ticket_ids->0->>'attemptId' <> v_new_attempt::text then
    raise exception 'ticket_provenance_missing';
  end if;
  select count(*) into v_count from public.claim_share_job_notifications(1,180);
  if v_count <> 0 then raise exception 'submitted_reclaimed'; end if;
  select count(*) into v_count from public.claim_share_job_receipts(1,90) where id=v_job;
  if v_count <> 1 then raise exception 'receipt_not_claimed'; end if;
  update public.share_jobs set notification_receipt_status='accepted' where id=v_job;
  select count(*) into v_count from public.claim_share_job_receipts(1,90) where id=v_job;
  if v_count <> 0 then raise exception 'accepted_receipt_rechecked'; end if;

  -- A user resolving needs-help before provider start must suppress that old
  -- notification; no new push is synthesized from the saved transition.
  insert into public.share_jobs(id,user_id,source_url,status,notification_status,notification_payload)
  values(v_other,v_user,'https://fixtures.nearr.invalid/superseded','needs_help','pending',
    jsonb_build_object('title','Test','body','Test','data',
      jsonb_build_object('jobId',v_other::text,'type','share_job_needs_help')));
  select * into v_row from public.claim_share_job_notifications(1,180);
  if v_row.id is distinct from v_other then raise exception 'needs_help_not_claimed'; end if;
  update public.share_jobs set status='completed' where id=v_other;
  select count(*) into v_count from public.begin_share_job_notification_provider_attempt(
    v_other,v_row.notification_attempt_id);
  if v_count <> 0 then raise exception 'superseded_result_sent'; end if;

  -- A provable pre-send failure may retry; the old attempt is fenced.
  insert into public.share_jobs(id,user_id,source_url,status,notification_status,notification_payload)
  values(v_pre_send,v_user,'https://fixtures.nearr.invalid/pre-send','failed','pending',
    jsonb_build_object('title','Test','body','Test','data',
      jsonb_build_object('jobId',v_pre_send::text,'type','share_job_needs_help')));
  select * into v_row from public.claim_share_job_notifications(1,180);
  if v_row.id is distinct from v_pre_send then raise exception 'pre_send_fixture_not_claimed'; end if;
  v_pre_attempt := v_row.notification_attempt_id;
  update public.share_jobs set notification_status='retryable_failed',
    notification_next_attempt_at=now()-interval '1 second' where id=v_pre_send;
  select * into v_row from public.claim_share_job_notifications(1,180);
  if v_row.id is distinct from v_pre_send or v_row.notification_attempt_id=v_pre_attempt
     or v_row.notification_attempt_started_at is not null then
    raise exception 'safe_pre_send_retry_failed';
  end if;

  if has_function_privilege('authenticated',
       'public.begin_share_job_notification_provider_attempt(uuid,uuid)','EXECUTE')
     or has_function_privilege('authenticated',
       'public.finish_share_job_notification_provider_attempt(uuid,uuid,text,jsonb,text)','EXECUTE')
     or not has_function_privilege('service_role',
       'public.begin_share_job_notification_provider_attempt(uuid,uuid)','EXECUTE') then
    raise exception 'notification_rpc_grants_unsafe';
  end if;
end;
$$;
rollback;
