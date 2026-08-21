/**
 * lib/mapClustering.ts
 *
 * Semantic clustering for saved-place map markers.
 *
 * PRESENTATION ONLY. Nothing here mutates a saved place, changes group or
 * reminder semantics, issues a network request, or reads a photo. A cluster is
 * derived from three things the map already holds locally: coordinates, the
 * place's category group, and the current camera. That is what makes this work
 * offline and what keeps a cluster from ever fanning out photo requests.
 *
 * Pipeline position:
 *
 *     saved places
 *       -> filterPlacesForMap()          (lib/mapVisibility)
 *       -> buildMapClusterIndex()        (this module)
 *       -> queryMapClusters()            (this module)
 *       -> cluster marker OR individual marker
 *       -> savedMarkerPresentation()     (lib/mapMarkerPresentation)
 *
 * Filtering happens BEFORE indexing, so a cluster's count and dominant
 * category can only ever describe places the user can currently see. There is
 * no "cluster everything then hide part of it" path, which is the only way the
 * count could lie.
 *
 * Zoom convention: every zoom in this module is Google/Web-Mercator zoom for a
 * 256px tile, matching react-native-maps' own camera. Supercluster is
 * configured with `extent: 256` so its `radius` option is in the SAME device
 * pixels, and so an expansion zoom it returns can be fed straight back to a
 * region without a tile-size correction.
 */

import Supercluster from 'supercluster';

import { CATEGORY_BROWSE_SECTIONS } from './placeCategory';
import { mapFilterGroupForPlace } from './mapVisibility';
import type { SavedPlaceWithPlace } from '@/types';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/**
 * Cluster radius in DEVICE PIXELS (see `extent: 256` below). Two markers whose
 * screen distance is under this collapse. Chosen a little wider than the
 * largest cluster disc (54px) so a cluster never visually overlaps its
 * neighbour at the zoom that produced it.
 */
export const CLUSTER_RADIUS_PX = 56;

/**
 * Above this zoom nothing clusters and every place is its own marker. This is
 * the safety floor that makes the identical-coordinates case terminate: past
 * maxZoom Supercluster returns raw points, so two saves on the same building
 * degrade to exactly today's overlapping-pin behavior instead of an
 * un-expandable cluster the user can tap forever.
 */
export const CLUSTER_MAX_ZOOM = 16;

/** A pair is already clutter at wide zoom, so two is a cluster. */
export const CLUSTER_MIN_POINTS = 2;

/**
 * Extra viewport fraction (per side) queried beyond the visible region so a
 * cluster whose weighted center sits just off-screen still renders, instead of
 * popping in mid-pan.
 */
export const CLUSTER_BBOX_PADDING = 0.15;

/**
 * Deadband added to the usual 0.5 rounding boundary before the committed
 * integer zoom is allowed to change. Without it a pan that nudges the camera
 * across a .5 boundary flips the whole map between two clusterings and back,
 * which reads as flashing. 0.12 of a zoom level is roughly an 8% scale change.
 */
export const CLUSTER_ZOOM_HYSTERESIS = 0.12;

/**
 * A category group owns a cluster's icon only when it is strictly the largest
 * AND holds at least this share of the cluster. "One more than the runner-up"
 * is explicitly NOT dominance: 3 food / 2 outdoors / 2 shopping is a mixed
 * cluster and gets the neutral symbol.
 */
export const CLUSTER_DOMINANCE_RATIO = 0.5;

// ---------------------------------------------------------------------------
// Visual contract
// ---------------------------------------------------------------------------

export type ClusterSizeTier = 1 | 2 | 3 | 4;

export type ClusterSizing = {
  tier: ClusterSizeTier;
  diameter: number;
  iconSize: number;
  countFontSize: number;
};

/**
 * Bounded tiers, not linear growth. The count is what conveys magnitude; size
 * is only a secondary cue. The largest tier (54px) is a hair over the selected
 * pin (52px) and 1.7x the normal local pin (32px) — a cluster of 500 is the
 * same disc as a cluster of 25.
 */
export const CLUSTER_SIZE_TIERS: readonly (ClusterSizing & { minCount: number })[] = [
  { minCount: 25, tier: 4, diameter: 54, iconSize: 16, countFontSize: 16 },
  { minCount: 10, tier: 3, diameter: 48, iconSize: 15, countFontSize: 15 },
  { minCount: 4, tier: 2, diameter: 42, iconSize: 14, countFontSize: 14 },
  { minCount: 0, tier: 1, diameter: 36, iconSize: 12, countFontSize: 12 },
];

