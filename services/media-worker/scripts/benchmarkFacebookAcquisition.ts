import { loadConfig } from '../src/config/env.js';
import { inspectMedia } from '../src/pipeline/inspectMedia.js';
import { ScrapeCreatorsFacebookProvider } from '../src/providers/ScrapeCreatorsFacebookProvider.js';
import {
  FacebookMediaResolver,
  facebookNumericContentId,
  resolveFacebookAcquisitionUrl,
} from '../src/resolvers/FacebookMediaResolver.js';
import { isMediaError } from '../src/types/media.js';
import { createJobTemp } from '../src/util/tempDir.js';

const DEFAULT_URLS = [
  'https://www.facebook.com/reel/1535656380759655/',
  'https://www.facebook.com/reel/1356645589772949/',
  'https://www.facebook.com/reel/1303365218449136/',
  'https://www.facebook.com/reel/2349748325554244/',
  'https://www.facebook.com/reel/1313027950911844/',
  'https://www.facebook.com/reel/3384429771712962/',
  'https://www.facebook.com/reel/1052691990581061/',
  'https://fb.watch/J8m9M2wynx/',
  'https://www.facebook.com/watch/?v=10153231379946729',
  'https://www.facebook.com/reel/9999999999999999/',
];

const urls = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_URLS;
const cfg = {
  ...loadConfig(),
  facebookResolverEnabled: true,
  scrapeCreatorsFacebookFallbackEnabled: true,
};
const primary = new FacebookMediaResolver(cfg);
const provider = new ScrapeCreatorsFacebookProvider(cfg);

function failure(error: unknown, latencyMs: number) {
  return {
    result: 'FAILURE',
    code: isMediaError(error) ? error.code : 'unexpected_error',
    detail: isMediaError(error) ? error.detail ?? null : 'unexpected_error',
    latencyMs,
  };
}

async function runOne(url: string) {
  const signal = AbortSignal.timeout(Math.min(cfg.jobTimeoutMs, 8 * 60_000));
  let canonicalUrl = url;
  try {
    canonicalUrl = (await resolveFacebookAcquisitionUrl(url, signal)).url;
  } catch {
    // The primary run below records the canonicalization failure independently.
  }
  const expectedFacebookId = facebookNumericContentId(canonicalUrl);

  const primaryTemp = await createJobTemp(cfg.tempDir, 'facebook-primary-benchmark');
  const primaryStarted = Date.now();
  let primaryResult: Record<string, unknown>;
  try {
    const media = await primary.resolve({
      jobId: 'facebook-primary-benchmark',
      sourceUrl: url,
      canonicalUrl,
      workDir: primaryTemp.dir,
      signal,
    });
    const probe = await inspectMedia(cfg, media.localFilePath, signal);
    primaryResult = {
      result: 'SUCCESS_MEDIA',
      identity: media.sourceId ?? null,
      identityMatch: !!expectedFacebookId && media.sourceId === expectedFacebookId,
      bytes: media.sizeBytes,
      durationSeconds: probe.durationSeconds,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
      container: probe.container,
      latencyMs: Date.now() - primaryStarted,
    };
  } catch (error) {
    primaryResult = failure(error, Date.now() - primaryStarted);
  } finally {
    await primaryTemp.cleanup();
  }

  const fallbackTemp = await createJobTemp(cfg.tempDir, 'facebook-provider-benchmark');
  const fallbackStarted = Date.now();
  let scrapeCreatorsResult: Record<string, unknown>;
  try {
    if (!expectedFacebookId) throw new Error('canonical_id_missing');
    const media = await provider.resolve({
      jobId: 'facebook-provider-benchmark',
      sourceUrl: url,
      canonicalUrl: `https://www.facebook.com/reel/${expectedFacebookId}/`,
      expectedFacebookId,
      workDir: fallbackTemp.dir,
      signal,
    });
    const probe = await inspectMedia(cfg, media.localFilePath, signal);
    scrapeCreatorsResult = {
      result: 'SUCCESS_MEDIA',
      identity: media.sourceId ?? null,
      identityMatch: media.sourceId === expectedFacebookId,
      bytes: media.sizeBytes,
      durationSeconds: probe.durationSeconds,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
      container: probe.container,
      latencyMs: Date.now() - fallbackStarted,
      credits: media.acquisition?.providerCredits ?? null,
      providerLatencyMs: media.acquisition?.providerLatencyMs ?? null,
    };
  } catch (error) {
    scrapeCreatorsResult = expectedFacebookId
      ? failure(error, Date.now() - fallbackStarted)
      : { result: 'NOT_ATTEMPTED', code: 'canonical_id_missing', latencyMs: 0 };
  } finally {
    await fallbackTemp.cleanup();
  }

  return {
    url,
    canonicalUrl: expectedFacebookId ? `https://www.facebook.com/reel/${expectedFacebookId}/` : canonicalUrl,
    expectedFacebookId,
    primary: primaryResult,
    scrapeCreators: scrapeCreatorsResult,
    tempCleaned: true,
  };
}

const results = [];
for (const url of urls.slice(0, 20)) results.push(await runOne(url));
console.log(JSON.stringify(results, null, 2));
