import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import {
  parseScrapeCreatorsVideo,
  ScrapeCreatorsTikTokProvider,
} from '../src/providers/ScrapeCreatorsTikTokProvider.js';
import { planTaskFailure } from '../src/pipeline/runMediaTask.js';
import { TikTokFallbackMediaResolver } from '../src/resolvers/TikTokFallbackMediaResolver.js';
import {
  shouldUseScrapeCreatorsFallback,
  type ScrapeCreatorsFallbackPolicyInput,
} from '../src/resolvers/scrapeCreatorsTikTokFallbackPolicy.js';
import { isMediaError, MediaError, type MediaProbe, type ResolvedMedia } from '../src/types/media.js';
import type { MediaResolver, ResolveInput } from '../src/resolvers/MediaResolver.js';

const VIDEO_ID = '7669596669075393822';
const CANONICAL = `https://www.tiktok.com/@fixture/video/${VIDEO_ID}`;
const DIRECT = 'https://v16.tiktokcdn.com/video/tos/test.mp4';
const SECRET = 'unit-test-provider-secret';

function cfg(over: Partial<WorkerConfig> = {}): WorkerConfig {
  return {
    ...loadConfig(),
    tiktokResolverEnabled: true,
    scrapeCreatorsTikTokFallbackEnabled: true,
    scrapeCreatorsApiKey: SECRET,
    maxDurationSeconds: 180,
    maxDownloadBytes: 10 * 1024 * 1024,
    downloadTimeoutMs: 100,
    redirectLimit: 3,
    ...over,
  };
}

function resolved(source = 'tiktok/yt-dlp'): ResolvedMedia {
  return {
    canonicalUrl: CANONICAL,
    localFilePath: 'fixture.mp4',
    mimeType: 'video/mp4',
    sizeBytes: 2048,
    source,
    warnings: [],
  };
}

function primary(result: ResolvedMedia | MediaError): MediaResolver {
  return {
    name: 'tiktok/yt-dlp',
    supports: () => true,
    resolve: async () => {
      if (result instanceof MediaError) throw result;
      return result;
    },
  };
}

function fallbackDecision(over: Partial<ScrapeCreatorsFallbackPolicyInput> = {}) {
  return shouldUseScrapeCreatorsFallback({
    platform: 'tiktok',
    primaryAcquisitionProducedUsableMedia: false,
    scrapeCreatorsAttempted: false,
    failureCode: 'provider_changed',
    failureDetail: 'yt_dlp_failed',
    canonicalTikTokId: VIDEO_ID,
    ...over,
  });
}

const input: ResolveInput & { canonicalUrl: string } = {
  jobId: 'job-fixture',
  sourceUrl: CANONICAL,
  canonicalUrl: CANONICAL,
  workDir: '.',
  signal: new AbortController().signal,
};

function providerBody(over: {
  id?: string;
  direct?: string | null;
  duration?: number;
  success?: boolean;
} = {}): unknown {
  const id = over.id ?? VIDEO_ID;
  const direct = over.direct === undefined ? DIRECT : over.direct;
  return {
    success: over.success ?? true,
    credits_charged: 1,
    aweme_detail: {
      aweme_id: id,
      url: `https://www.tiktok.com/@fixture/video/${id}`,
      desc: 'bounded fixture description',
      author: { unique_id: 'fixture', nickname: 'Fixture', uid: 'author-1' },
      video: {
        duration: over.duration ?? 11_200,
        download_no_watermark_addr: { url_list: direct ? [direct] : [] },
      },
    },
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
  const dir = await mkdtemp(path.join(tmpdir(), 'nearr-sc-test-'));
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
} = {}): ScrapeCreatorsTikTokProvider {
  return new ScrapeCreatorsTikTokProvider(cfg(), {
    fetch: options.fetch ?? (async () => options.response ?? Response.json(providerBody())) as typeof fetch,
    download: (options.download ?? (async ({ destPath }: { destPath: string }) => {
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'video/mp4', finalUrl: DIRECT };
    })) as never,
    inspect: (options.inspect ?? (async () => probe)) as never,
    ...(options.remove ? { remove: options.remove as never } : {}),
  });
}

test('1. yt-dlp success never calls ScrapeCreators', async () => {
  let calls = 0;
  const ladder = new TikTokFallbackMediaResolver(cfg(), { resolve: async () => { calls += 1; return resolved(); } }, primary(resolved()));
  const media = await ladder.resolve(input);
  assert.equal(media.acquisition?.provider, 'yt_dlp');
  assert.equal(calls, 0);
});

test('2. eligible generic yt-dlp failure calls provider exactly once', async () => {
  let calls = 0;
  const ladder = new TikTokFallbackMediaResolver(cfg(), {
    resolve: async () => { calls += 1; return { ...resolved('tiktok/scrapecreators-direct'), acquisition: { provider: 'scrapecreators' } }; },
  }, primary(new MediaError('provider_changed', 'yt_dlp_failed')));
  assert.equal((await ladder.resolve(input)).acquisition?.provider, 'scrapecreators');
  assert.equal(calls, 1);
});

