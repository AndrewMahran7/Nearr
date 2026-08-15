import assert from 'node:assert/strict';
import test from 'node:test';

import { effectiveClaimLimit } from '../src/db/tasks.js';

test('claiming never leases work that cannot start immediately', () => {
  assert.equal(effectiveClaimLimit({ claimBatchSize: 2, maxConcurrency: 1 }), 1);
  assert.equal(effectiveClaimLimit({ claimBatchSize: 8, maxConcurrency: 4 }), 4);
  assert.equal(effectiveClaimLimit({ claimBatchSize: 2, maxConcurrency: 4 }), 2);
  assert.equal(effectiveClaimLimit({ claimBatchSize: 1, maxConcurrency: 1 }), 1);
});
