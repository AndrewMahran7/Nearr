// services/media-worker/src/resolvers/YouTubeMediaResolver.ts
//
// YouTube PUBLIC video retrieval (Shorts, youtu.be, and ordinary
// /watch?v= URLs are all the same source type — see README for why we don't
// special-case Shorts). Built on the shared yt-dlp core (ytDlpShared.ts).
//
// CAPTIONS-FIRST TRANSCRIPT: YouTube frequently publishes real (owner) or
// auto-generated captions. When yt-dlp's metadata probe exposes a caption
// track for a preferred language, we fetch + parse it ourselves (through the
// SAME SSRF-guarded downloader used for video, capped much smaller) and hand
// the pipeline a ready transcript — no speech-to-text spend. When no caption
// track exists, `captionsTranscript` is simply absent and the pipeline falls
// through to its existing audio-extraction + transcription-provider path.
// Never fabricated: a missing/empty caption track is a normal, non-fatal case.
//
// Long videos: `enforceDurationLimit` (shared) rejects anything over
// MEDIA_MAX_DURATION_SECONDS with `duration_too_long` BEFORE any video bytes
// are fetched — an ordinary long-form YouTube video never becomes a
// multi-gigabyte download attempt.

import type { MediaResolver, ResolveInput } from './MediaResolver.js';
import type { ResolvedMedia, TranscriptSegment } from '../types/media.js';
import type { WorkerConfig } from '../config/env.js';
import { safeFetchText, sanitizeUrlForLog } from '../security/ssrf.js';
import { parseVttToSegments, normalizeTranscriptSegments } from '../util/subtitles.js';
import { log } from '../util/logger.js';
import {
  boundedMetadata,
  pickCreatorHandle,
  enforceDurationLimit,
  probeWithYtDlp,
  requireHttpsHost,
  retrieveVideoFile,
  type YtInfo,
  type YtSubtitleTrack,
} from './ytDlpShared.js';

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'music.youtube.com',
  'youtu.be',
]);

function isYouTubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return YOUTUBE_HOSTS.has(host) || host.endsWith('.youtube.com');
}

// Preference order when multiple caption languages are published. Falls
// through to whatever the FIRST available language is rather than giving up —
// a non-English transcript still carries place evidence, and the model prompt
// is language-agnostic.
const PREFERRED_CAPTION_LANGS = ['en', 'en-US', 'en-GB', 'en-orig'];

const CAPTIONS_MAX_BYTES = 2 * 1024 * 1024; // 2MB — captions are plain text, generous cap
const CAPTIONS_FETCH_TIMEOUT_MS = 10_000;

function pickCaptionTrack(
  tracks: Record<string, YtSubtitleTrack[]> | undefined,
): { lang: string; track: YtSubtitleTrack } | null {
  if (!tracks || typeof tracks !== 'object') return null;
  const langs = Object.keys(tracks);
  if (langs.length === 0) return null;

  const orderedLangs = [
    ...PREFERRED_CAPTION_LANGS.filter((l) => langs.includes(l)),
    ...langs.filter((l) => !PREFERRED_CAPTION_LANGS.includes(l)),
  ];

  for (const lang of orderedLangs) {
    const list = tracks[lang];
    if (!Array.isArray(list) || list.length === 0) continue;
    // Prefer a DIRECT plain-text vtt track. yt-dlp sometimes ALSO lists a
    // `vtt`-labeled entry that is actually an HLS manifest pointer
    // (`protocol: 'm3u8_native'`, host `manifest.googlevideo.com`) rather than
    // fetchable caption text — verified against a live YouTube response.
    // Skip those; only a plain `timedtext` endpoint parses as WebVTT.
    const vtt = list.find(
      (t) => (t.ext ?? '').toLowerCase() === 'vtt' && t.protocol !== 'm3u8_native' && typeof t.url === 'string',
    );
    if (vtt?.url) return { lang, track: vtt };
  }
  return null;
}

