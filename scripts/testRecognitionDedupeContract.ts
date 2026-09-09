import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

import {
  authorizeQualificationMode,
  DEV_QUALIFICATION_PROJECT_REF,
} from '../supabase/functions/create-share-job/qualificationMode';
import {
  recognitionCachePolicyForRun,
  resolveRecognitionCachePolicy,
} from '../supabase/functions/_shared/recognitionCachePolicy';
import { qualificationMediaResolverEnabled } from '../supabase/functions/process-share-jobs/qualificationMediaPolicy';

const dedicatedMetadata = {
  account_class: 'dedicated_dev_test',
  purpose: 'onb2_tutorial_qualification',
};

assert.deepStrictEqual(authorizeQualificationMode({
  requestedMode: undefined,
  projectRef: DEV_QUALIFICATION_PROJECT_REF,
  appMetadata: {},
}), { ok: true, requested: false });
assert.deepStrictEqual(authorizeQualificationMode({
  requestedMode: 'fresh_media',
  projectRef: DEV_QUALIFICATION_PROJECT_REF,
  appMetadata: dedicatedMetadata,
}), { ok: true, requested: true });
assert.deepStrictEqual(authorizeQualificationMode({
  requestedMode: 'fresh_media',
  projectRef: DEV_QUALIFICATION_PROJECT_REF,
  appMetadata: { ...dedicatedMetadata, account_class: 'ordinary_user' },
}), { ok: false, status: 403, error: 'qualification_mode_forbidden' });
assert.deepStrictEqual(authorizeQualificationMode({
  requestedMode: 'fresh_media',
  projectRef: 'production-project-ref',
  appMetadata: dedicatedMetadata,
}), { ok: false, status: 403, error: 'qualification_mode_forbidden' });
assert.deepStrictEqual(authorizeQualificationMode({
  requestedMode: 'anything_else',
  projectRef: DEV_QUALIFICATION_PROJECT_REF,
  appMetadata: dedicatedMetadata,
}), { ok: false, status: 400, error: 'invalid_qualification_mode' });

const enabled = resolveRecognitionCachePolicy(() => 'true');
assert.strictEqual(recognitionCachePolicyForRun(enabled, 'normal'), enabled);
const qualificationPolicy = recognitionCachePolicyForRun(enabled, 'qualification_fresh');
assert.strictEqual(qualificationPolicy.readsEnabled, false);
assert.strictEqual(qualificationPolicy.cacheReadSuspended, true);
assert.strictEqual(qualificationPolicy.source, 'qualification_fresh_override');
for (const platform of ['instagram', 'tiktok', 'youtube', 'facebook', 'snapchat']) {
  assert.strictEqual(
    qualificationMediaResolverEnabled('qualification_fresh', platform),
    true,
    `${platform} is wired for exact fresh qualification`,
  );
}
assert.strictEqual(qualificationMediaResolverEnabled('normal', 'youtube'), false);
assert.strictEqual(qualificationMediaResolverEnabled('qualification_fresh', 'genericWeb'), false);

const migration = fs.readFileSync(path.resolve(
  'supabase/migrations/20260909000001_canonical_development_recognition_baseline.sql',
), 'utf8');
const qualificationFunction = migration.split(
  'create or replace function public.create_dev_qualification_share_job_for_user',
)[1]?.split('revoke all on function')[0] ?? '';
assert.match(migration, /create unique index share_jobs_active_url_uidx[\s\S]*recognition_run_mode\s*=\s*'normal'/);
const normalFunction = migration.split(
  'create or replace function public.create_share_job_for_user',
)[1]?.split('create or replace function public.create_dev_qualification_share_job_for_user')[0] ?? '';
assert.match(normalFunction, /sj\.recognition_run_mode\s*=\s*'normal'/);
assert.match(normalFunction, /sj\.status in \('awaiting_purchase', 'queued', 'processing_metadata'\)/);
assert.doesNotMatch(normalFunction, /sj\.status\s*=\s*'completed'/);
assert.doesNotMatch(normalFunction, /token_monetization_config/);
assert.match(
  migration.replace(/\s+/g, ' '),
  /drop function if exists public\.create_share_job_for_user\( uuid,text,text,text,text,integer,boolean,boolean,boolean \)/,
);
assert.match(qualificationFunction, /sj\.idempotency_key\s*=\s*p_idempotency_key/);
assert.match(qualificationFunction, /'qualification_fresh'/);
assert.doesNotMatch(qualificationFunction, /sj\.canonical_url/);
assert.doesNotMatch(qualificationFunction, /p_dedupe_window_seconds/);
const compactMigration = migration.replace(/\s+/g, ' ');
assert.match(compactMigration, /revoke all on function public\.create_dev_qualification_share_job_for_user[\s\S]*from public, anon, authenticated/);
assert.match(compactMigration, /grant execute on function public\.create_dev_qualification_share_job_for_user[\s\S]*to service_role/);

const createSource = fs.readFileSync(
  path.resolve('supabase/functions/create-share-job/index.ts'),
  'utf8',
);
assert.match(createSource, /qualification\.requested[\s\S]*create_dev_qualification_share_job_for_user/);
assert.doesNotMatch(createSource, /p_enforce_tokens/);
assert.doesNotMatch(createSource, /TOKEN_MONETIZATION_ENABLED/);
assert.match(createSource, /appMetadata:\s*userData\.user\.app_metadata/);
assert.doesNotMatch(createSource, /body\.forceRerun/);

const appClientSource = fs.readFileSync(path.resolve('lib/shareJobClient.ts'), 'utf8');
assert.doesNotMatch(appClientSource, /forceRerun/);
assert.doesNotMatch(appClientSource, /qualificationMode/);

const processSource = fs.readFileSync(
  path.resolve('supabase/functions/process-share-jobs/index.ts'),
  'utf8',
);
assert.ok(
  (processSource.match(/recognitionCachePolicyForRun\(policy, job(?:\?|)\.recognition_run_mode\)/g) ?? []).length >= 2,
  'both queue processing and worker finalization must apply the per-job policy',
);

console.log('PASS normal dedupe, qualification authorization, fresh policy, and Production fail-closed contracts');
