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
  // Venue name = caption-derived hint > tagged venue handle. The poster
  // handle / poster display name is a SEPARATE, weaker signal.
  const venueName =
    evidence.address?.venue ??
    evidence.venueNameHints[0] ??
    (evidence.handles.venueHandles[0]
      ? humanize(evidence.handles.venueHandles[0])
      : null) ??
    null;

  // Address evidence is stronger than the poster. When a street address is
  // present we NEVER prepend the poster handle/name to a Places query — only
  // the caption-derived venue may qualify the address. The poster name is
  // only allowed as a weak fallback when there is no address at all (this
  // preserves the pre-existing no-address behavior).
  const placeNameHint = evidence.address
    ? venueName
    : venueName ?? evidence.handles.posterNameHint ?? null;

  // Explicit place evidence = something that actually anchors a place
  // (a street address, a caption venue hint like "📍 X" / "X, City", or a
  // tagged venue handle). A bare poster handle / poster name / city context
  // does NOT qualify — those must not license querying raw caption prose.
  const hasExplicitPlaceEvidence =
    !!evidence.address ||
    evidence.venueNameHints.length > 0 ||
    evidence.handles.venueHandles.length > 0;

  const queries: string[] = [];
  const push = (q: string | null | undefined) => {
    if (!q) return;
    const trimmed = q.trim();
    if (!trimmed) return;
    if (queries.some((existing) => existing.toLowerCase() === trimmed.toLowerCase())) return;
    queries.push(trimmed);
  };

  const nameVariants = expandPlaceNameVariants(placeNameHint);
  const cityHint = evidence.cityState?.city ?? evidence.address?.city ?? null;
  const namesToTry = nameVariants.length > 0 ? nameVariants : [null];
  for (const nameVariant of namesToTry) {
    const subQueries = buildCleanPlacesQueries({
      title: evidence.rawTitle,
      description: evidence.rawDescription,
      address: evidence.address,
      placeName: nameVariant,
      city: cityHint,
      profileDisplayName: null,
      // Only allow casual caption prose as a seed when an explicit place
      // signal is present to anchor it.
      allowGenericCaptionSeed: hasExplicitPlaceEvidence,
      max: 6,
    });
    for (const q of subQueries) push(q);
  }

  return { queries, placeNameHint, hasExplicitPlaceEvidence };
}

function expandPlaceNameVariants(placeName: string | null): string[] {
  if (!placeName) return [];
  const base = placeName.trim();
  if (!base) return [];
  const variants = [base];
  if (base.includes("'")) return variants;
  const words = base.split(/\s+/).filter(Boolean);
  if (words.length < 1) return variants;
  const first = words[0];
  if (/^[A-Za-z]+s$/i.test(first) && first.length >= 5) {
    const possessiveFirst = `${first.slice(0, -1)}'s`;
    const alt = [possessiveFirst, ...words.slice(1)].join(' ');
    if (!variants.some((v) => v.toLowerCase() === alt.toLowerCase())) {
      variants.push(alt);
    }
  }
  return variants;
}

function humanize(handle: string): string {
  return handle
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
