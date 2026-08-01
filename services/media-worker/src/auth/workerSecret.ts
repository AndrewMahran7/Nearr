// services/media-worker/src/auth/workerSecret.ts
//
// Validate the dedicated invocation secret (SHARE_MEDIA_WORKER_SECRET) the DB
// wake-up / cron presents. This is NOT the service-role key — the service-role
// key is never accepted here and never sent to this endpoint.

import { timingSafeEqual } from 'node:crypto';

export function extractBearer(header: string | null | undefined): string {
  const h = header ?? '';
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
}

export function checkWorkerSecret(
  authorizationHeader: string | null | undefined,
  expected: string,
): boolean {
  const provided = extractBearer(authorizationHeader);
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
