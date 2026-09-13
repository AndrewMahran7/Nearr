export type PlaceImageHydrationPolicy =
  | 'saved_snapshot'
  | 'saved_missing_visual'
  | 'active_candidate'
  | 'inactive_candidate'
  | 'active_manual_search'
  | 'offscreen_manual_search'
  | 'compact_known_only';

/**
 * Provider metadata eligibility is intentionally separate from rendering.
 * Already-known image URLs remain renderable in every context.
 */
export function allowsPlaceImageLookup(
  policy: PlaceImageHydrationPolicy,
  hasGooglePlaceId: boolean,
): boolean {
  if (!hasGooglePlaceId) return false;
  return policy === 'saved_missing_visual'
    || policy === 'active_candidate'
    || policy === 'active_manual_search';
}

export function placeImagePolicyForCandidate(active: boolean): PlaceImageHydrationPolicy {
  return active ? 'active_candidate' : 'inactive_candidate';
}
