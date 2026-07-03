// supabase/functions/process-share-link/resolver/queryBuilder.ts
//
// Build an ordered ladder of Google Places queries from the
// extracted evidence. Order: name+addr+city > addr+city > name+city.
// Re-uses `buildCleanPlacesQueries` from the shared queryCleaner
// module so behavior stays consistent with the in-app agent.

import type { Evidence } from '../evidence/extractEvidence.ts';
import { buildCleanPlacesQueries } from '../../../../lib/shareAgent/queryCleaner.ts';

export type QueryPlan = {
  queries: string[];
  /** Preferred name hint passed into buildCleanPlacesQueries —
   *  surfaces in candidate scoring downstream. */
  placeNameHint: string | null;
  /** True when the caption carried an explicit place signal (address,
   *  caption venue hint, or a tagged venue handle). When false we refuse
   *  to run casual caption prose as a Places query. */
  hasExplicitPlaceEvidence: boolean;
};

export function buildQueryPlan(evidence: Evidence): QueryPlan {
  // Pick the strongest name hint we have: caption venue hint > venue
  // handle > poster name hint.
  const placeNameHint =
    evidence.venueNameHints[0] ??
    (evidence.handles.venueHandles[0]
      ? humanize(evidence.handles.venueHandles[0])
      : null) ??
    evidence.handles.posterNameHint ??
    null;

  // Explicit place evidence = something that actually anchors a place
  // (a street address, a caption venue hint like "📍 X" / "X, City", or a
  // tagged venue handle). A bare poster handle / poster name / city context
  // does NOT qualify — those must not license querying raw caption prose.
  const hasExplicitPlaceEvidence =
    !!evidence.address ||
    evidence.venueNameHints.length > 0 ||
    evidence.handles.venueHandles.length > 0;

  const queries = buildCleanPlacesQueries({
    title: evidence.rawTitle,
    description: evidence.rawDescription,
    address: evidence.address,
    placeName: placeNameHint,
    city: evidence.cityState?.city ?? evidence.address?.city ?? null,
    profileDisplayName: null,
    // Only allow casual caption prose as a seed when an explicit place
    // signal is present to anchor it.
    allowGenericCaptionSeed: hasExplicitPlaceEvidence,
    max: 6,
  });

  return { queries, placeNameHint, hasExplicitPlaceEvidence };
}

function humanize(handle: string): string {
  return handle
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
