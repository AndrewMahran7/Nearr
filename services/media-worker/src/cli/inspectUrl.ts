// services/media-worker/src/cli/inspectUrl.ts
//
// LOCAL-ONLY developer inspection CLI. Runs the SAME production media modules
// against ONE input and writes a SANITIZED report. Two mutually-exclusive
// modes:
//
//   npm run media:inspect -- --url  "<https url>"          [--out report.json]
//   npm run media:inspect -- --file "C:\path\to\video.mp4" [--out report.json]
//
// --file lets us test reel CONTENT independently of Instagram's login wall: the
// user supplies a local copy of the video; everything AFTER the download stage
// (ffprobe -> normalize -> audio -> transcription -> frames/dedup -> OCR ->
// model analysis -> Zod validation -> deterministic resolver + Google Places
// verification) reuses the identical modules the worker's runMediaTask() uses.
//
// It NEVER: creates a Supabase client / writes any DB (hosted or local) / calls
// the finalize Edge Function / saves a place / uses cookies / prints signed
// URLs / weakens safeToAutoSave / modifies the user's original file / retains
// downloaded or derived media (temp dir deleted in `finally`).
//
// Genuine-content gate: transcription + the visual model must be REAL (not
// noop/heuristic). Otherwise the tool FAILS CLEARLY with a provider checklist
// and does NOT present a genuine content result.
//
// NOT part of CI. Exit codes: 0 genuine run; 2 cleanly-classified failure
// (retrieval failed / providers not configured); 1 bad usage / unexpected.

import { spawn } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config/env.js';
import { InstagramMediaResolver } from '../resolvers/InstagramMediaResolver.js';
import { selectResolver } from '../resolvers/MediaResolver.js';
import { selectTranscriptionProvider } from '../providers/transcription.js';
import { selectModelProvider } from '../providers/model.js';
import { selectOcrProvider, deduplicateOcrSegments } from '../providers/ocr.js';
import { inspectMedia } from '../pipeline/inspectMedia.js';
import { normalizeMedia } from '../pipeline/normalizeMedia.js';
import { extractAudio } from '../pipeline/extractAudio.js';
import { extractFrames } from '../pipeline/extractFrames.js';
import { deduplicateFrames } from '../pipeline/deduplicateFrames.js';
import { createJobTemp } from '../util/tempDir.js';
import { sanitizeUrlForLog } from '../security/ssrf.js';
import { isMediaError, MediaError, type ResolvedMedia } from '../types/media.js';
import type { MediaPlaceEvidence, PlaceCandidateEvidence, EvidenceItem } from '../types/evidence.js';
import { parseInspectArgs, buildProviderChecklist, type ProviderChecklist } from './inspectSupport.js';
import { prepareLocalFile } from './localFile.js';

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).host || null;
  } catch {
    return null;
  }
}

function classifyRetrieval(code: string): string {
  if (code === 'authentication_required' || code === 'private_or_unavailable') {
    return 'anonymous_public_retrieval_failed';
  }
  return code;
}

function boundedText(s: string, max = 200): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function sanitizeEvidenceItem(e: EvidenceItem) {
  return { timestampSeconds: e.timestampSeconds, source: e.source, value: boundedText(e.value) };
}

function sanitizePlace(p: PlaceCandidateEvidence) {
  return {
    name: boundedText(p.name),
    category: p.category,
    address: p.address,
    city: p.city,
    region: p.region,
    country: p.country,
    coordinatesTrusted: false, // model coords are never trusted downstream
    role: p.role,
    confidence: p.confidence,
    explicitEvidence: p.explicitEvidence.slice(0, 24).map(sanitizeEvidenceItem),
    inferredEvidence: p.inferredEvidence.slice(0, 24).map(sanitizeEvidenceItem),
  };
}

// A street-address pattern used ONLY for the section-7 name-vs-address REPORT
// (mirrors the resolver's address recognition; not a resolver substitute).
const REPORT_ADDRESS_RE =
  /\b\d{1,6}\s+[^,]*\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|hwy|highway|pkwy|parkway|ct|court|ter|terrace|pl|place|cir|circle|plaza|sq|square|paseo|camino|calle|avenida|via|rue)\b/i;

function placeHasExplicitAddress(p: PlaceCandidateEvidence): boolean {
  if (p.address && REPORT_ADDRESS_RE.test(p.address)) return true;
  return p.explicitEvidence.some((e) => REPORT_ADDRESS_RE.test(e.value));
}

