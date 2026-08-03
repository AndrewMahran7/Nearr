import type { OnboardingStatus } from './onboarding';

export type AuthLinkParseResult = {
  matches: boolean;
  params: Record<string, string>;
  hasCode: boolean;
  hasTokens: boolean;
  safePath: string;
};

const AUTH_SCHEMES = new Set(['nearr', 'exp', 'exps']);

function parseParamsFromSearch(search: string, out: Record<string, string>) {
  const searchParams = new URLSearchParams(search);
  searchParams.forEach((value, key) => {
    out[key] = value;
  });
}

function splitSegments(url: URL): string[] {
  return [url.hostname, url.pathname]
    .flatMap((value) => value.split('/'))
    .map((value) => value.trim())
    .filter(Boolean)
    .filter((value) => value !== '--');
}

function hashString(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) +
      (hash << 4) +
      (hash << 7) +
      (hash << 8) +
      (hash << 24);
  }
  return (hash >>> 0).toString(16);
}

function authIdentitySeed(url: string, params: Record<string, string>): string {
  if (params.code) return `code:${params.code}`;
  if (params.access_token && params.refresh_token) {
    return `tokens:${params.access_token}:${params.refresh_token}`;
  }
  return `url:${url}`;
}

export function parseAuthCallbackUrl(url: string): AuthLinkParseResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return {
      matches: false,
      params: {},
      hasCode: false,
      hasTokens: false,
      safePath: 'invalid-url',
    };
  }

  const params: Record<string, string> = {};
  parseParamsFromSearch(parsed.search, params);
  parseParamsFromSearch(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash, params);

  const hasCode = Boolean(params.code);
  const hasTokens = Boolean(params.access_token && params.refresh_token);
  const hasMagicLinkType = (params.type ?? '').toLowerCase() === 'magiclink';

  const segments = splitSegments(parsed);
  const hasCallbackSegment = segments.includes('auth-callback');

  const scheme = parsed.protocol.replace(':', '').toLowerCase();
  const isKnownAuthScheme = AUTH_SCHEMES.has(scheme);
  const hasAuthPayload = hasCode || hasTokens || hasMagicLinkType;

  const safePath = `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  const matches = hasCallbackSegment || (isKnownAuthScheme && hasAuthPayload);

  return {
    matches,
    params,
    hasCode,
    hasTokens,
    safePath,
  };
}

export function createAuthLinkDuplicateGuard(windowMs = 12_000) {
  let lastIdentityHash: string | null = null;
  let lastSeenAt = 0;

  return {
    shouldIgnore(url: string, params: Record<string, string>, nowMs = Date.now()): boolean {
      const nextHash = hashString(authIdentitySeed(url, params));
      const isDuplicate = lastIdentityHash === nextHash && nowMs - lastSeenAt <= windowMs;
      lastIdentityHash = nextHash;
      lastSeenAt = nowMs;
      return isDuplicate;
    },
    reset() {
      lastIdentityHash = null;
      lastSeenAt = 0;
    },
  };
}

export function routeAfterAuthenticatedUser(
  onboardingStatus: OnboardingStatus,
): '/activate' | '/(tabs)/map' {
  // A user with no saved places yet ('required') lands on the post-account
  // activation screen ("Save your first place"); an established user goes
  // straight to the map.
  return onboardingStatus === 'required' ? '/activate' : '/(tabs)/map';
}

export function decideAuthResolutionRoute(args: {
  hasSession: boolean;
  onboardingStatus: OnboardingStatus;
  signedOutRoute: '/(onboarding)' | '/(auth)/sign-in';
}): '/activate' | '/(tabs)/map' | '/(onboarding)' | '/(auth)/sign-in' {
  if (!args.hasSession) return args.signedOutRoute;
  return routeAfterAuthenticatedUser(args.onboardingStatus);
}

/**
 * Terminal-state model for magic-link handling, owned by the root layout and
 * published to the auth-callback screen.
 *
 *   - `idle`       — no auth link has been handled yet.
 *   - `processing` — an exchange is in flight.
 *   - `succeeded`  — the exchange established a session.
 *   - `failed`     — the exchange finished without a session (expired/invalid
 *                    /duplicate-without-session).
 *
 * `succeeded`/`failed` are STICKY (they persist until the next link resets the
 * state to `processing`). This is what makes the callback screen robust to
 * mount ordering: a screen that mounts AFTER a fast warm-link failure still
 * reads `failed` and resolves, instead of missing a transient boolean.
 */
export type AuthLinkStatus = 'idle' | 'processing' | 'succeeded' | 'failed';

export type AuthCallbackDecision = 'wait' | 'navigate_app' | 'navigate_sign_in';

/**
 * Pure resolver for what the auth-callback screen should do, given the current
 * terminal status and whether a session is present. Deterministic and
 * independent of React effect ordering, so it can be exhaustively unit-tested.
 *
 *   - A present session (or a `succeeded` status) → go into the app.
 *   - A `failed` status with no session → go to sign-in.
 *   - Otherwise (`idle`/`processing`, no session) → keep waiting.
 *
 * A present session always wins over `failed`, so a duplicate link that was
 * labelled `failed` but whose original attempt already signed the user in
 * still routes into the app rather than bouncing to sign-in.
 */
export function decideAuthCallbackNavigation(args: {
  status: AuthLinkStatus;
  hasSession: boolean;
}): AuthCallbackDecision {
  if (args.hasSession || args.status === 'succeeded') return 'navigate_app';
  if (args.status === 'failed') return 'navigate_sign_in';
  return 'wait';
}