test('3. non-TikTok is ineligible', () => {
  assert.equal(fallbackDecision({ platform: 'instagram' }).eligible, false);
});

test('4. authentication_required falls through to ScrapeCreators once', async () => {
  let calls = 0;
  const ladder = new TikTokFallbackMediaResolver(cfg(), { resolve: async () => { calls += 1; return resolved('tiktok/scrapecreators-direct'); } }, primary(new MediaError('authentication_required', 'login_required')));
  const media = await ladder.resolve(input);
  assert.equal(media.acquisition?.provider, 'scrapecreators');
  assert.equal(media.acquisition?.primaryFailureCode, 'authentication_required');
  assert.equal(calls, 1);
});

test('5. explicit sensitive classification remains eligible', () => {
  assert.equal(fallbackDecision({ contentClassification: 'sensitive_content' }).eligible, true);
});

test('6. private/protected content with a canonical ID remains eligible', () => {
  assert.equal(fallbackDecision({ failureCode: 'private_or_unavailable', failureDetail: 'private_protected' }).eligible, true);
});

test('7. age-restricted classification remains eligible', () => {
  assert.equal(fallbackDecision({ failureCode: 'authentication_required', failureDetail: 'age_restricted' }).eligible, true);
});

test('7b. every terminal primary acquisition failure class invokes the provider once', async () => {
  const failures: Array<[ConstructorParameters<typeof MediaError>[0], string]> = [
    ['authentication_required', 'login_required'],
    ['provider_changed', 'sensitive'],
    ['authentication_required', 'age_restricted'],
    ['private_or_unavailable', 'private_protected'],
    ['provider_changed', 'provider_changed'],
    ['provider_changed', 'extractor_failed'],
    ['provider_changed', 'yt_dlp_failed'],
    ['download_failed', 'download_failed'],
    ['download_timeout', 'download_timeout'],
    ['provider_unavailable', 'provider_unavailable'],
    ['provider_rate_limited', 'rate_limited'],
    ['missing_video', 'no_media'],
  ];
  for (const [code, detail] of failures) {
    let calls = 0;
    const ladder = new TikTokFallbackMediaResolver(cfg(), {
      resolve: async () => {
        calls += 1;
        return resolved('tiktok/scrapecreators-direct');
      },
    }, primary(new MediaError(code, detail)));
    assert.equal((await ladder.resolve(input)).acquisition?.provider, 'scrapecreators', `${code}:${detail}`);
    assert.equal(calls, 1, `${code}:${detail}`);
  }
});

test('7c. a missing canonical ID never invokes the paid provider', async () => {
  let calls = 0;
  const noIdentity: ResolveInput = {
    ...input,
    sourceUrl: 'https://www.tiktok.com/t/short-code/',
    canonicalUrl: undefined,
  };
  const ladder = new TikTokFallbackMediaResolver(cfg(), {
    resolve: async () => { calls += 1; return resolved(); },
  }, primary(new MediaError('authentication_required', 'login_required')));
  await assert.rejects(() => ladder.resolve(noIdentity), (error) => isMediaError(error) && error.code === 'authentication_required');
  assert.equal(calls, 0);
});

test('7d. usable primary media and an exhausted fallback attempt are ineligible', () => {
  assert.equal(fallbackDecision({ primaryAcquisitionProducedUsableMedia: true }).eligible, false);
  assert.equal(fallbackDecision({ scrapeCreatorsAttempted: true }).eligible, false);
});

test('7e. task cancellation never starts a paid provider call', async () => {
  let calls = 0;
  const ladder = new TikTokFallbackMediaResolver(cfg(), {
    resolve: async () => { calls += 1; return resolved(); },
  }, primary(new MediaError('cancelled')));
  await assert.rejects(() => ladder.resolve(input), (error) => isMediaError(error) && error.code === 'cancelled');
  assert.equal(calls, 0);
});

test('8. exact provider video ID is accepted', () => {
  assert.equal(parseScrapeCreatorsVideo(providerBody(), VIDEO_ID).result, 'SUCCESS_MEDIA');
});

test('9. provider ID mismatch is rejected before download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const client = mockClient({
      response: Response.json(providerBody({ id: '1111111111111111111' })),
      download: async () => { downloads += 1; throw new Error('must not download'); },
    });
    await assert.rejects(() => client.resolve({ ...input, canonicalUrl: CANONICAL, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'identity_mismatch');
    assert.equal(downloads, 0);
  });
});

test('10. no direct media URL fails safely', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ response: Response.json(providerBody({ direct: null })) });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'missing_video');
  });
});

test('11. bad content type is rejected', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ download: async ({ destPath }) => {
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'text/html', finalUrl: DIRECT };
    } });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'invalid_media');
  });
});

test('12. oversized download remains file_too_large', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ download: async () => { throw new MediaError('file_too_large'); } });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'file_too_large');
  });
});

test('13. provider duration over current limit is rejected before download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const client = mockClient({
      response: Response.json(providerBody({ duration: 181_000 })),
      download: async () => { downloads += 1; throw new Error('must not download'); },
    });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'duration_too_long');
    assert.equal(downloads, 0);
  });
});

