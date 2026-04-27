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

  // TODO: when a real provider is implemented, dispatch on `provider`:
  //   if (provider === 'whisper') return whisperTranscribe(input);
  //   if (provider === 'deepgram') return deepgramTranscribe(input);
  //   if (provider === 'assemblyai') return assemblyTranscribe(input);
  //   if (provider === 'choppity') return choppityTranscribe(input); // if API exists
  //
  // For now everything routes to the placeholder, which never throws and
  // returns status="unavailable" when nothing is configured.
  void provider;

  try {
    return await placeholderTranscribe(input);
  } catch (err) {
    // Defensive: placeholder should never throw, but the contract here is
    // strict — callers must be able to await without try/catch.
    console.log(`${LOG} placeholder threw (defensive catch):`, err);
    return {
      transcript: null,
      provider: 'placeholder',
      status: 'failed',
      reason: (err as Error)?.message ?? 'Unknown error',
    };
  }
}
