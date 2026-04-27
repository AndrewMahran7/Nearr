/**
 * Placeholder transcription provider.
 *
 * Why this exists:
 *   We do NOT currently have a working transcription API key, and there is
 *   no public, documented Choppity / GetTheScript REST API to call. Rather
 *   than hardcode an undocumented endpoint or scrape a third-party UI, we
 *   return an explicit "unavailable" result so calling code can degrade
 *   gracefully.
 *
 * Architectural rules (do not violate):
 *   - This module MUST NEVER throw. Calling code (eval scripts, future
 *     Supabase Edge Function) must be able to await it unconditionally.
 *   - This module MUST NOT be imported by React Native client code that
 *     ships in the Expo bundle. Transcription is server- / script-side
 *     only because real providers will require a secret API key.
 *   - No secrets are read here yet — when a real provider is wired up,
 *     read the key from process.env.TRANSCRIPTION_API_KEY (server only).
 *
 * TODO: future providers (pick ONE when we commit):
 *   - Choppity / GetTheScript style API IF a documented public endpoint
 *     and API key become available. As of writing, none is documented.
 *   - Generic video-download (e.g. yt-dlp on a server) + OpenAI Whisper
 *     ($0.006/min). Requires legal review of TOS for IG/TikTok download.
 *   - Deepgram / AssemblyAI / OpenAI Whisper hosted transcription, fed a
 *     pre-extracted audio URL from a server-side downloader.
 *
 *   Each future provider should live in its own file under
 *   lib/transcription/providers/ and be wired through lib/transcription/index.ts
 *   based on process.env.TRANSCRIPTION_PROVIDER.
 */

import type { TranscriptionInput, TranscriptionResult } from '../types';

const PROVIDER_NAME = 'placeholder';
const LOG = '[transcription:placeholder]';

export async function transcribeSocialVideo(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  // We deliberately read both the provider name and the api key — when a
  // real provider is later configured, the placeholder still won't try to
  // do anything; it will just report "skipped" and the dispatcher in
  // ../index.ts is responsible for routing to the real provider.
  const configuredProvider = process.env.TRANSCRIPTION_PROVIDER?.trim();
  const apiKey = process.env.TRANSCRIPTION_API_KEY?.trim();

  if (!configuredProvider && !apiKey) {
    console.log(
      `${LOG} no provider configured (url=${input.url} source=${input.sourceType ?? 'unknown'})`,
    );
    return {
      transcript: null,
      provider: PROVIDER_NAME,
      status: 'unavailable',
      reason: 'No transcription provider configured',
    };
  }

  // A real provider env var was set, but the placeholder itself can't
  // honor it. The dispatcher should have routed elsewhere; if we got here
  // it means the configured provider isn't implemented yet.
  console.log(
    `${LOG} provider="${configuredProvider ?? ''}" not implemented yet -- skipping`,
  );
  return {
    transcript: null,
    provider: PROVIDER_NAME,
    status: 'skipped',
    reason: `Provider "${configuredProvider ?? 'unknown'}" not implemented yet`,
  };
}
