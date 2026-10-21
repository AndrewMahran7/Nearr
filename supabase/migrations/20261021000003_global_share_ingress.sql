-- One compatible ingress for the unified app. No dependency on Development
-- practice entitlements or the paused token experiment. Plus enforcement is a
-- separate atomic trigger and is disabled until store/provider qualification.
alter table public.share_jobs add column if not exists submission_path text;
create or replace function public.create_global_share_job_for_user(
 p_user_id uuid,p_source_url text,p_canonical_url text,p_source_platform text,
 p_idempotency_key text default null,p_dedupe_window_seconds integer default 90,
 p_submission_path text default null
) returns table(job_id uuid,status text,duplicate boolean,requires_purchase boolean,available_uses integer)
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_job public.share_jobs%rowtype;
begin
 if p_user_id is null then raise exception 'missing_user_id'; end if;
 if not public.is_account_eligible_for_ai(p_user_id) then raise exception 'global_eligibility_required'; end if;
 if nullif(btrim(p_source_url),'') is null or nullif(btrim(p_canonical_url),'') is null then raise exception 'invalid_url'; end if;
 if p_submission_path is not null and p_submission_path not in ('share_extension','host_app','background_import') then raise exception 'invalid_submission_path'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_user_id::text||':'||p_canonical_url,0));
 if nullif(btrim(p_idempotency_key),'') is not null then
   perform pg_advisory_xact_lock(hashtextextended('global-request:'||p_user_id::text||':'||p_idempotency_key,0));
   select * into v_job from public.share_jobs j where j.user_id=p_user_id and j.idempotency_key=p_idempotency_key limit 1;
   if found then return query select v_job.id,v_job.status,true,false,null::integer; return; end if;
 end if;
 select * into v_job from public.share_jobs j where j.user_id=p_user_id and j.canonical_url=p_canonical_url
   and j.status in ('queued','processing_metadata')
   and j.created_at >= now()-make_interval(secs=>greatest(1,least(p_dedupe_window_seconds,300)))
   order by j.created_at desc limit 1;
 if found then return query select v_job.id,v_job.status,true,false,null::integer; return; end if;
 insert into public.share_jobs(user_id,source_url,canonical_url,source_platform,status,progress_stage,idempotency_key,submission_path)
   values(p_user_id,p_source_url,p_canonical_url,p_source_platform,'queued','queued',p_idempotency_key,p_submission_path)
   returning * into v_job;
 return query select v_job.id,v_job.status,false,false,null::integer;
end; $$;
revoke all on function public.create_global_share_job_for_user(uuid,text,text,text,text,integer,text) from public,anon,authenticated;
grant execute on function public.create_global_share_job_for_user(uuid,text,text,text,text,integer,text) to service_role;
