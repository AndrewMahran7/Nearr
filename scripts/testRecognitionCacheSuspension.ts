import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  forceFreshRecognitionSubmission,
  recognitionCacheDiagnostics,
  resolveRecognitionCachePolicy,
  reuseSavedPlaceBySourceOnly,
} from '../supabase/functions/_shared/recognitionCachePolicy';
import {
  recognitionCacheDecision,
  type RecognitionCacheRow,
} from '../supabase/functions/process-share-jobs/recognitionCache';
import { selectExistingSavedPlaceForUser } from '../supabase/functions/process-share-link/save';

const root = path.resolve(__dirname, '..');
const read = (relative: string) => readFileSync(path.join(root, relative), 'utf8');
const disabled = resolveRecognitionCachePolicy(() => undefined);
const explicitDisabled = resolveRecognitionCachePolicy((name) =>
  name === 'RECOGNITION_CACHE_READS_ENABLED' ? 'false' : undefined
);
const enabled = resolveRecognitionCachePolicy((name) =>
  name === 'RECOGNITION_CACHE_READS_ENABLED' ? 'true' : undefined
);
const edge = read('supabase/functions/process-share-jobs/index.ts');
const create = read('supabase/functions/create-share-job/index.ts');
const cache = read('supabase/functions/process-share-jobs/recognitionCache.ts');
const save = read('supabase/functions/process-share-link/save.ts');
const worker = read('services/media-worker/src/pipeline/runMediaTask.ts');
const premium = read('services/media-worker/src/premium/premiumRecognition.ts');
const premiumPrompt = read('services/media-worker/src/premium/premiumRecognitionPrompt.ts');
const migration = read('supabase/migrations/20260822000002_vayrin_recognition_cache_and_place_sources.sql');

const row = (trust: RecognitionCacheRow['trust_level']): RecognitionCacheRow => ({
  id: `cache-${trust}`,
  identity_key: 'v1:instagram:fixture',
  platform: 'instagram',
  content_id: 'fixture',
  canonical_url: 'https://www.instagram.com/reel/fixture/',
  identity_version: 1,
  recognition_version: 'vayrin-recognition-2026-08-26.v3-generic-guard-same-place-groups',
  result_type: trust === 'CANDIDATE_SET' ? 'candidate_set' : 'verified_place',
  trust_level: trust,
  canonical_place_id: trust === 'CANDIDATE_SET' ? null : 'place-old',
  candidate_payload: { candidates: [{ googlePlaceId: 'old-google', name: 'Old answer' }] },
  invalidated_at: null,
});

const oldSaved = [{
  id: 'saved-old', source_url: 'https://www.instagram.com/reel/fixture/', source_type: 'instagram',
  ai_note: null, place_id: 'place-old',
  place: {
    id: 'place-old', google_place_id: 'old-google', name: 'Old answer',
    formatted_address: 'Old address', latitude: 20, longitude: -155,
  },
}];
const samePlace = {
  googlePlaceId: 'old-google', name: 'Old answer', formattedAddress: 'Old address',
  latitude: 20, longitude: -155, types: [],
};
const freshDifferentPlace = {
  googlePlaceId: 'fresh-google', name: 'Fresh answer', formattedAddress: 'Fresh address',
  latitude: 60, longitude: 10, types: [],
};

