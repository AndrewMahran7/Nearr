import { supabase } from './supabase';
import type { ShareJobEvidenceFrame } from './shareJobResult';

export const SHARE_EVIDENCE_BUCKET = 'share-evidence';
export const MAX_RETAINED_EVIDENCE_FRAMES = 5;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const REFRESH_SKEW_MS = 5 * 60 * 1000;

export type ResolvedShareEvidenceFrame = ShareJobEvidenceFrame & { uri: string | null };

type CachedUrl = { uri: string; expiresAt: number };
const signedUrlCache = new Map<string, CachedUrl>();

/** Resolve all private frame references in one bounded Storage request. */
export async function resolveShareEvidenceFrames(
  frames: readonly ShareJobEvidenceFrame[],
  now = Date.now(),
): Promise<ResolvedShareEvidenceFrame[]> {
  const bounded = frames.slice(0, MAX_RETAINED_EVIDENCE_FRAMES);
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

export function clearShareEvidenceFrameUrlCache(): void {
  signedUrlCache.clear();
}
