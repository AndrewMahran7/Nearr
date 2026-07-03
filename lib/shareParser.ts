/**
 * Best-effort parser for shared social links.
 *
 * Public, safe methods only:
 *   - HTTP GET the public URL with a generic User-Agent.
 *   - Parse standard OpenGraph / Twitter / <title> metadata.
 *   - DO NOT log in, scrape private content, or use undocumented APIs.
 *
 * If we cannot derive a useful query the caller should fall back to a
 * manual text search.
 */

import { isDemoMode } from './demoMode';
import { normalizeShareUrl } from './shareAgent/tiktokUrl';

export type ShareSource = 'tiktok' | 'instagram' | 'link';

export type ParsedShare = {
  /** Original URL the user pasted (trimmed). */
  url: string;
  /** Platform we recognized (or 'link' for anything else). */
  source: ShareSource;
  /** og:title / twitter:title / <title>, cleaned of platform boilerplate. */
  title: string | null;
  /** og:description / twitter:description, if present. */
  description: string | null;
  /**
   * Best query string to feed Google Places text search.
   * Derived from title + description; null if we couldn't get anything useful.
   */
  suggestedQuery: string | null;
  /** True if the network/metadata fetch threw or returned nothing usable. */
  metadataFailed: boolean;
};

const USER_AGENT =
  'Mozilla/5.0 (compatible; NearrBot/1.0; +https://nearr.app)';

const FETCH_TIMEOUT_MS = 8000;
const SOCIAL_TAG_RE = /#[^\s#@]+/g;
const SOCIAL_MENTION_RE = /@[^\s#@]+/g;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function detectSource(url: string): ShareSource {
  const u = url.toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  return 'link';
}

export function isLikelyUrl(s: string): boolean {
  const trimmed = s.trim();
  return /^https?:\/\/\S+/i.test(trimmed);
}

export async function parseShare(rawUrl: string): Promise<ParsedShare> {
  // Normalize first: lowercase host + strip share-sheet tracking params so
  // the URL we fetch + persist is the clean canonical form. Never throws;
  // falls back to the trimmed input for non-URL text.
  const normalized = normalizeShareUrl(rawUrl);
  const url = normalized.url || rawUrl.trim();
  const source = detectSource(url);

  if (normalized.platform === 'tiktok') {
    console.log(
      `[tiktok-share] raw_input_present=${!!rawUrl} ` +
        `is_short_link=${normalized.isShortLink} normalized=${normalized.wasModified}`,
    );
  }

  console.log('[shareParser] parsing', { url, source });

  // Demo mode: skip all network access. Synthesize a plausible title from
  // the URL path so the add-place screen still has a starting query.
  if (isDemoMode()) {
    const fakeTitle = synthesizeDemoTitle(url, source);
    const suggestedQuery = buildQuery(fakeTitle, null);
    console.log('[shareParser] demo mode — synthesized', { fakeTitle, suggestedQuery });
    return {
      url,
      source,
      title: fakeTitle,
      description: null,
      suggestedQuery,
      metadataFailed: false,
    };
  }

  let title: string | null = null;
  let description: string | null = null;
  let metadataFailed = false;

  try {
    const html = await fetchHtml(url);
    title = pickMeta(html, 'og:title') ?? pickMeta(html, 'twitter:title') ?? pickTitle(html);
    description =
      pickMeta(html, 'og:description') ?? pickMeta(html, 'twitter:description') ?? null;

    title = cleanTitle(title, source);
    description = cleanDescription(description);

    if (!title && !description) {
      metadataFailed = true;
      console.warn('[shareParser] no usable metadata found');
    }
  } catch (err) {
    metadataFailed = true;
    console.warn('[shareParser] fetch failed', (err as Error)?.message);
  }

  const suggestedQuery = buildQuery(title, description);
  return { url, source, title, description, suggestedQuery, metadataFailed };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function fetchHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

function pickMeta(html: string, prop: string): string | null {
  // Tolerate either order of attributes, single or double quotes.
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtml(m[1]);
  }
  return null;
}

function pickTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtml(m[1]) : null;
}

