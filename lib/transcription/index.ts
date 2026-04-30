/**
 * Transcription dispatcher.
 *
 * Public entry point for callers that want a transcript of a social video
 * for the share-save fallback flow. Today this only routes to the
 * placeholder provider — no real transcription provider is integrated.
 *
 * Usage (server / script side ONLY):
 *
 *   import { transcribeSocialVideo } from '@/lib/transcription';
 *   const result = await transcribeSocialVideo({ url, sourceType: 'instagram' });
 *   if (result.status === 'success' && result.transcript) {
 *     // feed result.transcript into extractPlaceAI(...)
 *   }
 *
 * IMPORTANT: do NOT import this from React Native client code. A real
 * provider requires a secret TRANSCRIPTION_API_KEY which must never ship
 * in the Expo bundle. In production the share screen should call a
 * Supabase Edge Function that wraps this module.
 */

import type { TranscriptionInput, TranscriptionResult } from './types';
import { transcribeSocialVideo as placeholderTranscribe } from './providers/placeholder';
import { transcribeSocialVideo as soscriptedTranscribe } from './providers/soscripted';
import { transcribeSocialVideo as selfHostedTranscribe } from './providers/selfHosted';

export type {
  TranscriptionInput,
  TranscriptionResult,
  TranscriptionStatus,
  TranscriptionSourceType,
} from './types';

const LOG = '[transcription]';

export async function transcribeSocialVideo(
  input: TranscriptionInput,
): Promise<TranscriptionResult> {
  if (!input.url || typeof input.url !== 'string') {
    console.log(`${LOG} invalid input -- skipping`);
    return {
      transcript: null,
      provider: 'none',
      status: 'skipped',
      reason: 'Missing url',
    };
  }

  const provider = process.env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();

  try {
    // Real providers go here. Each must never throw — they own their own
    // timeouts and graceful failure handling.
    if (provider === 'soscripted') {
      return await soscriptedTranscribe(input);
    }
    if (provider === 'self_hosted') {
      return await selfHostedTranscribe(input);
    }
    // TODO: future providers (whisper / deepgram / assemblyai) — wire by
    // adding another `if (provider === '...')` branch.

    // Default: the placeholder, which returns status="unavailable" when
    // nothing is configured and never throws.
    return await placeholderTranscribe(input);
  } catch (err) {
    // Defensive: providers should never throw, but the contract here is
    // strict — callers must be able to await without try/catch.
    console.log(`${LOG} provider="${provider ?? 'placeholder'}" threw (defensive catch):`, err);
    return {
      transcript: null,
      provider: provider ?? 'placeholder',
      status: 'failed',
      reason: (err as Error)?.message ?? 'Unknown error',
    };
  }
}

/**
 * Convenience wrapper that returns just the transcript string (or null)
 * without forcing callers to destructure the full result. Honors
 * `TRANSCRIPTION_PROVIDER` exactly the same way as `transcribeSocialVideo`.
 *
 * Use this when you only need the text (e.g. to feed into AI extraction)
 * and don't care about the provider/status metadata.
 */
export async function getTranscript(url: string): Promise<string | null> {
  const result = await transcribeSocialVideo({ url });
  return result.status === 'success' && result.transcript ? result.transcript : null;
}
