// services/media-worker/src/types/media.ts
//
// Core worker data contracts: the media task row, resolved media, media probe
// info, transcript/frame/OCR shapes, and the structured resolver error taxonomy.

/** Structured error codes returned by media resolvers + the pipeline. NEVER
 *  carry secrets, cookies, or authorization headers in error detail. */
export type MediaErrorCode =
  | 'unsupported_platform'
  | 'unsupported_url'
  | 'private_or_unavailable'
  | 'authentication_required'
  | 'provider_changed'
  | 'redirect_limit'
  | 'download_timeout'
  | 'download_failed'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'finalizer_unavailable'
  | 'file_too_large'
  | 'duration_too_long'
  | 'invalid_media'
  | 'missing_video'
  | 'ssrf_blocked'
  | 'cancelled';

/** Whether an error should retry (download again) or is terminal. */
const RETRYABLE_CODES: ReadonlySet<MediaErrorCode> = new Set<MediaErrorCode>([
  'download_timeout',
  'download_failed',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_changed', // markup changed transiently; a retry may recover
]);

/** Errors that mean "media analysis cannot proceed but the user can still
 *  search by hand" — the parent job goes to needs_help(manual), not failed. */
const MANUAL_FALLBACK_CODES: ReadonlySet<MediaErrorCode> = new Set<MediaErrorCode>([
  'unsupported_platform',
  'unsupported_url',
  'private_or_unavailable',
  'authentication_required',
  'file_too_large',
  'duration_too_long',
  'invalid_media',
  'missing_video',
  'ssrf_blocked',
]);

export class MediaError extends Error {
  readonly code: MediaErrorCode;
  /** Sanitized, secret-free detail safe to log/persist. */
  readonly detail?: string;
  readonly retryAfterSeconds?: number;

  constructor(code: MediaErrorCode, detail?: string, retryAfterSeconds?: number) {
    super(`${code}${detail ? `: ${detail}` : ''}`);
    this.name = 'MediaError';
    this.code = code;
    this.detail = detail;
    this.retryAfterSeconds = retryAfterSeconds;
  }

  get retryable(): boolean {
    return RETRYABLE_CODES.has(this.code);
  }

  get manualFallback(): boolean {
    return MANUAL_FALLBACK_CODES.has(this.code);
  }
}

export function isMediaError(e: unknown): e is MediaError {
  return e instanceof MediaError;
}

/** The information a resolver must return. Only what the worker needs — never
 *  secrets, cookies, or signed URLs beyond the local file path. */
export type ResolvedMedia = {
  canonicalUrl: string;
  localFilePath: string;
  mimeType: string;
  sizeBytes: number;
  durationSeconds?: number;
  /** Bounded public-post metadata used transiently as caption evidence. */
  metadataTitle?: string | null;
  metadataDescription?: string | null;
  /** Human label of the retrieval source (e.g. "instagram/yt-dlp"). */
  source: string;
  warnings: string[];
};

/** ffprobe-derived media facts. */
export type MediaProbe = {
  hasVideo: boolean;
  hasAudio: boolean;
  durationSeconds: number;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  width: number | null;
  height: number | null;
  frameRate: number | null;
  rotation: number | null;
};

export type TranscriptSegment = {
  startSeconds: number;
  endSeconds: number;
  text: string;
};

export type TranscriptResult = {
  provider: string;
  segments: TranscriptSegment[];
  language: string | null;
  status: 'success' | 'no_audio' | 'unavailable' | 'failed';
  reason?: string;
};

export type SelectedFrame = {
  path: string;
  timestampSeconds: number;
  width: number;
  height: number;
  /** 64-bit average-hash as a hex string, for dedup + diagnostics. */
  aHash: string;
  reason: 'first' | 'last' | 'interval' | 'scene_change';
};

export type OcrSegment = {
  timestampSeconds: number;
  text: string;
  confidence: number;
};

/** The media task row as claimed from the DB (subset the worker needs). */
export type MediaTask = {
  id: string;
  share_job_id: string;
  user_id: string;
  source_url: string;
  canonical_url: string | null;
  platform: string;
  status: string;
  progress_stage: string | null;
  attempts: number;
  max_attempts: number;
};

/** Progress stages persisted on the media task (mirrors the DB CHECK). */
export type ProgressStage =
  | 'queued'
  | 'retrieving_media'
  | 'inspecting_media'
  | 'extracting_audio'
  | 'transcribing_audio'
  | 'extracting_frames'
  | 'extracting_visible_text'
  | 'analyzing_evidence'
  | 'verifying_place'
  | 'cleanup';
