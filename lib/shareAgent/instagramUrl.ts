// Pure Instagram content-identity contract used by the Supabase metadata
// boundary. Keep this module dependency-free so Deno and the root test harness
// can load it without crossing the media worker's ESM package boundary.

const INSTAGRAM_CONTENT_KINDS = new Set(['p', 'reel', 'reels', 'tv']);
const INSTAGRAM_SHORTCODE_RE = /^[A-Za-z0-9_-]{1,80}$/;
const INSTAGRAM_CREATOR_RE = /^[A-Za-z0-9._]{1,30}$/;

export function isInstagramHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === 'instagram.com' || host.endsWith('.instagram.com');
}

function parseUrl(value: string | URL | null | undefined): URL | null {
  if (!value) return null;
  try {
    return value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    return null;
  }
}

/** True only for an HTTPS Instagram post/reel identity that yt-dlp supports.
 * Same-host navigation/auth surfaces are deliberately not content identities. */
export function isInstagramContentUrl(value: string | URL | null | undefined): boolean {
  const url = parseUrl(value);
  if (
    !url ||
    url.protocol !== 'https:' ||
    !isInstagramHost(url.hostname) ||
    url.username !== '' ||
    url.password !== '' ||
    (url.port !== '' && url.port !== '443')
  ) return false;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 2) {
    return INSTAGRAM_CONTENT_KINDS.has(segments[0]!.toLowerCase()) && INSTAGRAM_SHORTCODE_RE.test(segments[1]!);
  }
  if (segments.length === 3) {
    return (
      INSTAGRAM_CREATOR_RE.test(segments[0]!) &&
      INSTAGRAM_CONTENT_KINDS.has(segments[1]!.toLowerCase()) &&
      INSTAGRAM_SHORTCODE_RE.test(segments[2]!)
    );
  }
  return false;
}

/** Prefer a valid canonical identity, then the original valid content URL.
 * Returns null rather than inventing a Reel URL when neither input qualifies. */
export function selectInstagramContentUrl(
  sourceUrl: string,
  canonicalUrl?: string | null,
): string | null {
  for (const candidate of [canonicalUrl, sourceUrl]) {
    const parsed = parseUrl(candidate);
    if (parsed && isInstagramContentUrl(parsed)) return parsed.toString();
  }
  return null;
}
