import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import {
  parseScrapeCreatorsInstagramPost,
  ScrapeCreatorsInstagramProvider,
} from '../src/providers/ScrapeCreatorsInstagramProvider.js';
import { planTaskFailure } from '../src/pipeline/runMediaTask.js';
import { InstagramFallbackMediaResolver } from '../src/resolvers/InstagramFallbackMediaResolver.js';
import { instagramContentIdentity } from '../src/resolvers/instagramUrl.js';
import { shouldUseScrapeCreatorsFallback } from '../src/resolvers/scrapeCreatorsFallbackPolicy.js';
import { isMediaError, MediaError, type MediaProbe, type ResolvedMedia } from '../src/types/media.js';
import type { MediaResolver, ResolveInput } from '../src/resolvers/MediaResolver.js';

const SHORTCODE = 'DUWyZkfgbT4';
const MEDIA_ID = '3825466592993588472';
const CANONICAL = `https://www.instagram.com/reel/${SHORTCODE}/`;
const DIRECT = 'https://scontent.example.cdninstagram.com/o1/video.mp4';
const SECRET = 'unit-test-instagram-provider-secret';

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

function resolved(source = 'instagram/yt-dlp'): ResolvedMedia {
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
    name: 'instagram/yt-dlp',
    supports: () => true,
    resolve: async () => {
      if (result instanceof MediaError) throw result;
      return result;
    },
  };
}

const probe: MediaProbe = {
  hasVideo: true,
  hasAudio: true,
  durationSeconds: 32.433,
  container: 'mov,mp4',
  videoCodec: 'h264',
  audioCodec: 'aac',
  width: 720,
  height: 1280,
  frameRate: 30,
  rotation: null,
};

const inspectOk = async () => probe;

const input: ResolveInput & { canonicalUrl: string } = {
  jobId: 'instagram-job-fixture',
  sourceUrl: `${CANONICAL}?igsh=tracking`,
  canonicalUrl: CANONICAL,
  workDir: '.',
  signal: new AbortController().signal,
};

function providerBody(over: {
  shortcode?: string;
  id?: string;
  direct?: string | null;
  duration?: number;
  success?: boolean;
  media?: Record<string, unknown> | null;
} = {}): unknown {
  const media = over.media === null ? null : {
    __typename: 'XDTGraphVideo',
    id: over.id ?? MEDIA_ID,
    shortcode: over.shortcode ?? SHORTCODE,
    is_video: true,
    video_url: over.direct === undefined ? DIRECT : over.direct,
    video_duration: over.duration ?? 32.433,
    owner: { id: 'creator-1', username: 'fixture.creator', full_name: 'Fixture Creator' },
    edge_media_to_caption: { edges: [{ node: { text: 'A bounded public caption' } }] },
    ...(over.media ?? {}),
  };
  return {
    success: over.success ?? true,
    credits_charged: 1,
    data: { xdt_shortcode_media: media },
  };
}

async function withTemp<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(path.join(tmpdir(), 'nearr-sc-instagram-test-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function mockProvider(options: {
  response?: Response;
  download?: (opts: { url: string; destPath: string; maxBytes: number }) => Promise<{
    bytes: number; contentType: string | null; finalUrl: string;
  }>;
  inspect?: () => Promise<MediaProbe>;
  fetch?: typeof fetch;
  remove?: (file: string) => Promise<void>;
  config?: WorkerConfig;
} = {}): ScrapeCreatorsInstagramProvider {
  return new ScrapeCreatorsInstagramProvider(options.config ?? cfg(), {
    fetch: options.fetch ?? (async () => options.response ?? Response.json(providerBody())) as typeof fetch,
    download: (options.download ?? (async ({ destPath }: { destPath: string }) => {
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'video/mp4', finalUrl: DIRECT };
    })) as never,
    inspect: (options.inspect ?? inspectOk) as never,
    ...(options.remove ? { remove: options.remove as never } : {}),
  });
}

