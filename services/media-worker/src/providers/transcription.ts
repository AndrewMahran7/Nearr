// services/media-worker/src/providers/transcription.ts
//
// Provider-neutral transcription. Default is `noop` (no transcript) so the
// pipeline works with metadata + frames alone. An OpenAI-compatible provider is
// included behind a key. Transcription failure is NON-FATAL — visual analysis
// still runs (mission requirement).

import { readFile } from 'node:fs/promises';
import type { WorkerConfig } from '../config/env.js';
import type { TranscriptResult, TranscriptSegment } from '../types/media.js';
import { log } from '../util/logger.js';

export type TranscribeInput = {
  audioPath: string | null;
  hasAudio: boolean;
  signal: AbortSignal;
  /** Public source URL (e.g. the reel URL). Required by URL-based providers
   *  like the self-hosted FastAPI service which does its own retrieval. */
  sourceUrl?: string | null;
  /** Platform hint for URL-based providers ('instagram' | 'tiktok' | …). */
  platform?: string | null;
};

export interface TranscriptionProvider {
  readonly name: string;
  transcribe(input: TranscribeInput): Promise<TranscriptResult>;
}

class NoopTranscription implements TranscriptionProvider {
  readonly name = 'noop';
  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    return {
      provider: this.name,
      segments: [],
      language: null,
      status: input.hasAudio ? 'unavailable' : 'no_audio',
      reason: input.hasAudio ? 'no_transcription_provider_configured' : 'no_audio_stream',
    };
  }
}

function normalizeText(t: string): string {
  return t.replace(/\s+/g, ' ').trim();
}

// OpenAI Whisper-compatible: POST the audio file, request verbose_json for
// timestamped segments. Any provider that mirrors this contract works.
class OpenAiTranscription implements TranscriptionProvider {
  readonly name = 'openai';
  constructor(private cfg: WorkerConfig) {}

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    if (!input.hasAudio || !input.audioPath) {
      return { provider: this.name, segments: [], language: null, status: 'no_audio' };
    }
    if (!this.cfg.transcriptionApiKey) {
      return { provider: this.name, segments: [], language: null, status: 'unavailable', reason: 'missing_api_key' };
    }
    try {
      const bytes = await readFile(input.audioPath);
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'audio/wav' }), 'audio.wav');
      form.append('model', this.cfg.transcriptionModel);
      form.append('response_format', 'verbose_json');

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { authorization: `Bearer ${this.cfg.transcriptionApiKey}` },
        body: form,
        signal: input.signal,
      });
      if (!res.ok) {
        // 429/5xx are retryable at the pipeline level, but transcription failure
        // must not fail visual analysis — report failed, keep going.
        return { provider: this.name, segments: [], language: null, status: 'failed', reason: `http_${res.status}` };
      }
      const json = (await res.json()) as {
        language?: string;
        segments?: { start: number; end: number; text: string }[];
        text?: string;
      };
      const segments: TranscriptSegment[] = Array.isArray(json.segments)
        ? json.segments
            .map((s) => ({
              startSeconds: Number(s.start) || 0,
              endSeconds: Number(s.end) || 0,
              text: normalizeText(String(s.text ?? '')),
            }))
            .filter((s) => s.text.length > 0)
        : json.text
          ? [{ startSeconds: 0, endSeconds: 0, text: normalizeText(json.text) }]
          : [];
      return {
        provider: this.name,
        segments,
        language: json.language ?? null,
        status: segments.length ? 'success' : 'unavailable',
      };
    } catch (err) {
      log.warn('transcription_error', { provider: this.name });
      return { provider: this.name, segments: [], language: null, status: 'failed', reason: 'exception' };
    }
  }
}

// Placeholder values shipped in the example env that must NOT be treated as a
// real credential/endpoint.
export const TRANSCRIPTION_PLACEHOLDER_VALUES: ReadonlySet<string> = new Set([
  'api_key',
  'your_api_key',
  'changeme',
  '',
]);