test('14. ffprobe failure is a safe media failure', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ inspect: async () => { throw new MediaError('invalid_media', 'ffprobe_failed'); } });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'invalid_media');
  });
});

test('15. provider timeout is structured and bounded', async () => {
  await withTemp(async (dir) => {
    const timeoutCfg = cfg({ downloadTimeoutMs: 5 });
    const hangingFetch = ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch;
    const client = new ScrapeCreatorsTikTokProvider(timeoutCfg, { fetch: hangingFetch });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'download_timeout');
  });
});

test('16. provider rate limit carries bounded retry metadata', async () => {
  await withTemp(async (dir) => {
    const client = mockClient({ response: new Response('', { status: 429, headers: { 'retry-after': '99999' } }) });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'provider_rate_limited' && error.retryAfterSeconds === 900);
  });
});

test('17. direct TikTok CDN URL is the downloaded path', async () => {
  await withTemp(async (dir) => {
    let selected = '';
    const client = mockClient({ download: async ({ url, destPath }) => {
      selected = url;
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'video/mp4', finalUrl: url };
    } });
    await client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir });
    assert.equal(selected, DIRECT);
  });
});

test('18. provider-hosted permanent media is not selected by default', async () => {
  await withTemp(async (dir) => {
    const hosted = 'https://provider-media.supabase.co/storage/v1/object/video.mp4';
    const parsed = parseScrapeCreatorsVideo(providerBody({ direct: hosted }), VIDEO_ID);
    assert.equal(parsed.providerHostedMediaPresent, true);
    assert.equal(parsed.directMediaUrl, null);
    const client = mockClient({ response: Response.json(providerBody({ direct: hosted })) });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }), (error) => isMediaError(error) && error.code === 'missing_video');
  });
});

test('19. partial provider temp media is deleted on validation failure', async () => {
  await withTemp(async (dir) => {
    const destination = path.join(dir, 'scrapecreators-source.mp4');
    const client = mockClient({ download: async ({ destPath }) => {
      await writeFile(destPath, Buffer.from('<html>' + 'x'.repeat(2048)));
      return { bytes: 2054, contentType: 'video/mp4', finalUrl: DIRECT };
    } });
    await assert.rejects(() => client.resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir }));
    await assert.rejects(() => stat(destination), { code: 'ENOENT' });
  });
});

test('20. trusted cache hit prevents both primary and provider calls', async () => {
  let primaryCalls = 0;
  let providerCalls = 0;
  const primaryResolver: MediaResolver = { name: 'tiktok/yt-dlp', supports: () => true, resolve: async () => { primaryCalls += 1; return resolved(); } };
  const ladder = new TikTokFallbackMediaResolver(cfg(), { resolve: async () => { providerCalls += 1; return resolved(); } }, primaryResolver, async () => resolved('recognition-cache'));
  assert.equal((await ladder.resolve(input)).source, 'recognition-cache');
  assert.equal(primaryCalls, 0);
  assert.equal(providerCalls, 0);
});

test('21. provider telemetry is bounded and contains no secret', async () => {
  await withTemp(async (dir) => {
    const media = await mockClient().resolve({ ...input, expectedVideoId: VIDEO_ID, workDir: dir });
    const serialized = JSON.stringify(media.acquisition);
    assert.equal(serialized.includes(SECRET), false);
    assert.deepEqual(Object.keys(media.acquisition ?? {}).sort(), [
      'canonicalTikTokId', 'provider', 'providerCredits', 'providerLatencyMs', 'providerMediaBytes', 'providerResult',
    ].sort());
  });
});

test('22. provider-specific error detail does not enter user failure plan', () => {
  const plan = planTaskFailure(
    new MediaError('provider_unavailable', 'scrapecreators_provider_auth_failed'),
    { attempts: 1, max_attempts: 3 },
    { retryBaseSeconds: 30, retryMaxSeconds: 900 },
    () => 0,
  );
  assert.deepEqual(plan, { action: 'requeue', delaySeconds: 30 });
  assert.equal(JSON.stringify(plan).includes('scrapecreators'), false);
});

test('23. final unavailable result is planned only after primary and fallback both fail', async () => {
  let calls = 0;
  const ladder = new TikTokFallbackMediaResolver(cfg(), {
    resolve: async () => {
      calls += 1;
      throw new MediaError('missing_video', 'scrapecreators_no_direct_media');
    },
  }, primary(new MediaError('authentication_required', 'login_required')));
  let finalError: MediaError | null = null;
  try {
    await ladder.resolve(input);
  } catch (error) {
    if (isMediaError(error)) finalError = error;
  }
  assert.equal(calls, 1);
  assert.ok(finalError);
  assert.deepEqual(
    planTaskFailure(finalError, { attempts: 1, max_attempts: 3 }, { retryBaseSeconds: 30, retryMaxSeconds: 900 }),
    { action: 'finalize', outcome: 'unavailable' },
  );
});
