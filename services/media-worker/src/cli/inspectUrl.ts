// services/media-worker/src/cli/inspectUrl.ts
//
// LOCAL-ONLY developer inspection CLI. Runs the SAME production media modules
// (config → Instagram resolver → SSRF-guarded download → ffprobe → normalize →
// audio → transcription → frames → dedup → OCR → model analysis → Zod evidence
// validation) against ONE real public URL and writes a SANITIZED report.
//
// It NEVER:
//   - creates a Supabase client or writes to any database (hosted or local)
//   - calls the process-share-jobs finalizer / any Edge Function
//   - creates a saved place
//   - uses cookies, a login, or a private-content bypass
//   - prints signed CDN URLs or query tokens (URLs are sanitized)
//   - retains the downloaded media (temp dir is deleted in `finally`)
//
// It does NOT duplicate pipeline logic — it calls the identical modules the
// worker's runMediaTask() uses, minus the DB claim/finalize.
//
// Usage (from services/media-worker):
//   npm run media:inspect -- --url "<https url>" [--out <report.json>]
//
// NOT part of CI: it depends on live Instagram availability. Exit codes:
//   0  retrieved + analyzed
//   2  cleanly-classified retrieval/analysis failure (e.g. login required)
//   1  bad usage / unexpected error

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

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
import type { PlaceCandidateEvidence, EvidenceItem } from '../types/evidence.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function safeHost(raw: string): string | null {
  try {
    return new URL(raw).host || null;
  } catch {
    return null;
  }
}

/** Map a resolver error code to the report's top-level result classification. */
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
    // Model coordinates are NEVER trusted downstream — omitted from the report.
    coordinatesTrusted: false,
    role: p.role,
    confidence: p.confidence,
    explicitEvidence: p.explicitEvidence.slice(0, 24).map(sanitizeEvidenceItem),
    inferredEvidence: p.inferredEvidence.slice(0, 24).map(sanitizeEvidenceItem),
  };
}