function ladder(
  primaryResult: ResolvedMedia | MediaError,
  fallback: Pick<ScrapeCreatorsInstagramProvider, 'resolve'>,
  cache?: () => Promise<ResolvedMedia | null>,
  inspectPrimary: typeof inspectOk = inspectOk,
) {
  return new InstagramFallbackMediaResolver(cfg(), fallback, primary(primaryResult), cache, inspectPrimary as never);
}

test('1. usable primary Instagram media prevents a provider call', async () => {
  let calls = 0;
  const media = await ladder(resolved(), { resolve: async () => { calls += 1; return resolved(); } }).resolve(input);
  assert.equal(media.acquisition?.provider, 'yt_dlp');
  assert.equal(media.acquisition?.canonicalInstagramId, SHORTCODE);
  assert.equal(calls, 0);
});

test('2. a generic primary failure invokes ScrapeCreators exactly once', async () => {
  let calls = 0;
  const media = await ladder(new MediaError('provider_changed', 'yt_dlp_failed'), {
    resolve: async () => { calls += 1; return resolved('instagram/scrapecreators-direct'); },
  }).resolve(input);
  assert.equal(media.acquisition?.provider, 'scrapecreators');
  assert.equal(calls, 1);
});

for (const [name, code, detail] of [
  ['login_required', 'authentication_required', 'login_required'],
  ['authentication_required', 'authentication_required', 'authentication_required'],
  ['extractor failure', 'provider_changed', 'extractor_failed'],
  ['download failure', 'download_failed', 'download_failed'],
  ['primary timeout', 'download_timeout', 'metadata_probe_timeout'],
  ['missing media URL', 'missing_video', 'no_progressive_url'],
] as const) {
  test(`3-8. ${name} falls through once`, async () => {
    let calls = 0;
    const media = await ladder(new MediaError(code, detail), {
      resolve: async () => { calls += 1; return resolved('instagram/scrapecreators-direct'); },
    }).resolve(input);
    assert.equal(media.acquisition?.primaryFailureCode, code);
    assert.equal(calls, 1);
  });
}

test('9. primary bytes that fail ffprobe fall through to the provider', async () => {
  let calls = 0;
  const resolver = ladder(resolved(), {
    resolve: async () => { calls += 1; return resolved('instagram/scrapecreators-direct'); },
  }, undefined, async () => { throw new MediaError('invalid_media', 'ffprobe_failed'); });
  assert.equal((await resolver.resolve(input)).acquisition?.provider, 'scrapecreators');
  assert.equal(calls, 1);
});

test('10. missing canonical Instagram identity prevents a paid call', async () => {
  let calls = 0;
  const bad = { ...input, sourceUrl: 'https://www.instagram.com/explore/', canonicalUrl: undefined };
  const resolver = ladder(new MediaError('authentication_required', 'login_required'), {
    resolve: async () => { calls += 1; return resolved(); },
  });
  await assert.rejects(() => resolver.resolve(bad), (error) => isMediaError(error) && error.code === 'authentication_required');
  assert.equal(calls, 0);
});

test('11. canonical identity normalizes aliases, creator prefixes, and tracking', () => {
  assert.deepEqual(
    instagramContentIdentity(`https://www.instagram.com/creator.name/reels/${SHORTCODE}/?igsh=x`),
    { shortcode: SHORTCODE, kind: 'reel', canonicalUrl: CANONICAL },
  );
});

test('12. exact provider shortcode is accepted', () => {
  const parsed = parseScrapeCreatorsInstagramPost(providerBody(), SHORTCODE);
  assert.equal(parsed.result, 'SUCCESS_MEDIA');
  assert.equal(parsed.mediaId, MEDIA_ID);
});

test('13. provider shortcode mismatch is rejected before download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const provider = mockProvider({
      response: Response.json(providerBody({ shortcode: 'DifferentPost' })),
      download: async () => { downloads += 1; throw new Error('must not download'); },
    });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'identity_mismatch',
    );
    assert.equal(downloads, 0);
  });
});

