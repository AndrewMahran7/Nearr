-- Sanitized recent Phase 2 canary audit. Run as service_role/postgres.
-- Intentionally excludes user IDs, URLs, raw evidence, and model output.
select
  r.share_job_id as job_id,
  r.share_media_task_id as media_task_id,
  r.share_media_run_id as media_run_id,
  r.logical_result_id,
  r.outcome,
  r.google_place_id,
  r.saved_place_id,
  r.confidence_score,
  r.rule_version,
  r.reason_codes,
  r.finalized_at,
  mt.status as media_task_status,
  sj.status as job_status,
  sj.notification_status
from public.share_job_place_results r
join public.share_jobs sj on sj.id = r.share_job_id
left join public.share_media_tasks mt on mt.id = r.share_media_task_id
where r.created_at >= now() - interval '14 days'
order by r.created_at desc, r.share_job_id, r.logical_result_id
limit 500;

select
  rule_version,
  outcome,
  count(*) as logical_places,
  count(*) filter (where saved_place_id is not null) as linked_saved_places
from public.share_job_place_results
where created_at >= now() - interval '14 days'
group by rule_version, outcome
order by rule_version, outcome;