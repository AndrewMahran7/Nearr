import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const createJob = read('supabase/functions/create-share-job/index.ts');
const tutorial = read('supabase/functions/get-onboarding-tutorial/index.ts');
const migration = read('supabase/migrations/20260910000008_onboarding_qa_non_monetized_runtime.sql');
const settings = read('app/(tabs)/settings.tsx');
const queue = read('app/share-jobs/index.tsx');
const detail = read('app/share-jobs/[jobId].tsx');
const layout = read('app/_layout.tsx');
const map = read('app/(tabs)/map.tsx');
const mapSheet = read('components/map/MapBottomSheet.tsx');
const premiumPolicy = read('lib/premiumRequests.ts');
const deployFunctions = read('scripts/deployFunctions.mjs');

assert.match(createJob, /activeProjectRef !== DEVELOPMENT_PROJECT_REF/);
assert.match(createJob, /'create_onboarding_qa_share_job_for_user'/);
assert.doesNotMatch(createJob, /['"]create_share_job_for_user['"]/);
assert.doesNotMatch(createJob, /p_enforce_tokens|p_is_anonymous|p_force_rerun/);
assert.match(createJob, /onboarding_qa_contract_violation/);
assert.match(createJob, /requiresPurchase: !!row\.requires_purchase/);
console.log('PASS ordinary share creation is server-guarded to the dedicated non-monetized Dev RPC');

const rpcBody = migration.slice(
  migration.indexOf('create or replace function public.create_onboarding_qa_share_job_for_user'),
  migration.indexOf('create or replace function public.record_onboarding_qa_submission_path'),
);
assert.match(rpcBody, /billing_mode, billing_outcome/);
assert.match(rpcBody, /'normal_free'/);
assert.match(rpcBody, /'unmetered:onboarding_qa'/);
assert.match(rpcBody, /return query select v_job\.id, v_job\.status, false, false, 0/);
assert.doesNotMatch(rpcBody, /place_find_|revenuecat|entitlement|subscription|wallet|reservation|token_/i);
assert.match(migration, /grant execute on function public\.create_onboarding_qa_share_job_for_user[\s\S]*to service_role/);
assert.doesNotMatch(migration, /grant execute on function public\.create_onboarding_qa_share_job_for_user[\s\S]*to (anon|authenticated)/);
console.log('PASS QA jobs are normal_free and cannot read or mutate monetization state');

assert.match(tutorial, /\.eq\('user_id', userData\.user\.id\)/);
assert.match(tutorial, /\.eq\('saved_place_id', session\.tutorial_saved_place_id\)/);
assert.match(tutorial, /\.eq\('resolution_source', 'tutorial_fixture'\)/);
assert.match(tutorial, /\.in\('tutorial_use', \['practice', 'both'\]\)/);
assert.match(tutorial, /\.neq\('place_id', demoFixture\.place_id\)/);
assert.match(tutorial, /resolve_onboarding_tutorial_fixture/);
assert.doesNotMatch(tutorial, /(?:from|rpc)\(['"][^'"]*(?:entitlement|wallet|purchase|revenuecat|token_)/i);
assert.match(migration, /v1:instagram:DUWyZkfgbT4/);
assert.match(migration, /https:\/\/www\.instagram\.com\/reel\/DUWyZkfgbT4\//);
console.log('PASS practice is unlocked by same-owner fixture proof and selects a distinct curated place');

assert.equal(existsSync(join(process.cwd(), 'app/monetization.tsx')), false);
assert.match(premiumPolicy, /return false/);
for (const [name, source] of [
  ['Settings', settings],
  ['Queue', queue],
  ['job detail', detail],
  ['root layout', layout],
] as const) {
  assert.doesNotMatch(source, /\/monetization|PlaceFindBalance|TokenSymbol|Premium Request|token pack|paywall|wallet/i, `${name} must not expose monetization UI`);
}
console.log('PASS onboarding QA has no wallet, token store, paywall, Pro, or Premium UI entry point');

assert.match(map, /<ShareQueueButton \/>/);
assert.match(map, /<NearbyMapExplorerCarousel/);
assert.match(mapSheet, /const hasPlaces = savedPlaces\.length > 0/);
assert.match(mapSheet, /Start building your map/);
assert.match(mapSheet, /savedPlaces\.length === 1 \? 'place' : 'places'/);
assert.match(mapSheet, /primaryRows: savedPlaces\.map/);
console.log('PASS map keeps Queue and carousel navigation while zero, one, and many-save states remain explicit');

for (const functionName of ['create-share-job', 'get-onboarding-tutorial', 'reset-onboarding-qa']) {
  assert.match(deployFunctions, new RegExp(`DEVELOPMENT_ONLY_FUNCTIONS[\\s\\S]*'${functionName}'`));
}
console.log('PASS every onboarding-only Edge surface is excluded from Production deploys');

assert.match(read('lib/shareJobClient.ts'), /submissionPath\?: 'share_extension' \| 'host_app' \| 'background_import'/);
assert.match(read('lib/hostShareSubmit.ts'), /submissionPath: 'host_app'/);
assert.match(createJob, /record_onboarding_qa_submission_path/);
assert.match(migration, /share_jobs_onboarding_qa_submission_path_check/);
console.log('PASS idempotency, source provenance, and host/share-extension-compatible submission stay intact');

console.log('\nAll clean onboarding baseline isolation contracts passed.');
