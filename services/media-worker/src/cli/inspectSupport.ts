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
  /** True only when BOTH transcription AND the visual model are real (not
   *  noop/heuristic) — the two the mission says gate a genuine content test. */
  genuineContentTest: boolean;
  /** True when the deterministic resolver's Google Places verification can run. */
  placesVerificationConfigured: boolean;
  /** Human-readable reasons a genuine test can't run yet (empty when ready). */
  blockers: string[];
};

/** `hasEnv` is injected (defaults to process.env presence) so this is testable
 *  without touching the real environment and never reads a VALUE. */
export function buildProviderChecklist(
  cfg: WorkerConfig,
  hasEnv: (name: string) => boolean,
): ProviderChecklist {
  const transcriptionReal = cfg.transcriptionProvider !== 'noop';
  const visualReal = cfg.analysisProvider === 'gemini' && hasEnv('GEMINI_API_KEY');
  const placesConfigured = hasEnv('GOOGLE_PLACES_KEY');

  const capabilities: ProviderCapability[] = [
    {
      capability: 'transcription',
      provider: cfg.transcriptionProvider,
      configured: transcriptionReal,
      required: true,
      envVars: ['MEDIA_TRANSCRIPTION_PROVIDER (e.g. "openai")', 'MEDIA_TRANSCRIPTION_API_KEY', 'MEDIA_TRANSCRIPTION_MODEL (optional)'],
    },
    {
      capability: 'visual_analysis',
      provider: cfg.analysisProvider,
      configured: visualReal,
      required: true,
      envVars: ['MEDIA_ANALYSIS_PROVIDER=gemini (or set GEMINI_API_KEY)', 'GEMINI_API_KEY', 'GEMINI_MODEL (optional)'],
    },
    {
      capability: 'ocr',
      provider: cfg.ocrProvider,
      configured: cfg.ocrProvider !== 'noop',
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

  const blockers: string[] = [];
  if (!transcriptionReal) blockers.push('transcription provider is noop (set MEDIA_TRANSCRIPTION_PROVIDER + MEDIA_TRANSCRIPTION_API_KEY)');
  if (!visualReal) blockers.push('visual model is heuristic/noop (set GEMINI_API_KEY, MEDIA_ANALYSIS_PROVIDER=gemini)');

  return {
    capabilities,
    genuineContentTest: transcriptionReal && visualReal,
    placesVerificationConfigured: placesConfigured,
    blockers,
  };
}
