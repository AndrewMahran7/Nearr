import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const worker = readFileSync(
  join(root, 'supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
const hook = readFileSync(join(root, 'hooks/useSavedPlaces.ts'), 'utf8');
const map = readFileSync(join(root, 'app/(tabs)/map.tsx'), 'utf8');
const claimMigration = readFileSync(
  join(root, 'supabase/migrations/20260813000001_post_save_media_enrichment.sql'),
  'utf8',
);

const autoSaveStart = worker.indexOf("if (plan.route === 'auto_save')");
const completion = worker.indexOf("status: 'completed'", autoSaveStart);
const scheduling = worker.indexOf('shouldRunPostSaveEnrichment', completion);
assert.ok(autoSaveStart >= 0 && completion > autoSaveStart && scheduling > completion,
  'metadata save reaches completed before enrichment scheduling');
assert.match(worker, /enqueueMediaTask\(admin, job, platform, canonicalUrl, requestUrl, \{ parkParent: false \}\)/,
  'post-save task does not park or reopen the parent');
assert.match(worker, /share_job_id: job\.id/,
  'media task is linked to the authoritative share job');
assert.match(claimMigration, /sj\.status = 'completed' and sj\.saved_place_id is not null/,
  'worker can claim a completed job only when it has an authoritative saved target');
assert.doesNotMatch(claimMigration, /sj\.status in \([^)]*needs_help|sj\.status = 'cancelled'/,
  'review/cancelled parents remain unclaimable');
assert.match(worker, /\.eq\('id', job\.saved_place_id\)/,
  'finalizer resolves the authoritative savedPlaceId');
assert.match(worker, /candidate\.googlePlaceId === targetProviderId/,
  'provider identity must match exactly before enriching');
assert.match(worker, /preserve_saved_identity_and_withhold_note/,
  'identity disagreement preserves the save and withholds the note');

const enrichmentStart = worker.indexOf('async function finalizePostSaveEnrichment');
const enrichmentEnd = worker.indexOf('// Move a parent job', enrichmentStart);
const enrichmentBody = worker.slice(enrichmentStart, enrichmentEnd);
assert.doesNotMatch(enrichmentBody, /saveForUser|auto_save_share_job_place_result/,
  'post-save enrichment cannot create or duplicate a saved place');
assert.match(enrichmentBody, /\.update\(\{ ai_note: note \}\)/,
  'enrichment only mutates ai_note');
assert.doesNotMatch(enrichmentBody, /update\(\{[^}]*notes:/s,
  'user notes are never updated');
assert.match(enrichmentBody, /post_save_secondary_logical_place/,
  'B/C are recorded as separate logical results instead of leaking into A');

assert.match(hook, /table: 'share_job_place_results'/,
  'the already-published enrichment ledger drives Realtime updates');
assert.match(hook, /row\.saved_place_id.*fetch\('background'\)/s,
  'a completed linked enrichment refreshes the shared saved-place cache');
assert.match(map, /live = validPlaces\.find\(\(place\) => place\.id === selected\.id\)/,
  'an open map detail sheet follows the asynchronously updated row');

console.log('PASS Santa Fe-shaped save-first enrichment, exact linkage, dedupe, isolation, and async UI contracts');
