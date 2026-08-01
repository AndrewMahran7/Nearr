/**
 * lib/shareSubmission.ts
 *
 * PURE, dependency-free helpers for a STABLE share submission id that dedupes a
 * single share action into at most one `create-share-job` call — even when the
 * extension callback fires twice, React effects run twice, the user taps twice,
 * the request times out after the server accepted it, the extension hands off to
 * the host, or the host cold-start AND warm-start deep-link listeners both
 * process the same URL.
 *
 * ROOT CAUSE THIS FIXES
 * ---------------------
 * ShareJobHandoff and AsyncShareExtension previously minted a RANDOM request id
 * per component MOUNT (`useRef(`${Date.now()}-${Math.random()}`)`). So the
 * extension and the host fallback used DIFFERENT ids, and cold/warm re-delivery
 * of the same deep link remounted the handoff with a NEW id — defeating the
 * server's `idempotency_key` dedup and creating multiple queue rows for one
 * shared video.
 *
 * The submission id travels: extension → create-share-job → host fallback deep
 * link (`?sid=`) → retry. All readers of the same deep link get the same id, so
 * the server returns the existing job on conflict. A DELIBERATE later re-share
 * is a new share action (new mint / new time bucket) and is allowed.
 *
 * Runnable under ts-node; safe to bundle into the iOS Share Extension.
 */

/** The deep-link query parameter that carries the submission id. */
export const SUBMISSION_ID_PARAM = 'sid' as const;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/** Small, stable, non-cryptographic string hash (FNV-1a) → base36. */
export function stableHash(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply via shifts (stays in 32-bit range).
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(36);
}

/**
 * Mint a fresh opaque id for a genuinely NEW share action (a fresh extension
 * invocation or an explicit in-app paste/submit). Random + time so two distinct
 * share actions never collide.
 */
export function mintSubmissionId(
  rand: () => number = Math.random,
  now: () => number = Date.now,
): string {
  const a = Math.floor(rand() * 1e9).toString(36);
  const b = now().toString(36);
  return `s_${b}_${a}`;
}

/**
 * Deterministic fallback id for a URL when no id was propagated (Android share
 * intent, in-app paste, or a deep link that lost its `sid`). Stable within a
 * coarse time bucket so cold/warm double-delivery of the SAME url collapses to
 * one id, while a deliberate re-share in a later bucket gets a new id.
 */
export function deriveSubmissionIdForUrl(
  url: string,
  nowMs: number = Date.now(),
  bucketMs = 120_000,
): string {
  const normalized = (url ?? '').trim().toLowerCase();
  const bucket = Math.floor(nowMs / Math.max(1, bucketMs));
  return `u_${stableHash(`${bucket}:${normalized}`)}`;
}

/** True for a syntactically plausible submission id. */
export function isSubmissionId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z]_[A-Za-z0-9_]{1,80}$/.test(value);
}

/**
 * Append the submission id to a host deep-link path/URL as `?sid=...` (or
 * `&sid=...`). Idempotent: never adds a second `sid`.
 */
export function appendSubmissionId(pathOrUrl: string, sid: string): string {
  if (!sid) return pathOrUrl;
  const [base, hash = ''] = pathOrUrl.split('#', 2);
  if (new RegExp(`[?&]${SUBMISSION_ID_PARAM}=`).test(base)) return pathOrUrl;
  const sep = base.includes('?') ? '&' : '?';
  const rebuilt = `${base}${sep}${SUBMISSION_ID_PARAM}=${encodeURIComponent(sid)}`;
  return hash ? `${rebuilt}#${hash}` : rebuilt;
}

/** Extract a previously-propagated submission id from a URL, or null. */
export function extractSubmissionId(url: string | null | undefined): string | null {
  if (typeof url !== 'string' || !url) return null;
  const m = url.match(new RegExp(`[?&]${SUBMISSION_ID_PARAM}=([^&#]+)`));
  if (!m) return null;
  let value: string;
  try {
    value = decodeURIComponent(m[1]);
  } catch {
    value = m[1];
  }
  return isSubmissionId(value) ? value : null;
}

/**
 * Resolve the submission id for a host-side submit: prefer one propagated in the
 * deep link, else derive a deterministic (remount-stable) one from the URL.
 */
export function resolveSubmissionId(args: {
  url: string;
  fromDeepLink?: string | null;
  nowMs?: number;
}): string {
  if (args.fromDeepLink && isSubmissionId(args.fromDeepLink)) return args.fromDeepLink;
  return deriveSubmissionIdForUrl(args.url, args.nowMs ?? Date.now());
}
