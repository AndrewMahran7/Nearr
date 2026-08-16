// supabase/functions/process-share-link/evidence/handleExtraction.ts
//
// Consolidated handle (poster + tagged) extraction. Wraps the
// `lib/shareAgent/tools.ts` `detectHandles` primitive plus the
// `recoveryHints` helpers for filtering mall / generic accounts.

import { detectHandles } from '../../../../lib/shareAgent/tools.ts';
import {
  isMallContextHandle,
  isNoiseHandle,
  derivePlaceNameHintFromHandle,
} from '../../../../lib/shareAgent/recoveryHints.ts';
import type { SourcePlatform } from '../types.ts';

export type ExtractedHandles = {
  posterHandle: string | null;
  taggedHandles: string[];
  /** Venue-like handles (mall/aggregator tags removed). */
  venueHandles: string[];
  /** Best-effort name hint derived from the poster's handle. */
  posterNameHint: string | null;
};

export function extractHandles(args: {
  platform: SourcePlatform;
  title: string | null;
  description: string | null;
  html: string | null;
  /**
   * The post author's handle, when a source told us authoritatively (the media
   * resolver reads it from the extractor's own metadata). Two effects, both
   * about keeping the CREATOR out of the venue set:
   *
   *   1. It becomes `posterHandle`, so it is filtered out of `taggedHandles` /
   *      `venueHandles` exactly like an og:title-derived poster would be.
   *   2. It suppresses the "a lone @handle on an Instagram post IS the poster"
   *      shortcut below. That shortcut reads a PAGE; a caption is a different
   *      shape, and the single handle in one is typically the tagged VENUE.
   *      Verified live on the Santa Fe reel: the caption's only handle is
   *      `@santafeimporters1947` (the venue), while the creator is
   *      `ocfoodandview` — the shortcut would have labelled the venue as the
   *      poster and then dropped it from `venueHandles` entirely.
   */
  knownPosterHandle?: string | null;
}): ExtractedHandles {
  const text = [args.title, args.description].filter(Boolean).join('\n');
  // detectHandles's "exactly one @handle found anywhere on the page is the
  // poster" shortcut is an INSTAGRAM-page-structure assumption (a lone
  // handle on an IG post page reliably IS the poster). It must not silently
  // apply to platforms whose raw HTML has a completely different shape —
  // verified live: a YouTube Shorts page's minified JS config blob contains
  // the literal substring `@.null` (from an internal `%.@.null,1000,2]`
  // format string, nothing to do with any user), which this shortcut then
  // promoted to a "poster handle" → "Null" venue query → literal `<Null>`
  // candidates from Google Places. Only pass 'instagram' for actual
  // Instagram posts; every other platform gets the neutral 'link' value,
  // which disables the shortcut entirely.
  const platformArg: 'instagram' | 'tiktok' | 'youtube' | 'link' =
    args.platform === 'tiktok'
      ? 'tiktok'
      : args.platform === 'instagram'
        ? 'instagram'
        : args.platform === 'youtube'
          ? 'youtube'
          : 'link';
  const known = normalizeKnownHandle(args.knownPosterHandle);
  // With an authoritative poster, `detectHandles` must not apply its
  // page-shaped single-handle shortcut — pass the neutral platform so every
  // handle it finds stays a TAGGED handle, then attribute the poster below.
  const { result } = detectHandles(
    text || null,
    args.html,
    known ? 'link' : platformArg,
  );
  // Drop platform / page-internal noise handles (e.g. `@media` leaking from
  // Instagram's inline CSS) so they never become a poster-name venue query.
  const posterHandle =
    known ??
    (result.posterHandle && !isNoiseHandle(result.posterHandle)
      ? result.posterHandle
      : null);
  const tagged = (result.taggedHandles ?? [])
    .filter(Boolean)
    .filter((h) => !isNoiseHandle(h))
    // The creator is never the venue, even when they tag themselves.
    .filter((h) => h !== posterHandle);
  const venue = tagged.filter((h) => !isMallContextHandle(h));
  const posterNameHint = posterHandle
    ? derivePlaceNameHintFromHandle(posterHandle)
    : null;
  return {
    posterHandle,
    taggedHandles: tagged,
    venueHandles: venue,
    posterNameHint,
  };
}

/** Accept only handle-shaped values, so a display name or numeric account id
 *  can never be attributed as the poster's handle. */
function normalizeKnownHandle(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9._]{2,30}$/.test(normalized)) return null;
  if (/^\d+$/.test(normalized)) return null;
  if (isNoiseHandle(normalized)) return null;
  return normalized;
}