test('14. malformed provider response is rejected', async () => {
  await withTemp(async (dir) => {
    const provider = mockProvider({ response: Response.json({ success: true, data: {} }) });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'invalid_media',
    );
  });
});

test('15. no media URL is a structured missing-video result', async () => {
  await withTemp(async (dir) => {
    const provider = mockProvider({ response: Response.json(providerBody({ direct: null })) });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'missing_video',
    );
  });
});

test('16. invalid content type is rejected', async () => {
  await withTemp(async (dir) => {
    const provider = mockProvider({ download: async ({ destPath }) => {
      await writeFile(destPath, Buffer.alloc(2048, 7));
      return { bytes: 2048, contentType: 'text/html', finalUrl: DIRECT };
    } });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'invalid_media',
    );
  });
});

test('17. provider ffprobe failure is rejected and partial media is cleaned', async () => {
  await withTemp(async (dir) => {
    const destination = path.join(dir, 'scrapecreators-instagram-source.mp4');
    const provider = mockProvider({ inspect: async () => { throw new MediaError('invalid_media', 'ffprobe_failed'); } });
    await assert.rejects(() => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }));
    await assert.rejects(() => stat(destination), { code: 'ENOENT' });
  });
});

test('18. oversized provider media preserves file_too_large', async () => {
  await withTemp(async (dir) => {
    const provider = mockProvider({ download: async () => { throw new MediaError('file_too_large'); } });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'file_too_large',
    );
  });
});

test('19. over-duration response is rejected before download', async () => {
  await withTemp(async (dir) => {
    let downloads = 0;
    const provider = mockProvider({
      response: Response.json(providerBody({ duration: 181 })),
      download: async () => { downloads += 1; throw new Error('must not download'); },
    });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'duration_too_long',
    );
    assert.equal(downloads, 0);
  });
});

test('20. provider timeout is structured and bounded', async () => {
  await withTemp(async (dir) => {
    const timeoutConfig = cfg({ downloadTimeoutMs: 5 });
    const hangingFetch = ((_url: Parameters<typeof fetch>[0], init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
    })) as typeof fetch;
    const provider = mockProvider({ config: timeoutConfig, fetch: hangingFetch });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'download_timeout',
    );
  });
});

test('21. one-video carousel is accepted without ambiguity', () => {
  const child = { is_video: true, video_url: DIRECT, video_duration: 12 };
  const parsed = parseScrapeCreatorsInstagramPost(providerBody({ direct: null, media: {
    __typename: 'XDTGraphSidecar', is_video: false,
    edge_sidecar_to_children: { edges: [{ node: { is_video: false } }, { node: child }] },
  } }), SHORTCODE);
  assert.equal(parsed.result, 'SUCCESS_MEDIA');
  assert.equal(parsed.mediaType, 'carousel_single_video');
});

test('22. multi-video carousel is explicitly unsupported, never arbitrarily selected', () => {
  const child = (suffix: string) => ({ is_video: true, video_url: `${DIRECT}?clip=${suffix}` });
  const parsed = parseScrapeCreatorsInstagramPost(providerBody({ direct: null, media: {
    __typename: 'XDTGraphSidecar', is_video: false,
    edge_sidecar_to_children: { edges: [{ node: child('a') }, { node: child('b') }] },
  } }), SHORTCODE);
  assert.equal(parsed.result, 'NO_MEDIA');
  assert.equal(parsed.mediaType, 'carousel_multiple_videos');
  assert.equal(parsed.directMediaUrl, null);
});

test('23. non-Meta and provider-hosted URLs are never selected as direct media', () => {
  const bad = parseScrapeCreatorsInstagramPost(providerBody({ direct: 'https://evil.example/video.mp4' }), SHORTCODE);
  assert.equal(bad.result, 'NO_MEDIA');
  const hosted = parseScrapeCreatorsInstagramPost(providerBody({ direct: 'https://files.supabase.co/storage/video.mp4' }), SHORTCODE);
  assert.equal(hosted.providerHostedMediaPresent, true);
  assert.equal(hosted.directMediaUrl, null);
});

