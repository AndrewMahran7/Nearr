// services/media-worker/src/security/ssrf.ts
//
// SSRF defense for outbound media fetches. Every remote fetch the worker makes
// goes through here. We enforce:
//   - HTTPS only
//   - host allowlist (suffix match)
//   - DNS resolution checks BEFORE connecting (reject loopback / private /
//     link-local / unique-local / cloud-metadata addresses, v4 and v6)
//   - a hard redirect limit with a re-check on every hop
//   - a streaming response-size cap
//   - AbortSignal-based cancellation + timeout
//
// NOTE (documented limitation, same as Phase 1): we resolve + check DNS at hop
// time but do not pin the socket to the checked IP, so a rebinding attacker
// with control over an allowlisted host's DNS could still race us. The host
// allowlist (Meta CDNs only) is the primary mitigation.

import dnsPromises from 'node:dns/promises';
import net from 'node:net';
import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { MediaError } from '../types/media.js';

const DEFAULT_UA =
  'NearrMediaWorker/0.1 (+https://nearr.app; contact=support@nearr.app)';

// ---------------------------------------------------------------------------
// IP range checks
// ---------------------------------------------------------------------------

function ipv4IsDisallowed(ip: string): boolean {
  const parts = ip.split('.').map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true; // unparseable → treat as disallowed
  }
  const [a, b] = parts as [number, number, number, number];
  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // 10.0.0.0/8 private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a === 192 && b === 0 && parts[2] === 0) return true; // 192.0.0.0/24 IETF
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function ipv6IsDisallowed(ipRaw: string): boolean {
  const ip = ipRaw.toLowerCase().replace(/^\[|\]$/g, '');
  // IPv4-mapped / -embedded (::ffff:a.b.c.d, ::a.b.c.d) → check the v4 part.
  const v4 = ip.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4 && v4[1]) return ipv4IsDisallowed(v4[1]);
  if (ip === '::1' || ip === '::') return true; // loopback / unspecified
  if (ip.startsWith('fe80') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb')) {
    return true; // link-local fe80::/10
  }
  if (ip.startsWith('fc') || ip.startsWith('fd')) return true; // unique-local fc00::/7
  if (ip.startsWith('ff')) return true; // multicast
  return false;
}

export function ipIsDisallowed(ip: string): boolean {
  const kind = net.isIP(ip);
  if (kind === 4) return ipv4IsDisallowed(ip);
  if (kind === 6) return ipv6IsDisallowed(ip);
  return true; // not a literal IP → disallowed (we only accept resolved IPs here)
}

// ---------------------------------------------------------------------------
// Host allowlist
// ---------------------------------------------------------------------------

export function hostAllowed(hostname: string, allowlist: string[]): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return false;
  return allowlist.some((allowed) => {
    const a = allowed.toLowerCase().replace(/^\.+|\.+$/g, '');
    return host === a || host.endsWith(`.${a}`);
  });
}

// ---------------------------------------------------------------------------
// URL safety assertion (scheme + host + DNS)
// ---------------------------------------------------------------------------

export async function assertUrlSafe(
  rawUrl: string,
  allowlist: string[],
  resolver: (host: string) => Promise<{ address: string }[]> = (h) =>
    dnsPromises.lookup(h, { all: true }),
): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new MediaError('unsupported_url', 'invalid_url');
  }
  if (url.protocol !== 'https:') {
    throw new MediaError('ssrf_blocked', 'non_https');
  }
  if (url.username || url.password) {
    throw new MediaError('ssrf_blocked', 'embedded_credentials');
  }
  if (!hostAllowed(url.hostname, allowlist)) {
    throw new MediaError('ssrf_blocked', 'host_not_allowlisted');
  }
  // If the host is already a literal IP, check it directly.
  if (net.isIP(url.hostname)) {
    if (ipIsDisallowed(url.hostname)) throw new MediaError('ssrf_blocked', 'private_ip');
    return url;
  }
  // Resolve + check every returned address.
  let addrs: { address: string }[];
  try {
    addrs = await resolver(url.hostname);
  } catch {
    throw new MediaError('download_failed', 'dns_resolution_failed');
  }
  if (!addrs.length) throw new MediaError('download_failed', 'dns_no_records');
  for (const a of addrs) {
    if (ipIsDisallowed(a.address)) throw new MediaError('ssrf_blocked', 'resolves_to_private_ip');
  }
  return url;
}

// ---------------------------------------------------------------------------
// Size-capped, redirect-limited streaming download
// ---------------------------------------------------------------------------

export type DownloadResult = {
  bytes: number;
  contentType: string | null;
  finalUrl: string;
};

async function streamToFileCapped(
  body: ReadableStream<Uint8Array>,
  destPath: string,
  maxBytes: number,
): Promise<number> {
  const reader = body.getReader();
  const out = createWriteStream(destPath);
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        throw new MediaError('file_too_large', `>${maxBytes}`);
      }
      if (!out.write(value)) await once(out, 'drain');
    }
    out.end();
    await once(out, 'finish');
    return total;
  } catch (err) {
    out.destroy();
    throw err;
  } finally {
    reader.releaseLock();
  }
}

export async function safeDownloadToFile(opts: {
  url: string;
  destPath: string;
  maxBytes: number;
  timeoutMs: number;
  redirectLimit: number;
  allowlist: string[];
  signal?: AbortSignal;
}): Promise<DownloadResult> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) throw new MediaError('cancelled');
    opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    let current = await assertUrlSafe(opts.url, opts.allowlist);
    let hops = 0;
    for (;;) {
      const res = await fetch(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { 'user-agent': DEFAULT_UA, accept: '*/*' },
      });

      if (res.status >= 300 && res.status < 400) {
        hops += 1;
        if (hops > opts.redirectLimit) throw new MediaError('redirect_limit');
        const loc = res.headers.get('location');
        if (!loc) throw new MediaError('download_failed', 'redirect_without_location');
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
        current = await assertUrlSafe(new URL(loc, current).toString(), opts.allowlist);
        continue;
      }

      if (!res.ok) throw new MediaError('download_failed', `status_${res.status}`);
      if (!res.body) throw new MediaError('download_failed', 'empty_body');

      const declared = Number(res.headers.get('content-length'));
      if (Number.isFinite(declared) && declared > opts.maxBytes) {
        try {
          await res.body.cancel();
        } catch {
          /* ignore */
        }
        throw new MediaError('file_too_large', `content_length_${declared}`);
      }

      const contentType = res.headers.get('content-type');
      const bytes = await streamToFileCapped(res.body, opts.destPath, opts.maxBytes);
      return { bytes, contentType, finalUrl: current.toString() };
    }
  } catch (err) {
    if (controller.signal.aborted) {
      if (opts.signal?.aborted) throw new MediaError('cancelled');
      throw new MediaError('download_timeout');
    }
    if (err instanceof MediaError) throw err;
    throw new MediaError('download_failed', 'fetch_error');
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}

/** Origin only. CDN paths and query strings may both carry opaque locators. */
export function sanitizeUrlForLog(raw: string): string {
  try {
    const u = new URL(raw);
    return u.origin;
  } catch {
    return '[unparseable-url]';
  }
}
