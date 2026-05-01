/**
 * Self-hosted transcription provider.
 *
 * Calls a small backend microservice (see transcription-service/) that
 * uses yt-dlp + ffmpeg + Whisper to produce a transcript from a social
 * video URL. The microservice is the *only* place those heavy binaries
 * run — Supabase Edge Functions cannot host them, and React Native
 * obviously can't either.
 *
 * Architectural rules (carried over from placeholder.ts / soscripted.ts):
 *   - This module MUST NEVER throw. The dispatcher (../index.ts) must be
 *     able to await it unconditionally.
 *   - This module MUST NOT be imported by React Native client code that
 *     ships in the Expo bundle — the API key must stay server-side.
 *   - Fails open: timeouts, non-2xx, parse errors → returns
 *     `{ success: false, error: ... }` and the pipeline degrades to
 *     metadata-only AI extraction.
 *
 * Required env (Node / script side):
 *   SELF_HOSTED_TRANSCRIPTION_URL   Base URL of the FastAPI service. The
 *                                   `/transcribe` path is appended if the
 *                                   value doesn't already end with it.
 *   TRANSCRIPTION_SERVICE_API_KEY   (optional, but recommended) — sent as
 *                                   `x-api-key`. Must match the value the
 *                                   FastAPI service is configured with.
 *
 * Wire-up: set TRANSCRIPTION_PROVIDER=self_hosted to route the dispatcher
 * here.
 */

import type { TranscriptionInput, TranscriptionResult } from '../types';

const PROVIDER_NAME = 'self_hosted';
const LOG = '[transcription:self_hosted]';
// Whisper on a small CPU box can take 20–40s for short clips; allow a
// generous budget here. The Edge Function uses its own (shorter) timeout.
const TIMEOUT_MS = 45_000;

export type SelfHostedTranscript = {
  transcript: string;
  success: boolean;
  error?: string;
};

export async function fetchSelfHostedTranscript(url: string): Promise<SelfHostedTranscript> {
  if (!url || typeof url !== 'string') {
    return { transcript: '', success: false, error: 'invalid_url' };
  }

  const baseUrl = process.env.SELF_HOSTED_TRANSCRIPTION_URL?.trim();
  if (!baseUrl) {
    console.log(`${LOG} TRANSCRIPT_SELF_HOSTED_FAILED reason=missing_endpoint`);
    return { transcript: '', success: false, error: 'missing_endpoint' };
  }
  const endpoint = baseUrl.replace(/\/+$/, '').endsWith('/transcribe')
    ? baseUrl
    : `${baseUrl.replace(/\/+$/, '')}/transcribe`;

  const apiKey = process.env.TRANSCRIPTION_SERVICE_API_KEY?.trim();

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const startedAt = Date.now();

  console.log(`${LOG} TRANSCRIPT_SELF_HOSTED_REQUESTED url=${truncateForLog(url)}`);

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (apiKey) headers['x-api-key'] = apiKey;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const reason = `http_${res.status}`;
      console.log(`${LOG} TRANSCRIPT_SELF_HOSTED_FAILED url=${truncateForLog(url)} reason=${reason}`);
      return { transcript: '', success: false, error: reason };
    }

    const json = (await res.json().catch(() => null)) as
      | { success?: boolean; transcript?: string; error?: string }
      | null;

    if (!json || typeof json !== 'object') {
      console.log(`${LOG} TRANSCRIPT_SELF_HOSTED_FAILED url=${truncateForLog(url)} reason=parse_error`);
      return { transcript: '', success: false, error: 'parse_error' };
    }

    if (json.success && typeof json.transcript === 'string' && json.transcript.trim().length > 0) {
      const transcript = json.transcript.trim();
      console.log(
        `${LOG} TRANSCRIPT_SELF_HOSTED_SUCCESS url=${truncateForLog(url)} length=${transcript.length} ms=${Date.now() - startedAt}`,
      );
      return { transcript, success: true };
    }

    const reason = json.error ?? 'empty_transcript';
    console.log(`${LOG} TRANSCRIPT_SELF_HOSTED_FAILED url=${truncateForLog(url)} reason=${reason}`);
    return { transcript: '', success: false, error: reason };
  } catch (err) {
    const isAbort = (err as Error)?.name === 'AbortError';
    const reason = isAbort ? 'timeout' : ((err as Error)?.message ?? 'unknown_error');
    console.log(
      `${LOG} ${isAbort ? 'TRANSCRIPT_SELF_HOSTED_TIMEOUT' : 'TRANSCRIPT_SELF_HOSTED_FAILED'} url=${truncateForLog(url)} reason=${reason}`,
    );
    return { transcript: '', success: false, error: reason };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adapter to the dispatcher's `TranscriptionResult` contract.
 */
export async function transcribeSocialVideo(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  const r = await fetchSelfHostedTranscript(input.url);
  if (r.success) {
    return { transcript: r.transcript, provider: PROVIDER_NAME, status: 'success' };
  }
  return {
    transcript: null,
    provider: PROVIDER_NAME,
    status: 'failed',
    reason: r.error ?? 'unknown_error',
  };
}

/**
 * Lightweight health check for the self-hosted transcription service.
 * Returns true only when the service is reachable, reports ok=true,
 * and all required binaries (yt-dlp, ffmpeg) are available.
 *
 * Intended for local scripts and pre-flight checks only. The Edge Function
 * has its own inlined equivalent (`selfHostedHealthCheck`).
 * Never throws — returns false on any error.
 */
export async function checkServiceHealth(): Promise<boolean> {
  const baseUrl = process.env.SELF_HOSTED_TRANSCRIPTION_URL?.trim();
  if (!baseUrl) {
    console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_SKIPPED reason=missing_endpoint`);
    return false;
  }
  const endpoint = baseUrl.replace(/\/+$/, '').endsWith('/transcribe')
    ? baseUrl.replace(/\/transcribe$/, '/health')
    : `${baseUrl.replace(/\/+$/, '')}/health`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3_000);
  console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_REQUESTED endpoint=${endpoint}`);
  try {
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_FAILED reason=http_${res.status}`);
      return false;
    }
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; yt_dlp_available?: boolean; ffmpeg_available?: boolean }
      | null;
    if (!body || body.ok !== true) {
      console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_FAILED reason=not_ok`);
      return false;
    }
    if (body.yt_dlp_available === false || body.ffmpeg_available === false) {
      console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_FAILED reason=missing_binaries`);
      return false;
    }
    console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_SUCCESS`);
    return true;
  } catch (err) {
    const reason = (err as Error)?.name === 'AbortError' ? 'timeout' : (err as Error)?.message;
    console.log(`${LOG} TRANSCRIPT_HEALTH_CHECK_FAILED reason=${reason}`);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function truncateForLog(s: string): string {
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}
