import { test } from 'node:test';
import assert from 'node:assert/strict';
import { finalizeWithRetry, planTaskFailure } from '../src/pipeline/runMediaTask.js';
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

test('finalizer outage never requeues the full media pipeline', () => {
  const plan = planTaskFailure(
    new MediaError('finalizer_unavailable', 'verifying_place:finalize_http_503'),
    { attempts: 1, max_attempts: 3 },
    cfg,
    () => 0,
  );
  assert.deepEqual(plan, { action: 'finalize', outcome: 'failed' });
});

test('finalizer retry reuses completed analysis and preserves the HTTP status', async () => {
  let attempts = 0;
  const waits: number[] = [];
  await assert.rejects(
    finalizeWithRetry(
      async () => {
        attempts += 1;
        return { ok: false, status: 503 };
      },
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    ),
    (error: unknown) =>
      error instanceof MediaError &&
      error.code === 'finalizer_unavailable' &&
      error.detail === 'verifying_place:finalize_http_503',
  );
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

test('finalizer retry returns after a transient outage recovers', async () => {
  let attempts = 0;
  const response = await finalizeWithRetry(
    async () => {
      attempts += 1;
      return attempts === 1
        ? { ok: false, status: 503, retryAfterSeconds: 2 }
        : { ok: true, status: 200, route: 'multi_candidate_confirmation' };
    },
    async () => undefined,
  );
  assert.equal(attempts, 2);
  assert.equal(response.route, 'multi_candidate_confirmation');
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