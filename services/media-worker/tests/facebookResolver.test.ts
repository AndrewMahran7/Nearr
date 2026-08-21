import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FacebookMediaResolver,
  assertFacebookPostIdentityMatches,
  facebookCanonicalVideoUrlFromHtml,
  facebookSourceIdentityFromInfo,
  isOpaqueFacebookRedirectUrl,
  resolveFacebookAcquisitionUrl,
} from '../src/resolvers/FacebookMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import type { WorkerConfig } from '../src/config/env.js';

function resolver(enabled = true) {
  return new FacebookMediaResolver({ facebookResolverEnabled: enabled } as unknown as WorkerConfig);
}

test('supports(): facebook host family (incl. fb.watch) + flag only', () => {
  const r = resolver(true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://www.facebook.com/reel/123456/') }), true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://www.facebook.com/SomePage/videos/123456/') }), true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://fb.watch/abcDEF/') }), true);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://m.facebook.com/reel/123456/') }), true);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://www.facebook.com/reel/123456/') }), false);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://evil.com/reel/123456/') }), false);
});

test('supports(): flag OFF => never supports', () => {
  const r = resolver(false);
  assert.equal(r.supports({ platform: 'facebook', url: new URL('https://www.facebook.com/reel/123456/') }), false);
});

test('resolve(): rejects non-HTTPS source before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'http://www.facebook.com/reel/123456/', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('resolve(): rejects a non-Facebook host before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'https://evil.com/reel/123456/', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('public extractor identity canonicalizes every numeric Facebook video id', () => {
  const identity = facebookSourceIdentityFromInfo(
    {
      id: '10153231379946729',
      uploader: 'Facebook',
      uploader_id: '100064860875397',
    },
    'https://fb.watch/opaqueToken/',
  );
  assert.deepEqual(identity, {
    canonicalUrl: 'https://www.facebook.com/reel/10153231379946729/',
    sourceId: '10153231379946729',
    creatorName: 'Facebook',
    creatorId: '100064860875397',
  });
});

test('numeric extractor identity mismatch stops before Facebook download', () => {
  assert.doesNotThrow(() => assertFacebookPostIdentityMatches(
    'https://www.facebook.com/watch/?v=11111',
    '11111',
    'https://www.facebook.com/reel/11111/',
  ));
  assert.throws(
    () => assertFacebookPostIdentityMatches(
      'https://www.facebook.com/reel/11111/',
      '22222',
      'https://www.facebook.com/reel/22222/',
    ),
    (e) => isMediaError(e) && e.code === 'identity_mismatch' && !e.retryable,
  );
});

test('non-numeric extractor ids preserve the exact fallback URL', () => {
  const identity = facebookSourceIdentityFromInfo(
    { id: 'pfbid0abcDEF', uploader: 'Example Page' },
    'https://www.facebook.com/example/posts/pfbid0abcDEF/',
  );
  assert.equal(identity.canonicalUrl, 'https://www.facebook.com/example/posts/pfbid0abcDEF/');
  assert.equal(identity.sourceId, 'pfbid0abcDEF');
  assert.equal(identity.creatorName, 'Example Page');
});

