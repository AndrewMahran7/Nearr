-- Read-only Phase 2 operational snapshot. Safe for production.
-- Usage: supabase db query --linked --file scripts/phase2OperationalSnapshot.sql

with
  recent_jobs as (
    select * from public.share_jobs where created_at >= now() - interval '24 hours'
  ),
  recent_tasks as (
    select * from public.share_media_tasks where created_at >= now() - interval '24 hours'
  ),
  task_latency as (
    select
      extract(epoch from (locked_at - created_at)) as queue_seconds,
      extract(epoch from (completed_at - locked_at)) as execution_seconds
    from recent_tasks
    where locked_at is not null
  ),
  provider_errors as (
    select coalesce(error_item->>'code', error_item->>'reason', error_item#>>'{}') as code
    from public.share_media_runs run
    cross join lateral jsonb_array_elements(coalesce(run.errors, '[]'::jsonb)) error_item
    where run.created_at >= now() - interval '24 hours'
  )
select
  now() as observed_at,
  (select count(*) from public.share_jobs where status = 'queued' and queue_archived_at is null) as queued_share_jobs,
  (select count(*) from public.share_jobs where status = 'processing_metadata' and queue_archived_at is null) as processing_share_jobs,
  (select count(*) from public.share_jobs where status = 'queued') as worker_queued_share_jobs,
  (select count(*) from public.share_jobs where status = 'processing_metadata') as worker_processing_share_jobs,
  (select count(*) from public.share_media_tasks where status = 'queued') as queued_media_tasks,
  (select extract(epoch from now() - min(created_at))::integer from public.share_media_tasks where status = 'queued') as oldest_queued_media_seconds,
  (select count(*) from public.share_media_tasks where status = 'processing' and locked_until > now()) as active_media_leases,
  (select count(*) from public.share_media_tasks where status = 'processing' and locked_until <= now()) as expired_media_leases,
  (select count(*) from public.share_media_tasks where completed_at >= now() - interval '5 minutes') / 5.0 as tasks_completed_per_minute_5m,
  (select round(100.0 * count(*) filter (where status = 'failed') / nullif(count(*), 0), 2) from recent_tasks) as task_failure_percent_24h,
  (select round(100.0 * count(*) filter (where attempts > 1) / nullif(count(*), 0), 2) from recent_tasks) as retry_percent_24h,
  (select round(percentile_cont(0.5) within group (order by queue_seconds)::numeric, 1) from task_latency) as queue_p50_seconds_24h,
  (select round(percentile_cont(0.95) within group (order by queue_seconds)::numeric, 1) from task_latency) as queue_p95_seconds_24h,
  (select round(percentile_cont(0.5) within group (order by execution_seconds)::numeric, 1) from task_latency where execution_seconds is not null) as execution_p50_seconds_24h,
  (select round(percentile_cont(0.95) within group (order by execution_seconds)::numeric, 1) from task_latency where execution_seconds is not null) as execution_p95_seconds_24h,
  (select round(100.0 * count(*) filter (where exists (select 1 from recent_tasks t where t.share_job_id = j.id)) / nullif(count(*), 0), 2) from recent_jobs j) as metadata_to_media_percent_24h,
  (select round(100.0 * count(*) filter (where decision = 'auto_save') / nullif(count(*), 0), 2) from recent_jobs) as autosave_percent_24h,
  (select round(100.0 * count(*) filter (where status = 'needs_help') / nullif(count(*), 0), 2) from recent_jobs) as needs_help_percent_24h,
  (select count(*) from public.share_jobs where status in ('queued', 'processing_metadata') and updated_at < now() - interval '15 minutes') as stuck_jobs_over_15m,
  (select coalesce(jsonb_object_agg(code, occurrences), '{}'::jsonb) from (select code, count(*) occurrences from provider_errors where code is not null group by code) e) as provider_errors_24h;

-- Configured Railway replica count is intentionally not guessed from DB
-- leases. Keep it alongside this snapshot from Railway service settings; the
-- worker emits batch_started/batch_completed logs for runtime activity.