export function clusterSizing(count: number): ClusterSizing {
  const safeCount = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  for (const tier of CLUSTER_SIZE_TIERS) {
    if (safeCount >= tier.minCount) {
      return {
        tier: tier.tier,
        diameter: tier.diameter,
        iconSize: tier.iconSize,
        countFontSize: tier.countFontSize,
      };
    }
  }
  const smallest = CLUSTER_SIZE_TIERS[CLUSTER_SIZE_TIERS.length - 1]!;
  return {
    tier: smallest.tier,
    diameter: smallest.diameter,
    iconSize: smallest.iconSize,
    countFontSize: smallest.countFontSize,
  };
}

/**
 * A cluster speaks the browse-section vocabulary — the same seven groups the
 * map's own filter chips and the Saved Places sheet use — not the 28-value
 * persisted taxonomy. "4 Food & drink, 2 Outdoors, 1 Other" is a sentence the
 * user has already been taught to read.
 */
export const CLUSTER_GROUP_GLYPHS: Readonly<Record<string, string>> = {
  food_drink: 'silverware-fork-knife',
  stays: 'bed-outline',
  outdoors: 'pine-tree',
  things_to_do: 'ticket-outline',
  shopping: 'shopping-outline',
  fitness_wellness: 'dumbbell',
  other: 'map-marker-outline',
};

/** Mixed cluster symbol. Deliberately "several places", never a real category. */
export const CLUSTER_NEUTRAL_GLYPH = 'map-marker-multiple-outline';

const GROUP_IDS: readonly string[] = CATEGORY_BROWSE_SECTIONS.map((section) => section.id);
const GROUP_LABELS: Readonly<Record<string, string>> = Object.fromEntries(
  CATEGORY_BROWSE_SECTIONS.map((section) => [section.id, section.label]),
);

/**
 * Flat scalar property keys, one per browse section.
 *
 * These are deliberately NOT a nested object or array. Supercluster seeds a
 * parent cluster's accumulator with `Object.assign({}, childProps)` — a
 * SHALLOW clone — and then mutates it. A nested container would be shared with
 * the child cluster it was cloned from, and merging into the parent would
 * silently corrupt the child's counts at the lower zoom level. Scalars clone
 * correctly.
 */
const GROUP_KEYS: readonly string[] = GROUP_IDS.map((_, index) => `g${index}`);

export type ClusterGroupCounts = Readonly<Record<string, number>>;

export type DominantClusterGroup = {
  groupId: string;
  label: string;
  count: number;
  share: number;
};

/**
 * The category group that earns the cluster's icon, or `null` for a mixed
 * cluster.
 *
 * Deterministic by construction: a tie at the top can never satisfy "strictly
 * the largest", so 2 food / 2 outdoors is mixed rather than whichever group
 * the iteration happened to reach first.
 */
export function dominantClusterGroup(
  counts: ClusterGroupCounts,
  totalCount: number,
): DominantClusterGroup | null {
  const total = Number.isFinite(totalCount) ? Math.max(0, Math.floor(totalCount)) : 0;
  if (total <= 0) return null;

  let bestId: string | null = null;
  let bestCount = 0;
  let tied = false;
  for (const groupId of GROUP_IDS) {
    const count = Math.max(0, Math.floor(counts[groupId] ?? 0));
    if (count === 0) continue;
    if (count > bestCount) {
      bestId = groupId;
      bestCount = count;
      tied = false;
    } else if (count === bestCount) {
      tied = true;
    }
  }

  if (!bestId || tied) return null;
  if (bestCount < total * CLUSTER_DOMINANCE_RATIO) return null;
  return {
    groupId: bestId,
    label: GROUP_LABELS[bestId] ?? 'Other',
    count: bestCount,
    share: bestCount / total,
  };
}

export function clusterGlyphForGroup(groupId: string | null): string {
  if (!groupId) return CLUSTER_NEUTRAL_GLYPH;
  return CLUSTER_GROUP_GLYPHS[groupId] ?? CLUSTER_NEUTRAL_GLYPH;
}

/**
 * What VoiceOver reads. The count is always spoken; the dominant group is
 * added only when it is real, so the label never over-claims a mixed cluster.
 */