test('resolve(): rejects a malformed URL before yt-dlp', async () => {
  const r = resolver(true);
  await assert.rejects(
    () => r.resolve({ jobId: 'j', sourceUrl: 'not a url', workDir: '/tmp/none', signal: new AbortController().signal }),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
});

test('public Facebook canonical URLs bypass opaque-link resolution', async () => {
  for (const url of [
    'https://www.facebook.com/reel/1356645589772949/',
    'https://www.facebook.com/watch/?v=1356645589772949',
    'https://www.facebook.com/61584748774034/videos/1356645589772949/',
  ]) {
    assert.equal(isOpaqueFacebookRedirectUrl(url), false);
    let fetched = false;
    const planned = await resolveFacebookAcquisitionUrl(
      url,
      new AbortController().signal,
      async () => {
        fetched = true;
        throw new Error('should not fetch');
      },
    );
    assert.deepEqual(planned, { url, canonicalized: false });
    assert.equal(fetched, false);
  }
});

test('Facebook Video Plugin canonical link yields a strict numeric public URL', () => {
  const html = `<!doctype html><link data-x="1" rel="alternate canonical" href="https://www.facebook.com/Page/videos/title/1356645589772949/?ref=embed">`;
  assert.equal(
    facebookCanonicalVideoUrlFromHtml(html),
    'https://www.facebook.com/reel/1356645589772949/',
  );
  assert.equal(
    facebookCanonicalVideoUrlFromHtml('<link rel="canonical" href="https://evil.example/videos/1356645589772949/">'),
    null,
  );
  assert.equal(
    facebookCanonicalVideoUrlFromHtml('<link rel="canonical" href="https://www.facebook.com/help/1356645589772949/">'),
    null,
  );
});

test('fb.watch and Facebook share URLs resolve through the bounded public plugin page', async () => {
  for (const input of [
    'https://fb.watch/J8m9M2wynx/',
    'https://www.facebook.com/share/v/abcDEF123/',
  ]) {
    assert.equal(isOpaqueFacebookRedirectUrl(input), true);
    let requestedUrl = '';
    const planned = await resolveFacebookAcquisitionUrl(
      input,
      new AbortController().signal,
      async (opts) => {
        requestedUrl = opts.url;
        return {
          text: '<link rel="canonical" href="https://www.facebook.com/Page/videos/title/1356645589772949/">',
          contentType: 'text/html',
          finalUrl: opts.url,
        };
      },
    );
    assert.deepEqual(planned, {
      url: 'https://www.facebook.com/reel/1356645589772949/',
      canonicalized: true,
    });
    const plugin = new URL(requestedUrl);
    assert.equal(plugin.origin + plugin.pathname, 'https://www.facebook.com/plugins/video.php');
    assert.equal(plugin.searchParams.get('href'), input);
  }
});

test('Facebook login redirect is authentication_required and deterministic', async () => {
  await assert.rejects(
    () => resolveFacebookAcquisitionUrl(
      'https://fb.watch/J8m9M2wynx/',
      new AbortController().signal,
      async () => ({
        text: '<html><title>Facebook</title></html>',
        contentType: 'text/html',
        finalUrl: 'https://www.facebook.com/login/?next=%2Fwatch%2F',
      }),
    ),
    (error) => isMediaError(error) && error.code === 'authentication_required' && !error.retryable,
  );
});

test('Facebook authentication HTML requires form plus identity input', async () => {
  await assert.rejects(
    () => resolveFacebookAcquisitionUrl(
      'https://fb.watch/J8m9M2wynx/',
      new AbortController().signal,
      async (opts) => ({
        text: '<form id="login_form" action="/login/device-based/"><input name="email"><input name="pass"></form>',
        contentType: 'text/html',
        finalUrl: opts.url,
      }),
    ),
    (error) => isMediaError(error) && error.code === 'authentication_required' && !error.retryable,
  );
});

test('Facebook private/unavailable plugin page fails safely without retry', async () => {
  await assert.rejects(
    () => resolveFacebookAcquisitionUrl(
      'https://www.facebook.com/share/v/abcDEF123/',
      new AbortController().signal,
      async (opts) => ({
        text: '<html><main>This content isn\'t available right now.</main></html>',
        contentType: 'text/html',
        finalUrl: opts.url,
      }),
    ),
    (error) => isMediaError(error) && error.code === 'private_or_unavailable' && !error.retryable,
  );
});

test('unknown plugin response preserves direct yt-dlp fallback', async () => {
  const input = 'https://fb.watch/J8m9M2wynx/';
  const planned = await resolveFacebookAcquisitionUrl(
    input,
    new AbortController().signal,
    async (opts) => ({ text: '<html>generic Facebook shell</html>', contentType: 'text/html', finalUrl: opts.url }),
  );
  assert.deepEqual(planned, { url: input, canonicalized: false });
});
