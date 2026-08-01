import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ipIsDisallowed,
  hostAllowed,
  assertUrlSafe,
  sanitizeUrlForLog,
} from '../src/security/ssrf.js';
import { MediaError } from '../src/types/media.js';

test('ipIsDisallowed rejects v4 private/loopback/link-local/metadata/cgnat', () => {
  for (const ip of [
    '127.0.0.1',
    '10.0.0.5',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
  ]) {
    assert.equal(ipIsDisallowed(ip), true, `${ip} should be disallowed`);
  }
});

test('ipIsDisallowed allows public v4', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '157.240.1.35']) {
    assert.equal(ipIsDisallowed(ip), false, `${ip} should be allowed`);
  }
});

test('ipIsDisallowed rejects v6 loopback/link-local/unique-local/mapped', () => {
  for (const ip of ['::1', '::', 'fe80::1', 'fc00::1', 'fd00::abcd', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
    assert.equal(ipIsDisallowed(ip), true, `${ip} should be disallowed`);
  }
  assert.equal(ipIsDisallowed('2606:4700:4700::1111'), false);
});

test('hostAllowed does exact + subdomain suffix match only', () => {
  const allow = ['cdninstagram.com', 'fbcdn.net'];
  assert.equal(hostAllowed('cdninstagram.com', allow), true);
  assert.equal(hostAllowed('scontent-lax3-1.cdninstagram.com', allow), true);
  assert.equal(hostAllowed('video.fbcdn.net', allow), true);
  assert.equal(hostAllowed('evil.com', allow), false);
  assert.equal(hostAllowed('notcdninstagram.com', allow), false);
  assert.equal(hostAllowed('cdninstagram.com.evil.com', allow), false);
});

test('assertUrlSafe rejects non-https', async () => {
  await assert.rejects(
    () => assertUrlSafe('http://cdninstagram.com/v', ['cdninstagram.com']),
    (e) => e instanceof MediaError && e.code === 'ssrf_blocked',
  );
});

test('assertUrlSafe rejects embedded credentials', async () => {
  await assert.rejects(
    () => assertUrlSafe('https://u:p@cdninstagram.com/v', ['cdninstagram.com']),
    (e) => e instanceof MediaError && e.code === 'ssrf_blocked',
  );
});

test('assertUrlSafe rejects non-allowlisted host', async () => {
  await assert.rejects(
    () => assertUrlSafe('https://evil.com/v', ['cdninstagram.com']),
    (e) => e instanceof MediaError && e.code === 'ssrf_blocked',
  );
});

test('assertUrlSafe rejects DNS that resolves to a private IP', async () => {
  const mock = async () => [{ address: '10.0.0.1' }];
  await assert.rejects(
    () => assertUrlSafe('https://scontent.cdninstagram.com/v', ['cdninstagram.com'], mock),
    (e) => e instanceof MediaError && e.code === 'ssrf_blocked',
  );
});

test('assertUrlSafe allows a public, allowlisted, resolvable host', async () => {
  const mock = async () => [{ address: '157.240.1.35' }];
  const u = await assertUrlSafe('https://scontent.cdninstagram.com/v', ['cdninstagram.com'], mock);
  assert.equal(u.hostname, 'scontent.cdninstagram.com');
});

test('sanitizeUrlForLog strips query tokens', () => {
  assert.equal(
    sanitizeUrlForLog('https://scontent.cdninstagram.com/v/abc.mp4?efg=SECRET&oh=TOKEN'),
    'https://scontent.cdninstagram.com/v/abc.mp4',
  );
  assert.equal(sanitizeUrlForLog('not a url'), '[unparseable-url]');
});
