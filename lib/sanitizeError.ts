/**
 * lib/sanitizeError.ts
 *
 * PURE helper that strips secrets/PII from an error message or stack before it
 * is logged, so a crash is diagnosable WITHOUT leaking access/refresh tokens,
 * URL credentials, or Supabase keys. No imports — testable from ts-node.
 */

/** Redact JWTs, bearer tokens, URL credentials, and token-ish key/values. */
export function sanitizeErrorText(input: unknown): string {
  let s =
    input instanceof Error
      ? `${input.name}: ${input.message}`
      : typeof input === 'string'
      ? input
      : String(input ?? '');

  // JWTs: header.payload.signature (starts with eyJ...).
  s = s.replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '<jwt>');
  // Authorization: Bearer <token>.
  s = s.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer <redacted>');
  // URL credentials: scheme://user:pass@host.
  s = s.replace(/\/\/[^/@\s:]+:[^/@\s]+@/g, '//<redacted>@');
  // token / access_token / refresh_token / apikey / api_key / password = value.
  s = s.replace(
    /((?:access_token|refresh_token|token|apikey|api_key|password|secret)["'\s]*[:=]["'\s]*)[^\s"'&,}]+/gi,
    '$1<redacted>',
  );
  // Long opaque base64/hex blobs (>=40 chars) that might be a raw secret.
  s = s.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '<redacted>');
  return s;
}

/** Sanitize a multi-line stack/component stack, capped to a sane length. */
export function sanitizeStack(stack: unknown, maxLen = 2000): string {
  const s = sanitizeErrorText(stack);
  return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
}
