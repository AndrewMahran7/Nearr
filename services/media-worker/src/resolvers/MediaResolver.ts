// services/media-worker/src/resolvers/MediaResolver.ts
//
// Platform-neutral media retrieval contract. Adding TikTok / Facebook later is
// a new resolver implementing this interface — no pipeline changes. Phase 2
// ships Instagram only, behind a feature flag.

import type { ResolvedMedia } from '../types/media.js';

export type ResolveInput = {
  jobId: string;
  sourceUrl: string;
  canonicalUrl?: string;
  /** Isolated per-job directory the resolver must write into. */
  workDir: string;
  signal: AbortSignal;
};

export interface MediaResolver {
  readonly name: string;

  /** Whether this resolver handles the given platform/url AND is enabled. */
  supports(input: { platform: string; url: URL }): boolean;

  /** Retrieve the public media to a local file. MUST NOT return secrets,
   *  cookies, or authorization headers (even in thrown MediaError detail). */
  resolve(input: ResolveInput): Promise<ResolvedMedia>;
}

/** Pick the first enabled resolver that supports the input, or null. */
export function selectResolver(
  resolvers: MediaResolver[],
  input: { platform: string; url: URL },
): MediaResolver | null {
  for (const r of resolvers) {
    if (r.supports(input)) return r;
  }
  return null;
}
