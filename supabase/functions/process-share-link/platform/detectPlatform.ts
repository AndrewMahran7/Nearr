// supabase/functions/process-share-link/platform/detectPlatform.ts
//
// URL → platform classification. Behaviorally identical to the
// `detectSource` helper in the legacy index.ts. The internal
// `SourcePlatform` is intentionally finer-grained than the wire-
// level `LegacySource` ('tiktok' | 'instagram' | 'link') so we can
// route new platforms later without changing the DB enum.

import type { SourcePlatform, LegacySource } from '../types.ts';

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

export function detectPlatform(url: string): SourcePlatform {
  let host = '';
  try {
    host = new URL((url ?? '').trim()).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return 'unknown';
  }
  if (isHostOrSubdomain(host, 'tiktok.com')) return 'tiktok';
  if (isHostOrSubdomain(host, 'instagram.com')) return 'instagram';
  if (isHostOrSubdomain(host, 'youtube.com') || host === 'youtu.be') return 'youtube';
  if (isHostOrSubdomain(host, 'facebook.com') || host === 'fb.watch') return 'facebook';
  if (isHostOrSubdomain(host, 'snapchat.com')) return 'snapchat';
  if (isHostOrSubdomain(host, 'twitter.com') || isHostOrSubdomain(host, 'x.com')) return 'twitter';
  return 'genericWeb';
}

/** Map the internal platform to the wire-level value clients persist in
 *  `saved_places.source_type`
 *  ('tiktok' | 'instagram' | 'youtube' | 'facebook' | 'snapchat' | 'link'). */
export function legacySourceFor(platform: SourcePlatform): LegacySource {
  if (platform === 'tiktok') return 'tiktok';
  if (platform === 'instagram') return 'instagram';
  if (platform === 'youtube') return 'youtube';
  if (platform === 'facebook') return 'facebook';
  if (platform === 'snapchat') return 'snapchat';
  return 'link';
}
