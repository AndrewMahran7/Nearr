import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { canonicalContentIdentity } from '../lib/shareAgent/contentIdentity';
import {
  RECOGNITION_CACHE_POLICY_VERSION,
  recognitionCacheDiagnostics,
  resolveRecognitionCachePolicy,
  reuseSavedPlaceBySourceOnly,
} from '../supabase/functions/_shared/recognitionCachePolicy';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => fs.readFileSync(path.join(root, relative), 'utf8');
const migration = [
  read('supabase/migrations/20260906000004_recognition_cache_v2.sql'),
  read('supabase/migrations/20260906000005_recognition_cache_v2_saved_category.sql'),
].join('\n');
const cache = read('supabase/functions/process-share-jobs/recognitionCache.ts');
const worker = read('supabase/functions/process-share-jobs/index.ts');
const createJob = read('supabase/functions/create-share-job/index.ts');
const mediaTypes = read('services/media-worker/src/types/media.ts');

const tests: Array<[string, () => void]> = [
  ['missing and malformed flags fail closed', () => {
    assert.equal(resolveRecognitionCachePolicy(() => undefined).readsEnabled, false);
    assert.equal(resolveRecognitionCachePolicy(() => 'maybe').readsEnabled, false);
    assert.equal(resolveRecognitionCachePolicy(() => 'true').readsEnabled, true);
    assert.equal(RECOGNITION_CACHE_POLICY_VERSION, 'recognition-cache-v2.1');
    assert.equal(recognitionCacheDiagnostics(resolveRecognitionCachePolicy(() => undefined)).cacheReadUsed, false);
  }],
  ['source-only reuse stays retired even when enabled', () => {
    assert.equal(reuseSavedPlaceBySourceOnly(resolveRecognitionCachePolicy(() => 'true')), false);
    assert.match(createJob, /p_force_rerun:\s*true/);
  }],
  ['URL variants converge on provider content identity', () => {
    const plain = canonicalContentIdentity('https://www.tiktok.com/@near/video/7673607812571876630')!;
    const tracked = canonicalContentIdentity('https://www.tiktok.com/@near/video/7673607812571876630?utm_source=share')!;
    assert.equal(plain.key, tracked.key);
  }],
  ['legacy trust labels are not read by the V2 lookup', () => {
    const lookup = cache.slice(cache.indexOf('export async function lookupRecognition'), cache.indexOf('export async function commitRecognitionCacheSaveV2'));
    assert.match(lookup, /read_recognition_answers_v2/);
    assert.doesNotMatch(lookup, /\.from\('recognition_cache'\)/);
  }],
  ['admission is terminal, evidence-backed, exact, and failure rejecting', () => {
    assert.match(migration, /v_job\.status<>'completed'/);
    assert.match(migration, /v_job\.failure_category is not null/);
    assert.match(migration, /mt\.status='completed'/);
    assert.match(migration, /mt\.media_acquired_once/);
    assert.match(migration, /r\.confidence_score>=0\.80/);
    assert.match(migration, /generic-only|category_only_candidate|provider_identity_invalid/i);
  }],
  ['legacy rows have no migration into V2', () => {
    assert.doesNotMatch(migration, /insert into public\.recognition_cache_answers_v2[\s\S]{0,1200}from public\.recognition_cache\b/i);
  }],
  ['feedback is owner-authorized, revisioned, quarantined, and outboxed atomically', () => {
    assert.match(migration, /select sp\.user_id into v_owner[\s\S]{0,120}for update/);
    assert.match(migration, /feedback_revision=ss\.feedback_revision\+1/);
    assert.match(migration, /insert into public\.recognition_correction_events/);
    assert.match(migration, /insert into public\.recognition_revalidation_tasks/);
    assert.match(migration, /queue_recognition_revalidation_media_task/);
  }],
  ['old supported correction functions converge on V2 invalidation', () => {
    assert.match(migration, /create or replace function public\.dispute_recognition_after_place_correction/);
    assert.match(migration, /perform public\.apply_recognition_feedback_v2\(new\.id,old\.place_id,new\.place_id/);
    assert.match(migration, /create or replace function public\.reject_saved_place_recognition\(/);
  }],
  ['validation has five bounded outcomes and stale CAS checks', () => {
    for (const outcome of ['AGREES_WITH_REPLACEMENT', 'SUPPORTS_PREVIOUS', 'SUPPORTS_OTHER', 'INSUFFICIENT_EVIDENCE', 'TECHNICAL_FAILURE']) {
      assert.match(migration, new RegExp(outcome));
    }
    assert.match(migration, /v_source\.feedback_revision<>v_task\.feedback_revision/);
    assert.match(migration, /v_source\.evidence_revision<>v_task\.evidence_revision/);
    assert.match(migration, /v_source\.policy_version<>v_task\.policy_version/);
  }],
  ['meaningful lead ignores passive autosaves', () => {
    assert.match(migration, /recognition_identity_support/);
    assert.match(migration, /v_leader_count>=3/);
    assert.match(migration, /v_leader_count-v_runner_count>=2/);
    assert.match(migration, /v_leader_count\*3>=v_total\*2/);
    assert.doesNotMatch(migration, /recognition_cache_answers_v2[\s\S]{0,200}confirmation_count/i);
  }],
  ['multi-place slots are stable ids rather than array ranks', () => {
    assert.match(migration, /slot_key text not null/);
    assert.match(worker, /mentionId:\s*answer\.slot_key/);
    assert.doesNotMatch(worker, /mentionId:\s*String\(index/);
  }],
  ['known-scope correction preserves sibling answer state', () => {
    assert.match(migration, /feedback_revision=v_revision,answer_revision=answer_revision\+1/);
    assert.match(migration, /where id=v_answer\.id/);
    assert.match(migration, /whole_source_quarantined=ss\.whole_source_quarantined or v_scope='\*'/);
  }],
  ['ambiguous correction uses whole-source scope', () => {
    assert.match(migration, /v_scope:=case when v_answer_count=1 then v_answer\.slot_key else '\*' end/);
  }],
  ['cache save rechecks the whole answer set under a source lock', () => {
    assert.match(migration, /commit_recognition_cache_save_v2[\s\S]*where identity_key=p_identity_key for update/);
    assert.match(migration, /<>v_requested then raise exception 'recognition_cache_stale'/);
    assert.match(cache, /partial_cache_save_rejected/);
  }],
  ['cache hit creates recipient-owned saves and no support vote', () => {
    const commit = migration.slice(migration.indexOf('create or replace function public.commit_recognition_cache_save_v2'), migration.indexOf('create or replace function public.complete_recognition_revalidation_v2'));
    assert.match(commit, /insert into public\.saved_places\(user_id,place_id/);
    assert.match(commit, /perform public\.attach_saved_place_source/);
    assert.doesNotMatch(commit, /insert into public\.recognition_identity_support/);
  }],
  ['cache saves preserve only the normalized admitted category', () => {
    assert.match(migration, /saved_category is null or saved_category in/);
    assert.match(migration, /not sp\.category_user_overridden/);
    assert.match(migration, /v_answer\.saved_category,v_answer\.saved_category_source/);
  }],
  ['only source AI notes cross the reuse boundary', () => {
    assert.match(migration, /source_ai_note/);
    assert.doesNotMatch(worker.slice(worker.indexOf('finalizeRecognitionRevalidationTask'), worker.indexOf('async function finalizeMediaTask')), /\.notes\b|user.?note/i);
  }],
  ['revalidation uses the current non-Premium media lane', () => {
    assert.match(mediaTypes, /recognition_revalidation/);
    assert.match(worker, /task\.task_kind === 'recognition_revalidation'/);
    assert.match(migration, /task_kind='recognition_revalidation'/);
    assert.match(migration, /task_kind in \('recognition','premium_recognition'\)/);
  }],
  ['queue claim uses SKIP LOCKED and supports abandoned claims', () => {
    assert.match(migration, /for update skip locked/);
    assert.match(migration, /rt\.state in \('QUEUED','RETRY_WAIT','PROCESSING'\)/);
    assert.match(migration, /recover_abandoned_recognition_revalidations_v2/);
  }],
  ['notifications occur only after atomic save commit', () => {
    const v2 = worker.slice(worker.indexOf("if (decision.kind === 'v2_answers')"), worker.indexOf("if (decision.kind === 'disputed')"));
    assert.ok(v2.indexOf('commitRecognitionCacheSaveV2') < v2.indexOf('composeShareCompletionNotification'));
  }],
  ['no cache write exists on revalidation technical failure', () => {
    const complete = migration.slice(migration.indexOf('create or replace function public.complete_recognition_revalidation_v2'), migration.indexOf('create or replace function public.admit_recognition_after_media_completion_v2'));
    const technical = complete.slice(complete.indexOf("if p_decision='TECHNICAL_FAILURE'"), complete.indexOf("if p_decision='AGREES_WITH_REPLACEMENT'"));
    assert.doesNotMatch(technical, /state='ELIGIBLE'/);
  }],
  ['Premium and token ledgers are untouched', () => {
    assert.doesNotMatch(migration, /place_find_ledger|premium_request_ledger|wallet/);
    const v2LookupAndCommit = cache.slice(cache.indexOf('export async function lookupRecognition'), cache.indexOf('export async function admitRecognitionAnswersV2'));
    assert.doesNotMatch(v2LookupAndCommit, /settle_place_find|settle_premium|analytics_events|wallet/i);
  }],
];

let failures = 0;
for (const [name, run] of tests) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}
if (failures) process.exitCode = 1;
else console.log(`PASS all ${tests.length} Recognition Cache V2 contract cases`);