export function selfHostedTranscriptionConfigured(cfg: WorkerConfig): {
  configured: boolean;
  reason?: string;
} {
  const url = (cfg.selfHostedTranscriptionUrl ?? '').trim();
  const key = (cfg.selfHostedTranscriptionApiKey ?? '').trim();
  if (!url) return { configured: false, reason: 'self_hosted_url_not_configured' };
  if (!/^https?:\/\//i.test(url)) return { configured: false, reason: 'self_hosted_url_invalid' };
  if (TRANSCRIPTION_PLACEHOLDER_VALUES.has(key.toLowerCase())) {
    return { configured: false, reason: 'self_hosted_api_key_placeholder' };
  }
  return { configured: true };
}

// URL-oriented self-hosted transcription (the repo's evidence-server FastAPI:
// POST /extract/video-transcript { url, platform } with an X-NEARR-EVIDENCE-KEY
// header). The service does its OWN public retrieval, so it needs the public
// source URL — it does NOT accept local audio bytes. Uses the EXISTING root
// .env config (TRANSCRIPTION_PROVIDER=self_hosted, SELF_HOSTED_TRANSCRIPTION_URL,
// TRANSCRIPTION_SERVICE_API_KEY) surfaced through the worker config bridge. When
// the URL/key are unset or still the example placeholders, it degrades to an
// explicit `unavailable` (never fabricates a transcript).
class SelfHostedTranscription implements TranscriptionProvider {
  readonly name = 'self_hosted';
  constructor(private cfg: WorkerConfig) {}

  async transcribe(input: TranscribeInput): Promise<TranscriptResult> {
    const cfgState = selfHostedTranscriptionConfigured(this.cfg);
    if (!cfgState.configured) {
      return { provider: this.name, segments: [], language: null, status: 'unavailable', reason: cfgState.reason };
    }
    const sourceUrl = (input.sourceUrl ?? '').trim();
    if (!sourceUrl) {
      // --file mode (no public URL) → this URL-based service can't run.
      return { provider: this.name, segments: [], language: null, status: 'unavailable', reason: 'self_hosted_requires_source_url' };
    }

    // Endpoint: append the known path if the operator gave only a base URL.
    const base = this.cfg.selfHostedTranscriptionUrl.trim().replace(/\/+$/, '');
    const endpoint = /\/extract\/video-transcript$/i.test(base)
      ? base
      : `${base}/extract/video-transcript`;

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-NEARR-EVIDENCE-KEY': this.cfg.selfHostedTranscriptionApiKey,
        },
        body: JSON.stringify({ url: sourceUrl, platform: input.platform ?? undefined }),
        signal: input.signal,
      });
      if (!res.ok) {
        return { provider: this.name, segments: [], language: null, status: 'failed', reason: `http_${res.status}` };
      }
      const json = (await res.json()) as {
        transcript?: {
          text?: string;
          language?: string | null;
          segments?: { start: number; end: number; text: string }[];
        };
      };
      const t = json.transcript;
      const segments: TranscriptSegment[] = Array.isArray(t?.segments)
        ? t!.segments
            .map((s) => ({
              startSeconds: Number(s.start) || 0,
              endSeconds: Number(s.end) || 0,
              text: normalizeText(String(s.text ?? '')),
            }))
            .filter((s) => s.text.length > 0)
        : t?.text
          ? [{ startSeconds: 0, endSeconds: 0, text: normalizeText(t.text) }]
          : [];
      return {
        provider: this.name,
        segments,
        language: t?.language ?? null,
        status: segments.length ? 'success' : 'unavailable',
        reason: segments.length ? undefined : 'self_hosted_empty_transcript',
      };
    } catch {
      log.warn('transcription_error', { provider: this.name });
      return { provider: this.name, segments: [], language: null, status: 'failed', reason: 'exception' };
    }
  }
}

export function selectTranscriptionProvider(cfg: WorkerConfig): TranscriptionProvider {
  switch (cfg.transcriptionProvider) {
    case 'openai':
      return new OpenAiTranscription(cfg);
    case 'self_hosted':
      return new SelfHostedTranscription(cfg);
    case 'noop':
    default:
      return new NoopTranscription();
  }
}
