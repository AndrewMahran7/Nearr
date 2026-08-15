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
  const { result } = detectHandles(text || null, args.html, platformArg);
  // Drop platform / page-internal noise handles (e.g. `@media` leaking from
  // Instagram's inline CSS) so they never become a poster-name venue query.
  const tagged = (result.taggedHandles ?? [])
    .filter(Boolean)
    .filter((h) => !isNoiseHandle(h));
  const venue = tagged.filter((h) => !isMallContextHandle(h));
  const posterHandle =
    result.posterHandle && !isNoiseHandle(result.posterHandle)
      ? result.posterHandle
      : null;
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
