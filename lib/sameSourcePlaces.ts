/**
 * lib/sameSourcePlaces.ts
 *
 * "Which of my other saved places came out of THIS post?"
 *
 * One reel can now produce several destinations — Ometepe, Granada, San Juan
 * del Sur, León. Those places have a real semantic relationship that has
 * nothing to do with how far apart they are, so Place Detail surfaces them as
 * their own section rather than hoping a distance ranking stumbles onto them.
 *
 * Identity is the stored `source_url`, compared through the SAME predicate the
 * provenance merge policy uses (`isSameSourceUrl`, delegating canonicalization
 * to `normalizeShareUrl`). That matters:
 *   - one reel matches itself across harmless tracking params
 *   - two different reels by the same creator have different paths, so they
 *     never merge
 *   - Instagram and TikTok keep their hosts, so they cannot collide
 *   - a manual save has no URL at all, so it forms no group
 * Nothing here infers membership from timing, creator, city or category.
 *
 * Membership is read from the user's CURRENT saved collection, so a place they
 * removed simply stops being a sibling; historical share-job results are never
 * consulted to repopulate the row.
 *
 * PURE — no React Native, no I/O, no provider calls. Unit-tested from ts-node.
 */

// Relative imports so the ts-node unit tests can load this module without the
// Metro path alias.
import { isSameSourceUrl } from './savedPlaceSourceMerge';
import { normalizeShareUrl } from './shareAgent/tiktokUrl';

/** Minimal shape needed to group saved places by their source post. */
type SourceCandidate = {
  id: string;
  source_url?: string | null;
  /** Saved-at timestamp; the tie-break that reproduces the post's own order. */
  created_at?: string | null;
};

/** Bounded so one very generous reel cannot produce an endless row. */
export const SAME_SOURCE_LIMIT = 6;

/** `normalizeShareUrl` returns a record; the merge policy wants just the URL. */
const normalizeUrl = (url: string): string => normalizeShareUrl(url).url;

function trimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const out = value.trim();
  return out.length > 0 ? out : null;
}

/**
 * The user's other saved places from the same post as `anchor`.
 *
 * Order reproduces the order they were saved, which for a multi-place share is
 * the order the resolver emitted them — the closest thing to "the order they
 * appeared in the video" that exists client-side today. There is no
 * `source_index` column, and inventing a relevance score for four destinations
 * from one reel would be noise, so `created_at` ascending (id as a stable
 * tie-break for identical timestamps) is the deliberate choice.
 *
 * Returns an empty array when the anchor has no source, when nothing else came
 * from it, or on any degenerate input — the caller then renders no section at
 * all rather than an empty heading.
 */
export function selectSameSourcePlaces<T extends SourceCandidate>(
  anchor: T | null | undefined,
  all: readonly T[] | null | undefined,
  options?: { limit?: number },
): T[] {
  const anchorUrl = trimmed(anchor?.source_url);
  // A manual save names no post, so it can never have siblings.
  if (!anchorUrl || !anchor?.id || !Array.isArray(all)) return [];

  const limit = Math.max(0, Math.floor(options?.limit ?? SAME_SOURCE_LIMIT));
  if (limit === 0) return [];

  const seen = new Set<string>([anchor.id]);
  const siblings: T[] = [];

  for (const candidate of all) {
    // Exclusion is by exact saved_places.id — never by name or coordinate — so
    // the place being viewed can never appear in its own list, and a row that
    // somehow arrives twice cannot render twice.
    if (!candidate?.id || seen.has(candidate.id)) continue;
    // Cheap reject before the URL parse. Manual saves are the common case in
    // most collections, and skipping them keeps this a handful of
    // canonicalizations per detail open rather than one per saved place.
    if (!trimmed(candidate.source_url)) continue;
    if (!isSameSourceUrl(anchorUrl, candidate.source_url, normalizeUrl)) continue;
    seen.add(candidate.id);
    siblings.push(candidate);
  }

  siblings.sort((a, b) => {
    const left = trimmed(a.created_at) ?? '';
    const right = trimmed(b.created_at) ?? '';
    if (left !== right) return left < right ? -1 : 1;
    return a.id < b.id ? -1 : 1;
  });

  return siblings.slice(0, limit);
}
