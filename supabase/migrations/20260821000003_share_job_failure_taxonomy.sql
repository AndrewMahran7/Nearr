-- Stable, client-readable share failure facts. Raw provider messages remain in
-- service-only diagnostics; these columns carry only bounded classifications.

alter table public.share_jobs
  add column if not exists failure_category text,
  add column if not exists failure_code text,
  add column if not exists analysis_attempted boolean not null default false;

alter table public.share_jobs
  drop constraint if exists share_jobs_failure_category_check;

alter table public.share_jobs
  add constraint share_jobs_failure_category_check
  check (
    failure_category is null or failure_category in (
      'media_access_required',
      'media_too_long',
      'analysis_insufficient',
      'technical_failure'
    )
  );

-- Retry remains owner-scoped and only applies to terminal technical failures.
-- Access/policy/insufficient results are needs_help rows and are intentionally
-- not made retryable by this RPC.
create or replace function public.retry_share_job(
  p_job_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_updated integer;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  update public.share_jobs sj
     set status = 'queued',
         attempts = 0,
         locked_until = null,
         last_error = null,
         failure_reason = null,
         failure_category = null,
         failure_code = null,
         analysis_attempted = false,
         completed_at = null,
         progress_stage = 'queued',
         updated_at = now()
   where sj.id = p_job_id
     and sj.user_id = v_uid
     and sj.saved_place_id is null
     and sj.status = 'failed'
     and coalesce(sj.failure_category, 'technical_failure') = 'technical_failure';

  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$$;

revoke all on function public.retry_share_job(uuid) from public;
grant execute on function public.retry_share_job(uuid) to authenticated;

-- DOWN (manual rollback):
--   restore retry_share_job from 20260731000001_share_jobs.sql;
--   alter table public.share_jobs drop constraint if exists share_jobs_failure_category_check;
--   alter table public.share_jobs drop column if exists analysis_attempted;
--   alter table public.share_jobs drop column if exists failure_code;
--   alter table public.share_jobs drop column if exists failure_category;