async function fetchCaptions(
  cfg: WorkerConfig,
  info: YtInfo,
  signal: AbortSignal,
  jobId: string,
): Promise<{ segments: TranscriptSegment[]; source: string; language: string } | null> {
  // Manual (owner-authored) captions first — more reliable than auto-captions.
  const manual = pickCaptionTrack(info.subtitles);
  const picked = manual ?? pickCaptionTrack(info.automatic_captions);
  if (!picked) return null;

  try {
    const fetched = await safeFetchText({
      url: picked.track.url!,
      maxBytes: CAPTIONS_MAX_BYTES,
      timeoutMs: CAPTIONS_FETCH_TIMEOUT_MS,
      redirectLimit: cfg.redirectLimit,
      allowlist: cfg.allowedMediaHosts,
      signal,
    });
    const segments = normalizeTranscriptSegments(parseVttToSegments(fetched.text));
    if (segments.length === 0) return null;
    return {
      segments,
      source: manual ? 'youtube_captions' : 'youtube_auto_captions',
      language: picked.lang,
    };
  } catch (err) {
    // Captions are a strict bonus — any failure here (network, SSRF gate,
    // parse) just means the pipeline falls through to audio transcription.
    // Never let a captions hiccup fail the whole task.
    log.warn('youtube_captions_fetch_failed', { jobId, url: sanitizeUrlForLog(picked.track.url ?? '') });
    return null;
  }
}

export class YouTubeMediaResolver implements MediaResolver {
  readonly name = 'youtube/yt-dlp';
  private readonly cfg: WorkerConfig;

  constructor(cfg: WorkerConfig) {
    this.cfg = cfg;
  }

  supports(input: { platform: string; url: URL }): boolean {
    if (!this.cfg.youtubeResolverEnabled) return false;
    if (input.platform.toLowerCase() !== 'youtube') return false;
    return isYouTubeHost(input.url.hostname);
  }

  async resolve(input: ResolveInput): Promise<ResolvedMedia> {
    const rawUrl = input.canonicalUrl || input.sourceUrl;
    const url = requireHttpsHost(rawUrl, isYouTubeHost);

    // `yt-dlp -j` already includes full `subtitles` / `automatic_captions`
    // metadata (language â†’ available track formats, incl. `vtt`) with no
    // extra flags needed — verified against live YouTube responses.
    const info = await probeWithYtDlp(this.cfg, url, { workDir: input.workDir, signal: input.signal });
    const duration = enforceDurationLimit(this.cfg, info);

    const captions = await fetchCaptions(this.cfg, info, input.signal, input.jobId);

    const file = await retrieveVideoFile(this.cfg, {
      jobId: input.jobId,
      url,
      info,
      workDir: input.workDir,
      signal: input.signal,
      sourceLabel: 'youtube',
      // Verified live: YouTube's legacy single-file progressive format (id
      // `18`, capped at 360p) is unreliable — it can 403 or serve an HLS
      // manifest instead of raw bytes even when yt-dlp's metadata calls it
      // `protocol: "https"`. Go straight to yt-dlp's adaptive video+audio
      // merge (its own recommended approach for YouTube), bounded by the same
      // duration/size/timeout limits as every other platform.
      skipDirectUrl: true,
      formatSelector: `bestvideo[ext=mp4][protocol^=https][height<=720]+bestaudio[ext=m4a][protocol^=https]/best[protocol^=https][ext=mp4]/best[protocol^=https]`,
      mergeOutputFormat: 'mp4',
    });

    return {
      canonicalUrl: url,
      localFilePath: file.path,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      durationSeconds: duration,
      metadataTitle: boundedMetadata(info.title, 500),
      metadataDescription: boundedMetadata(info.description, 4000),
      metadataCreatorHandle: pickCreatorHandle(info, url),
      source: file.source,
      warnings: file.warnings,
      captionsTranscript: captions?.segments,
      captionsSource: captions?.source,
      captionsLanguage: captions?.language ?? null,
    };
  }
}
