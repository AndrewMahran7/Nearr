// services/media-worker/src/cli/inspectSupport.ts
//
// PURE helpers for the media:inspect CLI (arg parsing, local-file validation,
// provider readiness checklist). No I/O, no process spawning — unit-testable so
// the CLI's decisions are deterministic and don't depend on a real video / keys.

import type { WorkerConfig } from '../config/env.js';

// ---------------------------------------------------------------------------
// Arg parsing — --url and --file are MUTUALLY EXCLUSIVE.
// ---------------------------------------------------------------------------

export type InspectArgs =
  | { mode: 'url'; url: string; out?: string }
  | { mode: 'file'; file: string; out?: string }
  | { mode: 'error'; message: string };

function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  // Treat a missing value or another flag as "present but empty".
  return v === undefined || v.startsWith('--') ? '' : v;
}

export function parseInspectArgs(argv: string[]): InspectArgs {
  const url = flag(argv, 'url');
  const file = flag(argv, 'file');
  const out = flag(argv, 'out') || undefined;

  const hasUrl = url !== undefined;
  const hasFile = file !== undefined;

  if (hasUrl && hasFile) {
    return { mode: 'error', message: '--url and --file are mutually exclusive; pass exactly one.' };
  }
  if (!hasUrl && !hasFile) {
    return {
      mode: 'error',
      message:
        'Usage: npm run media:inspect -- (--url "<https url>" | --file "<path to video>") [--out <report.json>]',
    };
  }
  if (hasUrl) {
    if (!url) return { mode: 'error', message: '--url requires a value.' };
    return { mode: 'url', url, out };
  }
  if (!file) return { mode: 'error', message: '--file requires a value.' };
  return { mode: 'file', file, out };
}

// ---------------------------------------------------------------------------
// Local-file validation (pure classifier — the CLI performs the fs.stat and
// passes the facts in).
// ---------------------------------------------------------------------------

/** Video containers ffprobe/ffmpeg can inspect. Lowercase, dot-prefixed. */
export const SUPPORTED_VIDEO_EXTENSIONS = [
  '.mp4',
  '.mov',
  '.m4v',
  '.webm',
  '.mkv',
  '.avi',
] as const;

export function fileExtension(p: string): string {
  const base = p.replace(/[\\/]+$/, '');
  const dot = base.lastIndexOf('.');
  const slash = Math.max(base.lastIndexOf('/'), base.lastIndexOf('\\'));
  if (dot <= slash) return '';
  return base.slice(dot).toLowerCase();
}

export function isSupportedVideoExtension(ext: string): boolean {
  return (SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(ext.toLowerCase());
}

export type VideoFileFacts = {
  exists: boolean;
  isDirectory: boolean;
  isFile: boolean;
  sizeBytes: number;
  ext: string;
};

export type VideoFileValidation =
  | { ok: true; sizeBytes: number; ext: string }
  | {
      ok: false;
      reason: 'not_found' | 'is_directory' | 'not_a_regular_file' | 'unsupported_type' | 'empty' | 'too_large';
    };

/** Validate a local video path against the production limits. Pure. */
export function classifyVideoFile(facts: VideoFileFacts, maxBytes: number): VideoFileValidation {
  if (!facts.exists) return { ok: false, reason: 'not_found' };
  if (facts.isDirectory) return { ok: false, reason: 'is_directory' };
  if (!facts.isFile) return { ok: false, reason: 'not_a_regular_file' };
  if (!isSupportedVideoExtension(facts.ext)) return { ok: false, reason: 'unsupported_type' };
  if (facts.sizeBytes <= 0) return { ok: false, reason: 'empty' };
  if (facts.sizeBytes > maxBytes) return { ok: false, reason: 'too_large' };
  return { ok: true, sizeBytes: facts.sizeBytes, ext: facts.ext };
}

export function mimeForExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.mp4':
    case '.m4v':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.webm':
      return 'video/webm';
    case '.mkv':
      return 'video/x-matroska';
    case '.avi':
      return 'video/x-msvideo';
    default:
      return 'application/octet-stream';
  }
}

// ---------------------------------------------------------------------------
// Provider readiness checklist. Reports which env VARS (names only, never
// values) are needed for each capability and whether each is currently
// configured. EXPO_PUBLIC_* variables are intentionally NOT consulted for this
// server-side tool.
// ---------------------------------------------------------------------------

export type ProviderCapability = {
  capability: 'transcription' | 'visual_analysis' | 'ocr' | 'google_places_verification';
  provider: string;
  /** Whether this capability is configured with a REAL provider (not noop). */
  configured: boolean;
  /** Whether a genuine content test REQUIRES this capability. */
  required: boolean;
  /** Env var NAMES the operator must set (never values). */
  envVars: string[];
};