export function clusterAccessibilityLabel(args: {
  count: number;
  groupLabel: string | null;
}): string {
  const count = Math.max(0, Math.floor(args.count));
  const noun = count === 1 ? 'saved place' : 'saved places';
  if (!args.groupLabel) return `${count} ${noun}`;
  return `${count} ${noun}, mostly ${args.groupLabel}`;
}

export const CLUSTER_ACCESSIBILITY_HINT = 'Zooms in to show these places';

// ---------------------------------------------------------------------------
// Camera <-> zoom
// ---------------------------------------------------------------------------

export type ClusterRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/**
 * Continuous Web-Mercator zoom for a region shown in a viewport `viewportWidth`
 * device pixels wide. Longitude is the Mercator-linear axis, so it — not
 * latitude — is the honest input.
 */
export function regionToClusterZoom(args: {
  longitudeDelta: number;
  viewportWidth: number;
}): number {
  const longitudeDelta = Number.isFinite(args.longitudeDelta)
    ? Math.max(1e-8, args.longitudeDelta)
    : 360;
  const viewportWidth = Number.isFinite(args.viewportWidth) && args.viewportWidth > 0
    ? args.viewportWidth
    : 256;
  const zoom = Math.log2((360 * viewportWidth) / (256 * longitudeDelta));
  return clamp(zoom, 0, CLUSTER_MAX_ZOOM + 1);
}

/**
 * The integer zoom the clustering is actually computed at.
 *
 * Hysteresis lives here rather than in the caller so the "don't flicker while
 * panning" rule is one testable function instead of scattered state.
 */
export function nextClusterZoom(
  currentZoom: number | null | undefined,
  continuousZoom: number,
): number {
  const target = clamp(continuousZoom, 0, CLUSTER_MAX_ZOOM + 1);
  if (currentZoom == null || !Number.isFinite(currentZoom)) {
    return Math.round(target);
  }
  const current = clamp(Math.round(currentZoom), 0, CLUSTER_MAX_ZOOM + 1);
  if (Math.abs(target - current) < 0.5 + CLUSTER_ZOOM_HYSTERESIS) return current;
  return Math.round(target);
}

/** `[west, south, east, north]`, padded. Supercluster normalizes longitudes. */
export function regionToClusterBbox(
  region: ClusterRegion,
  padding: number = CLUSTER_BBOX_PADDING,
): [number, number, number, number] {
  const latitudeDelta = Number.isFinite(region.latitudeDelta)
    ? Math.abs(region.latitudeDelta)
    : 180;
  const longitudeDelta = Number.isFinite(region.longitudeDelta)
    ? Math.abs(region.longitudeDelta)
    : 360;
  const latitude = Number.isFinite(region.latitude) ? region.latitude : 0;
  const longitude = Number.isFinite(region.longitude) ? region.longitude : 0;

  const halfLat = latitudeDelta * (0.5 + Math.max(0, padding));
  const halfLng = longitudeDelta * (0.5 + Math.max(0, padding));
  if (halfLng * 2 >= 360) return [-180, clamp(latitude - halfLat, -90, 90), 180, clamp(latitude + halfLat, -90, 90)];
  return [
    longitude - halfLng,
    clamp(latitude - halfLat, -90, 90),
    longitude + halfLng,
    clamp(latitude + halfLat, -90, 90),
  ];
}

/**
 * The zoom a cluster tap should animate to.
 *
 * Always at least one level in — a tap that produced no visible change would
 * read as a dead marker — and never past the level where clustering stops, so
 * co-located saves settle into overlapping individual pins rather than an
 * infinitely tappable cluster.
 */
export function clusterTapZoom(args: {
  expansionZoom: number;
  currentZoom: number;
}): number {
  const current = Number.isFinite(args.currentZoom) ? args.currentZoom : 0;
  const expansion = Number.isFinite(args.expansionZoom) ? args.expansionZoom : current + 1;
  return clamp(Math.max(expansion, current + 1), 0, CLUSTER_MAX_ZOOM + 1);
}

/**
 * The region that shows `zoom` centered on a cluster. Latitude degrees per
 * pixel shrink with `cos(latitude)` in Mercator, so the aspect correction is
 * not optional if the animation is to land on the zoom we asked for.
 */
