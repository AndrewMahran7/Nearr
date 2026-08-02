-- ============================================================================
-- scripts/recoverStaleShareJobs.sql
--
-- Administrative recovery for share_jobs that are stranded in a non-terminal
-- state (queued / processing_metadata) because the worker never advanced them.
--
-- ROOT CAUSE THIS RESPONDS TO (2026-08-02 forensics):
--   The per-minute cron `process-share-jobs-sweep` runs and "succeeds", but
--   invoke_process_share_jobs() no-ops because the Vault secrets
--   `share_jobs_worker_edge_base_url` + `share_jobs_worker_service_key` are
--   unset (vault.secrets is empty). No net.http_post to /process-share-jobs is
--   ever issued, so claim_share_jobs() never runs and every job stays `queued`
--   (attempts=0, locked_until=null). Once those secrets are configured, the
--   existing queued jobs are claimed automatically — this script is the manual
--   backstop / bounded-recovery escape hatch.
--
-- SAFETY:
--   * Runs in a transaction that ROLLS BACK by default, so executing it as-is
--     ONLY REPORTS what it would change. Change the final `rollback;` to
--     `commit;` to apply.
--   * NEVER touches terminal/owned states (completed / needs_help / failed /
--     cancelled).
--   * Idempotent.
--
-- DO NOT RUN until the root cause is reported and approved (per the Phase 1
-- recovery task). Run in the Supabase SQL editor or via psql as postgres /
-- service_role.
--
-- Adjust the "60 minutes" threshold below to taste.
-- ============================================================================

begin;

-- 1) REPORT: current stranded jobs older than the threshold.
select status, count(*) as n, min(created_at) as oldest, max(created_at) as newest
from public.share_jobs
where status in ('queued', 'processing_metadata')
  and updated_at < now() - interval '60 minutes'
group by status
order by status;

-- 2a) RECLAIM (attempts remaining): reset to `queued` + clear any lease so a
--     healthy dispatch picks them up immediately. For the current stranded set
--     (already queued, attempts=0) this is a safe no-op that just clears leases.
update public.share_jobs sj
   set status = 'queued',
       locked_until = null,
       updated_at = now()
 where sj.status in ('queued', 'processing_metadata')
   and sj.updated_at < now() - interval '60 minutes'
   and sj.attempts < sj.max_attempts;

-- 2b) BOUND (max attempts reached while processing): surface as needs_help so
--     the user can resolve it manually — never leave it spinning, never drop it.
update public.share_jobs sj
   set status = 'needs_help',
       needs_help_reason = 'manual_search',
       decision = 'manual_fallback',
       failure_reason = coalesce(sj.failure_reason, 'stale_no_worker'),
       progress_stage = 'stale_recovered',
       updated_at = now()
 where sj.status = 'processing_metadata'
   and sj.attempts >= sj.max_attempts
   and sj.updated_at < now() - interval '60 minutes';

-- 3) REPORT post-change distribution (within the same rolled-back transaction).
select status, count(*) as n
from public.share_jobs
group by status
order by status;

-- Change to `commit;` to APPLY the recovery.
rollback;
