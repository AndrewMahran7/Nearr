/**
 * scripts/testShareRoutes.ts
 *
 * Unit tests for lib/shareRoutes.ts — the canonical queue route + the deep-link
 * path the iOS Share Extension's "View queue" button uses (Bug 2). Guards
 * against the extension deep link drifting away from the real Expo Router
 * route (app/share-jobs/index.tsx).
 *
 * Run:
 *   npx ts-node -P scripts/tsconfig.json scripts/testShareRoutes.ts
 */

import {
  SHARE_JOBS_ROUTE,
  SHARE_JOBS_DEEPLINK_PATH,
  SHARE_JOBS_DEEP_LINK,
  HOST_APP_SCHEME,
  buildHostDeepLink,
  deepLinkPathname,
} from '../lib/shareRoutes';

let failures = 0;
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.log(`FAIL ${name}${detail ? ` - ${detail}` : ''}`);
  }
}

// The route must match the actual file route app/share-jobs/index.tsx.
check('route is /share-jobs', SHARE_JOBS_ROUTE === '/share-jobs');

// openHostApp() prefixes the scheme, so the deep-link path has NO leading slash.
check('deeplink path is share-jobs', SHARE_JOBS_DEEPLINK_PATH === 'share-jobs');
check('deeplink has no leading slash', !SHARE_JOBS_DEEPLINK_PATH.startsWith('/'));

// The deep-link path is DERIVED from the route — they can never drift apart.
check(
  'deeplink derived from route',
  SHARE_JOBS_DEEPLINK_PATH === SHARE_JOBS_ROUTE.replace(/^\/+/, ''),
);

// ---- Structural deep-link form (matches native openHostApp) -----------------
// Native ShareExtensionViewController builds URLComponents with host="" and a
// slash-prefixed path, i.e. `nearr:///share-jobs` (EMPTY host), NOT
// `nearr://share-jobs` (which would treat "share-jobs" as the host).
check('scheme is nearr', HOST_APP_SCHEME === 'nearr');
check(
  'buildHostDeepLink yields empty-host form nearr:///share-jobs',
  buildHostDeepLink('share-jobs') === 'nearr:///share-jobs',
);
check('exported SHARE_JOBS_DEEP_LINK is nearr:///share-jobs', SHARE_JOBS_DEEP_LINK === 'nearr:///share-jobs');
check(
  'buildHostDeepLink tolerates a leading slash too',
  buildHostDeepLink('/share-jobs') === 'nearr:///share-jobs',
);

// ---- The generated URL resolves to the Expo Router pathname /share-jobs ------
check(
  'empty-host form resolves to /share-jobs',
  deepLinkPathname('nearr:///share-jobs') === '/share-jobs',
);
check(
  'host form also resolves to /share-jobs',
  deepLinkPathname('nearr://share-jobs') === '/share-jobs',
);
check(
  'generated deep link parses back to the route',
  deepLinkPathname(SHARE_JOBS_DEEP_LINK) === SHARE_JOBS_ROUTE,
);
check(
  'trailing slash tolerated',
  deepLinkPathname('nearr:///share-jobs/') === '/share-jobs',
);
check(
  'non-scheme string => null',
  deepLinkPathname('share-jobs') === null,
);
// The auth callback deep link must NOT be mistaken for the queue route.
check(
  'auth-callback link parses to its own path (not /share-jobs)',
  deepLinkPathname('nearr://auth-callback#access_token=x') === '/auth-callback',
);

if (failures > 0) {
  console.error(`\n${failures} share-routes test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll share-routes tests passed.');