async function main(): Promise<number> {
  const url = arg('url');
  const out = arg('out');
  if (!url) {
    console.error('Usage: npm run media:inspect -- --url "<https url>" [--out <report.json>]');
    return 1;
  }

  // LOCAL-ONLY: enable the Instagram resolver for THIS process only. This never
  // writes any hosted/production flag and never persists anywhere.
  process.env.INSTAGRAM_MEDIA_RESOLVER_ENABLED = 'true';
  const cfg = loadConfig();

  const resolvers = [new InstagramMediaResolver(cfg)];
  const transcription = selectTranscriptionProvider(cfg);
  const model = selectModelProvider(cfg);
  const ocr = selectOcrProvider(cfg);

  const report: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    tool: 'media:inspect (local-only, no DB / no finalizer / no save)',
    input: { urlHost: safeHost(url) },
    flags: {
      mediaFallbackEnabled: cfg.mediaFallbackEnabled,
      instagramResolverEnabled: cfg.instagramResolverEnabled,
      nativeVideoAnalysisEnabled: cfg.nativeVideoAnalysisEnabled,
    },
    providers: { transcription: transcription.name, model: model.name, ocr: ocr.name },
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
    // 1) URL normalization + resolver selection (production modules).
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new MediaError('unsupported_url', 'bad_url');
    }
    steps.normalize = { ok: true, urlSanitized: sanitizeUrlForLog(parsed.toString()) };
    const resolver = selectResolver(resolvers, { platform: 'instagram', url: parsed });
    if (!resolver) throw new MediaError('unsupported_platform', 'instagram');
    steps.resolver = { name: resolver.name };

    // 2) Anonymous public retrieval (yt-dlp -j metadata + SSRF-guarded download).
    let media: ResolvedMedia;
    try {
      media = await resolver.resolve({
        jobId: 'inspect',
        sourceUrl: url,
        workDir: jt.dir,
        signal: controller.signal,
      });
    } catch (err) {
      const code = isMediaError(err) ? err.code : 'unknown_error';
      const detail = isMediaError(err) ? err.detail : undefined;
      steps.retrieve = { ok: false, code, detail, classification: classifyRetrieval(code) };
      report.result = classifyRetrieval(code);
      return 2;
    }
    steps.retrieve = {
      ok: true,
      source: media.source,
      canonicalUrlSanitized: sanitizeUrlForLog(media.canonicalUrl),
      sizeBytes: media.sizeBytes,
      approxSizeMB: Math.round((media.sizeBytes / (1024 * 1024)) * 100) / 100,
      durationSeconds: media.durationSeconds ?? null,
      mimeType: media.mimeType,
      warnings: media.warnings,
    };

    // 3) ffprobe inspect + (conditional) normalize.
    const probe = await inspectMedia(cfg, media.localFilePath, controller.signal);
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
    const playable = await normalizeMedia(cfg, media.localFilePath, probe, jt.dir, controller.signal);

    // 4) Audio → transcription (non-fatal).
    const audioPath = await extractAudio(cfg, playable, probe, jt.dir, controller.signal);
    const transcript = await transcription.transcribe({
      audioPath,
      hasAudio: probe.hasAudio,
      signal: controller.signal,
    });
    steps.transcript = {
      provider: transcript.provider,
      status: transcript.status,
      reason: transcript.reason ?? null,
      language: transcript.language,
      segmentCount: transcript.segments.length,
      segments: transcript.segments.slice(0, 80).map((s) => ({
        startSeconds: s.startSeconds,
        endSeconds: s.endSeconds,
        text: boundedText(s.text),
      })),
    };

    // 5) Frames + perceptual dedup.
    const rawFrames = await extractFrames(cfg, probe, playable, jt.dir, controller.signal);
    const frames = deduplicateFrames(rawFrames);
    steps.frames = {
      rawCount: rawFrames.length,
      dedupedCount: frames.length,
      // Manifest = timestamps + selection reason + hash only (no image data).
      manifest: frames.map((f) => ({
        timestampSeconds: f.timestampSeconds,
        reason: f.reason,
        width: f.width,
        height: f.height,
        aHash: f.aHash,
      })),
    };

    // 6) Visible text (OCR provider) + 7) model analysis → PROPOSED evidence.
    const ocrSegs = deduplicateOcrSegments(await ocr.extract({ frames, signal: controller.signal }));
    steps.ocr = { provider: ocr.name, segmentCount: ocrSegs.length };
    const analysis = await model.analyze({
      platform: 'instagram',
      canonicalUrl: media.canonicalUrl,
      transcript: transcript.segments,
      ocr: ocrSegs,
      frames,
      signal: controller.signal,
    });
    steps.evidence = {
      provider: analysis.provider,
      promptVersion: analysis.promptVersion,
      multipleIntentionalPlaces: analysis.evidence.multipleIntentionalPlaces,
      insufficientEvidence: analysis.evidence.insufficientEvidence,
      warnings: analysis.evidence.warnings,
      placeCount: analysis.evidence.places.length,
      places: analysis.evidence.places.map(sanitizePlace),
    };
    report.result = analysis.evidence.insufficientEvidence ? 'insufficient_evidence' : 'evidence_proposed';
    report.note =
      'Evidence is PROPOSED only. Google Places verification + safeToAutoSave run in the ' +
      'Deno finalizer (process-share-jobs), which this local inspection deliberately does not call.';
    return 0;
  } catch (err) {
    const code = isMediaError(err) ? err.code : 'unexpected_error';
    const detail = isMediaError(err) ? err.detail : String(err instanceof Error ? err.message : err);
    steps.error = { code, detail: boundedText(String(detail ?? ''), 200) };
    report.result = `error:${code}`;
    exitCode = code === 'unexpected_error' ? 1 : 2;
    return exitCode;
  } finally {
    clearTimeout(timer);
    // Delete the downloaded video/audio/frames — nothing is retained.
    await jt.cleanup();
    report.cleanup = { tempDeleted: true };

    const json = JSON.stringify(report, null, 2);
    if (out) {
      const outPath = path.resolve(process.cwd(), out);
      await mkdir(path.dirname(outPath), { recursive: true }).catch(() => {});
      await writeFile(outPath, json, 'utf8');
      console.log(`[media:inspect] result=${String(report.result)} report=${outPath}`);
    } else {
      // No --out: emit the JSON on stdout (may interleave with worker log lines).
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
