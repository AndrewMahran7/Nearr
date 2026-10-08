-- Read-only Development audit. IDs are one-way pseudonyms; no payload, user,
-- source URL, place, or other private content is selected.
select
  left(md5(id::text), 12) as job_id_pseudonym,
  status,
  completed_at as result_ready_at,
  completed_at as notification_decided_at,
  completed_at as queued_at,
  notification_last_attempt_at as dispatch_started_at,
  notification_submitted_at as provider_accepted_at,
  null::timestamptz as client_received_at,
  'unknown'::text as app_state,
  null::boolean as suppressed,
  null::text as suppression_reason,
  notification_attempts,
  notification_error_code,
  extract(epoch from (notification_last_attempt_at - completed_at))::numeric(10,3)
    as result_to_dispatch_seconds,
  extract(epoch from (notification_submitted_at - notification_last_attempt_at))::numeric(10,3)
    as dispatch_to_provider_accept_seconds
from public.share_jobs
where completed_at is not null
  and notification_payload is not null
order by completed_at desc
limit 25;
