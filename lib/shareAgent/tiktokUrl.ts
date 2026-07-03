/**
 * Pure, dependency-free share-URL normalization — shared by the React
 * Native client (`lib/shareParser.ts`) and the Deno Edge Function
 * (`supabase/functions/process-share-link`). Uses only the global
 * `URL` / `URLSearchParams` (available in Deno, Node 18+, and RN via
 * `react-native-url-polyfill`). NO network, NO secrets, NEVER throws.
 *
 * Goals (see docs/EXTRACTION_BACKLOG.md — TikTok):
 *   - recognize TikTok canonical + short-link hosts
 *   - strip tracking query params (`_r`, `_t`, `is_from_webapp`,
 *     `sender_device`, …) so the canonical URL is stable + clean
 *   - classify short links (`vm.tiktok.com` / `vt.tiktok.com` / `/t/…`)
 *     so callers can decide whether a server-side redirect resolve is
 *     needed
 *   - leave Instagram / generic links working (strip only tracking)
 *
 * Redirect FOLLOWING (short → canonical) is intentionally NOT done here:
 * it requires a network fetch and belongs in the server-side metadata
 * layer. This module only prepares/cleans URLs.
 */

export type ShareUrlPlatform = 'tiktok' | 'instagram' | 'other' | 'unknown';

export type NormalizedShareUrl = {
  /** Cleaned URL (tracking stripped, host lowercased). Falls back to the
   *  trimmed input verbatim if the URL could not be parsed. */
  url: string;
  /** Lowercased host, or null when the input was not a parseable URL. */
  host: string | null;
  platform: ShareUrlPlatform;
  /** True for `vm.tiktok.com` / `vt.tiktok.com` / `tiktok.com/t/…` links
   *  that must be redirect-resolved server-side to reach the canonical
   *  `@user/video/<id>` form. */
  isShortLink: boolean;
  /** True when normalization actually changed the input string. */
  wasModified: boolean;
};

// TikTok tracking / share-sheet params. TikTok canonical video URLs carry
// NO meaningful query, so for TikTok hosts we drop the query entirely;
// this list documents the params we've observed on shared links.
export const TIKTOK_TRACKING_PARAMS: readonly string[] = [
  '_r', '_t', '_d', '_svg', 'is_from_webapp', 'sender_device',
  'sender_web_id', 'web_id', 'share_app_id', 'share_link_id',
  'share_item_id', 'u_code', 'ug_btm', 'social_sharing', 'source',
  'checksum', 'refer', 'referer_url', 'referer_video_id', 'embed_source',
  'is_copy_url', 'enter_method', 'preview_pb', 'tt_from', 'iid', 'app',
];

// Generic tracking params stripped from ANY platform (never place-relevant).
const GENERIC_TRACKING_PARAMS: readonly string[] = [
  'fbclid', 'gclid', 'igshid', 'igsh', 'mibextid', 'si',
];

const TIKTOK_HOSTS = new Set([
  'tiktok.com', 'www.tiktok.com', 'm.tiktok.com',
  'vm.tiktok.com', 'vt.tiktok.com',
]);
const TIKTOK_SHORT_HOSTS = new Set(['vm.tiktok.com', 'vt.tiktok.com']);

function stripWww(host: string): string {
  return host.startsWith('www.') ? host.slice(4) : host;
}

export function classifyShareUrlPlatform(host: string | null): ShareUrlPlatform {
  if (!host) return 'unknown';
  const h = host.toLowerCase();
  if (h.endsWith('tiktok.com')) return 'tiktok';
  if (h.endsWith('instagram.com')) return 'instagram';
  return 'other';
}

export function isTikTokUrl(rawUrl: string): boolean {
  return normalizeShareUrl(rawUrl).platform === 'tiktok';
}

export function isTikTokShortLink(rawUrl: string): boolean {
  return normalizeShareUrl(rawUrl).isShortLink;
}

/**
 * Build the official, keyless TikTok oEmbed endpoint URL for a canonical
 * video URL. Docs: https://developers.tiktok.com/doc/embed-videos/ —
 * `GET https://www.tiktok.com/oembed?url=<video url>` returns JSON with
 * `title` (the caption), `author_name`, `thumbnail_url`, etc.
 */
export function buildTikTokOEmbedUrl(canonicalUrl: string): string {
  return `https://www.tiktok.com/oembed?url=${encodeURIComponent(canonicalUrl)}`;
}

/**
 * Normalize a shared URL: lowercase host, strip tracking params, and
 * classify platform + short-link status. Never throws — returns the
 * trimmed input unchanged when it is not a parseable http(s) URL.
 */
export function normalizeShareUrl(rawUrl: string): NormalizedShareUrl {
  const trimmed = (rawUrl ?? '').trim();
  if (!trimmed) {
    return { url: '', host: null, platform: 'unknown', isShortLink: false, wasModified: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    // Not a parseable absolute URL — hand it back verbatim so callers
    // can still run their own `isLikelyUrl` guard / manual fallback.
    return { url: trimmed, host: null, platform: 'unknown', isShortLink: false, wasModified: false };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { url: trimmed, host: null, platform: 'unknown', isShortLink: false, wasModified: false };
  }

  const host = parsed.host.toLowerCase();
  parsed.host = host;
  const bareHost = stripWww(host);
  const platform = classifyShareUrlPlatform(host);

  const isShortLink =
    TIKTOK_SHORT_HOSTS.has(host) ||
    (TIKTOK_HOSTS.has(host) && parsed.pathname.toLowerCase().startsWith('/t/'));

  if (platform === 'tiktok' && !isShortLink) {
    // Canonical TikTok video URLs need no query at all. Dropping it gives
    // us a stable, dedupe-friendly canonical URL and a clean oEmbed input.
    parsed.search = '';
  } else {
    // Every other case (short links, Instagram, generic): strip only known
    // tracking keys and keep the rest of the query intact.
    const toDrop = new Set<string>([...GENERIC_TRACKING_PARAMS]);
    if (bareHost.endsWith('tiktok.com')) {
      for (const p of TIKTOK_TRACKING_PARAMS) toDrop.add(p);
    }
    const params = parsed.searchParams;
    for (const key of [...params.keys()]) {
      const lower = key.toLowerCase();
      if (lower.startsWith('utm_') || toDrop.has(lower)) {
        params.delete(key);
      }
    }
    parsed.search = params.toString() ? `?${params.toString()}` : '';
  }

  // Drop a dangling "?" and normalize.
  let out = parsed.toString();
  if (out.endsWith('?')) out = out.slice(0, -1);

  return {
    url: out,
    host,
    platform,
    isShortLink,
    wasModified: out !== trimmed,
  };
}