const cases: Array<[string, () => void]> = [
  ['1 new uncached video runs recognition', () => {
    assert.equal(disabled.readsEnabled, false);
    assert.match(edge, /fresh_recognition_enqueued/);
  }],
  ['2 cached video still runs fresh recognition', () => {
    assert.equal(forceFreshRecognitionSubmission(disabled), true);
    assert.match(edge, /if \(!policy\.readsEnabled\)[\s\S]{0,800}return 'continue'/);
  }],
  ['3 VERIFIED_AUTO_SAVE does not short-circuit', () => {
    assert.equal(recognitionCacheDecision(row('VERIFIED_AUTO_SAVE')).kind, 'trusted_place');
    assert.equal(disabled.cacheReadSuspended, true);
  }],
  ['4 CANDIDATE_SET does not short-circuit', () => {
    assert.equal(recognitionCacheDecision(row('CANDIDATE_SET')).kind, 'candidate_set');
    assert.equal(disabled.cacheReadSuspended, true);
  }],
  ['5 USER_CONFIRMED does not short-circuit during suspension', () => {
    assert.equal(recognitionCacheDecision(row('USER_CONFIRMED')).kind, 'trusted_place');
    assert.equal(disabled.cacheReadSuspended, true);
  }],
  ['6 previous Premium result does not short-circuit', () => {
    assert.doesNotMatch(worker, /from\(['"]recognition_cache['"]\)/);
    assert.doesNotMatch(premium, /recognition_cache|candidate_payload|share_jobs/i);
  }],
  ['7 old hypothesis is not sent to a model', () => {
    assert.doesNotMatch(worker, /recognition_cache/);
    assert.doesNotMatch(premiumPrompt, /prior(?:Result|Answer|Hypothesis)|cached(?:Result|Answer|Hypothesis)/i);
  }],
  ['8 old candidate is not sent to a model', () => {
    const aiNoteHistoryStart = worker.indexOf('async function loadRetainedHandoff');
    const recognitionStart = worker.indexOf('export async function runMediaTask');
    assert.ok(aiNoteHistoryStart >= 0 && aiNoteHistoryStart < recognitionStart);
    assert.match(worker.slice(aiNoteHistoryStart, recognitionStart), /task\.task_kind !== 'ai_note_enrichment'/);
    assert.doesNotMatch(worker.slice(recognitionStart), /\.select\(['"]candidate_payload['"]\)/);
    assert.doesNotMatch(premiumPrompt, /candidate_payload|recognition_cache/i);
  }],
  ['9 old Places result is not sent to a model', () => {
    assert.doesNotMatch(premiumPrompt, /googlePlaceId|places result|previous place/i);
  }],
  ['10 free recognition bypasses cache', () => {
    const bypass = edge.indexOf('if (!policy.readsEnabled)');
    const lookup = edge.indexOf('const decision = await lookupRecognition', bypass);
    assert.ok(bypass >= 0 && lookup > bypass);
    assert.match(edge.slice(bypass, lookup), /return 'continue'/);
  }],
  ['11 Premium recognition bypasses cache', () => {
    assert.match(edge, /task\.task_kind === 'premium_recognition'[\s\S]+recognition_cache_miss[\s\S]+reason: 'read_suspended'/);
    assert.doesNotMatch(worker, /lookupRecognition|useRecognitionCache/);
  }],
  ['12 source media reuse remains outside the answer-cache policy', () => {
    assert.doesNotMatch(read('services/media-worker/src/resolvers/MediaResolver.ts'), /recognitionCachePolicy/);
  }],
  ['13 compatible transcript reuse remains outside the answer-cache policy', () => {
    assert.doesNotMatch(read('services/media-worker/src/providers/transcription.ts'), /recognitionCachePolicy/);
  }],
  ['14 compatible frame reuse remains outside the answer-cache policy', () => {
    assert.doesNotMatch(read('services/media-worker/src/pipeline/retainedFrameSnapshot.ts'), /recognitionCachePolicy/);
  }],
  ['15 canonical save deduplication remains', () => {
    assert.equal(reuseSavedPlaceBySourceOnly(disabled), false);
    assert.equal(selectExistingSavedPlaceForUser(oldSaved as any, samePlace as any, oldSaved[0]!.source_url, false)?.id, 'saved-old');
  }],
  ['16 existing saved place still opens normally', () => {
    assert.doesNotMatch(read('services/savedPlacesService.ts'), /recognitionCachePolicy/);
    assert.doesNotMatch(read('app/place/[id].tsx'), /recognitionCachePolicy/);
  }],
  ['17 a source-only old answer cannot create a false duplicate', () => {
    assert.equal(selectExistingSavedPlaceForUser(oldSaved as any, freshDifferentPlace as any, oldSaved[0]!.source_url, false), null);
  }],
  ['18 historical cache rows are not deleted', () => {
    const changedSources = [edge, create, cache, save, read('supabase/functions/_shared/recognitionCachePolicy.ts')].join('\n');
    assert.doesNotMatch(changedSources, /delete\s+from\s+(?:public\.)?(?:recognition_cache|share_jobs|saved_places)/i);
    assert.doesNotMatch(changedSources, /\.from\(['"](?:recognition_cache|share_jobs|saved_places)['"]\)\.delete\(/i);
  }],
  ['19 cache writes still occur', () => {
    assert.equal(disabled.writesEnabled, true);
    assert.match(cache, /\.from\('recognition_cache'\)[\s\S]{0,100}\.upsert\(payload/);
    assert.match(cache, /recognition_version:\s*RECOGNITION_VERSION/);
  }],
  ['20 newly written cache is not read while disabled', () => {
    assert.equal(explicitDisabled.readsEnabled, false);
    assert.match(edge, /if \(!policy\.readsEnabled\)[\s\S]{0,800}return 'continue'/);
  }],
  ['21 diagnostics prove cacheReadUsed=false', () => {
    assert.deepEqual(recognitionCacheDiagnostics(disabled), {
      recognitionCacheRead: false,
      cacheReadUsed: false,
      cacheReadSuspended: true,
      recognitionCacheWritesEnabled: true,
    });
    assert.match(edge, /recognitionVersion:\s*RECOGNITION_VERSION/);
    assert.match(edge, /recognition_cache_miss[\s\S]{0,400}reason: 'read_suspended'/);
    assert.match(migration, /recognition_cache_miss/);
  }],
  ['22 re-enable switch restores normal cache reads', () => {
    assert.equal(enabled.readsEnabled, true);
    assert.equal(forceFreshRecognitionSubmission(enabled), false);
    assert.equal(reuseSavedPlaceBySourceOnly(enabled), true);
  }],
  ['23 no raw cached answer enters a model prompt', () => {
    assert.doesNotMatch([premiumPrompt, read('services/media-worker/src/prompts/placeEvidencePrompt.ts')].join('\n'), /recognition_cache|candidate_payload|cached answer/i);
  }],
  ['24 this suite cannot mutate Production user data', () => {
    const self = read('scripts/testRecognitionCacheSuspension.ts');
    assert.doesNotMatch(self, /createClient\(|fetch\(|\.insert\(|\.update\(|\.delete\(|\.rpc\(/);
  }],
  ['25 recognition prompts and safety remain unchanged by the suspension', () => {
    assert.doesNotMatch(premiumPrompt, /RECOGNITION_CACHE_READS_ENABLED/);
    assert.doesNotMatch(read('services/media-worker/src/premium/premiumRecognitionSafety.ts'), /RECOGNITION_CACHE_READS_ENABLED/);
  }],
  ['26 completed-job reuse is bypassed but request idempotency remains', () => {
    assert.match(create, /p_idempotency_key:\s*idempotencyKey/);
    assert.match(create, /p_force_rerun:[\s\S]{0,160}forceFreshRecognitionSubmission/);
  }],
  ['27 USER_CONFIRMED preservation remains in the cache upsert contract', () => {
    assert.match(migration, /old\.trust_level = 'USER_CONFIRMED'[\s\S]+new\.canonical_place_id := old\.canonical_place_id/);
  }],
];

let failures = 0;
for (const [name, test] of cases) {
  try {
    test();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}
if (failures > 0) process.exitCode = 1;
else console.log(`PASS all ${cases.length} recognition-cache suspension cases`);
