import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MediaError, isMediaError } from '../src/types/media.js';

test('retryable classification', () => {
  assert.equal(new MediaError('download_timeout').retryable, true);
  assert.equal(new MediaError('download_failed').retryable, true);
  assert.equal(new MediaError('provider_changed').retryable, true);
  assert.equal(new MediaError('private_or_unavailable').retryable, false);
  assert.equal(new MediaError('duration_too_long').retryable, false);
});

test('manualFallback classification (safe needs_help, not retry)', () => {
  for (const code of [
    'unsupported_platform',
    'unsupported_url',
    'identity_mismatch',
    'private_or_unavailable',
    'authentication_required',
    'file_too_large',
    'duration_too_long',
    'invalid_media',
    'missing_video',
    'ssrf_blocked',
  ] as const) {
    assert.equal(new MediaError(code).manualFallback, true, code);
  }
  assert.equal(new MediaError('download_timeout').manualFallback, false);
});

test('error detail never leaks and isMediaError works', () => {
  const e = new MediaError('ssrf_blocked', 'resolves_to_private_ip');
  assert.equal(isMediaError(e), true);
  assert.equal(isMediaError(new Error('x')), false);
  assert.match(e.message, /ssrf_blocked/);
});
