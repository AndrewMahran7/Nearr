import test from 'node:test';
import assert from 'node:assert/strict';
import { boundedProviderCost } from './boundedCost.mjs';

test('fixed-request bounds keep unknown billing explicit and include every completed charge', () => {
  const observation = { cost_usd: null, entries: [{ status: 'complete', cost_usd: .01 },
    { status: 'unknown', operation: 'google_text_search', request_sha256: 'request', reservation_usd: .032,
      dispatch_attempted: true, cost_usd: null }] };
  const before = structuredClone(observation), carry = [{ request_sha256: 'request', reserved_upper_usd: .032 }];
  assert.deepEqual(boundedProviderCost(observation, carry), { lower_usd: .01, upper_usd: .042, unknown_requests: 1 });
  assert.deepEqual(observation, before);
  assert.throws(() => boundedProviderCost(observation, []), /no_valid_fixed_request_bound/);
  observation.entries[1].operation = 'openai_responses';
  assert.throws(() => boundedProviderCost(observation, carry), /no_valid_fixed_request_bound/);
});

test('completed accounting must agree and unknown billing cannot silently become zero', () => {
  assert.deepEqual(boundedProviderCost({ cost_usd: .04, entries: [{ status: 'complete', cost_usd: .04 }] }, []),
    { lower_usd: .04, upper_usd: .04, unknown_requests: 0 });
  assert.throws(() => boundedProviderCost({ cost_usd: 0, entries: [{ status: 'complete', cost_usd: .04 }] }, []), /mismatch/);
  assert.throws(() => boundedProviderCost({ cost_usd: null, entries: [] }, []), /mismatch/);
});
