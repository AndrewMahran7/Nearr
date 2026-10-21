-- Filter before LIMIT/locking so a pre-rollout or subsequently ineligible row
-- cannot abort the whole eligible batch through the existing BEFORE guard.
-- Preserve attempt, lease, retry, task-kind and source-parent conditions.
create or replace function public.claim_share_jobs(p_limit integer default 5, p_lock_seconds integer default 120)
returns setof public.share_jobs language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  return query
  update public.share_jobs sj
     set status = 'processing_metadata',
         attempts = sj.attempts + 1,
         locked_until = now() + make_interval(secs => greatest(p_lock_seconds, 30)),
         updated_at = now()
   where sj.id in (
     select c.id
       from public.share_jobs c
      where public.is_account_eligible_for_ai(c.user_id)
        and c.attempts < c.max_attempts
        and (
          c.status = 'queued'
          or (c.status = 'processing_metadata' and c.locked_until is not null and c.locked_until < now())
        )
      order by c.created_at
      for update skip locked
      limit greatest(p_limit, 1)
   )
  returning sj.*;
end;
$$;

create or replace function public.claim_media_tasks(p_limit integer default 2, p_lock_seconds integer default 600)
returns setof public.share_media_tasks language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  return query update public.share_media_tasks mt set
    status='processing',attempts=mt.attempts+1,locked_at=now(),
    locked_until=now()+make_interval(secs=>greatest(p_lock_seconds,60)),
    progress_stage=coalesce(mt.progress_stage,'queued'),updated_at=now()
  where mt.id in (
    select c.id from public.share_media_tasks c
    where public.is_account_eligible_for_ai(c.user_id)
      and c.attempts<c.max_attempts and (c.next_attempt_at is null or c.next_attempt_at<=now())
      and (c.status='queued' or (c.status='processing' and c.locked_until is not null and c.locked_until<now()))
      and (
        (c.task_kind in ('recognition','premium_recognition') and exists(
          select 1 from public.share_jobs sj where sj.id=c.share_job_id and (
            sj.status='processing_metadata' or
            (c.task_kind='recognition' and sj.status='completed' and sj.saved_place_id is not null)
          )
        )) or
        (c.task_kind='ai_note_enrichment' and exists(
          select 1 from public.saved_places sp where sp.id=c.saved_place_id
            and sp.user_id=c.user_id and sp.place_id=c.target_place_id
            and sp.source_url=coalesce(c.canonical_url,c.source_url)
            and public.is_video_derived_saved_place(sp.source_type,sp.source_url)
            and coalesce(length(trim(sp.ai_note)),0)=0
        )) or
        (c.task_kind='recognition_revalidation' and exists(
          select 1 from public.recognition_revalidation_tasks rt
           where rt.id=c.recognition_revalidation_task_id
             and rt.state in ('QUEUED','RETRY_WAIT','PROCESSING') and rt.next_attempt_at<=now()
        ))
      )
    order by c.created_at for update skip locked limit greatest(p_limit,1)
  ) returning mt.*;
end;
$$;

-- Claims return private queue records and mutate leases across account owners.
-- Only authenticated server workers may invoke these SECURITY DEFINER RPCs.
revoke all on function public.claim_share_jobs(integer,integer) from public,anon,authenticated;
revoke all on function public.claim_media_tasks(integer,integer) from public,anon,authenticated;
grant execute on function public.claim_share_jobs(integer,integer) to service_role;
grant execute on function public.claim_media_tasks(integer,integer) to service_role;
