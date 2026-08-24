import { open, unlink } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { safeDownloadToFile, type DownloadResult } from '../security/ssrf.js';
import { MediaError, type MediaProbe } from '../types/media.js';

const MIN_MEDIA_BYTES = 1024;

export type JsonObject = Record<string, unknown>;

export function objectValue(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

export function stringValue(value: unknown, max = 500): string | null {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean ? clean.slice(0, max) : null;
}

export function numberValue(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function hostMatches(host: string, allowed: string): boolean {
  return host === allowed || host.endsWith(`.${allowed}`);
}

export function urlUsesAllowedHost(raw: string, allowedHosts: readonly string[]): boolean {
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return false;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    return allowedHosts.some((allowed) => hostMatches(host, allowed));
  } catch {
    return false;
  }
}

export function isProviderHostedMediaUrl(raw: string): boolean {
  try {
    const host = new URL(raw).hostname.toLowerCase();
    return host === 'scrapecreators.com' || host.endsWith('.scrapecreators.com') ||
      host.endsWith('.supabase.co');
  } catch {
    return false;
  }
}

async function validateDownloadedPayload(filePath: string, result: DownloadResult): Promise<void> {
  const contentType = result.contentType?.toLowerCase().split(';')[0]?.trim() ?? '';
  if (!(contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
    throw new MediaError('invalid_media', 'scrapecreators_bad_content_type');
  }
  if (result.bytes < MIN_MEDIA_BYTES) throw new MediaError('invalid_media', 'scrapecreators_media_too_small');
  const file = await open(filePath, 'r');
  try {
    const prefix = Buffer.alloc(Math.min(result.bytes, 512));
    await file.read(prefix, 0, prefix.byteLength, 0);
    const text = prefix.toString('utf8').trimStart().toLowerCase();
    if (text.startsWith('<!doctype') || text.startsWith('<html') || text.startsWith('{') || text.startsWith('[')) {
      throw new MediaError('invalid_media', 'scrapecreators_non_media_payload');
    }
  } finally {
    await file.close();
  }
}

export type ScrapeCreatorsMediaDeps = {
  download: typeof safeDownloadToFile;
  inspect: typeof inspectMedia;
  remove: typeof unlink;
};

export const DEFAULT_MEDIA_DEPS: ScrapeCreatorsMediaDeps = {
  download: safeDownloadToFile,
  inspect: inspectMedia,
  remove: unlink,
};

/** Download and ffprobe one direct provider-authorized CDN asset. All partial
 * bytes are removed on failure; the caller's job-temp cleanup owns success. */
export async function downloadAndInspectScrapeCreatorsMedia(input: {
  cfg: WorkerConfig;
  url: string;
  destination: string;
  canonicalUrl: string;
  allowlist: readonly string[];
  signal: AbortSignal;
  deps?: Partial<ScrapeCreatorsMediaDeps>;
}): Promise<{ download: DownloadResult; probe: MediaProbe }> {
  const deps: ScrapeCreatorsMediaDeps = {
    download: input.deps?.download ?? DEFAULT_MEDIA_DEPS.download,
    inspect: input.deps?.inspect ?? DEFAULT_MEDIA_DEPS.inspect,
    remove: input.deps?.remove ?? DEFAULT_MEDIA_DEPS.remove,
  };
  try {
    const download = await deps.download({
      url: input.url,
      destPath: input.destination,
      maxBytes: input.cfg.maxDownloadBytes,
      timeoutMs: input.cfg.downloadTimeoutMs,
      redirectLimit: input.cfg.redirectLimit,
      allowlist: [...input.allowlist],
      signal: input.signal,
      extraHeaders: { referer: input.canonicalUrl },
    });
    await validateDownloadedPayload(input.destination, download);
    const probe = await deps.inspect(input.cfg, input.destination, input.signal);
    return { download, probe };
  } catch (error) {
    await deps.remove(input.destination).catch(() => undefined);
    throw error;
  }
}
