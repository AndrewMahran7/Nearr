/**
 * Transcription provider types.
 *
 * The transcription layer is a fallback for the share-save flow: when a
 * social post's caption / OG metadata does NOT contain a recognizable
 * place name but the video's audio does ("we're at Tacos Los Chulos"),
 * we want to optionally pull a transcript and feed it into AI extraction.
 *
 * No provider is wired up yet — see lib/transcription/providers/ and
 * docs/README "Transcription fallback" section.
 */

export type TranscriptionSourceType = 'instagram' | 'tiktok' | 'link' | 'manual';

export type TranscriptionInput = {
  url: string;
  sourceType?: TranscriptionSourceType;
};

export type TranscriptionStatus =
  | 'success'
  | 'unavailable'
  | 'failed'
  | 'skipped';

export type TranscriptionResult = {
  transcript: string | null;
  provider: string;
  status: TranscriptionStatus;
  reason?: string;
};