test('24. trusted cache hit prevents primary and provider calls', async () => {
  let primaryCalls = 0;
  let providerCalls = 0;
  const primaryResolver: MediaResolver = {
    name: 'instagram/yt-dlp', supports: () => true,
    resolve: async () => { primaryCalls += 1; return resolved(); },
  };
  const resolver = new InstagramFallbackMediaResolver(cfg(), {
    resolve: async () => { providerCalls += 1; return resolved(); },
  }, primaryResolver, async () => resolved('recognition-cache'), inspectOk as never);
  assert.equal((await resolver.resolve(input)).source, 'recognition-cache');
  assert.equal(primaryCalls, 0);
  assert.equal(providerCalls, 0);
});

test('25. task cancellation never starts a paid provider call', async () => {
  let calls = 0;
  const resolver = ladder(new MediaError('cancelled'), { resolve: async () => { calls += 1; return resolved(); } });
  await assert.rejects(() => resolver.resolve(input), (error) => isMediaError(error) && error.code === 'cancelled');
  assert.equal(calls, 0);
});

test('26. fallback policy has no content-classification exclusions', () => {
  for (const contentClassification of ['sensitive_content', 'private_protected', 'age_restricted', 'unknown']) {
    assert.equal(shouldUseScrapeCreatorsFallback({
      platform: 'instagram', canonicalInstagramId: SHORTCODE,
      primaryAcquisitionProducedUsableMedia: false, scrapeCreatorsAttempted: false,
      contentClassification,
    }).eligible, true);
  }
});

test('27. provider telemetry is bounded and secret-free', async () => {
  await withTemp(async (dir) => {
    const media = await mockProvider().resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir });
    const serialized = JSON.stringify(media.acquisition);
    assert.equal(serialized.includes(SECRET), false);
    assert.equal(serialized.includes('video.mp4'), false);
    assert.equal(media.acquisition?.canonicalInstagramId, SHORTCODE);
    assert.equal(media.acquisition?.providerPostId, MEDIA_ID);
  });
});

test('28. provider-specific details never enter the user failure plan', () => {
  const plan = planTaskFailure(
    new MediaError('provider_unavailable', 'scrapecreators_provider_auth_failed'),
    { attempts: 1, max_attempts: 3 },
    { retryBaseSeconds: 30, retryMaxSeconds: 900 },
    () => 0,
  );
  assert.deepEqual(plan, { action: 'requeue', delaySeconds: 30 });
  assert.equal(JSON.stringify(plan).includes('scrapecreators'), false);
});

test('29. fallback feature flag off leaves primary failure unchanged', async () => {
  let calls = 0;
  const resolver = new InstagramFallbackMediaResolver(
    cfg({ scrapeCreatorsInstagramFallbackEnabled: false }),
    { resolve: async () => { calls += 1; return resolved(); } },
    primary(new MediaError('authentication_required', 'login_required')),
    undefined,
    inspectOk as never,
  );
  await assert.rejects(() => resolver.resolve(input), (error) => isMediaError(error) && error.code === 'authentication_required');
  assert.equal(calls, 0);
});

test('30. deleted/provider 404 is terminal no-media rather than an outer paid retry', async () => {
  await withTemp(async (dir) => {
    const provider = mockProvider({ response: new Response('', { status: 404 }) });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'missing_video' && !error.retryable,
    );
  });
});

test('31. exhausted provider credits return a structured opaque provider outage', async () => {
  await withTemp(async (dir) => {
    const provider = mockProvider({ response: new Response('', { status: 402 }) });
    await assert.rejects(
      () => provider.resolve({ ...input, expectedShortcode: SHORTCODE, workDir: dir }),
      (error) => isMediaError(error) && error.code === 'provider_unavailable' &&
        error.detail === 'scrapecreators_payment_required',
    );
  });
});
