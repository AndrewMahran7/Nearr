import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import {
  parseScrapeCreatorsFacebookPost,
  ScrapeCreatorsFacebookProvider,
} from '../src/providers/ScrapeCreatorsFacebookProvider.js';
import { planTaskFailure } from '../src/pipeline/runMediaTask.js';
import { FacebookFallbackMediaResolver } from '../src/resolvers/FacebookFallbackMediaResolver.js';
import {
  shouldUseScrapeCreatorsFacebookFallback,
  type ScrapeCreatorsFacebookFallbackPolicyInput,
} from '../src/resolvers/scrapeCreatorsFacebookFallbackPolicy.js';
import { isMediaError, MediaError, type MediaProbe, type ResolvedMedia } from '../src/types/media.js';
import type { MediaResolver, ResolveInput } from '../src/resolvers/MediaResolver.js';

const VIDEO_ID = '1356645589772949';
const CANONICAL = `https://www.facebook.com/reel/${VIDEO_ID}/`;
const FB_WATCH = 'https://fb.watch/J8m9M2wynx/';
const DIRECT = 'https://video-lga3-1.xx.fbcdn.net/video/test.mp4';
const SECRET = 'unit-test-provider-secret';

function cfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    ...loadConfig(),
    facebookResolverEnabled: true,
    scrapeCreatorsFacebookFallbackEnabled: true,
    scrapeCreatorsApiKey: SECRET,
    maxDurationSeconds: 180,
    maxDownloadBytes: 10 * 1024 * 1024,
    downloadTimeoutMs: 100,
    redirectLimit: 3,
    ...over,
  };
}

function resolved(source = 'facebook/yt-dlp'): ResolvedMedia {
  return {
    canonicalUrl: CANONICAL,
    localFilePath: 'fixture.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 2048,
    sourceId: VIDEO_ID,
    source,
    warnings: [],
  };
}

function primary(result: ResolvedMedia | MediaError): MediaResolver {
  return {
    name: 'facebook/yt-dlp',
    supports: ({ platform }) => platform === 'facebook',
    resolve: async () => {
      if (result instanceof MediaError) throw result;
      return result;
    },
  };
}

function fallbackDecision(over: Partial<ScrapeCreatorsFacebookFallbackPolicyInput> = {}) {
  return shouldUseScrapeCreatorsFacebookFallback({
    platform: 'facebook',
    primaryAcquisitionProducedUsableMedia: false,
    scrapeCreatorsAttempted: false,
    canonicalFacebookId: VIDEO_ID,
    failureCode: 'provider_changed',
    failureDetail: 'yt_dlp_failed',
    ...over,
  });
}

const input: ResolveInput & { canonicalUrl: string } = {
  jobId: 'facebook-job-fixture',
  sourceUrl: CANONICAL,
  canonicalUrl: CANONICAL,
  workDir: '.',
  signal: new AbortController().signal,
};

function providerBody(over: {
  id?: string | null;
  returnedUrl?: string;
  direct?: string | null;
  duration?: number;
  success?: boolean;
  multiple?: boolean;
} = {}): unknown {
  const id = over.id === undefined ? VIDEO_ID : over.id;
  const direct = over.direct === undefined ? DIRECT : over.direct;
  return {
    success: over.success ?? true,
    credits_charged: 1,
    post_id: '122137629429158292',
    url: over.returnedUrl ?? CANONICAL,
    description: 'bounded fixture description',
    author: { id: 'page-1', name: 'Fixture Page' },
    video: {
      ...(id === null ? {} : { id }),
      hd_url: direct,
      sd_url: direct,
      length_in_second: over.duration ?? 11.2,
    },
    ...(over.multiple ? { media: [{ type: 'video' }, { type: 'video' }] } : {}),
  };
}

const probe: MediaProbe = {
  hasVideo: true,
  hasAudio: true,
  durationSeconds: 11.2,
  container: 'mov,mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 576,
  height: 1024,
  frameRate: 30,
  rotation: null,
};

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nearr-sc-facebook-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mockClient(options: {
  response?: Response;
  download?: (opts: { url: string; destPath: string; maxBytes: number }) => Promise<{
    bytes: number; contentType: string | null; finalUrl: string;
  }>;
  inspect?: () => Promise<MediaProbe>;
  fetch?: typeof fetch;
  remove?: (file: string) => Promise<void>;
} = {}): ScrapeCreatorsFacebookProvider {
  return new ScrapeCreatorsFacebookProvider(cfg(), {
    fetch: options.fetch ?? (async () => options.response ?? Response.json(providerBody())) as typeof fetch,
    download: (options.download ?? (async ({ destPath }: { destPath: string }) => {
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'video/mp4', finalUrl: DIRECT };
    })) as never,
    inspect: (options.inspect ?? (async () => probe)) as never,
    ...(options.remove ? { remove: options.remove as never } : {}),
  });
}

