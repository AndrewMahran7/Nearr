import {
  evaluateAiPlaceNote,
  type AiPlaceNoteEvidence,
  type AiPlaceNoteResult,
} from './aiPlaceNote';

export type VideoDerivedSource = {
  source_url?: string | null;
  source_type?: string | null;
};

export type VideoSourcePlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'facebook'
  | 'snapchat';

export type TargetedAiNotePlace = {
  name?: string | null;
  memoryCue?: string | null;
  memoryCueEvidence?: readonly AiPlaceNoteEvidence[] | null;
};

export type TargetedAiNoteResult = AiPlaceNoteResult & {
  targetMatch: 'matched' | 'missing' | 'ambiguous';
};

function cleaned(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

const EXPLICIT_VIDEO_SOURCE_TYPES = new Set<VideoSourcePlatform>([
  'instagram',
  'tiktok',
  'youtube',
  'facebook',
  'snapchat',
]);

function hostIs(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Resolve only provenance that the current media pipeline can actually
 * process. Every row needs a durable post/video URL shape. An explicit
 * normalized label must agree with that URL; `link`/null preserves legacy
 * compatibility. Restaurant websites and Google Maps URLs are not enough.
 */
export function videoSourcePlatform(
  source: VideoDerivedSource | null | undefined,
): VideoSourcePlatform | null {
  const url = cleaned(source?.source_url);
  if (!url) return null;
  const declared = cleaned(source?.source_type)?.toLowerCase() ?? '';
  if (declared === 'manual') return null;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:') return null;
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  const declaredPlatform = EXPLICIT_VIDEO_SOURCE_TYPES.has(declared as VideoSourcePlatform)
    ? declared as VideoSourcePlatform
    : null;
  const accept = (platform: VideoSourcePlatform): VideoSourcePlatform | null =>
    declaredPlatform && declaredPlatform !== platform ? null : platform;

  if (hostIs(host, 'instagram.com')) {
    const post = /^\/(?:p|reel|reels|tv)\/[^/]+\/?$/i.test(path) ||
      /^\/stories\/[^/]+\/[^/]+\/?$/i.test(path);
    return post ? accept('instagram') : null;
  }
  if (hostIs(host, 'tiktok.com')) {
    const shortHost = host === 'vm.tiktok.com' || host === 'vt.tiktok.com';
    const short = (shortHost && path !== '/') || /^\/t\/[^/]+\/?$/i.test(path);
    return short || /^\/@[^/]+\/video\/\d+\/?$/i.test(path) ? accept('tiktok') : null;
  }
  if (hostIs(host, 'youtube.com')) {
    const video = (/^\/watch\/?$/i.test(path) && !!parsed.searchParams.get('v')) ||
      /^\/(?:shorts|live)\/[^/]+\/?$/i.test(path);
    return video ? accept('youtube') : null;
  }
  if (host === 'youtu.be') return /^\/[^/]+\/?$/i.test(path) ? accept('youtube') : null;
  if (hostIs(host, 'facebook.com')) {
    const post = /^\/(?:reel|reels)\/[^/]+\/?$/i.test(path) ||
      /^\/[^/]+\/videos\/[^/]+\/?$/i.test(path) ||
      /^\/[^/]+\/posts\/[^/]+\/?$/i.test(path) ||
      /^\/share\/(?:r|v|p)\/[^/]+\/?$/i.test(path) ||
      (/^\/watch\/?$/i.test(path) && !!parsed.searchParams.get('v'));
    return post ? accept('facebook') : null;
  }
  if (host === 'fb.watch') return path !== '/' ? accept('facebook') : null;
  if (hostIs(host, 'snapchat.com')) {
    return /^\/spotlight\/[^/]+\/?$/i.test(path) ? accept('snapchat') : null;
  }
  return null;
}

/** Canonical application-side definition of processable video provenance. */
export function isVideoDerivedSavedPlace(
  source: VideoDerivedSource | null | undefined,
): boolean {
  return videoSourcePlatform(source) !== null;
}

export function hasUsefulAiNote(value: unknown): boolean {
  return cleaned(value) !== null;
}

export type VideoAiNoteInvariantAction =
  | 'not_video_derived'
  | 'already_satisfied'
  | 'ensure_enrichment';

export function planVideoAiNoteInvariant(
  source: VideoDerivedSource | null | undefined,
  aiNote: unknown,
): VideoAiNoteInvariantAction {
  if (!isVideoDerivedSavedPlace(source)) return 'not_video_derived';
  return hasUsefulAiNote(aiNote) ? 'already_satisfied' : 'ensure_enrichment';
}

export function normalizePlaceIdentity(value: unknown): string {
  return (cleaned(value) ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * `saved_places.place_id` is Nearr's required internal FK for every canonical
 * place. `places.google_place_id` may be null for natural/custom places, but
 * that does not make saved-place identity nullable. Metadata refreshes retain
 * this FK; replacements change it.
 */
export function savedPlaceIdentityChanged(
  before: { place_id?: string | null } | null | undefined,
  after: { place_id?: string | null } | null | undefined,
): boolean {
  return cleaned(before?.place_id) !== cleaned(after?.place_id);
}

const TRANSIENT_AI_NOTE_ERRORS = new Set([
  'download_timeout',
  'download_failed',
  'provider_rate_limited',
  'provider_unavailable',
  'provider_changed',
  'finalizer_unavailable',
]);

export type VideoAiNoteFailureDisposition =
  | 'retry_after_outage'
  | 'retry_after_generation'
  | 'awaiting_evidence';

/** Only literal absence of every observable input may terminate blank. A
 * provider outage or a failed/invalid generation over real evidence remains a
 * durable obligation; ordinary sparse-text cases never defer to user input. */
export function classifyVideoAiNoteFailure(input: {
  outcome?: string | null;
  errorCodes?: readonly unknown[] | null;
  observableEvidenceCount?: number | null;
  mediaAcquiredOnce?: boolean | null;
}): VideoAiNoteFailureDisposition {
  const errors = (input.errorCodes ?? [])
    .filter((value): value is string => typeof value === 'string')
    .map((value) => value.trim().toLowerCase());
  if (input.outcome === 'failed' && errors.some((code) => TRANSIENT_AI_NOTE_ERRORS.has(code))) {
    return 'retry_after_outage';
  }
  const hasEvidence = (Number(input.observableEvidenceCount) || 0) > 0 ||
    input.mediaAcquiredOnce === true;
  return hasEvidence ? 'retry_after_generation' : 'awaiting_evidence';
}

/** A finalizer callback is valid only for the exact saved-place identity and
 * source snapshot claimed by the worker. This is deliberately independent of
 * names: a correction may reuse a row while changing its authoritative FK. */
export function videoAiNoteCallbackMatchesTarget(input: {
  savedPlaceId?: string | null;
  taskPlaceId?: string | null;
  callbackPlaceId?: string | null;
  savedSourceUrl?: string | null;
  taskSourceUrl?: string | null;
  callbackSourceUrl?: string | null;
}): boolean {
  return !!input.taskPlaceId &&
    input.savedPlaceId === input.taskPlaceId &&
    input.callbackPlaceId === input.taskPlaceId &&
    !!input.taskSourceUrl &&
    input.callbackSourceUrl === input.taskSourceUrl &&
    input.savedSourceUrl === input.callbackSourceUrl;
}

/**
 * Select a cue only for the FINAL saved place. Exact normalized identity is
 * intentional: a correction from Place A to Place B must never inherit A's
 * otherwise well-grounded cue, and a multi-place post must never borrow a
 * sibling's evidence.
 */
export function evaluateTargetedVideoAiNote(input: {
  finalPlaceName: string | null | undefined;
  places: readonly TargetedAiNotePlace[] | null | undefined;
}): TargetedAiNoteResult {
  const target = normalizePlaceIdentity(input.finalPlaceName);
  const matches = target
    ? (input.places ?? []).filter(
        (place) => normalizePlaceIdentity(place.name) === target,
      )
    : [];

  if (matches.length !== 1) {
    return {
      note: null,
      status: 'insufficient_evidence',
      reason: null,
      targetMatch: matches.length > 1 ? 'ambiguous' : 'missing',
    };
  }

  const match = matches[0]!;
  return {
    ...evaluateAiPlaceNote({
      placeName: input.finalPlaceName,
      proposedNote: match.memoryCue,
      evidence: match.memoryCueEvidence ?? [],
    }),
    targetMatch: 'matched',
  };
}
