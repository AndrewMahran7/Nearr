// services/media-worker/tests/envAndRetrieval.test.ts
//
// Deterministic tests for the self-contained media:inspect workflow:
//   - .env auto-load + precedence (no network, injected reader/env)
//   - retrieval error classification + fallback policy
//   - the provider-neutral HTTP fallback resolver (mocked fetch/download)
//   - sanitization guarantees (no secret VALUES in readiness output)
// No network, no real keys, no real video.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseEnvContent,
  loadEnvFiles,
  envFilePrecedence,
} from '../src/config/loadEnvFiles.js';
import {
  classifyRetrievalError,
  shouldTryFallback,
} from '../src/resolvers/retrievalPolicy.js';
import {
  HttpMediaFetchResolver,
  isHttpFetchProviderConfigured,
  buildFetchProviderRequestUrl,
  pickMediaUrlFromJson,
} from '../src/resolvers/HttpMediaFetchResolver.js';
import { buildProviderChecklist, buildReadinessLines } from '../src/cli/inspectSupport.js';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import { isMediaError } from '../src/types/media.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function cfg(over: Partial<WorkerConfig>): WorkerConfig {
  return { ...loadConfig(), ...over } as WorkerConfig;
}

// ---- .env parsing ---------------------------------------------------------
test('parseEnvContent: export, comments, quotes, inline comments', () => {
  const parsed = parseEnvContent(
    [
      '# a comment',
      'export FOO=bar',
      'QUOTED="hello world"',
      "SINGLE='keep # hash'",
      'INLINE=value # trailing comment',
      'EMPTY=',
      'not a var line',
    ].join('\n'),
  );
  assert.equal(parsed.FOO, 'bar');
  assert.equal(parsed.QUOTED, 'hello world');
  assert.equal(parsed.SINGLE, 'keep # hash');
  assert.equal(parsed.INLINE, 'value');
  assert.equal(parsed.EMPTY, '');
  assert.ok(!('not a var line' in parsed));
});

// ---- precedence -----------------------------------------------------------
test('loadEnvFiles: worker/.env.local wins over root/.env', () => {
  const files = envFilePrecedence('/w', '/root');
  const read = (p: string): string | null => {
    if (p === files[0]) return 'K=from_worker_local'; // highest precedence
    if (p === files[3]) return 'K=from_root_env\nONLY_ROOT=r'; // lowest
    return null;
  };
  const env: Record<string, string | undefined> = {};
  const { checked } = loadEnvFiles({ workerDir: '/w', repoRoot: '/root', env, read });
  assert.equal(env.K, 'from_worker_local');
  assert.equal(env.ONLY_ROOT, 'r');
  assert.equal(checked.length, 4);
  assert.equal(checked[0]!.exists, true);
  assert.equal(checked[1]!.exists, false);
});

test('loadEnvFiles: existing process.env is never overwritten', () => {
  const files = envFilePrecedence('/w', '/root');
  const read = (p: string): string | null => (p === files[3] ? 'K=from_file' : null);
  const env: Record<string, string | undefined> = { K: 'from_process' };
  loadEnvFiles({ workerDir: '/w', repoRoot: '/root', env, read });
  assert.equal(env.K, 'from_process');
});

test('loadEnvFiles: reports missing files (paths only) and loaded key counts', () => {
  const read = (): string | null => null; // no files exist
  const env: Record<string, string | undefined> = {};
  const { checked } = loadEnvFiles({ workerDir: '/w', repoRoot: '/root', env, read });
  assert.equal(checked.every((c) => c.exists === false && c.loadedKeys === 0), true);
  // Never leaks a value — only paths + counts.
  for (const c of checked) assert.deepEqual(Object.keys(c).sort(), ['exists', 'loadedKeys', 'path']);
});