test('1. normal Facebook primary success never calls ScrapeCreators', async () => {
  let calls = 0;
  const ladder = new FacebookFallbackMediaResolver(
    cfg(),
    { resolve: async () => { calls += 1; return resolved(); } },
    primary(resolved()),
  );
  const media = await ladder.resolve(input);
  assert.equal(media.acquisition?.provider, 'yt_dlp');
  assert.equal(media.acquisition?.scrapeCreatorsInvoked, false);
  assert.equal(calls, 0);
});

test('2. already-canonicalized fb.watch primary success never calls ScrapeCreators', async () => {
  let calls = 0;
  const ladder = new FacebookFallbackMediaResolver(
    cfg(),
    { resolve: async () => { calls += 1; return resolved(); } },
    primary(resolved()),
  );
  const media = await ladder.resolve({ ...input, sourceUrl: FB_WATCH, canonicalUrl: CANONICAL });
  assert.equal(media.acquisition?.sourceUrlClass, 'fb_watch');
  assert.equal(media.acquisition?.scrapeCreatorsInvoked, false);
  assert.equal(calls, 0);
});

test('3-6. extraction, auth, provider change, and timeout failures invoke fallback once', async () => {
  for (const [code, detail] of [
    ['missing_video', 'no_direct_media'],
    ['authentication_required', 'facebook_login_redirect'],
    ['provider_changed', 'extractor_failed'],
    ['download_timeout', 'primary_timeout'],
  ] as const) {
    let calls = 0;
    const ladder = new FacebookFallbackMediaResolver(
      cfg(),
      { resolve: async () => { calls += 1; return resolved('facebook/scrapecreators-direct'); } },
      primary(new MediaError(code, detail)),
    );
    const media = await ladder.resolve(input);
    assert.equal(media.acquisition?.provider, 'scrapecreators', `${code}:${detail}`);
    assert.equal(media.acquisition?.primaryFailureCode, code, `${code}:${detail}`);
    assert.equal(calls, 1, `${code}:${detail}`);
  }
});

test('7. missing canonical numeric Facebook ID never invokes paid fallback', async () => {
  let calls = 0;
  const postInput: ResolveInput = {
    ...input,
    sourceUrl: 'https://www.facebook.com/example/posts/pfbid0abcDEF123456789/',
    canonicalUrl: undefined,
  };
  const ladder = new FacebookFallbackMediaResolver(
    cfg(),
    { resolve: async () => { calls += 1; return resolved(); } },
    primary(new MediaError('authentication_required', 'login_required')),
  );
  await assert.rejects(
    () => ladder.resolve(postInput),
    (error) => isMediaError(error) && error.code === 'authentication_required',
  );
  assert.equal(calls, 0);
});

test('8. modern video.id and legacy canonical URL identities are accepted exactly', () => {
  assert.equal(parseScrapeCreatorsFacebookPost(providerBody(), VIDEO_ID).result, 'SUCCESS_MEDIA');
  const legacy = providerBody({
    id: null,
    returnedUrl: `https://www.facebook.com/61584748774034/videos/${VIDEO_ID}/?extid=share`,
    duration: 0,
  });
  assert.equal(parseScrapeCreatorsFacebookPost(legacy, VIDEO_ID).result, 'SUCCESS_MEDIA');
});

test('9. provider identity mismatch is rejected before download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const client = mockClient({
      response: Response.json(providerBody({ id: '9999999999999999', returnedUrl: 'https://www.facebook.com/reel/9999999999999999/' })),
      download: async () => { downloads += 1; throw new Error('must not download'); },
    });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'identity_mismatch',
    );
    assert.equal(downloads, 0);
  });
});

test('10. malformed response is rejected', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ response: Response.json({ success: true, video: 'changed' }) });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'invalid_media',
    );
    assert.equal(
      parseScrapeCreatorsFacebookPost(providerBody({ id: 'not-a-numeric-id' }), VIDEO_ID).result,
      'INVALID_RESPONSE',
    );
  });
});

test('11. no direct media is terminal fallback failure', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ response: Response.json(providerBody({ direct: null })) });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'missing_video',
    );
  });
});

test('12. invalid content type is rejected and removed', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ download: async ({ destPath }) => {
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'text/html', finalUrl: DIRECT };
    } });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'invalid_media',
    );
    await assert.rejects(() => stat(path.join(dir, 'scrapecreators-facebook-source.mp4')));
  });
});

test('13. ffprobe failure is rejected and temp media is cleaned', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ inspect: async () => { throw new MediaError('invalid_media', 'ffprobe_failed'); } });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.detail === 'ffprobe_failed',
    );
    await assert.rejects(() => stat(path.join(dir, 'scrapecreators-facebook-source.mp4')));
  });
});

test('14. oversized download remains file_too_large', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ download: async () => { throw new MediaError('file_too_large'); } });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'file_too_large',
    );
  });
});

test('15. provider duration above Nearr limit is rejected before download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const client = mockClient({
      response: Response.json(providerBody({ duration: 181 })),
      download: async () => { downloads += 1; throw new Error('must not download'); },
    });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'duration_too_long',
    );
    assert.equal(downloads, 0);
  });
});

