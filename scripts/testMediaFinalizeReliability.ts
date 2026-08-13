import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  classifyFinalizeException,
  classifyProviderFailure,
  formatFinalizeReliabilityLog,
  planProviderUnavailable,
} from '../supabase/functions/process-share-jobs/mediaFinalizeReliability';

function check(name: string, fn: () => void) {
  fn();
  console.log(`PASS ${name}`);
}

check('HTTP 503 provider failure is classified', () => {
  assert.equal(
    classifyProviderFailure([{ providerError: 'http_error', providerStatus: '503' }]),
    'upstream_503',
  );
});

check('provider transport failure is classified as timeout', () => {
  assert.equal(classifyProviderFailure([{ providerError: 'http_error' }]), 'upstream_timeout');
});

check('retry scheduling failure is classified as database unavailable', () => {
  assert.equal(
    classifyFinalizeException(new Error('media_retry_schedule_failed: connection closed')),
    'database_unavailable',
  );
});

check('deterministic exception is not mislabeled transient', () => {
  assert.equal(
    classifyFinalizeException(new Error('invalid candidate payload')),
    'permanent_processing_error',
  );
});

check('first transient failure is durably accepted, not returned as 503', () => {
  assert.deepEqual(planProviderUnavailable({
    attempts: 1,
    maxAttempts: 3,
    failures: [{ providerError: 'http_error', providerStatus: '503' }],
    random: () => 0,
  }), {
    action: 'requeue',
    delaySeconds: 30,
    errorClass: 'upstream_503',
    responseStatus: 202,
  });
});

check('durable retries use exponential backoff', () => {
  const plan = planProviderUnavailable({
    attempts: 2,
    maxAttempts: 3,
    failures: [{ providerError: 'api_error' }],
    random: () => 0,
  });
  assert.equal(plan.action, 'requeue');
  if (plan.action === 'requeue') assert.equal(plan.delaySeconds, 60);
});

check('Retry-After is respected and bounded', () => {
  const plan = planProviderUnavailable({
    attempts: 1,
    maxAttempts: 3,
    failures: [{ providerError: 'http_error', providerStatus: '429', providerRetryAfterSeconds: 1200 }],
    random: () => 1,
  });
  assert.equal(plan.action, 'requeue');
  if (plan.action === 'requeue') assert.equal(plan.delaySeconds, 900);
});

check('retry exhaustion becomes a successful terminal response', () => {
  assert.deepEqual(planProviderUnavailable({
    attempts: 3,
    maxAttempts: 3,
    failures: [{ providerError: 'http_error', providerStatus: '503' }],
  }), {
    action: 'exhaust',
    errorClass: 'upstream_503',
    responseStatus: 200,
  });
});

check('structured log contains correlation fields and no payload', () => {
  const parsed = JSON.parse(formatFinalizeReliabilityLog({
    invocationId: 'inv-1',
    jobId: 'job-1',
    taskId: 'task-1',
    operation: 'finalize_media_task',
    attempt: 2,
    claimState: 'processing',
    elapsedMs: 123,
    finalStatus: 'retry_scheduled',
    errorClass: 'upstream_503',
  }));
  assert.equal(parsed.marker, 'phase2_reliability');
  assert.equal(parsed.invocationId, 'inv-1');
  assert.equal(parsed.jobId, 'job-1');
  assert.equal(parsed.taskId, 'task-1');
  assert.equal(parsed.attempt, 2);
  assert.equal(parsed.elapsedMs, 123);
  assert.equal('evidence' in parsed, false);
  assert.equal('transcript' in parsed, false);
});

check('Edge callback schedules durable retry and never explicitly returns 503', () => {
  const source = readFileSync(join(
    process.cwd(),
    'supabase/functions/process-share-jobs/index.ts',
  ), 'utf8');
  assert.match(source, /admin\.rpc\('requeue_media_task'/);
  assert.match(source, /route: 'retry_scheduled'/);
  assert.doesNotMatch(source, /places_provider_unavailable'[\s\S]{0,200}\b503\b/);
});

check('concurrent or duplicate callback conflict is an idempotent success', () => {
  const source = readFileSync(join(
    process.cwd(),
    'supabase/functions/process-share-jobs/index.ts',
  ), 'utf8');
  assert.match(source, /if \(!requeued\)[\s\S]*idempotent: true/);
  assert.match(source, /pre\.action === 'idempotent_task_terminal'/);
});

check('retry exhaustion is terminal and does not schedule another attempt', () => {
  const exhausted = planProviderUnavailable({
    attempts: 99,
    maxAttempts: 3,
    failures: [{ providerError: 'api_error', providerStatus: '403' }],
  });
  assert.equal(exhausted.action, 'exhaust');
  assert.equal(exhausted.responseStatus, 200);
});

check('deterministic provider 4xx is not retried', () => {
  assert.deepEqual(planProviderUnavailable({
    attempts: 1,
    maxAttempts: 3,
    failures: [{ providerError: 'http_error', providerStatus: '403' }],
  }), {
    action: 'exhaust',
    errorClass: 'permanent_processing_error',
    responseStatus: 200,
  });
});

console.log('\nALL MEDIA FINALIZE RELIABILITY TESTS PASSED');
