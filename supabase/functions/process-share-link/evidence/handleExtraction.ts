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
  // detectHandles only supports 'instagram' | 'tiktok' (the
  // shareAgent platform enum). For other platforms pass a neutral
  // value that disables platform-specific shortcuts.
  const platformArg: 'instagram' | 'tiktok' =
    args.platform === 'tiktok' ? 'tiktok' : 'instagram';
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