test('16. provider timeout is structured and secret-free', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ fetch: ((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'download_timeout' && !error.message.includes(SECRET),
    );
  });
});

test('16b. exhausted credits are provider readiness failure, not no-media', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ response: Response.json({ success: false }, { status: 402 }) });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'provider_unavailable' &&
        error.detail === 'scrapecreators_credits_exhausted',
    );
  });
});

test('17. policy permits one attempt maximum and excludes cancellation', async () => {
  assert.equal(fallbackDecision({ scrapeCreatorsAttempted: true }).eligible, false);
  assert.equal(fallbackDecision({ primaryAcquisitionProducedUsableMedia: true }).eligible, false);
  let calls = 0;
  const ladder = new FacebookFallbackMediaResolver(
    cfg(),
    { resolve: async () => { calls += 1; return resolved(); } },
    primary(new MediaError('cancelled')),
  );
  await assert.rejects(() => ladder.resolve(input), (error) => isMediaError(error) && error.code === 'cancelled');
  assert.equal(calls, 0);
});

test('18-19. successful fallback feeds the existing frames and recognition sequence', async () => {
  const worker = await readFile(new URL('../src/pipeline/runMediaTask.ts', import.meta.url), 'utf8');
  const resolveAt = worker.indexOf('await resolver.resolve({');
  const framesAt = worker.indexOf('await extractFrames(', resolveAt);
  const recognitionAt = worker.indexOf('await deps.model.analyze(', framesAt);
  assert.ok(resolveAt >= 0 && framesAt > resolveAt && recognitionAt > framesAt);
  assert.match(worker, /media\.acquisition\?\.provider === 'scrapecreators'/);
  assert.match(worker, /modelPipelineReached = true/);
});

test('20. recognition-cache seam prevents both primary and paid provider calls', async () => {
  let primaryCalls = 0;
  let providerCalls = 0;
  const primaryResolver: MediaResolver = {
    name: 'facebook/yt-dlp', supports: () => true,
    resolve: async () => { primaryCalls += 1; return resolved(); },
  };
  const ladder = new FacebookFallbackMediaResolver(
    cfg(),
    { resolve: async () => { providerCalls += 1; return resolved(); } },
    primaryResolver,
    async () => resolved('recognition-cache'),
  );
  assert.equal((await ladder.resolve(input)).source, 'recognition-cache');
  assert.equal(primaryCalls, 0);
  assert.equal(providerCalls, 0);
});

test('21. provider name/detail never enters normal user failure plan', () => {
  const plan = planTaskFailure(
    new MediaError('missing_video', 'scrapecreators_facebook_no_direct_media'),
    { attempts: 1, max_attempts: 3 },
    { retryBaseSeconds: 30, retryMaxSeconds: 900 },
  );
  assert.deepEqual(plan, { action: 'finalize', outcome: 'unavailable' });
  assert.equal(JSON.stringify(plan).includes('scrapecreators'), false);
});

test('22. bounded provider telemetry contains no key or signed media URL', async () => {
  await withTemp(async (dir) => {
    const media = await mockClient().resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir });
    const serialized = JSON.stringify(media.acquisition);
    assert.equal(serialized.includes(SECRET), false);
    assert.equal(serialized.includes('fbcdn.net'), false);
    assert.deepEqual(Object.keys(media.acquisition ?? {}).sort(), [
      'canonicalFacebookId', 'provider', 'providerCredits', 'providerLatencyMs', 'providerMediaBytes', 'providerResult',
    ].sort());
  });
});

test('23. ambiguous multi-media posts are not resolved by response order', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ response: Response.json(providerBody({ multiple: true })) });
    await assert.rejects(
      () => client.resolve({ ...input, expectedFacebookId: VIDEO_ID, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'unsupported_url' &&
        error.detail === 'scrapecreators_facebook_multiple_media_unsupported',
    );
  });
});

test('24. every primary acquisition MediaError with valid identity remains eligible', () => {
  for (const code of [
    'authentication_required', 'provider_changed', 'private_or_unavailable', 'download_failed',
    'download_timeout', 'provider_unavailable', 'provider_rate_limited', 'missing_video',
    'invalid_media', 'file_too_large', 'duration_too_long', 'ssrf_blocked', 'identity_mismatch',
  ] as const) {
    assert.equal(fallbackDecision({ failureCode: code, failureDetail: code }).eligible, true, code);
  }
});

test('25. secret is server-only and cannot use mobile export naming', async () => {
  const env = await readFile(new URL('../.env.example', import.meta.url), 'utf8');
  const config = await readFile(new URL('../src/config/env.ts', import.meta.url), 'utf8');
  assert.match(env, /^SCRAPE_CREATORS_KEY=$/m);
  assert.doesNotMatch(env + config, /EXPO_PUBLIC_SCRAPE/i);
});