/**
 * Section 7: name-driven multi-place readiness, computed from the PROPOSED
 * evidence (no network). Reports how many proposed places carry an explicit
 * street address (verifiable by the current address-only multi path) vs how
 * many would be LOST for lack of an address.
 */
function analyzeNameDrivenMultiPlace(evidence: MediaPlaceEvidence) {
  const explicit = evidence.places.filter((p) => p.explicitEvidence.length > 0 && p.role !== 'passing_mention');
  const withAddress = explicit.filter(placeHasExplicitAddress);
  const withoutAddress = explicit.filter((p) => !placeHasExplicitAddress(p));
  return {
    proposedPlaceNames: explicit.map((p) => boundedText(p.name, 80)),
    distinctProposedPlaces: explicit.length,
    withExplicitStreetAddress: withAddress.length,
    verifiableByCurrentAddressOnlyResolver: withAddress.length,
    lostForLackOfAddress: withoutAddress.map((p) => boundedText(p.name, 80)),
    multipleIntentionalPlaces: evidence.multipleIntentionalPlaces,
    note:
      'The current resolver multi_candidate_confirmation path is ADDRESS-DRIVEN: it ' +
      'iterates evidence.addresses and verifies each by street address. Places named ' +
      'without an explicit street address are not fanned out to per-name Places searches, ' +
      'so they are lost from a multi result.',
  };
}

// ---------------------------------------------------------------------------
// Deterministic-resolver + Google Places verification via the Deno harness
// (real production modules, no Supabase, no save). Only invoked when a
// GOOGLE_PLACES_KEY is present and Deno is installed.
// ---------------------------------------------------------------------------

