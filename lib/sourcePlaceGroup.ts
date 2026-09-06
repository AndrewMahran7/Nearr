/**
 * Canonical, durable "Places from this video" membership.
 *
 * `saved_place_sources.identity_key` owns the relationship. Navigation batches
 * are only entry hints: after one hinted place identifies the source, current
 * membership is rebuilt from the live saved-place collection.
 *
 * PURE: shared by React Native and the Node regression suite.
 */

import { canonicalContentIdentity } from './shareAgent/contentIdentity';

type SourceRelationshipLike = {
  identity_key?: string | null;
  canonical_url?: string | null;
  first_attached_at?: string | null;
  is_primary?: boolean | null;
};

export type SourceGroupPlaceLike = {
  id: string;
  place_id?: string | null;
  source_url?: string | null;
  created_at?: string | null;
  sources?: readonly SourceRelationshipLike[] | null;
  place?: {
    id?: string | null;
    google_place_id?: string | null;
  } | null;
};

export type SourcePlaceGroup<T> = {
  identityKey: string;
  places: T[];
};

function clean(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function legacyIdentityKey(sourceUrl: string | null | undefined): string | null {
  const url = clean(sourceUrl);
  if (!url) return null;
  return canonicalContentIdentity(url)?.key ?? null;
}

type ActiveRelationship = {
  identityKey: string;
  attachedAt: string;
  primary: boolean;
};

/** Active source identities for one durable saved-place row. */
export function activeSourceRelationships(place: SourceGroupPlaceLike): ActiveRelationship[] {
  const sources = Array.isArray(place.sources) ? place.sources : null;
  if (sources && sources.length > 0) {
    const seen = new Set<string>();
    const active: ActiveRelationship[] = [];
    for (const source of sources) {
      const identityKey = clean(source.identity_key) ?? legacyIdentityKey(source.canonical_url);
      if (!identityKey || seen.has(identityKey)) continue;
      seen.add(identityKey);
      active.push({
        identityKey,
        attachedAt: clean(source.first_attached_at) ?? '',
        primary: source.is_primary === true,
      });
    }
    return active;
  }

  // Compatibility only for old/offline rows. Once child relations exist, an
  // inactive relation cannot be resurrected by the legacy parent mirror.
  const identityKey = legacyIdentityKey(place.source_url);
  return identityKey
    ? [{ identityKey, attachedAt: clean(place.created_at) ?? '', primary: true }]
    : [];
}

function canonicalPlaceKey(place: SourceGroupPlaceLike): string {
  const googlePlaceId = clean(place.place?.google_place_id);
  return clean(place.place_id)
    ?? clean(place.place?.id)
    ?? (googlePlaceId ? `google:${googlePlaceId}` : null)
    ?? `saved:${place.id}`;
}

function groupForIdentity<T extends SourceGroupPlaceLike>(
  allPlaces: readonly T[],
  identityKey: string,
  preferredSavedPlaceId?: string | null,
): SourcePlaceGroup<T> {
  const candidates = allPlaces
    // Current production has no state column on saved_place_sources: a child
    // row exists only while the owned save/source association exists. Soft
    // alternatives live in share_job_place_results and become group members
    // only when Keep/Make primary materializes a saved place + source row.
    .filter((place) => !!place?.id)
    .map((place) => ({
      place,
      relation: activeSourceRelationships(place).find((source) => source.identityKey === identityKey),
    }))
    .filter((entry): entry is { place: T; relation: ActiveRelationship } => !!entry.relation)
    .sort((left, right) => {
      if (left.relation.attachedAt !== right.relation.attachedAt) {
        return left.relation.attachedAt < right.relation.attachedAt ? -1 : 1;
      }
      const leftCreated = clean(left.place.created_at) ?? '';
      const rightCreated = clean(right.place.created_at) ?? '';
      if (leftCreated !== rightCreated) return leftCreated < rightCreated ? -1 : 1;
      return left.place.id.localeCompare(right.place.id);
    });

  const canonicalIndexes = new Map<string, number>();
  const places: T[] = [];
  for (const candidate of candidates) {
    const key = canonicalPlaceKey(candidate.place);
    const existingIndex = canonicalIndexes.get(key);
    if (existingIndex != null) {
      if (candidate.place.id === preferredSavedPlaceId) places[existingIndex] = candidate.place;
      continue;
    }
    canonicalIndexes.set(key, places.length);
    places.push(candidate.place);
  }
  return { identityKey, places };
}

/** Resolve the source group that owns the anchor's primary source. */
export function sourcePlaceGroupForAnchor<T extends SourceGroupPlaceLike>(
  anchor: T | null | undefined,
  allPlaces: readonly T[] | null | undefined,
  preferredIdentityKey?: string | null,
): SourcePlaceGroup<T> | null {
  if (!anchor?.id || !Array.isArray(allPlaces)) return null;
  const relationships = activeSourceRelationships(anchor);
  const preferred = clean(preferredIdentityKey);
  const identityKey = preferred && relationships.some((source) => source.identityKey === preferred)
    ? preferred
    : relationships.find((source) => source.primary)?.identityKey
      ?? relationships[0]?.identityKey
      ?? null;
  return identityKey ? groupForIdentity(allPlaces, identityKey, anchor.id) : null;
}

/** Expand an initial save/navigation batch to current durable membership. */
export function sourcePlaceGroupFromSeeds<T extends SourceGroupPlaceLike>(
  allPlaces: readonly T[],
  seedSavedPlaceIds: readonly string[],
): SourcePlaceGroup<T> | null {
  const byId = new Map(allPlaces.map((place) => [place.id, place]));
  const counts = new Map<string, { count: number; firstOrder: number }>();
  seedSavedPlaceIds.forEach((id, order) => {
    const place = byId.get(id);
    if (!place) return;
    for (const source of activeSourceRelationships(place)) {
      const current = counts.get(source.identityKey);
      counts.set(source.identityKey, {
        count: (current?.count ?? 0) + 1,
        firstOrder: current?.firstOrder ?? order,
      });
    }
  });
  const identityKey = [...counts.entries()]
    .sort((left, right) => right[1].count - left[1].count || left[1].firstOrder - right[1].firstOrder)[0]?.[0]
    ?? null;
  return identityKey ? groupForIdentity(allPlaces, identityKey, seedSavedPlaceIds[0]) : null;
}

export function sourceGroupPosition<T extends { id: string }>(
  places: readonly T[],
  selectedId: string | null | undefined,
): { index: number; count: number; label: string } | null {
  if (places.length < 2 || !selectedId) return null;
  const index = places.findIndex((place) => place.id === selectedId);
  if (index < 0) return null;
  return { index, count: places.length, label: `${index + 1} of ${places.length}` };
}
