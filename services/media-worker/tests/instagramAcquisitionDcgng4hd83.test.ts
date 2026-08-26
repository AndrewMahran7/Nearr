import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import {
  classifyScrapeCreatorsTerminalResponse,
  requestScrapeCreatorsJson,
} from '../src/providers/ScrapeCreatorsClient.js';
import {
  parseScrapeCreatorsInstagramPost,
  ScrapeCreatorsInstagramProvider,
} from '../src/providers/ScrapeCreatorsInstagramProvider.js';
import { planTaskFailure } from '../src/pipeline/runMediaTask.js';
import { InstagramFallbackMediaResolver } from '../src/resolvers/InstagramFallbackMediaResolver.js';
import { instagramContentIdentity } from '../src/resolvers/instagramUrl.js';
import { isMediaError, MediaError, type MediaProbe, type ResolvedMedia } from '../src/types/media.js';
import type { MediaResolver, ResolveInput } from '../src/resolvers/MediaResolver.js';

const SHORTCODE = 'DcGgNG4hd83';
const CANONICAL = `https://www.instagram.com/reel/${SHORTCODE}/`;
const DIRECT = 'https://scontent.example.cdninstagram.com/o1/incident.mp4';
const SECRET = 'incident-test-secret';

function cfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    ...loadConfig(),
    instagramResolverEnabled: true,
    scrapeCreatorsInstagramFallbackEnabled: true,
    scrapeCreatorsApiKey: SECRET,
    maxDurationSeconds: 180,
    maxDownloadBytes: 10 * 1024 * 1024,
    downloadTimeoutMs: 100,
    redirectLimit: 3,
    ...over,
  };
}

function providerBody(shortcode = SHORTCODE, media: Record<string, unknown> = {}): unknown {
  return {
    success: true,
    credits_charged: 1,
    data: {
      xdt_shortcode_media: {
        __typename: 'XDTGraphVideo',
        id: '3900000000000000001',
        shortcode,
        is_video: true,
        video_url: DIRECT,
        video_duration: 12,
        owner: { id: '1', username: 'fixture.creator', full_name: 'Fixture Creator' },
        edge_media_to_caption: { edges: [] },
        ...media,
      },
    },
  };
}

const probe: MediaProbe = {
  hasVideo: true,
  hasAudio: true,
  durationSeconds: 12,
  container: 'mov,mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 720,
  height: 1280,
  frameRate: 30,
  rotation: null,
};

const input: ResolveInput & { canonicalUrl: string } = {
  jobId: 'incident-job',
  sourceUrl: `${CANONICAL}?igsi=shared&utm_source=tracking`,
  canonicalUrl: CANONICAL,
  workDir: '.',
  signal: new AbortController().signal,
};

function media(source = 'instagram/yt-dlp'): ResolvedMedia {
  return {
    canonicalUrl: CANONICAL,
    localFilePath: 'fixture.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 2048,
    source,
    warnings: [],
  };
}

function primary(result: ResolvedMedia | MediaError, calls: { value: number }): MediaResolver {
  return {
    name: 'instagram/yt-dlp',
    supports: () => true,
    resolve: async () => {
      calls.value += 1;
      if (result instanceof MediaError) throw result;
      return result;
    },
  };
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nearr-dcgng4hd83-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('1. canonical and shared URLs preserve exact DcGgNG4hd83 identity', () => {
  for (const url of [
    CANONICAL,
    `${CANONICAL}?igsi=abc&utm_source=share#fragment`,
    `https://www.instagram.com/creator.name/reels/${SHORTCODE}/?igsh=abc`,
    `https://www.instagram.com/p/${SHORTCODE}/?utm_campaign=x`,
    `https://www.instagram.com/tv/${SHORTCODE}/`,
  ]) {
    const identity = instagramContentIdentity(url);
    assert.equal(identity?.shortcode, SHORTCODE);
    assert.equal(identity?.canonicalUrl.includes(SHORTCODE), true);
  }
});

test('2. current provider request contract sends the canonical full URL', async () => {
  await withTemp(async (dir) => {
    let observedUrlString = '';
    let observedInit: RequestInit | undefined;
    const provider = new ScrapeCreatorsInstagramProvider(cfg(), {
      fetch: (async (url, init) => {
        observedUrlString = String(url);
        observedInit = init;
        return Response.json(providerBody());
      }) as typeof fetch,
      download: (async ({ destPath }: { destPath: string }) => {
        await writeFile(destPath, Buffer.alloc(2048, 1));
        return { bytes: 2048, contentType: 'video/mp4', finalUrl: DIRECT };
      }) as never,
      inspect: (async () => probe) as never,
    });
    await provider.resolve({ ...input, workDir: dir, expectedShortcode: SHORTCODE });
    const observedUrl = new URL(observedUrlString);
    assert.equal(observedUrl.origin + observedUrl.pathname, 'https://api.scrapecreators.com/v1/instagram/post');
    assert.equal(observedUrl.searchParams.get('url'), CANONICAL);
    assert.equal(observedUrl.searchParams.get('download_media'), 'false');
    assert.equal(observedInit?.method, 'GET');
    assert.equal((observedInit?.headers as Record<string, string>)['x-api-key'], SECRET);
  });
});

test('3. identity mismatch is rejected before media download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const provider = new ScrapeCreatorsInstagramProvider(cfg(), {
      fetch: (async () => Response.json(providerBody('DifferentPost'))) as typeof fetch,
      download: (async () => { downloads += 1; throw new Error('must not download'); }) as never,
      inspect: (async () => probe) as never,
    });
    await assert.rejects(
      () => provider.resolve({ ...input, workDir: dir, expectedShortcode: SHORTCODE }),
      (error) => isMediaError(error) && error.code === 'identity_mismatch',
    );
    assert.equal(downloads, 0);
  });
});

