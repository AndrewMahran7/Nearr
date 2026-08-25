import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { normalizeActiveQueueRows } from '../lib/queueInbox';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const migration = read('supabase/migrations/20260824233000_empty_queue_durable.sql');
const service = read('services/shareJobsService.ts');
const screen = read('app/share-jobs/index.tsx');
const detail = read('app/share-jobs/[jobId].tsx');
const dashboard = read('scripts/phase2OperationalSnapshot.sql');

const active = normalizeActiveQueueRows([
  { id: 'queued', status: 'queued', queue_archived_at: null },
  { id: 'archived', status: 'processing_metadata', queue_archived_at: '2026-08-24T00:00:00Z' },
  { id: 'help', status: 'needs_help', queue_archived_at: null },
  { id: 'completed', status: 'completed', queue_archived_at: null },
]);
assert.deepEqual(active.map((row) => row.id), ['queued', 'help']);

assert.match(migration, /add column if not exists queue_archived_at timestamptz/i);
assert.match(migration, /create or replace function public\.archive_active_queue_for_user/i);
assert.match(migration, /security definer[\s\S]*set search_path = public, pg_temp/i);
assert.match(migration, /v_uid uuid := auth\.uid\(\)/i);
assert.match(migration, /sj\.user_id = v_uid/i);
assert.match(migration, /sj\.created_at <= v_cutoff/i);
assert.match(migration, /transaction_timestamp\(\)/i);
assert.match(migration, /queue_archived_at is null/i);
assert.match(migration, /p_job_ids is null[\s\S]*status in \('queued', 'processing_metadata', 'needs_help', 'failed'\)/i);
assert.match(migration, /share_job_place_results[\s\S]*finalized_at >= v_cutoff - interval '24 hours'/i);
assert.match(migration, /revoke all on function public\.archive_active_queue_for_user\(uuid\[\]\)[\s\S]*from public, anon/i);
assert.match(migration, /grant execute[\s\S]*to authenticated, service_role/i);
assert.match(migration, /revoke delete on table public\.share_jobs from authenticated/i);
assert.doesNotMatch(migration, /delete\s+from\s+public\.(share_jobs|saved_places|saved_place_sources|recognition_cache)/i);
assert.doesNotMatch(migration, /update\s+public\.(saved_places|saved_place_sources|recognition_cache)/i);

assert.match(service, /\.is\('queue_archived_at', null\)/);
assert.match(service, /\.is\('share_job\.queue_archived_at', null\)/);
assert.match(service, /rpc\('archive_active_queue_for_user'/);
assert.doesNotMatch(service, /from\('share_jobs'\)\.delete\(/);
assert.match(detail, /await archiveShareJob\(job\.id\)/);
assert.doesNotMatch(detail, /await (cancelShareJob|deleteShareJob)\(job\.id\)/);

assert.match(screen, /Empty your queue\?/);
assert.match(screen, /This removes all items from your queue\. Your saved places won't be affected\./);
assert.match(screen, /style: 'destructive'/);
assert.match(screen, /Alert\.alert\('Queue emptied'\)/);
assert.match(screen, /Connect to empty your queue\./);
assert.match(screen, /setDismissedIds\(previousDismissed\)/);
assert.match(screen, /setClearedIds\(previousCleared\)/);
assert.match(screen, /await refresh\(\)/);
for (const event of [
  'queue_empty_requested',
  'queue_empty_completed',
  'queue_empty_failed',
  'queue_empty_count',
]) assert.match(screen, new RegExp(event));

assert.match(dashboard, /queued_share_jobs[\s\S]*queue_archived_at is null|queue_archived_at is null[\s\S]*queued_share_jobs/i);
assert.match(dashboard, /worker_queued_share_jobs/);

console.log('PASS durable empty-queue client, UX, analytics, history, and query contracts');
