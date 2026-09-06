/**
 * Back-compatible sibling selector for Place Detail.
 * Membership is delegated to the canonical durable source-group projection.
 */

import { sourcePlaceGroupForAnchor } from './sourcePlaceGroup';

type SourceCandidate = {
  id: string;
  place_id?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  sources?: Array<{
    identity_key?: string | null;
    canonical_url?: string | null;
    first_attached_at?: string | null;
    is_primary?: boolean | null;
    membership_state?: string | null;
    removed_at?: string | null;
    deleted_at?: string | null;
  }> | null;
};

export const SAME_SOURCE_LIMIT = 6;

export function selectSameSourcePlaces<T extends SourceCandidate>(
  anchor: T | null | undefined,
  all: readonly T[] | null | undefined,
  options?: { limit?: number },
): T[] {
  if (!anchor?.id || !Array.isArray(all)) return [];
  const limit = Math.max(0, Math.floor(options?.limit ?? SAME_SOURCE_LIMIT));
  if (limit === 0) return [];
  const group = sourcePlaceGroupForAnchor(anchor, all);
  return group?.places.filter((candidate) => candidate.id !== anchor.id).slice(0, limit) ?? [];
}