test('4. incident-shaped provider 404 is terminal content-not-found', async () => {
  const responseBody = { success: false, error: 'Post not found', message: 'Post not found', credits_charged: 0 };
  assert.equal(classifyScrapeCreatorsTerminalResponse(404, responseBody), 'scrapecreators_content_not_found');
  await assert.rejects(
    () => requestScrapeCreatorsJson({
      endpoint: new URL('https://api.scrapecreators.com/v1/instagram/post?url=fixture'),
      apiKey: SECRET,
      timeoutMs: 100,
      signal: new AbortController().signal,
      terminalNoMediaStatuses: [400, 404, 422],
      deps: { fetch: (async () => Response.json(responseBody, { status: 404 })) as typeof fetch },
    }),
    (error) => isMediaError(error) && error.code === 'missing_video' &&
      error.detail === 'scrapecreators_content_not_found' && !error.retryable,
  );
});

test('5. transient provider 5xx remains retryable', async () => {
  await assert.rejects(
    () => requestScrapeCreatorsJson({
      endpoint: new URL('https://api.scrapecreators.com/v1/instagram/post?url=fixture'),
      apiKey: SECRET,
      timeoutMs: 100,
      signal: new AbortController().signal,
      terminalNoMediaStatuses: [400, 404, 422],
      deps: { fetch: (async () => new Response('', { status: 503 })) as typeof fetch },
    }),
    (error) => isMediaError(error) && error.code === 'provider_unavailable' && error.retryable,
  );
});

test('6. terminal 404 cannot trigger a repeated paid outer retry', () => {
  const plan = planTaskFailure(
    new MediaError('missing_video', 'scrapecreators_content_not_found'),
    { attempts: 1, max_attempts: 3 },
    { retryBaseSeconds: 30, retryMaxSeconds: 900 },
  );
  assert.deepEqual(plan, { action: 'finalize', outcome: 'unavailable' });
});

test('7. primary plus fallback failure maps to acquisition unavailable', async () => {
  const primaryCalls = { value: 0 };
  let providerCalls = 0;
  const resolver = new InstagramFallbackMediaResolver(cfg(), {
    resolve: async () => {
      providerCalls += 1;
      throw new MediaError('missing_video', 'scrapecreators_content_not_found');
    },
  }, primary(new MediaError('provider_changed', 'yt_dlp_failed'), primaryCalls));
  await assert.rejects(
    () => resolver.resolve(input),
    (error) => isMediaError(error) && error.code === 'missing_video' && error.manualFallback,
  );
  assert.equal(primaryCalls.value, 1);
  assert.equal(providerCalls, 1);
});

test('8. user-facing failure plan hides provider names and HTTP details', () => {
  const plan = planTaskFailure(
    new MediaError('missing_video', 'scrapecreators_content_not_found'),
    { attempts: 1, max_attempts: 3 },
    { retryBaseSeconds: 30, retryMaxSeconds: 900 },
  );
  const serialized = JSON.stringify(plan);
  assert.equal(serialized.includes('scrapecreators'), false);
  assert.equal(serialized.includes('yt-dlp'), false);
  assert.equal(serialized.includes('404'), false);
});

test('9. trusted recognition cache hit skips both acquisition providers', async () => {
  const primaryCalls = { value: 0 };
  let providerCalls = 0;
  const resolver = new InstagramFallbackMediaResolver(cfg(), {
    resolve: async () => { providerCalls += 1; return media('instagram/scrapecreators-direct'); },
  }, primary(media(), primaryCalls), async () => media('recognition-cache'));
  assert.equal((await resolver.resolve(input)).source, 'recognition-cache');
  assert.equal(primaryCalls.value, 0);
  assert.equal(providerCalls, 0);
});

test('10. multi-video carousel policy remains explicit no-media', () => {
  const child = (suffix: string) => ({ is_video: true, video_url: `${DIRECT}?clip=${suffix}` });
  const parsed = parseScrapeCreatorsInstagramPost(providerBody(SHORTCODE, {
    __typename: 'XDTGraphSidecar',
    is_video: false,
    video_url: null,
    edge_sidecar_to_children: { edges: [{ node: child('a') }, { node: child('b') }] },
  }), SHORTCODE);
  assert.equal(parsed.result, 'NO_MEDIA');
  assert.equal(parsed.mediaType, 'carousel_multiple_videos');
  assert.equal(parsed.directMediaUrl, null);
});

test('11. known primary controls retain exact canonical identities', () => {
  for (const shortcode of ['DUWyZkfgbT4', 'CxdY35frOrf', 'DYq7Q3Lza0G']) {
    assert.equal(instagramContentIdentity(`https://www.instagram.com/reel/${shortcode}/`)?.shortcode, shortcode);
  }
});

test('12. known fallback controls retain valid single-video response shape', () => {
  for (const [index, shortcode] of ['DYpcd2ZBTsZ', 'DX77lghIHeG', 'Db60wxqvvOI'].entries()) {
    const parsed = parseScrapeCreatorsInstagramPost(providerBody(shortcode, {
      id: `390000000000000000${index + 2}`,
    }), shortcode);
    assert.equal(parsed.result, 'SUCCESS_MEDIA');
    assert.equal(parsed.mediaType, 'video');
    assert.equal(parsed.shortcode, shortcode);
  }
});
