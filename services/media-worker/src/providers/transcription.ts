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

export function selectTranscriptionProvider(cfg: WorkerConfig): TranscriptionProvider {
  switch (cfg.transcriptionProvider) {
    case 'openai':
      return new OpenAiTranscription(cfg);
    case 'noop':
    default:
      return new NoopTranscription();
  }
}
