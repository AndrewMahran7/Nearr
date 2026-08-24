import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '../config/env.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { InstagramMediaResolver } from '../resolvers/InstagramMediaResolver.js';
import { safeDownloadToFile } from '../security/ssrf.js';
import { isMediaError } from '../types/media.js';

const ENDPOINT = 'https://api.scrapecreators.com/v1/instagram/post';
const PROVIDER_TIMEOUT_MS = 30_000;
const MAX_PROVIDER_BODY_BYTES = 2 * 1024 * 1024;
const INSTAGRAM_MEDIA_HOSTS = ['cdninstagram.com', 'fbcdn.net'];

const fixtures = [
  { id: 'capones-ground-truth', url: 'https://www.instagram.com/reel/DUWyZkfgbT4/' },
  { id: 'brooklyn-pizzeria', url: 'https://www.instagram.com/reel/CxdY35frOrf/' },
  { id: 'hellfire-bay', url: 'https://www.instagram.com/reel/DYq7Q3Lza0G/' },
  { id: 'second-floor-post', url: 'https://www.instagram.com/p/DYpcd2ZBTsZ/' },
  { id: 'paradise-dynasty-post', url: 'https://www.instagram.com/p/DX77lghIHeG/' },
  { id: 'known-ytdlp-reel', url: 'https://www.instagram.com/reel/Db60wxqvvOI/' },
  { id: 'explicit-evidence-post', url: 'https://www.instagram.com/p/DbYVuJjM9u2/' },
  { id: 'remote-reel', url: 'https://www.instagram.com/reel/DNT_wptv1K9/' },
  { id: 'remote-post-one', url: 'https://www.instagram.com/p/DVrn72RmJsW/' },
  { id: 'remote-post-two', url: 'https://www.instagram.com/p/DLfvZunSKRp/' },
  { id: 'multi-video-carousel', url: 'https://www.instagram.com/p/DbbY9pdm6Q2/' },
  { id: 'unavailable-control', url: 'https://www.instagram.com/reel/E2eNearrProbe0/' },
] as const;

type JsonObject = Record<string, unknown>;

function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function shortcodeFromUrl(value: string): string | null {
  try {
    return new URL(value).pathname.match(/^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{1,80})\/?$/i)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > MAX_PROVIDER_BODY_BYTES) throw new Error('provider_response_too_large');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

function mediaSummary(body: unknown, expectedShortcode: string) {
  const root = objectValue(body);
  const data = objectValue(root?.data);
  const media = objectValue(data?.xdt_shortcode_media);
  const sidecar = objectValue(media?.edge_sidecar_to_children);
  const edges = Array.isArray(sidecar?.edges) ? sidecar.edges.slice(0, 24) : [];
  const children = edges
    .map((edge) => objectValue(objectValue(edge)?.node))
    .filter((node): node is JsonObject => !!node);
  const childVideos = children.filter((node) => node.is_video === true || !!stringValue(node.video_url));
  const rootVideoUrl = stringValue(media?.video_url);
  const childVideoUrl = childVideos.length === 1 ? stringValue(childVideos[0]?.video_url) : null;
  const directMediaUrl = rootVideoUrl ?? childVideoUrl;
  const shortcode = stringValue(media?.shortcode);
  const caption = objectValue(media?.edge_media_to_caption);
  const captionEdges = Array.isArray(caption?.edges) ? caption.edges.slice(0, 1) : [];
  const captionText = stringValue(objectValue(objectValue(captionEdges[0])?.node)?.text) ?? '';

  return {
    success: root?.success === true,
    credits: numberValue(root?.credits_charged),
    cached: root?.cached === true,
    mediaId: stringValue(media?.id),
    shortcode,
    identityMatch: shortcode === expectedShortcode,
    mediaType: stringValue(media?.__typename),
    durationSeconds: numberValue(media?.video_duration ?? childVideos[0]?.video_duration),
    directMediaUrl,
    carouselChildren: children.length,
    carouselVideoChildren: childVideos.length,
    captionChars: captionText.length,
  };
}

