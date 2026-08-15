/**
 * lib/openOriginalPost.ts
 *
 * PURE, security-focused validation for the confirmation screen's "Open
 * original post" action. The job's persisted source URL is untrusted input, so
 * before we ever hand it to `Linking.openURL` we require:
 *   - a parseable URL,
 *   - the `https:` scheme ONLY (never javascript:/file:/data:/custom schemes),
 *   - a host on the allow-list of supported social platforms.
 *
 * No React Native / Deno imports and no I/O — unit-testable from ts-node. The
 * screen calls `planOpenOriginal(sourceUrl)` and only opens when the plan says
 * so; opening never resolves, cancels, or removes the queue job (the plan has
 * no such outcome by construction).
 */

/** Registrable domains we allow the "Open original post" action to open. A URL
 *  is allowed if its host equals one of these or is a subdomain of one. */
export const ALLOWED_SOURCE_HOSTS = [
  'instagram.com',
  'tiktok.com',
  'youtube.com',
  'youtu.be',
  'facebook.com',
  'fb.watch',
  'snapchat.com',
  'twitter.com',
  'x.com',
] as const;

export type OpenOriginalReason =
  | 'missing' // no source URL persisted
  | 'malformed' // not a parseable URL
  | 'insecure_scheme' // not https (blocks javascript:/file:/data:/http:/custom)
  | 'unsupported_host'; // parseable https URL but host not on the allow-list

export type SourceUrlValidation =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: OpenOriginalReason };

function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, '');
}

function isAllowedHost(host: string): boolean {
  const h = normalizeHost(host);
  return ALLOWED_SOURCE_HOSTS.some((allowed) => h === allowed || h.endsWith(`.${allowed}`));
}

/**
 * Validate an untrusted source URL for the "Open original post" action. Never
 * throws.
 */
export function validateSourceUrl(raw: string | null | undefined): SourceUrlValidation {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    return { ok: false, reason: 'missing' };
  }
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'insecure_scheme' };
  }
  if (!parsed.hostname || !isAllowedHost(parsed.hostname)) {
    return { ok: false, reason: 'unsupported_host' };
  }
  return { ok: true, url: parsed.toString(), host: normalizeHost(parsed.hostname) };
}

/** Convenience boolean for showing/hiding the action. */
export function canOpenOriginal(raw: string | null | undefined): boolean {
  return validateSourceUrl(raw).ok;
}

export type OpenOriginalPlan =
  | { kind: 'open'; url: string; host: string; analyticsEvent: 'share_job_original_post_opened' }
  | { kind: 'unavailable'; reason: OpenOriginalReason };

/**
 * Decide what the "Open original post" action should do for a given source URL.
 * The only successful outcome is `open` — there is deliberately NO outcome that
 * resolves, saves, cancels, or removes the job, so opening the original post
 * can never mutate queue state. Pure and idempotent.
 */
export function planOpenOriginal(raw: string | null | undefined): OpenOriginalPlan {
  const v = validateSourceUrl(raw);
  if (!v.ok) return { kind: 'unavailable', reason: v.reason };
  return {
    kind: 'open',
    url: v.url,
    host: v.host,
    analyticsEvent: 'share_job_original_post_opened',
  };
}
