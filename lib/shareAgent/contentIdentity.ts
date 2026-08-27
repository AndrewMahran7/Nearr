// Stable, privacy-safe identity for one public social post. This module is
// dependency-free so React Native, Deno edge functions, and Node tests share
// the exact same keying rules.

import { inspectFacebookUrl } from './facebookUrl.ts';
import { normalizeShareUrl, extractTikTokPostIdentity, type ShareUrlPlatform } from './tiktokUrl.ts';

export const CONTENT_IDENTITY_VERSION = 1;
// Recognition semantics now reject category-only identity hypotheses and
// consolidate same-place moments before candidate resolution. One intentional
// bump prevents older machine conclusions from bypassing either policy.
export const RECOGNITION_VERSION = 'vayrin-recognition-2026-08-27.v4-same-place-groups-hypothesis-first-hard-path';

export type CanonicalContentIdentity = {
  platform: ShareUrlPlatform;
  contentId: string;
  canonicalUrl: string;
  identityVersion: number;
  /** Durable database key. Never contains a user id. */
  key: string;
  kind: 'provider_id' | 'normalized_url';
};

const INSTAGRAM_KINDS = new Set(['p', 'reel', 'reels', 'tv']);
const YOUTUBE_ID = /^[A-Za-z0-9_-]{6,20}$/;

function cleanGenericUrl(rawUrl: string): string {
  const normalized = normalizeShareUrl(rawUrl).url || rawUrl.trim();
  try {
    const url = new URL(normalized);
    url.protocol = 'https:';
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    const entries = [...url.searchParams.entries()]
      .filter(([key]) => {
        const lower = key.toLowerCase();
        return !lower.startsWith('utm_') && ![
          'fbclid', 'gclid', 'igsh', 'igshid', 'mibextid', 'si',
        ].includes(lower);
      })
      .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
    url.search = '';
    for (const [key, value] of entries) url.searchParams.append(key, value);
    return url.toString().replace(/\/$/, '');
  } catch {
    return normalized;
  }
}

function instagramIdentity(rawUrl: string): { id: string; url: string } | null {
  try {
    const url = new URL(rawUrl);
    if (!/(^|\.)instagram\.com$/i.test(url.hostname)) return null;
    const segments = url.pathname.split('/').filter(Boolean);
    const kindIndex = INSTAGRAM_KINDS.has((segments[0] ?? '').toLowerCase())
      ? 0
      : INSTAGRAM_KINDS.has((segments[1] ?? '').toLowerCase()) ? 1 : -1;
    const shortcode = kindIndex >= 0 ? segments[kindIndex + 1] : null;
    if (!shortcode || !/^[A-Za-z0-9_-]{1,80}$/.test(shortcode)) return null;
    const kind = (segments[kindIndex] ?? '').toLowerCase() === 'p' ? 'p' : 'reel';
    return { id: shortcode, url: `https://www.instagram.com/${kind}/${shortcode}/` };
  } catch {
    return null;
  }
}

function youtubeIdentity(rawUrl: string): { id: string; url: string } | null {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    let id: string | null = null;
    if (host === 'youtu.be') id = url.pathname.split('/').filter(Boolean)[0] ?? null;
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const segments = url.pathname.split('/').filter(Boolean);
      if ((segments[0] ?? '').toLowerCase() === 'watch') id = url.searchParams.get('v');
      if (['shorts', 'embed', 'live'].includes((segments[0] ?? '').toLowerCase())) id = segments[1] ?? null;
    }
    if (!id || !YOUTUBE_ID.test(id)) return null;
    return { id, url: `https://www.youtube.com/watch?v=${id}` };
  } catch {
    return null;
  }
}

/**
 * Build identity from the strongest URL currently known. For opaque short
 * links, pass the provider-resolved URL as the second argument; this is what
 * makes a TikTok short link and its @creator/video/<id> URL converge.
 */
export function canonicalContentIdentity(
  rawUrl: string,
  resolvedUrl?: string | null,
): CanonicalContentIdentity | null {
  const preferred = (resolvedUrl || rawUrl || '').trim();
  if (!preferred) return null;
  const normalized = normalizeShareUrl(preferred);
  const platform = normalized.platform;
  const candidate = normalized.url || preferred;

  const tiktok = extractTikTokPostIdentity(candidate);
  if (tiktok) return identity('tiktok', tiktok.postId, tiktok.canonicalUrl, 'provider_id');

  const instagram = instagramIdentity(candidate);
  if (instagram) return identity('instagram', instagram.id, instagram.url, 'provider_id');

  const youtube = youtubeIdentity(candidate);
  if (youtube) return identity('youtube', youtube.id, youtube.url, 'provider_id');

  const facebook = inspectFacebookUrl(candidate);
  if (facebook?.supported && facebook.contentId && !facebook.needsRedirectResolution) {
    return identity('facebook', facebook.contentId, facebook.canonicalUrl, 'provider_id');
  }

  const canonicalUrl = cleanGenericUrl(candidate);
  if (!canonicalUrl) return null;
  // The URL itself is the fallback fingerprint. Postgres stores this bounded
  // key directly; no tracking parameters, captions, prompts, or user data.
  return identity(platform, canonicalUrl, canonicalUrl, 'normalized_url');
}

function identity(
  platform: ShareUrlPlatform,
  contentId: string,
  canonicalUrl: string,
  kind: CanonicalContentIdentity['kind'],
): CanonicalContentIdentity {
  return {
    platform,
    contentId,
    canonicalUrl,
    identityVersion: CONTENT_IDENTITY_VERSION,
    key: `v${CONTENT_IDENTITY_VERSION}:${platform}:${contentId}`,
    kind,
  };
}
