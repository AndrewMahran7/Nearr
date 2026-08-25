import { supabase } from './supabase';
import type { ShareJobEvidenceFrame } from './shareJobResult';
import {
  MAX_RETAINED_EVIDENCE_FRAMES,
  SIGNED_URL_TTL_SECONDS,
} from './shareEvidenceFrameLifecycle';

export { MAX_RETAINED_EVIDENCE_FRAMES, SIGNED_URL_TTL_SECONDS } from './shareEvidenceFrameLifecycle';

export const SHARE_EVIDENCE_BUCKET = 'share-evidence';
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type ResolvedShareEvidenceFrame = ShareJobEvidenceFrame & {
  uri: string | null;
};

type CachedUrl = { uri: string; expiresAt: number };
const signedUrlCache = new Map<string, CachedUrl>();

async function resolveFrames(
  frames: readonly ShareJobEvidenceFrame[],
  limit: number,
  now: number,
): Promise<ResolvedShareEvidenceFrame[]> {
  const bounded = frames.slice(0, limit);
  const missingPaths = [...new Set(bounded.flatMap((frame) => {
    if (frame.url || !frame.storagePath) return [];
    const cached = signedUrlCache.get(frame.storagePath);
    return cached && cached.expiresAt - REFRESH_SKEW_MS > now ? [] : [frame.storagePath];
  }))];

  if (missingPaths.length > 0) {
    const { data, error } = await supabase.storage
      .from(SHARE_EVIDENCE_BUCKET)
      .createSignedUrls(missingPaths, SIGNED_URL_TTL_SECONDS);
    if (!error) {
      for (const row of data ?? []) {
        if (row?.path && row?.signedUrl) {
          signedUrlCache.set(row.path, {
            uri: row.signedUrl,
            expiresAt: now + SIGNED_URL_TTL_SECONDS * 1000,
          });
        }
      }
    }
  }

  return bounded.map((frame) => ({
    ...frame,
    uri: frame.url ?? (frame.storagePath ? signedUrlCache.get(frame.storagePath)?.uri ?? null : null),
  }));
}

/** Resolve all private frame references in one bounded Storage request. */
export async function resolveShareEvidenceFrames(
  frames: readonly ShareJobEvidenceFrame[],
  now = Date.now(),
): Promise<ResolvedShareEvidenceFrame[]> {
  return resolveFrames(frames, MAX_RETAINED_EVIDENCE_FRAMES, now);
}

/** Resolve one already-selected frame per source card in one Storage request.
 * The per-job retention cap above remains unchanged; this larger presentation
 * bound only prevents a many-source place from issuing one signing request per
 * card. */
export async function resolveShareEvidenceFramePreviews(
  frames: readonly ShareJobEvidenceFrame[],
  now = Date.now(),
): Promise<ResolvedShareEvidenceFrame[]> {
  return resolveFrames(frames, 20, now);
}

export function clearShareEvidenceFrameUrlCache(): void {
  signedUrlCache.clear();
}
