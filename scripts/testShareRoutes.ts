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

import { SHARE_JOBS_ROUTE, SHARE_JOBS_DEEPLINK_PATH } from '../lib/shareRoutes';

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

// Full deep link the extension effectively opens (scheme + path).
check(
  'full deep link resolves to nearr://share-jobs',
  `nearr://${SHARE_JOBS_DEEPLINK_PATH}` === 'nearr://share-jobs',
);

if (failures > 0) {
  console.error(`\n${failures} share-routes test(s) FAILED`);
  process.exit(1);
}
console.log('\nAll share-routes tests passed.');