async function runVerification(
  evidence: MediaPlaceEvidence,
  workDir: string,
): Promise<{ ran: boolean; skippedReason?: string; result?: unknown }> {
  if (!process.env.GOOGLE_PLACES_KEY) {
    return { ran: false, skippedReason: 'no_google_places_key' };
  }
  const harness = path.join(path.dirname(fileURLToPath(import.meta.url)), 'verifyEvidence.deno.ts');
  const evidencePath = path.join(workDir, 'evidence.json');
  await writeFile(evidencePath, JSON.stringify(evidence), 'utf8');

  return await new Promise((resolve) => {
    let stdout = '';
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn('deno', ['run', '--allow-env', '--allow-net', '--allow-read', harness, evidencePath], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch {
      resolve({ ran: false, skippedReason: 'deno_unavailable' });
      return;
    }
    child.on('error', () => resolve({ ran: false, skippedReason: 'deno_unavailable' }));
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.on('close', () => {
      const line = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
      try {
        resolve({ ran: true, result: JSON.parse(line) });
      } catch {
        resolve({ ran: false, skippedReason: 'verification_output_unparseable' });
      }
    });
  });
}

// ---------------------------------------------------------------------------
// Shared analysis pipeline (identical modules to runMediaTask, minus DB claim /
// finalize). Runs for BOTH --url and --file once media is acquired.
// ---------------------------------------------------------------------------

type Providers = {
  transcription: ReturnType<typeof selectTranscriptionProvider>;
  model: ReturnType<typeof selectModelProvider>;
  ocr: ReturnType<typeof selectOcrProvider>;
};

async function analyzeMedia(args: {
  cfg: ReturnType<typeof loadConfig>;
  providers: Providers;
  checklist: ProviderChecklist;
  media: ResolvedMedia;
  workDir: string;
  signal: AbortSignal;
  steps: Record<string, unknown>;
  report: Record<string, unknown>;
}): Promise<number> {
  const { cfg, providers, checklist, media, workDir, signal, steps, report } = args;

  // ffprobe + normalize (mechanical).
  const probe = await inspectMedia(cfg, media.localFilePath, signal);
  steps.inspect = {
    hasVideo: probe.hasVideo,
    hasAudio: probe.hasAudio,
    durationSeconds: probe.durationSeconds,
    container: probe.container,
    videoCodec: probe.videoCodec,
    audioCodec: probe.audioCodec,
    width: probe.width,
    height: probe.height,
    frameRate: probe.frameRate,
  };
  if (Number.isFinite(probe.durationSeconds) && probe.durationSeconds > cfg.maxDurationSeconds) {
    throw new MediaError('duration_too_long', `${Math.round(probe.durationSeconds)}s`);
  }
  const playable = await normalizeMedia(cfg, media.localFilePath, probe, workDir, signal);

  // Frames + dedup (mechanical — safe to report even without a model).
  const rawFrames = await extractFrames(cfg, probe, playable, workDir, signal);
  const frames = deduplicateFrames(rawFrames);
  steps.frames = {
    rawCount: rawFrames.length,
    dedupedCount: frames.length,
    manifest: frames.map((f) => ({
      timestampSeconds: f.timestampSeconds,
      reason: f.reason,
      width: f.width,
      height: f.height,
      aHash: f.aHash,
    })),
  };

  // Genuine-content gate: refuse to present a real content result when the
  // transcription or visual model is noop/heuristic.
  if (!checklist.genuineContentTest) {
    steps.transcript = { skipped: 'providers_not_configured' };
    steps.evidence = { skipped: 'providers_not_configured' };
    steps.verification = { ran: false, skippedReason: 'providers_not_configured' };
    report.result = 'providers_not_configured';
    report.genuineContentTest = false;
    report.note =
      'A GENUINE content test was NOT run: transcription and/or the visual model are ' +
      'noop/heuristic. Media properties + frame timestamps above are mechanical facts; ' +
      'no transcript/visual evidence was produced. Configure the providers below and re-run.';
    return 2;
  }

  // Audio -> transcription.
  const audioPath = await extractAudio(cfg, playable, probe, workDir, signal);
  const transcript = await providers.transcription.transcribe({ audioPath, hasAudio: probe.hasAudio, signal });
  steps.transcript = {
    provider: transcript.provider,
    status: transcript.status,
    reason: transcript.reason ?? null,
    language: transcript.language,
    segmentCount: transcript.segments.length,
    segments: transcript.segments.slice(0, 200).map((s) => ({
      startSeconds: s.startSeconds,
      endSeconds: s.endSeconds,
      text: boundedText(s.text),
    })),
  };

  // Visible text (OCR) -> model analysis (PROPOSED evidence).
  const ocrSegs = deduplicateOcrSegments(await providers.ocr.extract({ frames, signal }));
  steps.visibleText = {
    provider: providers.ocr.name,
    segmentCount: ocrSegs.length,
    segments: ocrSegs.slice(0, 80).map((o) => ({ timestampSeconds: o.timestampSeconds, text: boundedText(o.text), confidence: o.confidence })),
  };

  const analysis = await providers.model.analyze({
    platform: 'instagram',
    canonicalUrl: media.canonicalUrl,
    transcript: transcript.segments,
    ocr: ocrSegs,
    frames,
    signal,
  });
  const explicitPlaces = analysis.evidence.places.filter((p) => p.explicitEvidence.length > 0);
  const inferredOnlyPlaces = analysis.evidence.places.filter((p) => p.explicitEvidence.length === 0);
  steps.evidence = {
    provider: analysis.provider,
    promptVersion: analysis.promptVersion,
    multipleIntentionalPlaces: analysis.evidence.multipleIntentionalPlaces,
    insufficientEvidence: analysis.evidence.insufficientEvidence,
    warnings: analysis.evidence.warnings,
    placeCount: analysis.evidence.places.length,
    explicitMentions: explicitPlaces.map(sanitizePlace),
    inferredOnlyMentions: inferredOnlyPlaces.map(sanitizePlace),
    distinctProposedPlaces: explicitPlaces.filter((p) => p.role !== 'passing_mention').length,
  };
  report.nameDrivenMultiPlace = analyzeNameDrivenMultiPlace(analysis.evidence);

  // Deterministic resolver + Google Places verification (real modules, no save).
  const verification = await runVerification(analysis.evidence, workDir);
  steps.verification = verification;

  report.genuineContentTest = true;
  report.result = analysis.evidence.insufficientEvidence
    ? 'insufficient_evidence'
    : verification.ran
      ? 'evidence_verified'
      : 'evidence_proposed_verification_skipped';
  report.note =
    'Evidence is PROPOSED by the model; verification uses the SAME deterministic resolver + ' +
    'Google Places as production (no save, no Supabase). safeToAutoSave is reported as-is.';
  return 0;
}

async function main(): Promise<number> {
  const parsed = parseInspectArgs(process.argv);
  if (parsed.mode === 'error') {
    console.error(parsed.message);
    return 1;
  }
  const out = parsed.out;

  // --url mode enables the IG resolver for THIS process only (never a hosted
  // flag, never persisted). --file mode needs no resolver flag.
  if (parsed.mode === 'url') process.env.INSTAGRAM_MEDIA_RESOLVER_ENABLED = 'true';
  const cfg = loadConfig();
  const providers: Providers = {
    transcription: selectTranscriptionProvider(cfg),
    model: selectModelProvider(cfg),
    ocr: selectOcrProvider(cfg),
  };
  const checklist = buildProviderChecklist(cfg, (name) => {
    const v = process.env[name];
    return typeof v === 'string' && v.trim().length > 0;
  });

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    tool: 'media:inspect (local-only, no DB / no finalizer / no save)',
    mode: parsed.mode,
    input: parsed.mode === 'url' ? { urlHost: safeHost(parsed.url) } : { fileBasename: path.basename(parsed.file) },
    flags: {
      mediaFallbackEnabled: cfg.mediaFallbackEnabled,
      instagramResolverEnabled: cfg.instagramResolverEnabled,
      nativeVideoAnalysisEnabled: cfg.nativeVideoAnalysisEnabled,
    },
    providers: { transcription: providers.transcription.name, model: providers.model.name, ocr: providers.ocr.name },
    providerChecklist: checklist,
    limits: {
      maxDurationSeconds: cfg.maxDurationSeconds,
      maxDownloadBytes: cfg.maxDownloadBytes,
      maxSelectedFrames: cfg.maxSelectedFrames,
    },
    steps: {} as Record<string, unknown>,
    result: 'unknown',
  };
  const steps = report.steps as Record<string, unknown>;

  const jt = await createJobTemp(cfg.tempDir, 'media-inspect');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.jobTimeoutMs);
  let exitCode = 0;

  try {
    // Acquire media (network download OR local-file copy).
    let media: ResolvedMedia;
    if (parsed.mode === 'url') {
      const resolvers = [new InstagramMediaResolver(cfg)];
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(parsed.url);
      } catch {
        throw new MediaError('unsupported_url', 'bad_url');
      }
      const resolver = selectResolver(resolvers, { platform: 'instagram', url: parsedUrl });
      if (!resolver) throw new MediaError('unsupported_platform', 'instagram');
      steps.resolver = { name: resolver.name, urlSanitized: sanitizeUrlForLog(parsedUrl.toString()) };
      try {
        media = await resolver.resolve({ jobId: 'inspect', sourceUrl: parsed.url, workDir: jt.dir, signal: controller.signal });
      } catch (err) {
        const code = isMediaError(err) ? err.code : 'unknown_error';
        steps.retrieve = {
          ok: false,
          code,
          detail: isMediaError(err) ? err.detail : undefined,
          classification: classifyRetrieval(code),
        };
        report.result = classifyRetrieval(code);
        return 2;
      }
    } else {
      steps.resolver = { name: 'local-file' };
      media = await prepareLocalFile(cfg, parsed.file, jt.dir);
    }
    steps.retrieve = {
      ok: true,
      source: media.source,
      canonicalUrlSanitized: sanitizeUrlForLog(media.canonicalUrl),
      sizeBytes: media.sizeBytes,
      approxSizeMB: Math.round((media.sizeBytes / (1024 * 1024)) * 100) / 100,
      mimeType: media.mimeType,
      warnings: media.warnings,
    };

    exitCode = await analyzeMedia({
      cfg,
      providers,
      checklist,
      media,
      workDir: jt.dir,
      signal: controller.signal,
      steps,
      report,
    });
    return exitCode;
  } catch (err) {
    const code = isMediaError(err) ? err.code : 'unexpected_error';
    const detail = isMediaError(err) ? err.detail : String(err instanceof Error ? err.message : err);
    steps.error = { code, detail: boundedText(String(detail ?? ''), 200) };
    report.result = `error:${code}`;
    return code === 'unexpected_error' ? 1 : 2;
  } finally {
    clearTimeout(timer);
    // Delete the temp COPY, audio, frames, evidence — the user's original file
    // is never touched (we only ever copied FROM it).
    await jt.cleanup();
    report.cleanup = { tempDeleted: true, originalFileModified: false };

    const json = JSON.stringify(report, null, 2);
    if (out) {
      const outPath = path.resolve(process.cwd(), out);
      await mkdir(path.dirname(outPath), { recursive: true }).catch(() => {});
      await writeFile(outPath, json, 'utf8');
      console.log(`[media:inspect] mode=${parsed.mode} result=${String(report.result)} report=${outPath}`);
    } else {
      console.log(json);
    }
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    console.error('[media:inspect] fatal', err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  });
