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

function nonNegativeNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Narrow an env string to the frame-strategy union, falling back to the
 *  default rather than trusting an unrecognized value. */
function frameStrategy(value: string): WorkerConfig['vayrinFrameStrategy'] {
  const v = value.trim().toLowerCase();
  return v === 'uniform' || v === 'pipeline' || v === 'diverse' || v === 'all' ? v : 'diverse';
}

/** Reasoning effort is OMITTED unless explicitly configured, so the model's own
 *  default applies rather than one this repo picked blind. */
function reasoningEffort(value: string): WorkerConfig['vayrinReasoningEffort'] {
  const v = value.trim().toLowerCase();
  return v === 'none' ||
    v === 'low' ||
    v === 'medium' ||
    v === 'high' ||
    v === 'xhigh' ||
    v === 'max'
    ? v
    : undefined;
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
  tiktokResolverEnabled: boolean;
  youtubeResolverEnabled: boolean;
  facebookResolverEnabled: boolean;
  snapchatResolverEnabled: boolean;
  nativeVideoAnalysisEnabled: boolean;

  // ---- Supabase (service-role, used INTERNALLY only) ----
  supabaseUrl: string;
  supabaseServiceRoleKey: string;
  /** process-share-jobs finalize endpoint. Defaults to
   *  `${supabaseUrl}/functions/v1/process-share-jobs`. */
  finalizeUrl: string;
  /** Dedicated bearer for the finalize callback (verifyPlaceEvidence). NOT the
   *  service-role key — independent so a service-role rotation can never
   *  silently break this callback. Required to start. */
  mediaFinalizeSecret: string;

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
  transcriptionProvider: string; // 'noop' | 'openai' | 'self_hosted' (default noop)
  transcriptionApiKey: string;
  transcriptionModel: string;
  /** URL-based self-hosted transcription endpoint (evidence-server FastAPI).
   *  Bridged from the existing root SELF_HOSTED_TRANSCRIPTION_URL. */
  selfHostedTranscriptionUrl: string;
  /** API key for the self-hosted endpoint (root TRANSCRIPTION_SERVICE_API_KEY). */
  selfHostedTranscriptionApiKey: string;
  analysisProvider: string; // 'heuristic' | 'gemini' (default heuristic)
  geminiApiKey: string;
  geminiModel: string;
  ocrProvider: string; // 'noop' | 'model' (default model when a model is configured, else noop)

  // ---- Vayrin visual geolocation (strong-model fallback; default OFF) ----
  // A share whose cheap pass identified no specific place is escalated to a
  // multimodal geolocation call. Deliberately a fallback rather than the first
  // call: it is materially more expensive per share than the default provider.
  //
  // The API key is NOT held here. It is resolved at call time from the
  // environment by `vayrin/visualGeolocationClient.resolveVayrinApiKey`, so it
  // has exactly one reader and cannot be copied into a config summary or a log
  // line by accident.
  vayrinVisualGeolocationEnabled: boolean;
  vayrinModel: string;
  /** Frames sent per call. Capped by maxSelectedFrames. */
  vayrinFrameBudget: number;
  vayrinFrameStrategy: 'uniform' | 'pipeline' | 'diverse' | 'all';
  vayrinReasoningEffort: 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max' | undefined;
  vayrinInputPricePerMillion: number;
  vayrinCachedInputPricePerMillion: number;
  vayrinOutputPricePerMillion: number;

  // ---- Fallback public-media retrieval provider (optional; env-configured) ----
  // A production-grade external public-media fetch service used ONLY when the
  // direct yt-dlp provider can't retrieve public content. Credentials come from
  // env — never hardcoded, never sent to the app. See docs/MEDIA_FALLBACK.md.
  mediaFetchProviderUrl: string;
  mediaFetchProviderApiKey: string;
  mediaFetchProviderAuthHeader: string; // header name for the key (default authorization)
  mediaFetchProviderUrlParam: string; // query param carrying the source URL (default url)
  mediaFetchProviderResultPath: string; // dot-path to the direct media URL in the JSON response

  // ---- External binaries (overridable for local dev) ----
  ytDlpPath: string;
  ffmpegPath: string;
  ffprobePath: string;

  // ---- Temp storage ----
  tempDir: string;
};

