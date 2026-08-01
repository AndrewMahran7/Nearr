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
 * Deep-link path handed to expo-share-extension `openHostApp()`, which prefixes
 * the configured app scheme (`nearr://`). Derived from SHARE_JOBS_ROUTE — the
 * same route, without the leading slash — so the two can never drift apart.
 */
export const SHARE_JOBS_DEEPLINK_PATH = SHARE_JOBS_ROUTE.replace(/^\/+/, '');
