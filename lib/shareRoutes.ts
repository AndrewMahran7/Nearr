/**
 * lib/shareRoutes.ts
 *
 * Canonical Expo Router paths for the async share-job queue, shared between
 * the host app and the iOS Share Extension so the extension's "View queue"
 * deep link always matches the real route (app/share-jobs/index.tsx) instead
 * of a hardcoded guess.
 *
 * PURE — no imports — safe to bundle into the Share Extension and testable
 * from ts-node.
 */

/** Expo Router pathname for the in-app queue screen (app/share-jobs/index.tsx). */
export const SHARE_JOBS_ROUTE = '/share-jobs' as const;

/**
 * Deep-link path handed to expo-share-extension `openHostApp()`. The native
 * side (ShareExtensionViewController.openHostApp) does:
 *   urlComponents.scheme = <HostAppScheme>   // "nearr"
 *   urlComponents.host   = ""                // EMPTY host
 *   urlComponents.path   = path.hasPrefix("/") ? path : "/" + path
 * so it wants the route WITHOUT a leading slash (it adds one). Derived from
 * SHARE_JOBS_ROUTE so the two can never drift apart.
 */
export const SHARE_JOBS_DEEPLINK_PATH = SHARE_JOBS_ROUTE.replace(/^\/+/, '');

/** The app's URL scheme (app.json → "scheme"). */
export const HOST_APP_SCHEME = 'nearr' as const;

/**
 * Reproduce EXACTLY what the native `openHostApp` builds: an empty-host URL
 * with a slash-prefixed path, e.g. `nearr:///share-jobs`. (Empty host means
 * the segment after the scheme is the PATH, not the authority — which is why
 * `nearr:///share-jobs` resolves to pathname `/share-jobs`, whereas
 * `nearr://share-jobs` would treat `share-jobs` as the host.)
 */
export function buildHostDeepLink(path: string, scheme: string = HOST_APP_SCHEME): string {
  const withoutQuery = path.split('?', 1)[0];
  const query = path.includes('?') ? path.slice(path.indexOf('?')) : '';
  const slashed = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  return `${scheme}://${slashed}${query}`;
}

/**
 * Extract the Expo Router pathname from a deep-link URL, handling the
 * empty-host form the extension emits (`nearr:///share-jobs`) as well as the
 * host-form (`nearr://share-jobs`). Returns null for a non-matching scheme.
 */
export function deepLinkPathname(url: string): string | null {
  const schemeSep = url.indexOf('://');
  if (schemeSep === -1) return null;
  let rest = url.slice(schemeSep + 3);
  rest = rest.split('?')[0].split('#')[0];
  if (rest.startsWith('/')) {
    // Empty-host form: nearr:///share-jobs → "/share-jobs".
    return rest.replace(/\/+$/, '') || '/';
  }
  // Host form: nearr://share-jobs → host "share-jobs", pathname "/share-jobs".
  const slash = rest.indexOf('/');
  const host = slash === -1 ? rest : rest.slice(0, slash);
  const tail = slash === -1 ? '' : rest.slice(slash);
  return `/${host}${tail}`.replace(/\/+$/, '') || '/';
}

/** The exact deep link the extension's View queue emits: `nearr:///share-jobs`. */
export const SHARE_JOBS_DEEP_LINK = buildHostDeepLink(SHARE_JOBS_DEEPLINK_PATH);