export function clusterExpansionRegion(args: {
  latitude: number;
  longitude: number;
  zoom: number;
  viewportWidth: number;
  viewportHeight: number;
}): ClusterRegion {
  const zoom = clamp(args.zoom, 0, CLUSTER_MAX_ZOOM + 1);
  const viewportWidth = Number.isFinite(args.viewportWidth) && args.viewportWidth > 0
    ? args.viewportWidth
    : 256;
  const viewportHeight = Number.isFinite(args.viewportHeight) && args.viewportHeight > 0
    ? args.viewportHeight
    : viewportWidth;
  const latitude = clamp(args.latitude, -85, 85);
  const longitudeDelta = clamp(
    (360 * viewportWidth) / (256 * Math.pow(2, zoom)),
    1e-6,
    360,
  );
  const aspect = viewportHeight / viewportWidth;
  const cosLat = Math.max(0.05, Math.cos((latitude * Math.PI) / 180));
  return {
    latitude,
    longitude: args.longitude,
    longitudeDelta,
    latitudeDelta: clamp(longitudeDelta * aspect * cosLat, 1e-6, 180),
  };
}

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

type ClusterPointProperties = {
  savedPlaceId: string;
  [groupKey: string]: number | string;
};

/** Per-browse-section counts carried up the cluster tree. Scalars only. */
type ClusterAggregateProperties = { [groupKey: string]: number };

export type MapClusterMarker = {
  kind: 'cluster';
  /** Stable across pans at the same zoom; supplied by the clustering engine. */
  id: string;
  clusterId: number;
  latitude: number;
  longitude: number;
  count: number;
  /** Dominant browse-section id, or null for a mixed cluster. */
  groupId: string | null;
  groupLabel: string | null;
  glyph: string;
  sizing: ClusterSizing;
  accessibilityLabel: string;
};

export type MapClusterPlace<T> = {
  kind: 'place';
  id: string;
  place: T;
};

export type MapClusterNode<T> = MapClusterMarker | MapClusterPlace<T>;

export type MapClusterIndex<T> = {
  /** null when there is nothing to cluster; callers render individuals. */
  index: Supercluster<ClusterPointProperties, ClusterAggregateProperties> | null;
  byId: Map<string, T>;
  pointCount: number;
};

type Clusterable = Pick<SavedPlaceWithPlace, 'id' | 'place'>;

function hasCoordinates(place: Clusterable): boolean {
  return (
    Number.isFinite(place?.place?.latitude) && Number.isFinite(place?.place?.longitude)
  );
}

/**
 * Build the spatial index over ALREADY FILTERED places.
 *
 * Cost is one `load()` — O(n log n) across zoom levels — and it is memoized on
 * the filtered set in the caller, so panning and zooming never rebuild it.
 */
export function buildMapClusterIndex<T extends Clusterable>(
  places: readonly T[] | null | undefined,
): MapClusterIndex<T> {
  const byId = new Map<string, T>();
  const features: Supercluster.PointFeature<ClusterPointProperties>[] = [];

  if (Array.isArray(places)) {
    for (const saved of places) {
      if (!saved || !hasCoordinates(saved)) continue;
      byId.set(saved.id, saved);
      const groupIndex = GROUP_IDS.indexOf(mapFilterGroupForPlace(saved as never));
      const properties = { savedPlaceId: saved.id } as ClusterPointProperties;
      for (let i = 0; i < GROUP_KEYS.length; i += 1) {
        properties[GROUP_KEYS[i]!] = i === groupIndex ? 1 : 0;
      }
      features.push({
        type: 'Feature',
        properties,
        geometry: {
          type: 'Point',
          coordinates: [saved.place.longitude, saved.place.latitude],
        },
      });
    }
  }

  if (features.length === 0) {
    return { index: null, byId, pointCount: 0 };
  }

  const index = new Supercluster<ClusterPointProperties, ClusterAggregateProperties>({
    radius: CLUSTER_RADIUS_PX,
    // Device pixels, matching the 256px-tile zoom used everywhere here.
    extent: 256,
    maxZoom: CLUSTER_MAX_ZOOM,
    minPoints: CLUSTER_MIN_POINTS,
    map: (props) => {
      const seed: ClusterAggregateProperties = {};
      for (const key of GROUP_KEYS) seed[key] = Number(props[key] ?? 0);
      return seed;
    },
    reduce: (accumulated, props) => {
      for (const key of GROUP_KEYS) {
        accumulated[key] = Number(accumulated[key] ?? 0) + Number(props[key] ?? 0);
      }
    },
  });
  index.load(features);
  return { index, byId, pointCount: features.length };
}