export type ProviderChecklist = {
  capabilities: ProviderCapability[];
  transcriptionReady: boolean;
  visualReady: boolean;
  placesVerificationConfigured: boolean;
  ocrReady: boolean;
  /**
   * A genuine multimodal CONTENT test can run when the visual model is real
   * (Gemini reads the frames directly). Transcription is additive (adds spoken
   * mentions) but not required, since the multimodal model already extracts
   * on-screen place names from frames.
   */
  genuineContentTest: boolean;
  /** REQUIRED capabilities that are still missing, with the exact env var names. */
  missingRequired: { capability: string; envVars: string[] }[];
  /** Human-readable reasons a genuine test can't run yet (empty when ready). */
  blockers: string[];
};

/** Whether the configured transcription provider is actually usable. A bare
 *  provider NAME is not enough: openai needs a key; self_hosted needs a real
 *  https endpoint URL and a non-placeholder key. */
export function isTranscriptionConfigured(cfg: WorkerConfig): boolean {
  const PLACEHOLDERS = new Set(['api_key', 'your_api_key', 'changeme', '']);
  switch (cfg.transcriptionProvider) {
    case 'openai':
      return !!(cfg.transcriptionApiKey && cfg.transcriptionApiKey.trim());
    case 'self_hosted':
      return (
        !!cfg.selfHostedTranscriptionUrl &&
        /^https?:\/\//i.test(cfg.selfHostedTranscriptionUrl) &&
        !PLACEHOLDERS.has((cfg.selfHostedTranscriptionApiKey || '').trim().toLowerCase())
      );
    default:
      return false;
  }
}

/** `hasEnv` is injected (defaults to process.env presence) so this is testable
 *  without touching the real environment and never reads a VALUE. */
export function buildProviderChecklist(
  cfg: WorkerConfig,
  hasEnv: (name: string) => boolean,
): ProviderChecklist {
  const transcriptionReal = isTranscriptionConfigured(cfg);
  const visualReal = cfg.analysisProvider === 'gemini' && hasEnv('GEMINI_API_KEY');
  const placesConfigured = hasEnv('GOOGLE_PLACES_KEY');
  const ocrReal = cfg.ocrProvider !== 'noop';

  const capabilities: ProviderCapability[] = [
    {
      capability: 'transcription',
      provider: cfg.transcriptionProvider,
      configured: transcriptionReal,
      required: false, // additive: adds SPOKEN mentions; visual model still runs without it
      envVars: [
        'MEDIA_TRANSCRIPTION_PROVIDER (openai) + MEDIA_TRANSCRIPTION_API_KEY',
        'or TRANSCRIPTION_PROVIDER=self_hosted + SELF_HOSTED_TRANSCRIPTION_URL + TRANSCRIPTION_SERVICE_API_KEY',
      ],
    },
    {
      capability: 'visual_analysis',
      provider: cfg.analysisProvider,
      configured: visualReal,
      required: true, // the multimodal model IS the genuine content test
      envVars: ['GEMINI_API_KEY', 'MEDIA_ANALYSIS_PROVIDER=gemini (auto when GEMINI_API_KEY is set)', 'GEMINI_MODEL (optional)'],
    },
    {
      capability: 'ocr',
      provider: cfg.ocrProvider,
      configured: ocrReal,
      required: false,
      envVars: ['MEDIA_OCR_PROVIDER (optional; default noop — the visual model reads frames)'],
    },
    {
      capability: 'google_places_verification',
      provider: placesConfigured ? 'google_places' : 'noop',
      configured: placesConfigured,
      required: false, // required for the verify step, not for evidence extraction
      envVars: ['GOOGLE_PLACES_KEY (server-side; EXPO_PUBLIC_* is intentionally ignored here)'],
    },
  ];

  const missingRequired = capabilities
    .filter((c) => c.required && !c.configured)
    .map((c) => ({ capability: c.capability, envVars: c.envVars }));

  const blockers: string[] = [];
  if (!visualReal) blockers.push('visual model is heuristic/noop — set GEMINI_API_KEY (MEDIA_ANALYSIS_PROVIDER=gemini is automatic)');

  return {
    capabilities,
    transcriptionReady: transcriptionReal,
    visualReady: visualReal,
    placesVerificationConfigured: placesConfigured,
    ocrReady: ocrReal,
    genuineContentTest: visualReal,
    missingRequired,
    blockers,
  };
}

/** Sanitized one-line readiness summary (NEVER values). `retrievalReady` /
 *  `retrievalName` come from the CLI (yt-dlp availability + fallback provider). */
export function buildReadinessLines(
  checklist: ProviderChecklist,
  retrieval: { name: string; ready: boolean },
): string[] {
  const t = checklist.capabilities.find((c) => c.capability === 'transcription')!;
  const v = checklist.capabilities.find((c) => c.capability === 'visual_analysis')!;
  const state = (ok: boolean) => (ok ? 'ready' : 'not configured');
  return [
    `media retrieval: ${retrieval.name} / ${state(retrieval.ready)}`,
    `transcription: ${t.provider} / ${checklist.transcriptionReady ? 'ready' : 'not configured (spoken mentions will be skipped)'}`,
    `visual analysis: ${v.provider} / ${state(checklist.visualReady)}`,
    `places verification: ${state(checklist.placesVerificationConfigured)}`,
  ];
}
