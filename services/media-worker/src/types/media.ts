// services/media-worker/src/types/media.ts
//
// Core worker data contracts: the media task row, resolved media, media probe
// info, transcript/frame/OCR shapes, and the structured resolver error taxonomy.

/** Structured error codes returned by media resolvers + the pipeline. NEVER
 *  carry secrets, cookies, or authorization headers in error detail. */
export type MediaErrorCode =
  | 'unsupported_platform'
  | 'unsupported_url'
  | 'identity_mismatch'
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
  'identity_mismatch',
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
  /** Public-post metadata retained to the source limit. Model callers derive
   *  a smaller prompt excerpt without replacing this evidence. */
  metadataTitle?: string | null;
  metadataDescription?: string | null;
  /** Platform-provided location label when the public extractor exposes one.
   *  This is geographic context, never trusted as the final place. */
  metadataLocation?: string | null;
  /** The post author's @handle, when the extractor exposed one. Forwarded to
   *  the resolver so the CREATOR is never mistaken for a tagged venue. */
  metadataCreatorHandle?: string | null;
  /** Stable public post id when the extractor exposes one. Provenance only. */
  metadataPostId?: string | null;
  /** Stable platform content id plus public creator/page attribution. These
   *  are provenance only; they never become place identity evidence. */
  sourceId?: string | null;
  metadataCreatorName?: string | null;
  metadataCreatorId?: string | null;
  /** Human label of the retrieval source (e.g. "instagram/yt-dlp"). */
  source: string;
  warnings: string[];
  /**
   * Platform-supplied captions/subtitles, ALREADY normalized into transcript
   * segments, when the resolver could obtain them through the same legitimate
   * public access used for the video itself (e.g. YouTube's caption tracks).
   * When present and non-empty, the pipeline uses this as the transcript and
   * skips paying for audio extraction + speech-to-text — see the transcript
   * hierarchy in runMediaTask.ts. Never fabricated: absence means the platform
   * exposed no usable captions for this post, not a failure.
   */
  captionsTranscript?: TranscriptSegment[];
  /** Label for diagnostics, e.g. "youtube_captions" / "youtube_auto_captions". */
  captionsSource?: string;
  captionsLanguage?: string | null;
  /** Bounded, secret-free acquisition provenance. Signed CDN URLs and raw
   * provider responses are deliberately absent. */
  acquisition?: {
    provider: 'yt_dlp' | 'scrapecreators';
    primaryAcquisitionProvider?: 'yt_dlp';
    primaryAcquisitionResult?: 'success_media' | 'failure_no_usable_media';
    primaryFailureCode?: MediaErrorCode;
    scrapeCreatorsInvoked?: boolean;
    scrapeCreatorsResult?: string;
    identityMatch?: boolean;
    finalAcquisitionProvider?: 'yt_dlp' | 'scrapecreators';
    fallbackReason?: string;
    canonicalTikTokId?: string;
    canonicalInstagramId?: string;
    providerPostId?: string;
    canonicalFacebookId?: string;
    sourceUrlClass?: string;
    providerLatencyMs?: number;
    providerMediaBytes?: number;
    providerResult?: string;
    providerCredits?: number;
  };
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
  /** Added by the video-AI-note migration; absent legacy/test rows are recognition. */
  task_kind?: 'recognition' | 'premium_recognition' | 'ai_note_enrichment';
  premium_request_id?: string | null;
  share_job_id: string | null;
  saved_place_id?: string | null;
  /** Internal public.places.id captured for this enrichment generation. */
  target_place_id?: string | null;
  /** Number of exhausted transient-outage retry cycles. */
  retry_cycles?: number;
  /** Bounded place-specific observations retained across retries. Never raw media. */
  evidence_snapshot?: unknown;
  /** True once any attempt acquired usable media/text. */
  media_acquired_once?: boolean;
  frame_snapshot?: unknown;
  frame_snapshot_timestamp_seconds?: number | null;
  /** Last disposition, used to widen scene context after a quality rejection. */
  ai_note_outcome?: string | null;
  model_calls?: number | null;
  model_input_tokens?: number | null;
  model_output_tokens?: number | null;
  model_thinking_tokens?: number | null;
  model_latency_ms?: number | null;
  user_id: string;
  source_url: string;
  canonical_url: string | null;
  platform: string;
  status: string;
  progress_stage: string | null;
  attempts: number;
  max_attempts: number;
  created_at?: string | null;
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