// ---- retrieval classification --------------------------------------------
test('classifyRetrievalError: precise mapping', () => {
  assert.equal(classifyRetrievalError('authentication_required'), 'private_or_login_required');
  assert.equal(classifyRetrievalError('private_or_unavailable'), 'post_unavailable');
  assert.equal(
    classifyRetrievalError('private_or_unavailable', 'not_public'),
    'private_or_login_required',
  );
  assert.equal(classifyRetrievalError('unsupported_platform'), 'unsupported_url');
  assert.equal(classifyRetrievalError('file_too_large'), 'media_too_large');
  assert.equal(classifyRetrievalError('duration_too_long'), 'media_too_long');
  assert.equal(classifyRetrievalError('missing_video'), 'invalid_media');
  assert.equal(classifyRetrievalError('no_provider_configured'), 'retrieval_provider_not_configured');
  assert.equal(classifyRetrievalError('download_failed', 'rate_limited'), 'rate_limited');
  assert.equal(classifyRetrievalError('download_failed'), 'transient_retrieval_failure');
  assert.equal(classifyRetrievalError('something_new'), 'transient_retrieval_failure');
});

test('shouldTryFallback: only for public-but-blocked / transient cases', () => {
  assert.equal(shouldTryFallback('private_or_login_required'), true);
  assert.equal(shouldTryFallback('post_unavailable'), true);
  assert.equal(shouldTryFallback('rate_limited'), true);
  assert.equal(shouldTryFallback('transient_retrieval_failure'), true);
  assert.equal(shouldTryFallback('unsupported_url'), false);
  assert.equal(shouldTryFallback('media_too_large'), false);
  assert.equal(shouldTryFallback('media_too_long'), false);
  assert.equal(shouldTryFallback('retrieved_publicly'), false);
});

// ---- HTTP fallback resolver (pure helpers) --------------------------------
test('isHttpFetchProviderConfigured: only when an https endpoint is set', () => {
  assert.equal(isHttpFetchProviderConfigured(cfg({ mediaFetchProviderUrl: '' })), false);
  assert.equal(isHttpFetchProviderConfigured(cfg({ mediaFetchProviderUrl: 'http://x' })), false);
  assert.equal(
    isHttpFetchProviderConfigured(cfg({ mediaFetchProviderUrl: 'https://api.example.com/get' })),
    true,
  );
});

test('buildFetchProviderRequestUrl: appends + encodes the source url (incl. query)', () => {
  const c = cfg({ mediaFetchProviderUrl: 'https://api.example.com/get', mediaFetchProviderUrlParam: 'url' });
  const out = buildFetchProviderRequestUrl(c, 'https://www.instagram.com/reel/ABC/?igsh=XYZ');
  const u = new URL(out);
  assert.equal(u.searchParams.get('url'), 'https://www.instagram.com/reel/ABC/?igsh=XYZ');
});

test('pickMediaUrlFromJson: dot path, https-only', () => {
  assert.equal(pickMediaUrlFromJson({ url: 'https://cdn/v.mp4' }, 'url'), 'https://cdn/v.mp4');
  assert.equal(pickMediaUrlFromJson({ data: { url: 'https://cdn/v.mp4' } }, 'data.url'), 'https://cdn/v.mp4');
  assert.equal(pickMediaUrlFromJson({ data: { url: 'http://cdn/v.mp4' } }, 'data.url'), null);
  assert.equal(pickMediaUrlFromJson({ data: {} }, 'data.url'), null);
});

// ---- HTTP fallback resolver (mocked I/O) ----------------------------------
function resolveInput(over: Partial<Parameters<HttpMediaFetchResolver['resolve']>[0]> = {}) {
  return {
    jobId: 'job1',
    sourceUrl: 'https://www.instagram.com/reel/ABC/?igsh=XYZ',
    canonicalUrl: 'https://www.instagram.com/reel/ABC/',
    workDir: '/tmp/job1',
    signal: new AbortController().signal,
    ...over,
  };
}

