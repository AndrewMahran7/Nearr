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
): '/(onboarding)' | '/(tabs)/map' {
  return onboardingStatus === 'required' ? '/(onboarding)' : '/(tabs)/map';
}

export function decideAuthResolutionRoute(args: {
  hasSession: boolean;
  onboardingStatus: OnboardingStatus;
  signedOutRoute: '/(onboarding)' | '/(auth)/sign-in';
}): '/(onboarding)' | '/(tabs)/map' | '/(auth)/sign-in' {
  if (!args.hasSession) return args.signedOutRoute;
  return routeAfterAuthenticatedUser(args.onboardingStatus);
}
