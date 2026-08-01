// services/media-worker/src/config/env.ts
//
// Typed, centralized configuration for the media worker. Every operational
// limit is environment-configurable (the mission requires this) with
// conservative defaults. This module never logs secret values.
//
// NOTE: these are SERVER-ONLY variables. None of them are EXPO_PUBLIC_* and
// none of them ever reach the mobile bundle.

function str(name: string, fallback = ''): string {
  const v = process.env[name];
  return typeof v === 'string' && v.trim() ? v.trim() : fallback;
}

function bool(name: string, fallback = false): boolean {
  const v = process.env[name];
  if (v == null || v.trim() === '') return fallback;
  return v.trim().toLowerCase() === 'true';
}

function int(name: string, fallback: number, min = 0): number {
  const v = Number(process.env[name]);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.floor(v));
}

function list(name: string, fallback: string[]): string[] {
  const v = process.env[name];
  if (!v || !v.trim()) return fallback;
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export type WorkerConfig = {
  // ---- Server ----
  port: number;
  /** Dedicated invocation secret the DB wake-up / cron must present. NOT the
   *  service-role key. Required to start. */
  workerSecret: string;

  // ---- Feature flags (all default OFF) ----
  mediaFallbackEnabled: boolean;
  instagramResolverEnabled: boolean;
  nativeVideoAnalysisEnabled: boolean;

  // ---- Supabase (service-role, used INTERNALLY only) ----
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** process-share-jobs finalize endpoint. Defaults to
   *  `${supabaseUrl}/functions/v1/process-share-jobs`. */
  finalizeUrl: string;

  // ---- Concurrency / claiming ----
  maxConcurrency: number;
  claimBatchSize: number;
  claimLockSeconds: number;

  // ---- Retry backoff (bounded exponential; see util/backoff.ts) ----
  retryBaseSeconds: number; // 30s first backoff step
  retryMaxSeconds: number; // 900s cap

  // ---- Media limits (why each default was chosen — see README) ----
  maxDurationSeconds: number; // 180s: short-form social video; longer = likely not a place clip
  maxDownloadBytes: number; // 150MB: generous for <=180s 1080p, bounds disk + egress
  downloadTimeoutMs: number; // 60s: a stalled CDN fetch must not hold a slot
  jobTimeoutMs: number; // 8min: hard ceiling for a single task incl. model calls
  maxSelectedFrames: number; // 24: enough visual coverage; caps model cost
  frameIntervalSeconds: number; // 1s baseline sampling cadence
  redirectLimit: number; // 3: public CDN rarely needs more; limits SSRF surface

  // ---- Host allowlist (HTTPS only) ----
  allowedMediaHosts: string[];

  // ---- Providers ----
  transcriptionProvider: string; // 'noop' | 'openai' | ... (default noop)
  transcriptionApiKey: string;
  transcriptionModel: string;
  analysisProvider: string; // 'heuristic' | 'gemini' (default heuristic)
  geminiApiKey: string;
  geminiModel: string;
  ocrProvider: string; // 'noop' | 'model' (default model when a model is configured, else noop)

  // ---- External binaries (overridable for local dev) ----
  ytDlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;

  // ---- Temp storage ----
  tempDir: string;
};

// Instagram public video is served from Meta CDNs. HTTPS-only, allowlisted.
const DEFAULT_ALLOWED_HOSTS = [
  'cdninstagram.com',
  'fbcdn.net',
  'instagram.com',
];

const MB = 1024 * 1024;

export function loadConfig(): WorkerConfig {
  const supabaseUrl = str('SUPABASE_URL');
  const finalizeUrl =
    str('SHARE_JOBS_FINALIZE_URL') ||
    (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/process-share-jobs` : '');

  const geminiApiKey = str('GEMINI_API_KEY');
  const analysisProvider = str('MEDIA_ANALYSIS_PROVIDER', geminiApiKey ? 'gemini' : 'heuristic');

  return Object.freeze({
    port: int('PORT', 8090, 1),
    workerSecret: str('SHARE_MEDIA_WORKER_SECRET'),

    mediaFallbackEnabled: bool('MEDIA_FALLBACK_ENABLED', false),
    instagramResolverEnabled: bool('INSTAGRAM_MEDIA_RESOLVER_ENABLED', false),
    nativeVideoAnalysisEnabled: bool('NATIVE_VIDEO_ANALYSIS_ENABLED', false),

    supabaseUrl,
    supabaseServiceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
    finalizeUrl,

    maxConcurrency: int('MEDIA_WORKER_MAX_CONCURRENCY', 1, 1),
    claimBatchSize: int('MEDIA_WORKER_CLAIM_BATCH', 2, 1),
    claimLockSeconds: int('MEDIA_WORKER_CLAIM_LOCK_SECONDS', 600, 60),

    retryBaseSeconds: int('MEDIA_RETRY_BASE_SECONDS', 30, 1),
    retryMaxSeconds: int('MEDIA_RETRY_MAX_SECONDS', 900, 1),

    maxDurationSeconds: int('MEDIA_MAX_DURATION_SECONDS', 180, 1),
    maxDownloadBytes: int('MEDIA_MAX_DOWNLOAD_BYTES', 150 * MB, MB),
    downloadTimeoutMs: int('MEDIA_DOWNLOAD_TIMEOUT_MS', 60_000, 1000),
    jobTimeoutMs: int('MEDIA_JOB_TIMEOUT_MS', 8 * 60_000, 10_000),
    maxSelectedFrames: int('MEDIA_MAX_SELECTED_FRAMES', 24, 1),
    frameIntervalSeconds: int('MEDIA_FRAME_INTERVAL_SECONDS', 1, 1),
    redirectLimit: int('MEDIA_REDIRECT_LIMIT', 3, 0),

    allowedMediaHosts: list('MEDIA_ALLOWED_HOSTS', DEFAULT_ALLOWED_HOSTS),

    transcriptionProvider: str('MEDIA_TRANSCRIPTION_PROVIDER', 'noop').toLowerCase(),
    transcriptionApiKey: str('MEDIA_TRANSCRIPTION_API_KEY'),
    transcriptionModel: str('MEDIA_TRANSCRIPTION_MODEL', 'whisper-1'),
    analysisProvider: analysisProvider.toLowerCase(),
    geminiApiKey,
    geminiModel: str('GEMINI_MODEL', 'gemini-1.5-flash'),
    ocrProvider: str('MEDIA_OCR_PROVIDER', geminiApiKey ? 'model' : 'noop').toLowerCase(),

    ytDlpPath: str('YT_DLP_PATH', 'yt-dlp'),
    ffmpegPath: str('FFMPEG_PATH', 'ffmpeg'),
    ffprobePath: str('FFPROBE_PATH', 'ffprobe'),

    tempDir: str('MEDIA_TEMP_DIR', ''),
  });
}

export type ConfigValidation =
  | { ok: true }
  | { ok: false; missing: string[] };

/** Required config for the worker to be READY (not just alive). */
export function validateConfig(cfg: WorkerConfig): ConfigValidation {
  const missing: string[] = [];
  if (!cfg.workerSecret) missing.push('SHARE_MEDIA_WORKER_SECRET');
  if (!cfg.supabaseUrl) missing.push('SUPABASE_URL');
  if (!cfg.supabaseServiceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (!cfg.finalizeUrl) missing.push('SHARE_JOBS_FINALIZE_URL');
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Non-secret summary for /ready and logs. NEVER includes keys/secrets. */
export function redactedConfigSummary(cfg: WorkerConfig): Record<string, unknown> {
  return {
    port: cfg.port,
    flags: {
      mediaFallbackEnabled: cfg.mediaFallbackEnabled,
      instagramResolverEnabled: cfg.instagramResolverEnabled,
      nativeVideoAnalysisEnabled: cfg.nativeVideoAnalysisEnabled,
    },
    limits: {
      maxDurationSeconds: cfg.maxDurationSeconds,
      maxDownloadBytes: cfg.maxDownloadBytes,
      downloadTimeoutMs: cfg.downloadTimeoutMs,
      jobTimeoutMs: cfg.jobTimeoutMs,
      maxSelectedFrames: cfg.maxSelectedFrames,
      redirectLimit: cfg.redirectLimit,
      maxConcurrency: cfg.maxConcurrency,
    },
    providers: {
      transcription: cfg.transcriptionProvider,
      analysis: cfg.analysisProvider,
      ocr: cfg.ocrProvider,
    },
    allowedMediaHosts: cfg.allowedMediaHosts,
    hasWorkerSecret: !!cfg.workerSecret,
    hasServiceRoleKey: !!cfg.supabaseServiceRoleKey,
    hasGeminiKey: !!cfg.geminiApiKey,
  };
}
