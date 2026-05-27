// supabase/functions/process-share-link/platform/detectPlatform.ts
//
// URL → platform classification. Behaviorally identical to the
// `detectSource` helper in the legacy index.ts. The internal
// `SourcePlatform` is intentionally finer-grained than the wire-
// level `LegacySource` ('tiktok' | 'instagram' | 'link') so we can
// route new platforms later without changing the DB enum.

import type { SourcePlatform, LegacySource } from '../types.ts';

export function detectPlatform(url: string): SourcePlatform {
  const u = (url ?? '').toLowerCase();
  if (!u) return 'unknown';
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('twitter.com') || u.includes('x.com')) return 'twitter';
  return 'genericWeb';
}

/** Map the internal platform to the wire-level value clients persist
 *  in `saved_places.source_type` ('tiktok' | 'instagram' | 'link'). */
export function legacySourceFor(platform: SourcePlatform): LegacySource {
  if (platform === 'tiktok') return 'tiktok';
  if (platform === 'instagram') return 'instagram';
  return 'link';
}