// Public video/caption CDNs for every wired platform. HTTPS-only, allowlisted.
// Meta (Instagram + Facebook share the same CDN family), YouTube's video CDN
// (`googlevideo.com`) + caption API (`youtube.com`), and Snapchat's Spotlight
// CDN (`sc-cdn.net`) are all verified live during Phase 3 development. TikTok
// hosts are included for when its extractor is reachable (own webpage/CDN
// hosts are documented publicly) — see docs/MEDIA_FALLBACK.md.
const DEFAULT_ALLOWED_HOSTS = [
  // Instagram + Facebook (Meta) — one shared CDN family. `fb.watch`/
  // `facebook.com` themselves are never a download target (video bytes are
  // always served from `fbcdn.net`; verified live) so they're deliberately
  // NOT added here — the allowlist stays scoped to actual CDN hosts.
  'cdninstagram.com',
  'fbcdn.net',
  'instagram.com',
  // YouTube — video CDN + the `www.youtube.com/api/timedtext` caption
  // endpoint (both verified live).
  'googlevideo.com',
  'youtube.com',
  // TikTok — publicly documented CDN hosts, PLUS `tiktok.com` itself. Added
  // 2026-08-15: a live production sample (7 real TikTok shares) showed
  // `ssrf_blocked`/`host_not_allowlisted` as the dominant media-acquisition
  // failure (3 of 4 downloads that reached this gate) even though yt-dlp's
  // own extractor succeeded. The worker deliberately never logs the blocked
  // host (avoids leaking signed CDN URLs), but yt-dlp's TikTok extractor is
  // publicly documented to serve progressive video from
  // `<region>-webapp[-prime].tiktok.com`, a host none of the entries below
  // cover — the most likely explanation and the smallest safe fix.
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokv.com',
  'tiktokv.us',
  'tiktok.com',
  'muscdn.com',
  // Snapchat Spotlight CDN (verified live).
  'sc-cdn.net',
];

const MB = 1024 * 1024;

