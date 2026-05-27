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

  const queries = buildCleanPlacesQueries({
    title: evidence.rawTitle,
    description: evidence.rawDescription,
    address: evidence.address,
    placeName: placeNameHint,
    city: evidence.cityState?.city ?? evidence.address?.city ?? null,
    profileDisplayName: null,
    max: 6,
  });

  return { queries, placeNameHint };
}

function humanize(handle: string): string {
  return handle
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
