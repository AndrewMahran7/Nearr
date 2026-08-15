-- Hosted-safe Phase 2 lease/recovery probe.
--
-- Safety: repeatable-read first proves there is no actionable production media
-- work in this snapshot. New work committed after that check is invisible to
-- this transaction. Every synthetic row and mutation is rolled back.

begin isolation level repeatable read;

create temporary table _phase2_ctx (
  ordinal integer primary key,
  task_id uuid not null
) on commit drop;

create temporary table _phase2_claims (
  claim_no integer not null,
  task_id uuid not null
) on commit drop;

do $$
declare
  v_user uuid;
  v_job uuid;
  v_task uuid;
  v_i integer;
begin
  if exists (
    select 1
      from public.share_media_tasks mt
      join public.share_jobs sj on sj.id = mt.share_job_id
     where mt.attempts < mt.max_attempts
       and (mt.next_attempt_at is null or mt.next_attempt_at <= now())
       and (mt.status = 'queued' or (mt.status = 'processing' and mt.locked_until < now()))
       and (sj.status = 'processing_metadata' or (sj.status = 'completed' and sj.saved_place_id is not null))
  ) then
    raise exception 'Refusing hosted queue probe: actionable production work exists in the isolated snapshot';
  end if;

  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise exception 'Hosted queue probe requires one existing FK owner'; end if;

  for v_i in 1..5 loop
    insert into public.share_jobs (user_id, source_url, source_platform, status)
    values (v_user, 'https://example.com/phase2-hosted-queue/' || gen_random_uuid(), 'instagram', 'processing_metadata')
    returning id into v_job;

    insert into public.share_media_tasks (
      share_job_id, user_id, source_url, platform, status, attempts, max_attempts, created_at
    ) values (
      v_job, v_user, 'https://example.com/phase2-hosted-media/' || gen_random_uuid(),
      'instagram', 'queued', 0, 3, now() + make_interval(secs => v_i)
    ) returning id into v_task;
    insert into _phase2_ctx values (v_i, v_task);
  end loop;
end $$;

-- Two independent claim attempts each lease exactly one different row.
insert into _phase2_claims select 1, id from public.claim_media_tasks(1, 600);
insert into _phase2_claims select 2, id from public.claim_media_tasks(1, 600);

do $$
begin
  if (select count(*) from _phase2_claims) <> 2 then
    raise exception 'Expected two successful single-slot claims';
  end if;
  if (select count(distinct task_id) from _phase2_claims) <> 2 then
    raise exception 'Fresh leases were claimed more than once';
  end if;
  if exists (
    select 1 from public.share_media_tasks mt
     where mt.id in (select task_id from _phase2_claims)
       and (mt.status <> 'processing' or mt.attempts <> 1 or mt.locked_until <= now())
  ) then
    raise exception 'Claim did not atomically set status, attempt, and lease';
  end if;
end $$;

-- Inject worker death by expiring the first lease; the oldest stale task must
-- be reclaimed exactly once and its attempt count must advance.
update public.share_media_tasks
   set locked_until = now() - interval '1 second'
 where id = (select task_id from _phase2_claims where claim_no = 1);
insert into _phase2_claims select 3, id from public.claim_media_tasks(1, 600);

do $$
begin
  if (select task_id from _phase2_claims where claim_no = 3)
     <> (select task_id from _phase2_claims where claim_no = 1) then
    raise exception 'Expired lease was not reclaimed first';
  end if;
  if (select attempts from public.share_media_tasks where id = (select task_id from _phase2_claims where claim_no = 3)) <> 2 then
    raise exception 'Stale-lease recovery did not increment attempts once';
  end if;
end $$;

-- Inject a 429-style retry backoff. The requeued task must remain invisible
-- until next_attempt_at, while another ready row remains claimable.
select public.requeue_media_task(
  (select task_id from _phase2_claims where claim_no = 3), 60, 'provider_rate_limited'
);
insert into _phase2_claims select 4, id from public.claim_media_tasks(1, 600);

do $$
begin
  if (select task_id from _phase2_claims where claim_no = 4)
     = (select task_id from _phase2_claims where claim_no = 3) then
    raise exception 'Backoff task was reclaimed prematurely';
  end if;
end $$;

-- Terminal callbacks are idempotent from the queue's perspective: even with
-- an expired lock, a completed task can never be reclaimed.
update public.share_media_tasks
   set status = 'completed', locked_until = now() - interval '1 second', completed_at = now()
 where id = (select task_id from _phase2_claims where claim_no = 2);
insert into _phase2_claims select 5, id from public.claim_media_tasks(1, 600);

do $$
begin
  if (select task_id from _phase2_claims where claim_no = 5)
     = (select task_id from _phase2_claims where claim_no = 2) then
    raise exception 'Terminal task was reclaimed';
  end if;
  raise notice 'phase2_hosted_queue_claim_recovery_backoff_terminal: PASS';
end $$;

rollback;
