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
import { execFileSync } from 'node:child_process';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadConfig } from '../config/env.js';
import { loadEnvFiles } from '../config/loadEnvFiles.js';
import { InstagramMediaResolver } from '../resolvers/InstagramMediaResolver.js';
import type { MediaResolver } from '../resolvers/MediaResolver.js';
import { HttpMediaFetchResolver, isHttpFetchProviderConfigured } from '../resolvers/HttpMediaFetchResolver.js';
import { classifyRetrievalError, shouldTryFallback, type RetrievalClassification } from '../resolvers/retrievalPolicy.js';
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
import {
  parseInspectArgs,
  buildProviderChecklist,
  buildReadinessLines,
  type ProviderChecklist,
} from './inspectSupport.js';
import { prepareLocalFile } from './localFile.js';

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).host || null;
  } catch {
    return null;
  }
}

/** Sanitized yt-dlp readiness probe (version string is not a secret). */
function checkYtDlp(ytDlpPath: string): { ready: boolean; version: string | null } {
  try {
    const v = execFileSync(ytDlpPath, ['--version'], { timeout: 8000, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return { ready: v.length > 0, version: v || null };
  } catch {
    return { ready: false, version: null };
  }
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
      'Name-driven multi-place verification IS implemented: when ≥2 eligible explicit ' +
      'venue NAMES are present (and there arent ≥2 street addresses), each name is ' +
      'individually searched + scored against Google Places and surfaced as a ' +
      'multi_candidate_confirmation. The address-driven multi path still handles captions ' +
      'that carry ≥2 explicit street addresses. withExplicitStreetAddress counts places the ' +
      'ADDRESS path alone could verify; the rest are now covered by the NAME path.',
  };
}

// ---------------------------------------------------------------------------
// Content + verification breakdown for the report (separates the required
// channels: spoken vs visible vs address vs inferred vs verified vs lost).
// ---------------------------------------------------------------------------

function evidenceItemsBySource(evidence: MediaPlaceEvidence, sources: string[]) {
  const out: { place: string; timestampSeconds: number | null; value: string }[] = [];
  for (const p of evidence.places) {
    for (const e of p.explicitEvidence) {
      if (sources.includes(e.source)) {
        out.push({ place: boundedText(p.name, 80), timestampSeconds: e.timestampSeconds, value: boundedText(e.value) });
      }
    }
  }
  return out;
}

function buildContentBreakdown(evidence: MediaPlaceEvidence) {
  const explicit = evidence.places.filter((p) => p.explicitEvidence.length > 0 && p.role !== 'passing_mention');
  return {
    spokenPlaceMentions: evidenceItemsBySource(evidence, ['speech']),
    visiblePlaceMentions: evidenceItemsBySource(evidence, ['visible_text', 'frame', 'caption']),
    explicitAddresses: evidence.places.flatMap((p) =>
      p.explicitEvidence
        .filter((e) => REPORT_ADDRESS_RE.test(e.value))
        .map((e) => ({ place: boundedText(p.name, 80), value: boundedText(e.value) })),
    ),
    inferredGeographicContext: evidence.places
      .filter((p) => p.city || p.region || p.country)
      .map((p) => ({ place: boundedText(p.name, 80), city: p.city, region: p.region, country: p.country })),
    proposedVenueNames: explicit.map((p) => boundedText(p.name, 80)),
    distinctProposedPlaces: explicit.length,
  };
}

type VerificationOutcome = { ran: boolean; skippedReason?: string; result?: unknown };

function buildVerificationBreakdown(v: VerificationOutcome, evidence: MediaPlaceEvidence) {
  const nameDriven = analyzeNameDrivenMultiPlace(evidence);
  if (!v.ran || !v.result || typeof v.result !== 'object' || (v.result as { ok?: boolean }).ok !== true) {
    return {
      ran: false,
      skippedReason: v.skippedReason ?? (v.result as { reason?: string } | undefined)?.reason ?? 'not_run',
      verifiedCanonicalPlaces: [],
      ambiguousCandidates: 0,
      rejectedCandidates: 'not_surfaced_by_resolver_result',
      placesLostByAddressOnlyResolver: nameDriven.lostForLackOfAddress,
    };
  }
  const r = v.result as {
    decision?: string;
    safeToAutoSave?: boolean;
    confidence?: string;
    candidateCount?: number;
    candidates?: { name: string | null; formattedAddress: string | null; googlePlaceId: string | null; matchScore: number | null }[];
    mentionCount?: number;
    geoContext?: { city: string | null; region: string | null; country: string | null };
    nameDriven?: unknown;
    mentionResults?: {
      mentionId: string | null;
      displayName: string | null;
      outcome: string | null;
      candidates: { name: string | null; formattedAddress: string | null; googlePlaceId: string | null; confidenceScore: number | null }[];
    }[];
  };
  const ambiguous = r.decision === 'multi_candidate_confirmation' || r.decision === 'candidate_picker';
  const mentionResults = Array.isArray(r.mentionResults) ? r.mentionResults : [];
  const verifiedSlots = mentionResults.filter((m) => m.outcome === 'verified_single');
  const ambiguousSlots = mentionResults.filter((m) => m.outcome === 'ambiguous_candidates');
  const noMatchSlots = mentionResults.filter((m) => m.outcome === 'no_match');
  return {
    ran: true,
    decision: r.decision ?? null,
    safeToAutoSave: r.safeToAutoSave === true, // reported as-is; never weakened
    confidence: r.confidence ?? null,
    geoContext: r.geoContext ?? null,
    // Per-mention slots (name-driven multi-place). Each explicit name gets one
    // slot with its own verification outcome + candidates.
    mentionSlots: mentionResults.map((m) => ({
      mentionId: m.mentionId,
      name: m.displayName,
      outcome: m.outcome,
      candidates: (Array.isArray(m.candidates) ? m.candidates : []).map((c) => ({
        name: c.name,
        address: c.formattedAddress,
        googlePlaceId: c.googlePlaceId,
        confidenceScore: c.confidenceScore,
      })),
    })),
    verifiedMentionCount: verifiedSlots.length,
    ambiguousMentionCount: ambiguousSlots.length,
    noMatchMentionCount: noMatchSlots.length,
    verifiedCanonicalPlaces: (r.candidates ?? []).map((c) => ({
      name: c.name,
      address: c.formattedAddress,
      googlePlaceId: c.googlePlaceId,
      matchScore: c.matchScore,
    })),
    ambiguousCandidates: ambiguous ? (r.candidates ?? []).length : 0,
    rejectedCandidates: 'not_surfaced_by_resolver_result',
    placesLostByAddressOnlyResolver: nameDriven.lostForLackOfAddress,
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

  // Audio -> transcription. URL-based providers (self_hosted) receive the
  // public source URL; audio-file providers (openai) use the extracted audio.
  const audioPath = await extractAudio(cfg, playable, probe, workDir, signal);
  const transcript = await providers.transcription.transcribe({
    audioPath,
    hasAudio: probe.hasAudio,
    signal,
    sourceUrl: media.canonicalUrl,
    platform: 'instagram',
  });
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
    modelRawPreview: analysis.modelRawPreview ?? null,
    multipleIntentionalPlaces: analysis.evidence.multipleIntentionalPlaces,
    insufficientEvidence: analysis.evidence.insufficientEvidence,
    warnings: analysis.evidence.warnings,
    placeCount: analysis.evidence.places.length,
    explicitMentions: explicitPlaces.map(sanitizePlace),
    inferredOnlyMentions: inferredOnlyPlaces.map(sanitizePlace),
    distinctProposedPlaces: explicitPlaces.filter((p) => p.role !== 'passing_mention').length,
  };
  report.nameDrivenMultiPlace = analyzeNameDrivenMultiPlace(analysis.evidence);
  report.contentBreakdown = buildContentBreakdown(analysis.evidence);
  // Honest transcription reporting — reflects what ACTUALLY ran, not just the
  // configured capability. A URL-based self-hosted service that isn't
  // configured (or has no source URL) reports its exact reason here.
  report.transcription = {
    provider: transcript.provider,
    status: transcript.status,
    reason: transcript.reason ?? null,
    ran: transcript.status === 'success',
    segmentCount: transcript.segments.length,
  };
  report.transcriptionRan = transcript.status === 'success';
  report.visualAnalysisRan = true;

  // Deterministic resolver + Google Places verification (real modules, no save).
  const verification = await runVerification(analysis.evidence, workDir);
  steps.verification = verification;
  report.verification = buildVerificationBreakdown(verification, analysis.evidence);

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
  // Auto-load server-side provider config from local .env files (deterministic
  // precedence; existing process vars win). No manual key entry per session.
  const envLoad = loadEnvFiles();
  const repoRoot = envLoad.repoRoot;

  // --url mode enables the IG resolver for THIS process only (never a hosted
  // flag, never persisted). --file mode needs no resolver flag.
  if (parsed.mode === 'url') process.env.INSTAGRAM_MEDIA_RESOLVER_ENABLED = 'true';
  const cfg = loadConfig();
  const providers: Providers = {
    transcription: selectTranscriptionProvider(cfg),
    model: selectModelProvider(cfg),
    ocr: selectOcrProvider(cfg),
  };
  const hasEnv = (name: string) => {
    const v = process.env[name];
    return typeof v === 'string' && v.trim().length > 0;
  };
  const checklist = buildProviderChecklist(cfg, hasEnv);

  // Retrieval readiness: direct yt-dlp + optional configured fallback provider.
  const yt = checkYtDlp(cfg.ytDlpPath);
  const fallbackConfigured = isHttpFetchProviderConfigured(cfg);
  const retrievalName = fallbackConfigured ? 'yt-dlp + http-fallback' : 'yt-dlp';
  const readinessLines = buildReadinessLines(checklist, { name: retrievalName, ready: yt.ready || fallbackConfigured });

  // A single command writes a sanitized report even without --out.
  const out =
    parsed.out ??
    path.join(repoRoot, '.tmp', 'phase2-reel-test', `media-inspect-${parsed.mode}-${Date.now()}.json`);

  // Sanitized readiness summary (NEVER values).
  for (const line of readinessLines) console.log(`[media:inspect] ${line}`);
  if (yt.version) console.log(`[media:inspect] yt-dlp version: ${yt.version}`);
  if (checklist.missingRequired.length > 0) {
    console.log('[media:inspect] MISSING required configuration:');
    for (const m of checklist.missingRequired) {
      console.log(`  - ${m.capability}: set one of ${m.envVars.join(' | ')}`);
    }
    console.log(
      `  checked env files: ${envLoad.checked
        .map((c) => `${path.basename(path.dirname(c.path))}/${path.basename(c.path)}[${c.exists ? 'found' : 'absent'}]`)
        .join(', ')}`,
    );
  }

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
    envAutoLoad: {
      checkedFiles: envLoad.checked.map((c) => ({
        file: `${path.basename(path.dirname(c.path))}/${path.basename(c.path)}`,
        exists: c.exists,
        loadedKeys: c.loadedKeys,
      })),
    },
    readiness: readinessLines,
    retrieval: { direct: 'yt-dlp', ytDlpVersion: yt.version, fallbackProviderConfigured: fallbackConfigured },
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
      let parsedUrl: URL;
      try {
        parsedUrl = new URL(parsed.url);
      } catch {
        throw new MediaError('unsupported_url', 'bad_url');
      }
      // Ordered providers: direct yt-dlp first, then a configured public-media
      // fallback provider. Both go through the same SSRF/limits/cleanup path.
      const ordered: MediaResolver[] = [new InstagramMediaResolver(cfg)];
      if (isHttpFetchProviderConfigured(cfg)) ordered.push(new HttpMediaFetchResolver(cfg));
      const supporting = ordered.filter((r) => r.supports({ platform: 'instagram', url: parsedUrl }));
      if (supporting.length === 0) throw new MediaError('unsupported_platform', 'instagram');

      const attempts: { provider: string; ok: boolean; code?: string; classification?: RetrievalClassification }[] = [];
      let acquired: ResolvedMedia | null = null;
      for (const r of supporting) {
        try {
          acquired = await r.resolve({ jobId: 'inspect', sourceUrl: parsed.url, workDir: jt.dir, signal: controller.signal });
          attempts.push({ provider: r.name, ok: true });
          break;
        } catch (err) {
          const code = isMediaError(err) ? err.code : 'unknown_error';
          const detail = isMediaError(err) ? err.detail : undefined;
          const classification = classifyRetrievalError(code, detail);
          attempts.push({ provider: r.name, ok: false, code, classification });
          if (!shouldTryFallback(classification)) break; // don't fall back on unsupported/oversized/too-long
        }
      }
      steps.retrieveAttempts = attempts;
      if (!acquired) {
        const last = attempts[attempts.length - 1];
        const classification = last?.classification ?? 'transient_retrieval_failure';
        steps.retrieve = { ok: false, classification, attempts };
        report.result = classification;
        return 2;
      }
      media = acquired;
    } else {
      steps.resolver = { name: 'local-file' };
      media = await prepareLocalFile(cfg, parsed.file, jt.dir);
    }
    steps.retrieve = {
      ok: true,
      classification: parsed.mode === 'url' ? 'retrieved_publicly' : 'local_file',
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
