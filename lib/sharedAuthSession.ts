/**
 * lib/sharedAuthSession.ts
 *
 * PURE, dependency-free helpers for evaluating the Supabase access token that
 * the host app bridges into the App Group (see lib/supabase.ts). Used by the
 * iOS Share Extension to decide whether it can submit a job, and unit-tested
 * from ts-node.
 *
 * DEPENDENCY RULE: no imports — safe to bundle into the Share Extension target
 * (no `atob`/`Buffer`/native deps assumed) and runnable under ts-node.
 *
 * NEVER logs the token. Only decodes the two claims we need (`exp`, `sub`).
 */

export type SharedSessionState = 'valid' | 'expired' | 'absent' | 'malformed';

export type JwtClaims = { exp: number | null; sub: string | null };

const B64_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Minimal base64url → binary-string decoder (no atob / Buffer dependency). */
function base64UrlDecode(input: string): string | null {
  let b64 = input.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4 !== 0) b64 += '=';
  let output = '';
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < b64.length; i++) {
    const c = b64[i];
    if (c === '=') break;
    const idx = B64_ALPHABET.indexOf(c);
    if (idx === -1) return null;
    buffer = (buffer << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

/**
 * Decode the `exp` (seconds) and `sub` (user id) claims from a JWT access
 * token WITHOUT verifying the signature (we only need to know whether the
 * host app's token is still fresh; the server enforces the real check).
 * Returns null for anything that is not a well-formed 3-part JWT.
 */
export function decodeJwtClaims(token: string | null | undefined): JwtClaims | null {
  if (typeof token !== 'string') return null;
  const trimmed = token.trim();
  if (!trimmed) return null;
  const parts = trimmed.split('.');
  if (parts.length !== 3) return null;
  const payloadRaw = base64UrlDecode(parts[1]);
  if (payloadRaw == null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadRaw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;
  const exp = typeof obj.exp === 'number' && Number.isFinite(obj.exp) ? obj.exp : null;
  const sub = typeof obj.sub === 'string' && obj.sub.length > 0 ? obj.sub : null;
  return { exp, sub };
}

/**
 * Classify the shared access token:
 *   - 'absent'    — no token bridged yet (host app not signed in / not launched
 *                   once since install). Show "Open Nearr to sign in".
 *   - 'malformed' — present but not a decodable JWT / missing exp. Treat as
 *                   unusable; recover via the host, never submit.
 *   - 'expired'   — decodable but past `exp` (minus `skewSeconds`, so we never
 *                   submit a token about to die mid-request). Recover via host.
 *   - 'valid'     — safe to submit.
 */
export function evaluateSharedSession(
  token: string | null | undefined,
  nowMs: number = Date.now(),
  skewSeconds = 30,
): SharedSessionState {
  if (typeof token !== 'string' || token.trim().length === 0) return 'absent';
  const claims = decodeJwtClaims(token);
  if (!claims || claims.exp == null) return 'malformed';
  const expiresAtMs = claims.exp * 1000;
  if (expiresAtMs - skewSeconds * 1000 <= nowMs) return 'expired';
  return 'valid';
}

/**
 * What the iOS Share Extension should do given the bridged token AND the App
 * Group bootstrap marker (`sharedAuthInitialized`, set by the host on its first
 * completed getSession()). Splitting "absent" by the marker lets the extension
 * distinguish a first-install-before-launch device ("finish setup") from a
 * genuinely signed-out user ("sign in").
 *
 *   - 'submit'          — valid token; create the job.
 *   - 'needs_setup'     — no token AND host never initialized the bridge:
 *                          "Open Nearr once to finish setup".
 *   - 'signed_out'      — no token but bridge WAS initialized (host ran while
 *                          signed out): "Open Nearr to sign in".
 *   - 'session_expired' — token present but expired/malformed: recover via host.
 */
export type ExtensionAuthAction = 'submit' | 'needs_setup' | 'signed_out' | 'session_expired';

export function selectExtensionAuthAction(args: {
  token: string | null | undefined;
  initialized: boolean;
  nowMs?: number;
  skewSeconds?: number;
}): ExtensionAuthAction {
  const state = evaluateSharedSession(
    args.token,
    args.nowMs ?? Date.now(),
    args.skewSeconds ?? 30,
  );
  switch (state) {
    case 'valid':
      return 'submit';
    case 'expired':
    case 'malformed':
      return 'session_expired';
    case 'absent':
    default:
      return args.initialized ? 'signed_out' : 'needs_setup';
  }
}
