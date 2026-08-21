import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import {
  SHARE_MEDIA_MAX_DURATION_SECONDS,
  type ShareFailureCategory,
} from '../lib/shareFailurePresentation';
import { routeShareJobNotification } from '../lib/shareJobRouting';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';

const cases: Array<{
  category: ShareFailureCategory;
  code: string;
  provider: string | null;
  attempted: boolean;
  status: 'needs_help' | 'failed';
}> = [
  { category: 'media_access_required', code: 'authentication_required', provider: 'tiktok', attempted: false, status: 'needs_help' },
  { category: 'media_too_long', code: 'duration_too_long', provider: 'facebook', attempted: false, status: 'needs_help' },
  { category: 'analysis_insufficient', code: 'insufficient_evidence', provider: 'facebook', attempted: true, status: 'needs_help' },
  { category: 'technical_failure', code: 'download_timeout', provider: 'facebook', attempted: false, status: 'failed' },
];

for (const item of cases) {
  const notification = composeShareCompletionNotification({
    jobId: `job-${item.category}`,
    status: item.status,
    failureCategory: item.category,
    failureCode: item.code,
    provider: item.provider,
    analysisAttempted: item.attempted,
    reviewMode: 'manual',
  });
  const detail = buildShareJobDetailState({
    id: `job-${item.category}`,
    status: item.status,
    decision: item.status === 'failed' ? 'failed' : 'manual_fallback',
    candidate_payload: { candidates: [] },
    failure_category: item.category,
    failure_code: item.code,
    analysis_attempted: item.attempted,
    source_platform: item.provider,
  });

  assert.equal(notification.resultClass, item.category);
  assert.equal(detail.failureCategory, item.category);
  assert.deepEqual(detail.copy, { title: notification.title, body: notification.body });
  assert.equal(notification.data.failureCategory, item.category);
  assert.equal(notification.data.failureCode, item.code);
  assert.equal(notification.data.analysisAttempted, item.attempted);
  assert.deepEqual(routeShareJobNotification(notification.data), {
    kind: 'queue_item',
    jobId: `job-${item.category}`,
  });
  assert.equal(detail.canRetry, item.category === 'technical_failure');
  assert.equal(detail.canSearchManually, item.category !== 'technical_failure');
}

const workerEnv = fs.readFileSync(path.join(process.cwd(), 'services/media-worker/src/config/env.ts'), 'utf8');
const workerDefault = workerEnv.match(/maxDurationSeconds:\s*int\('MEDIA_MAX_DURATION_SECONDS',\s*(\d+),\s*1\)/);
assert.ok(workerDefault, 'worker duration default remains discoverable');
assert.equal(Number(workerDefault[1]), SHARE_MEDIA_MAX_DURATION_SECONDS, 'display duration cannot drift from worker default');

const workerPipeline = fs.readFileSync(path.join(process.cwd(), 'services/media-worker/src/pipeline/runMediaTask.ts'), 'utf8');
const finalizer = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
const runDiagnostics = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/process-share-jobs/mediaRunDiagnostics.ts'), 'utf8');
const detailScreen = fs.readFileSync(path.join(process.cwd(), 'app/share-jobs/[jobId].tsx'), 'utf8');
assert.match(workerPipeline, /failureCode:\s*code/);
assert.match(workerPipeline, /analysisAttempted/);
assert.match(finalizer, /failure_category:\s*failureCategory/);
assert.match(finalizer, /failure_code:\s*failureCode/);
assert.match(runDiagnostics, /out\.analysisAttempted = d\.analysisAttempted/);
assert.match(detailScreen, /detail\.canSearchManually \? renderManualSearch\(\) : null/);

const composer = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/process-share-jobs/shareCompletionNotification.ts'), 'utf8');
const routing = fs.readFileSync(path.join(process.cwd(), 'lib/shareJobRouting.ts'), 'utf8');
assert.doesNotMatch(routing, /\.title|\.body/, 'notification routing never inspects copy');
assert.match(composer, /failureCategory/);

console.log('PASS shared notification/detail failure presentation, structured routing, actions, and duration drift guard');