/**
 * Clusters and loose places for the current camera.
 *
 * Returns nodes in a deterministic order — every cluster, then every loose
 * place — so React reconciliation sees a stable list rather than one that
 * reorders as the user pans.
 */
export function queryMapClusters<T extends Clusterable>(
  built: MapClusterIndex<T>,
  args: { region: ClusterRegion; zoom: number },
): MapClusterNode<T>[] {
  const { index, byId } = built;
  if (!index) return [];

  const bbox = regionToClusterBbox(args.region);
  const zoom = clamp(Math.round(args.zoom), 0, CLUSTER_MAX_ZOOM + 1);

  let features: ReturnType<typeof index.getClusters>;
  try {
    features = index.getClusters(bbox, zoom);
  } catch {
    // A malformed camera must never blank the map.
    return [...byId.values()].map((place) => ({ kind: 'place', id: place.id, place }));
  }

  // `visiblePlaces` means "allowed by the active Nearr filter", not "inside
  // the current camera bounds". Supercluster's bbox query legitimately returns
  // no features when the camera is temporarily elsewhere (for example while a
  // GPS-centered initial region settles). The caller used the query result as
  // the complete ownership list for ordinary markers, so that valid empty
  // viewport response removed every Marker component. Keep the pre-clustering
  // rendering invariant in that one case: mount the filtered places as
  // ordinary markers and let MapView cull the off-screen visuals. The next
  // settled region re-queries normally and restores clustering where relevant.
  if (features.length === 0 && byId.size > 0) {
    return [...byId.values()].map((place) => ({ kind: 'place', id: place.id, place }));
  }

  const clusters: MapClusterMarker[] = [];
  const loose: MapClusterPlace<T>[] = [];

  for (const feature of features) {
    const properties = feature.properties as Record<string, unknown>;
    const [longitude, latitude] = feature.geometry.coordinates as [number, number];

    if (properties.cluster) {
      const count = Math.max(0, Math.floor(Number(properties.point_count ?? 0)));
      const counts: Record<string, number> = {};
      for (let i = 0; i < GROUP_KEYS.length; i += 1) {
        counts[GROUP_IDS[i]!] = Number(properties[GROUP_KEYS[i]!] ?? 0);
      }
      const dominant = dominantClusterGroup(counts, count);
      const clusterId = Number(properties.cluster_id);
      clusters.push({
        kind: 'cluster',
        id: `cluster-${clusterId}`,
        clusterId,
        latitude,
        longitude,
        count,
        groupId: dominant?.groupId ?? null,
        groupLabel: dominant?.label ?? null,
        glyph: clusterGlyphForGroup(dominant?.groupId ?? null),
        sizing: clusterSizing(count),
        accessibilityLabel: clusterAccessibilityLabel({
          count,
          groupLabel: dominant?.label ?? null,
        }),
      });
      continue;
    }

    const savedPlaceId = String(properties.savedPlaceId ?? '');
    const place = byId.get(savedPlaceId);
    if (place) loose.push({ kind: 'place', id: savedPlaceId, place });
  }

  return [...clusters, ...loose];
}

/** Group counts for a cluster, for tests and diagnostics. */
export function clusterGroupCounts<T extends Clusterable>(
  built: MapClusterIndex<T>,
  clusterId: number,
): ClusterGroupCounts {
  const counts: Record<string, number> = {};
  for (const groupId of GROUP_IDS) counts[groupId] = 0;
  if (!built.index) return counts;
  for (const leaf of built.index.getLeaves(clusterId, Infinity)) {
    const savedPlaceId = String((leaf.properties as { savedPlaceId?: string })?.savedPlaceId ?? '');
    const place = built.byId.get(savedPlaceId);
    if (!place) continue;
    const group = mapFilterGroupForPlace(place as never);
    counts[group] = (counts[group] ?? 0) + 1;
  }
  return counts;
}

/** Expansion zoom from the clustering engine, or `null` when unavailable. */
export function clusterExpansionZoom<T extends Clusterable>(
  built: MapClusterIndex<T>,
  clusterId: number,
): number | null {
  if (!built.index) return null;
  try {
    return built.index.getClusterExpansionZoom(clusterId);
  } catch {
    return null;
  }
}