test('HttpMediaFetchResolver.supports: instagram host + configured only', () => {
  const c = cfg({ mediaFetchProviderUrl: 'https://api.example.com/get' });
  const r = new HttpMediaFetchResolver(c);
  assert.equal(r.supports({ platform: 'instagram', url: new URL('https://www.instagram.com/reel/A/') }), true);
  assert.equal(r.supports({ platform: 'tiktok', url: new URL('https://www.tiktok.com/x') }), false);
  const off = new HttpMediaFetchResolver(cfg({ mediaFetchProviderUrl: '' }));
  assert.equal(off.supports({ platform: 'instagram', url: new URL('https://www.instagram.com/reel/A/') }), false);
});

test('HttpMediaFetchResolver.resolve: success via mocked provider + download', async () => {
  const c = cfg({
    mediaFetchProviderUrl: 'https://api.example.com/get',
    mediaFetchProviderApiKey: 'super-secret-key',
    mediaFetchProviderResultPath: 'data.url',
  });
  const fetchImpl = (async () =>
    new Response(JSON.stringify({ data: { url: 'https://cdn.example.com/v.mp4' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as unknown as typeof fetch;
  const download = (async () => ({
    bytes: 12345,
    contentType: 'video/mp4',
    finalUrl: 'https://cdn.example.com/v.mp4',
  })) as unknown as typeof import('../src/security/ssrf.js').safeDownloadToFile;

  const r = new HttpMediaFetchResolver(c, { fetchImpl, download });
  const media = await r.resolve(resolveInput());
  assert.equal(media.source, 'instagram/http-fetch-provider');
  assert.equal(media.sizeBytes, 12345);
  assert.equal(media.mimeType, 'video/mp4');
  assert.ok(media.localFilePath.endsWith('source.mp4'));
});

test('HttpMediaFetchResolver.resolve: 429 => rate_limited MediaError', async () => {
  const c = cfg({ mediaFetchProviderUrl: 'https://api.example.com/get' });
  const fetchImpl = (async () => new Response('', { status: 429 })) as unknown as typeof fetch;
  const r = new HttpMediaFetchResolver(c, { fetchImpl });
  await assert.rejects(
    () => r.resolve(resolveInput()),
    (err: unknown) => isMediaError(err) && err.code === 'download_failed' && err.detail === 'rate_limited',
  );
});

test('HttpMediaFetchResolver.resolve: 401 => provider_changed MediaError', async () => {
  const c = cfg({ mediaFetchProviderUrl: 'https://api.example.com/get' });
  const fetchImpl = (async () => new Response('', { status: 401 })) as unknown as typeof fetch;
  const r = new HttpMediaFetchResolver(c, { fetchImpl });
  await assert.rejects(
    () => r.resolve(resolveInput()),
    (err: unknown) => isMediaError(err) && err.code === 'provider_changed',
  );
});

// ---- sanitization guarantees ---------------------------------------------
test('readiness lines never contain secret VALUES', () => {
  const checklist = buildProviderChecklist(
    cfg({ analysisProvider: 'gemini', transcriptionProvider: 'noop' }),
    (name) => name === 'GEMINI_API_KEY' || name === 'GOOGLE_PLACES_KEY',
  );
  const lines = buildReadinessLines(checklist, { name: 'yt-dlp', ready: true }).join('\n');
  // Provider names + states only — no key-shaped tokens.
  assert.ok(!/sk-[A-Za-z0-9]/.test(lines));
  assert.ok(!/AIza[A-Za-z0-9]/.test(lines)); // Google API key prefix
  assert.match(lines, /visual analysis: gemini \/ ready/);
  assert.match(lines, /places verification: ready/);
});

// ---- root command wiring --------------------------------------------------
test('root package.json delegates media:inspect to the worker package', () => {
  const rootPkgPath = path.resolve(here, '../../../package.json');
  const pkg = JSON.parse(readFileSync(rootPkgPath, 'utf8')) as { scripts?: Record<string, string> };
  const script = pkg.scripts?.['media:inspect'] ?? '';
  assert.match(script, /services\/media-worker/);
});