function cleanTitle(raw: string | null, source: ShareSource): string | null {
  if (!raw) return null;
  let s = raw.trim();
  s = s
    .replace(/\s+on TikTok.*/i, '')
    .replace(/\s*\|\s*Instagram.*/i, '')
    .replace(/\s*•\s*Instagram.*/i, '')
    .replace(/\s*\(@[^)]+\)\s*on Instagram.*/i, '')
    .replace(/\s*-\s*YouTube.*/i, '')
    .trim();
  s = s.replace(/^["\u201C\u201D'`]+|["\u201C\u201D'`]+$/g, '').trim();
  if (!s) return null;
  void source;
  return s;
}

function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.length > 240) s = s.slice(0, 237).trimEnd() + '\u2026';
  return s;
}

/**
 * Build a Google Places-friendly query.
 * - Prefer the title (the most place-relevant signal).
 * - If title is missing, use the first sentence of the description.
 * - Strip hashtags, urls, emoji, social boilerplate, collapse whitespace,
 *   and cap length so we never feed a 500-char caption to Places.
 */
function buildQuery(title: string | null, description: string | null): string | null {
  const candidate = title ?? firstSentence(description);
  if (!candidate) return null;
  let q = candidate
    // Hashtags and @mentions are pure noise for a place search.
    .replace(SOCIAL_TAG_RE, ' ')
    .replace(SOCIAL_MENTION_RE, ' ')
    // URLs leaked into captions.
    .replace(/https?:\/\/\S+/g, ' ')
    // Social platform boilerplate.
    .replace(/\s+on Instagram\b.*$/i, ' ')
    .replace(/\s+on TikTok\b.*$/i, ' ')
    .replace(/\bReel by\b/gi, ' ')
    .replace(/\bPhoto by\b/gi, ' ')
    // Surrounding quotes.
    .replace(/["\u201C\u201D'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  q = stripEmojiLikeChars(q);
  if (q.length > 120) q = q.slice(0, 120).trim();
  return q || null;
}

function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^[^.!?\n]{4,}/);
  return m ? m[0].trim() : s.trim();
}

function decodeHtml(s: string): string {
  return (
    s
      // Numeric hex entities: &#x1f4cd; &#x2019;
      .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
        const code = parseInt(hex, 16);
        if (!Number.isFinite(code) || code <= 0) return '';
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      })
      // Numeric decimal entities: &#8217; &#128205;
      .replace(/&#(\d+);/g, (_, dec) => {
        const code = parseInt(dec, 10);
        if (!Number.isFinite(code) || code <= 0) return '';
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      })
      // Named entities (the small set we actually see in OG tags).
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&#x27;/g, "'")
      .replace(/&nbsp;/g, ' ')
  );
}

function stripEmojiLikeChars(value: string): string {
  let out = '';
  for (const char of value) {
    const codePoint = char.codePointAt(0);
    if (codePoint == null || !isEmojiLikeCodePoint(codePoint)) {
      out += char;
      continue;
    }
    out += ' ';
  }
  return out;
}

function isEmojiLikeCodePoint(codePoint: number): boolean {
  return (
    (codePoint >= 0x1f000 && codePoint <= 0x1faff) ||
    (codePoint >= 0x2600 && codePoint <= 0x27bf) ||
    (codePoint >= 0x2300 && codePoint <= 0x23ff)
  );
}

/**
 * Demo-mode synthetic title. Picks the last meaningful URL path segment,
 * un-slugifies it, and title-cases it. Falls back to platform-flavored text.
 */
function synthesizeDemoTitle(url: string, source: ShareSource): string {
  try {
    const u = new URL(url);
    const segments = u.pathname.split('/').filter(Boolean);
    const last = segments[segments.length - 1] ?? '';
    const cleaned = last
      .replace(/\.[a-z0-9]{1,5}$/i, '')
      .replace(/[-_+]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (cleaned.length >= 3 && /[a-z]/i.test(cleaned)) {
      return cleaned
        .split(' ')
        .map((w) => (w.length ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
        .join(' ');
    }
  } catch {
    // fall through
  }
  if (source === 'tiktok') return 'Tacos near me';
  if (source === 'instagram') return 'Coffee shop';
  return 'Shared place';
}
