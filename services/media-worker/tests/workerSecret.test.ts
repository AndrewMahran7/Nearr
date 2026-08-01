import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkWorkerSecret, extractBearer } from '../src/auth/workerSecret.js';

test('extractBearer parses the token', () => {
  assert.equal(extractBearer('Bearer abc123'), 'abc123');
  assert.equal(extractBearer('bearer  spaced '), 'spaced');
  assert.equal(extractBearer('Basic abc'), '');
  assert.equal(extractBearer(''), '');
  assert.equal(extractBearer(undefined), '');
  assert.equal(extractBearer(null), '');
});

test('checkWorkerSecret is exact + rejects empties', () => {
  assert.equal(checkWorkerSecret('Bearer s3cret', 's3cret'), true);
  assert.equal(checkWorkerSecret('Bearer wrong', 's3cret'), false);
  assert.equal(checkWorkerSecret('Bearer s3cret', ''), false);
  assert.equal(checkWorkerSecret(undefined, 's3cret'), false);
  assert.equal(checkWorkerSecret('Bearer s3cre', 's3cret'), false); // length mismatch
});