export function loadConfig(): WorkerConfig {
  const supabaseUrl = str('SUPABASE_URL');
  const finalizeUrl =
    str('SHARE_JOBS_FINALIZE_URL') ||
    (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1/process-share-jobs` : '');

  const geminiApiKey = str('GEMINI_API_KEY');
  const analysisProvider = str('MEDIA_ANALYSIS_PROVIDER', geminiApiKey ? 'gemini' : 'heuristic');

  // Transcription provider bridge. Prefer the worker-native
  // MEDIA_TRANSCRIPTION_PROVIDER; otherwise interpret the EXISTING app-level
  // TRANSCRIPTION_PROVIDER (self_hosted → URL-based FastAPI; placeholder → noop;
  // soscripted contract is unknown here → noop, never faked).
  const rootTranscriptionProvider = str('TRANSCRIPTION_PROVIDER').toLowerCase();
  const transcriptionProvider = (
    str('MEDIA_TRANSCRIPTION_PROVIDER') ||
    (rootTranscriptionProvider === 'self_hosted'
      ? 'self_hosted'
      : 'noop')
  ).toLowerCase();

  return Object.freeze({
    port: int('PORT', 8090, 1),
    workerSecret: str('SHARE_MEDIA_WORKER_SECRET'),

    mediaFallbackEnabled: bool('MEDIA_FALLBACK_ENABLED', false),
    instagramResolverEnabled: bool('INSTAGRAM_MEDIA_RESOLVER_ENABLED', false),
    tiktokResolverEnabled: bool('TIKTOK_MEDIA_RESOLVER_ENABLED', false),
    youtubeResolverEnabled: bool('YOUTUBE_MEDIA_RESOLVER_ENABLED', false),
    facebookResolverEnabled: bool('FACEBOOK_MEDIA_RESOLVER_ENABLED', false),
    snapchatResolverEnabled: bool('SNAPCHAT_MEDIA_RESOLVER_ENABLED', false),
    nativeVideoAnalysisEnabled: bool('NATIVE_VIDEO_ANALYSIS_ENABLED', false),

    supabaseUrl,
    supabaseServiceRoleKey: str('SUPABASE_SERVICE_ROLE_KEY'),
    finalizeUrl,
    mediaFinalizeSecret: str('MEDIA_FINALIZE_SECRET'),

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

    transcriptionProvider,
    transcriptionApiKey: str('MEDIA_TRANSCRIPTION_API_KEY'),
    transcriptionModel: str('MEDIA_TRANSCRIPTION_MODEL', 'whisper-1'),
    selfHostedTranscriptionUrl: str('SELF_HOSTED_TRANSCRIPTION_URL'),
    selfHostedTranscriptionApiKey: str('TRANSCRIPTION_SERVICE_API_KEY'),
    analysisProvider: analysisProvider.toLowerCase(),
    geminiApiKey,
    // `-latest` alias so a retired pinned model (e.g. the old gemini-1.5-flash)
    // never 404s the analysis. Override with GEMINI_MODEL for a pinned version.
    geminiModel: str('GEMINI_MODEL', 'gemini-flash-latest'),
    ocrProvider: str('MEDIA_OCR_PROVIDER', geminiApiKey ? 'model' : 'noop').toLowerCase(),

    vayrinVisualGeolocationEnabled: bool('VAYRIN_VISUAL_GEOLOCATION_ENABLED', false),
    vayrinModel: str('VAYRIN_MODEL', 'gpt-5.6-sol'),
    vayrinFrameBudget: int('VAYRIN_FRAME_BUDGET', 8, 1),
    vayrinFrameStrategy: frameStrategy(str('VAYRIN_FRAME_STRATEGY', 'diverse')),
    vayrinReasoningEffort: reasoningEffort(str('VAYRIN_REASONING_EFFORT', '')),
    vayrinInputPricePerMillion: nonNegativeNumber('VAYRIN_PRICE_INPUT_PER_MILLION', 5),
    vayrinCachedInputPricePerMillion: nonNegativeNumber('VAYRIN_PRICE_CACHED_INPUT_PER_MILLION', 0.5),
    vayrinOutputPricePerMillion: nonNegativeNumber('VAYRIN_PRICE_OUTPUT_PER_MILLION', 30),

    mediaFetchProviderUrl: str('MEDIA_FETCH_PROVIDER_URL'),
    mediaFetchProviderApiKey: str('MEDIA_FETCH_PROVIDER_API_KEY'),
    mediaFetchProviderAuthHeader: str('MEDIA_FETCH_PROVIDER_AUTH_HEADER', 'authorization'),
    mediaFetchProviderUrlParam: str('MEDIA_FETCH_PROVIDER_URL_PARAM', 'url'),
    mediaFetchProviderResultPath: str('MEDIA_FETCH_PROVIDER_RESULT_PATH', 'url'),

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
  if (!cfg.mediaFinalizeSecret) missing.push('MEDIA_FINALIZE_SECRET');
  if (cfg.transcriptionProvider !== 'openai') missing.push('MEDIA_TRANSCRIPTION_PROVIDER=openai');
  if (!cfg.transcriptionApiKey) missing.push('MEDIA_TRANSCRIPTION_API_KEY');
  if (cfg.analysisProvider !== 'gemini') missing.push('MEDIA_ANALYSIS_PROVIDER=gemini');
  if (!cfg.geminiApiKey) missing.push('GEMINI_API_KEY');
  return missing.length ? { ok: false, missing } : { ok: true };
}

/** Non-secret summary for /ready and logs. NEVER includes keys/secrets. */
export function redactedConfigSummary(cfg: WorkerConfig): Record<string, unknown> {
  return {
    port: cfg.port,
    flags: {
      mediaFallbackEnabled: cfg.mediaFallbackEnabled,
      instagramResolverEnabled: cfg.instagramResolverEnabled,
      tiktokResolverEnabled: cfg.tiktokResolverEnabled,
      youtubeResolverEnabled: cfg.youtubeResolverEnabled,
      facebookResolverEnabled: cfg.facebookResolverEnabled,
      snapchatResolverEnabled: cfg.snapchatResolverEnabled,
      nativeVideoAnalysisEnabled: cfg.nativeVideoAnalysisEnabled,
      vayrinVisualGeolocationEnabled: cfg.vayrinVisualGeolocationEnabled,
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
    vayrin: {
      enabled: cfg.vayrinVisualGeolocationEnabled,
      model: cfg.vayrinModel,
      frameBudget: cfg.vayrinFrameBudget,
      frameStrategy: cfg.vayrinFrameStrategy,
      reasoningEffort: cfg.vayrinReasoningEffort ?? 'model_default',
      pricingUsdPerMillion: {
        input: cfg.vayrinInputPricePerMillion,
        cachedInput: cfg.vayrinCachedInputPricePerMillion,
        output: cfg.vayrinOutputPricePerMillion,
      },
    },
    allowedMediaHosts: cfg.allowedMediaHosts,
    hasWorkerSecret: !!cfg.workerSecret,
    hasServiceRoleKey: !!cfg.supabaseServiceRoleKey,
    hasMediaFinalizeSecret: !!cfg.mediaFinalizeSecret,
    hasGeminiKey: !!cfg.geminiApiKey,
  };
}
