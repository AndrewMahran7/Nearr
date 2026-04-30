/**
 * SoScripted transcription provider.
 *
 * Calls https://soscripted.com/transcript-api to obtain a transcript for a
 * social video URL (TikTok / Instagram). This is the first real provider
 * wired into the share-save fallback flow.
 *
 * Architectural rules (carried over from placeholder.ts):
 *   - This module MUST NEVER throw. The dispatcher (../index.ts) must be
 *     able to await it unconditionally.
 *   - This module MUST NOT be imported by React Native client code that
 *     ships in the Expo bundle — the API key (when used) must stay
 *     server-side. It is intended for evaluation scripts and (mirrored
 *     inline) the Supabase Edge Function.
 *
 * Assumptions about the SoScripted API (no public OpenAPI spec at the time
 * of integration):
 *   - HTTP POST to https://soscripted.com/transcript-api
 *   - JSON body: { "url": "<social video url>" }
 *   - Optional bearer auth via SOSCRIPTED_API_KEY (sent as
 *     `Authorization: Bearer <key>`) when set.
 *   - Response JSON shape (any of these is accepted, in priority order):
 *       { transcript: string }
 *       { text: string }
 *       { data: { transcript: string } }
 *       { result: { transcript: string } }
 *
 * If the response shape diverges, this provider returns
 * `{ success: false, error: 'unrecognized_response' }` and the pipeline
 * degrades gracefully.
 */

import type { TranscriptionInput, TranscriptionResult } from '../types';

const PROVIDER_NAME = 'soscripted';
const LOG = '[transcription:soscripted]';
const ENDPOINT = 'https://soscripted.com/transcript-api';
const TIMEOUT_MS = 7000; // 5–8s budget per spec; the share flow must stay snappy.

/**
 * Slim, well-typed return shape required by the task spec.
 * The dispatcher adapts this into the broader `TranscriptionResult` contract.
 */
export type SoScriptedTranscript = {
  transcript: string;
  success: boolean;
  error?: string;
};

/**
 * Low-level call to SoScripted. Never throws.
 *
 * Used directly by evaluation scripts that want the simple shape, and
 * adapted by `transcribeSocialVideo` below for the dispatcher contract.
 */
export async function fetchSoScriptedTranscript(url: string): Promise<SoScriptedTranscript> {
  if (!url || typeof url !== 'string') {
    return { transcript: '', success: false, error: 'invalid_url' };
  }

  const apiKey = process.env.SOSCRIPTED_API_KEY?.trim();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  const startedAt = Date.now();
  console.log(`${LOG} TRANSCRIPT_REQUESTED url=${truncateForLog(url)}`);

  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      accept: 'application/json',
    };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;

    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify({ url }),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const reason = `http_${res.status}`;
      console.log(`${LOG} TRANSCRIPT_FAILED url=${truncateForLog(url)} reason=${reason}`);
      return { transcript: '', success: false, error: reason };
    }

    const json = (await res.json()) as unknown;
    const transcript = pickTranscript(json);

    if (!transcript) {
      console.log(
        `${LOG} TRANSCRIPT_FAILED url=${truncateForLog(url)} reason=unrecognized_response`,
      );
      return { transcript: '', success: false, error: 'unrecognized_response' };
    }

    console.log(
      `${LOG} TRANSCRIPT_SUCCESS url=${truncateForLog(url)} length=${transcript.length} ms=${Date.now() - startedAt}`,
    );
    return { transcript, success: true };
  } catch (err) {
    const message = (err as Error)?.name === 'AbortError' ? 'timeout' : ((err as Error)?.message ?? 'unknown_error');
    console.log(`${LOG} TRANSCRIPT_FAILED url=${truncateForLog(url)} reason=${message}`);
    return { transcript: '', success: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Adapter to the dispatcher's `TranscriptionResult` contract so this
 * provider can be selected from `lib/transcription/index.ts` based on
 * `TRANSCRIPTION_PROVIDER=soscripted`.
 */
export async function transcribeSocialVideo(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  const r = await fetchSoScriptedTranscript(input.url);
  if (r.success) {
    return {
      transcript: r.transcript,
      provider: PROVIDER_NAME,
      status: 'success',
    };
  }
  return {
    transcript: null,
    provider: PROVIDER_NAME,
    status: 'failed',
    reason: r.error ?? 'unknown_error',
  };
}

function pickTranscript(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const candidates: Array<unknown> = [
    j.transcript,
    j.text,
    (j.data as Record<string, unknown> | undefined)?.transcript,
    (j.data as Record<string, unknown> | undefined)?.text,
    (j.result as Record<string, unknown> | undefined)?.transcript,
    (j.result as Record<string, unknown> | undefined)?.text,
  ];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return null;
}

function truncateForLog(s: string): string {
  return s.length > 120 ? s.slice(0, 117) + '...' : s;
}