async function providerFixture(
  cfg: ReturnType<typeof loadConfig>,
  fixture: (typeof fixtures)[number],
  workDir: string,
  metadataOnly = false,
) {
  const expectedShortcode = shortcodeFromUrl(fixture.url);
  if (!expectedShortcode) return { result: 'CANONICAL_ID_MISSING', latencyMs: 0 };
  const endpoint = new URL(ENDPOINT);
  endpoint.searchParams.set('url', fixture.url);
  endpoint.searchParams.set('download_media', 'false');
  endpoint.searchParams.set('cache_max_age', '30d');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS);
  const started = Date.now();
  try {
    const response = await fetch(endpoint, {
      redirect: 'error',
      signal: controller.signal,
      headers: {
        accept: 'application/json',
        'x-api-key': cfg.scrapeCreatorsApiKey,
        'user-agent': 'NearrMediaWorkerBenchmark/0.1 (+https://nearr.app)',
      },
    });
    const latencyMs = Date.now() - started;
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { result: `HTTP_${response.status}`, latencyMs };
    }
    const summary = mediaSummary(await readBoundedJson(response), expectedShortcode);
    if (!summary.success || !summary.mediaId || !summary.shortcode) {
      return { result: 'INVALID_RESPONSE', latencyMs, credits: summary.credits };
    }
    if (!summary.identityMatch) {
      return {
        result: 'IDENTITY_MISMATCH', latencyMs, credits: summary.credits,
        returnedShortcode: summary.shortcode, returnedMediaId: summary.mediaId,
      };
    }
    if (!summary.directMediaUrl || summary.carouselVideoChildren > 1) {
      return {
        result: 'NO_MEDIA', latencyMs, credits: summary.credits, cached: summary.cached,
        returnedShortcode: summary.shortcode, returnedMediaId: summary.mediaId,
        mediaType: summary.mediaType, carouselChildren: summary.carouselChildren,
        carouselVideoChildren: summary.carouselVideoChildren, captionChars: summary.captionChars,
      };
    }
    if (metadataOnly) {
      return {
        result: 'SUCCESS_MEDIA', latencyMs, credits: summary.credits, cached: summary.cached,
        returnedShortcode: summary.shortcode, returnedMediaId: summary.mediaId,
        mediaType: summary.mediaType, durationSeconds: summary.durationSeconds,
        carouselChildren: summary.carouselChildren,
        carouselVideoChildren: summary.carouselVideoChildren,
        captionChars: summary.captionChars,
      };
    }
    const destination = path.join(workDir, 'provider.mp4');
    const downloadStarted = Date.now();
    const download = await safeDownloadToFile({
      url: summary.directMediaUrl,
      destPath: destination,
      maxBytes: cfg.maxDownloadBytes,
      timeoutMs: cfg.downloadTimeoutMs,
      redirectLimit: cfg.redirectLimit,
      allowlist: INSTAGRAM_MEDIA_HOSTS,
      extraHeaders: { referer: fixture.url },
    });
    const probe = await inspectMedia(cfg, destination, new AbortController().signal);
    return {
      result: 'SUCCESS_MEDIA',
      latencyMs,
      downloadLatencyMs: Date.now() - downloadStarted,
      credits: summary.credits,
      cached: summary.cached,
      returnedShortcode: summary.shortcode,
      returnedMediaId: summary.mediaId,
      mediaType: summary.mediaType,
      bytes: download.bytes,
      durationSeconds: probe.durationSeconds,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      width: probe.width,
      height: probe.height,
      carouselChildren: summary.carouselChildren,
      carouselVideoChildren: summary.carouselVideoChildren,
      captionChars: summary.captionChars,
    };
  } catch (error) {
    return {
      result: isMediaError(error) ? error.code : controller.signal.aborted ? 'PROVIDER_TIMEOUT' : 'PROVIDER_ERROR',
      detail: isMediaError(error) ? error.detail : undefined,
      latencyMs: Date.now() - started,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function primaryFixture(
  cfg: ReturnType<typeof loadConfig>,
  fixture: (typeof fixtures)[number],
  workDir: string,
) {
  const resolver = new InstagramMediaResolver({ ...cfg, instagramResolverEnabled: true });
  const started = Date.now();
  try {
    const media = await resolver.resolve({
      jobId: `benchmark-${fixture.id}`,
      sourceUrl: fixture.url,
      canonicalUrl: fixture.url,
      workDir,
      signal: new AbortController().signal,
    });
    const probe = await inspectMedia(cfg, media.localFilePath, new AbortController().signal);
    return {
      result: 'SUCCESS_MEDIA',
      latencyMs: Date.now() - started,
      source: media.source,
      bytes: media.sizeBytes,
      durationSeconds: probe.durationSeconds,
      hasVideo: probe.hasVideo,
      hasAudio: probe.hasAudio,
      videoCodec: probe.videoCodec,
      audioCodec: probe.audioCodec,
      width: probe.width,
      height: probe.height,
    };
  } catch (error) {
    return {
      result: isMediaError(error) ? error.code : 'PRIMARY_ERROR',
      detail: isMediaError(error) ? error.detail : undefined,
      latencyMs: Date.now() - started,
    };
  }
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  if (!cfg.scrapeCreatorsApiKey) throw new Error('SCRAPE_CREATORS_KEY is required');
  const fixtureArg = process.argv.indexOf('--fixture');
  const fixtureId = fixtureArg >= 0 ? process.argv[fixtureArg + 1] : null;
  const selectedFixtures = fixtureId ? fixtures.filter((fixture) => fixture.id === fixtureId) : fixtures;
  if (fixtureId && selectedFixtures.length === 0) throw new Error('unknown fixture id');
  const metadataOnly = process.argv.includes('--metadata-only');
  const rows = [];
  for (const fixture of selectedFixtures) {
    const workDir = await mkdtemp(path.join(tmpdir(), 'nearr-ig-benchmark-'));
    try {
      const primary = metadataOnly ? { result: 'SKIPPED' } : await primaryFixture(cfg, fixture, workDir);
      await rm(workDir, { recursive: true, force: true });
      const providerDir = await mkdtemp(path.join(tmpdir(), 'nearr-ig-benchmark-provider-'));
      try {
        const provider = await providerFixture(cfg, fixture, providerDir, metadataOnly);
        rows.push({ fixture: fixture.id, url: fixture.url, expectedShortcode: shortcodeFromUrl(fixture.url), primary, provider });
      } finally {
        await rm(providerDir, { recursive: true, force: true });
      }
    } finally {
      await rm(workDir, { recursive: true, force: true });
    }
  }
  process.stdout.write(`${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`);
}

void main().catch((error) => {
  process.stderr.write(`benchmark failed: ${error instanceof Error ? error.message : 'unknown'}\n`);
  process.exitCode = 1;
});
