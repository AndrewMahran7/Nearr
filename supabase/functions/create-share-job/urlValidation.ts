// supabase/functions/create-share-job/urlValidation.ts
//
// SSRF-safe validation for share-job source URLs.
//
// The durable worker fetches this URL server-side (fetchPostMetadata), so a
// malicious/internal URL is an SSRF risk. This module rejects anything that
// is not a public http(s) URL:
//   - non-http(s) schemes (file:, data:, gopher:, ftp:, ...)
//   - credentials in the URL (user:pass@host)
//   - private / loopback / link-local / reserved IP literals (v4 + v6)
//   - localhost-style and cloud-metadata hostnames
//
// Pure + dependency-free (only the standard URL global) so it runs in Deno
// AND is unit-testable from Node via scripts/tsconfig.json.
//
// KNOWN LIMITATION (Phase 1): this checks the URL literally. It does NOT
// defend against DNS rebinding (a public hostname that resolves to a private
// IP). That requires resolve-then-pin at fetch time and is out of scope here.

export type UrlValidation =
  | { ok: true; url: string; host: string }
  | {
      ok: false;
      reason:
        | 'not_a_string'
        | 'empty'
        | 'invalid_url'
        | 'unsupported_scheme'
        | 'has_credentials'
        | 'blocked_host';
    };

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'ip6-localhost',
  'ip6-loopback',
  'metadata',
  'metadata.google.internal',
]);

const BLOCKED_HOST_SUFFIXES = ['.local', '.internal', '.localhost', '.lan', '.home.arpa'];

function isPrivateIpv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((n) => Number(n));
  if (parts.some((n) => n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // loopback
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast / reserved
  return false;
}

function isPrivateIpv6(host: string): boolean {
  // URL host for IPv6 is bracketed, e.g. "[::1]". Strip brackets + zone id.
  let h = host;
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  h = h.split('%')[0].toLowerCase();
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fe80')) return true; // link-local
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:10.0.0.1) — pull the tail and re-check.
  const tail = h.split(':').pop() ?? '';
  if (tail.includes('.') && isPrivateIpv4(tail)) return true;
  return false;
}

export function isBlockedHost(rawHost: string): boolean {
  const host = rawHost.toLowerCase().trim();
  if (!host) return true;
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix))) return true;
  if (isPrivateIpv4(host)) return true;
  if (host.includes(':') || host.startsWith('[')) {
    if (isPrivateIpv6(host)) return true;
  }
  return false;
}

/**
 * Validate a candidate share URL. Returns the parsed href + host on success.
 * The caller normalizes tracking params separately (normalizeShareUrl).
 */
export function validateShareUrl(input: unknown): UrlValidation {
  if (typeof input !== 'string') return { ok: false, reason: 'not_a_string' };
  const trimmed = input.trim();
  if (!trimmed) return { ok: false, reason: 'empty' };

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false, reason: 'invalid_url' };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== 'http:' && scheme !== 'https:') {
    return { ok: false, reason: 'unsupported_scheme' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, reason: 'has_credentials' };
  }
  // `hostname` strips the port and brackets differently than `host`; use it
  // for the block check, but keep `host` for logging.
  if (isBlockedHost(parsed.hostname)) {
    return { ok: false, reason: 'blocked_host' };
  }
  return { ok: true, url: parsed.toString(), host: parsed.host };
}
