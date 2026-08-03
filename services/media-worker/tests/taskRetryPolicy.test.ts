import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planTaskFailure } from '../src/pipeline/runMediaTask.js';
import { MediaError } from '../src/types/media.js';

const cfg = { retryBaseSeconds: 30, retryMaxSeconds: 900 };

test('transient provider failure requeues with bounded Retry-After', () => {
  const plan = planTaskFailure(
    new MediaError('provider_rate_limited', 'http_429', 120),
    { attempts: 1, max_attempts: 3 },
    cfg,
    () => 0,
  );
  assert.deepEqual(plan, { action: 'requeue', delaySeconds: 120 });
});

test('transient failure exhausts into a safe failed finalization', () => {
  const plan = planTaskFailure(
    new MediaError('provider_unavailable', 'http_503'),
    { attempts: 3, max_attempts: 3 },
    cfg,
    () => 0,
  );
  assert.deepEqual(plan, { action: 'finalize', outcome: 'failed' });
});

for (const code of [
  'authentication_required',
  'private_or_unavailable',
  'invalid_media',
  'file_too_large',
  'duration_too_long',
  'cancelled',
] as const) {
  test(`${code} does not retry`, () => {
    const plan = planTaskFailure(
      new MediaError(code),
      { attempts: 1, max_attempts: 3 },
      cfg,
      () => 0,
    );
    assert.deepEqual(plan, { action: 'finalize', outcome: 'unavailable' });
  });
}