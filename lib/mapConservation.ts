import type { ClusterRegion, MapClusterMarker } from './mapClustering';
import { isCoordinateInsideRegion } from './mapReliability';

type LedgerPlace = {
  id: string;
  place: { latitude: number; longitude: number };
};

export type MapConservationLedger = {
  datasetRevision: number;
  datasetKey: string;
  cameraRevision: number;
  viewportRevision: number;
  zoom: number;
  bounds: ClusterRegion;
  filterState: string;
  selectedPlaceId: string | null;
  clusteringEnabled: boolean;
  querySynchronized: boolean;
  source_count: number;
  eligible_count: number;
  viewport_eligible_count: number;
  cluster_input_count: number;
  rendered_individual_count: number;
  rendered_cluster_count: number;
  rendered_cluster_member_count: number;
  represented_in_viewport_count: number;
  unique_represented_ids: readonly string[];
  missing_ids: readonly string[];
  duplicate_ids: readonly string[];
  invalid_cluster_ids: readonly string[];
  outside_viewport_ids: readonly string[];
  filtered_ids: readonly string[];
  invalid_coordinate_ids: readonly string[];
  cluster_input_missing_ids: readonly string[];
  ok: boolean;
};

function validCoordinate(place: LedgerPlace): boolean {
  return Number.isFinite(place?.place?.latitude) &&
    Number.isFinite(place?.place?.longitude) &&
    place.place.latitude >= -90 && place.place.latitude <= 90 &&
    place.place.longitude >= -180 && place.place.longitude <= 180 &&
    !(place.place.latitude === 0 && place.place.longitude === 0);
}

/** Full source -> filter -> index -> viewport -> render conservation ledger. */
export function buildMapConservationLedger<T extends LedgerPlace>(args: {
  datasetRevision: number;
  datasetKey: string;
  cameraRevision: number;
  viewportRevision: number;
  zoom: number;
  bounds: ClusterRegion;
  filterState: string;
  selectedPlaceId: string | null;
  clusteringEnabled: boolean;
  querySynchronized: boolean;
  sourcePlaces: readonly T[];
  eligiblePlaces: readonly T[];
  clusterInputIds: readonly string[];
  individualIds: readonly string[];
  clusters: readonly Pick<MapClusterMarker, 'id' | 'count' | 'engineCount' | 'memberIds'>[];
}): MapConservationLedger {
  const sourceIds = new Set<string>();
  const duplicateSourceIds = new Set<string>();
  const invalidCoordinateIds: string[] = [];
  for (const place of args.sourcePlaces) {
    if (!place?.id) continue;
    if (sourceIds.has(place.id)) duplicateSourceIds.add(place.id);
    sourceIds.add(place.id);
    if (!validCoordinate(place)) invalidCoordinateIds.push(place.id);
  }
  const eligibleById = new Map<string, T>();
  for (const place of args.eligiblePlaces) {
    if (place?.id && !eligibleById.has(place.id)) eligibleById.set(place.id, place);
  }
  const eligibleIds = new Set(eligibleById.keys());
  const clusterInputIds = new Set(args.clusterInputIds.filter(Boolean));
  const individualIds = args.individualIds.filter(Boolean);
  const individualIdSet = new Set(individualIds);
  const occurrences = new Map<string, number>();
  for (const id of individualIds) occurrences.set(id, (occurrences.get(id) ?? 0) + 1);

  const invalidClusterIds: string[] = [];
  let renderedClusterMemberCount = 0;
  for (const cluster of args.clusters) {
    const unique = new Set(cluster.memberIds);
    renderedClusterMemberCount += cluster.memberIds.length;
    if (
      unique.size !== cluster.memberIds.length ||
      cluster.count !== unique.size ||
      cluster.engineCount !== unique.size ||
      [...unique].some((id) => !eligibleIds.has(id))
    ) invalidClusterIds.push(cluster.id);
    for (const id of cluster.memberIds) {
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
  }

  const viewportEligibleIds: string[] = [];
  const outsideViewportIds: string[] = [];
  for (const [id, place] of eligibleById) {
    if (!validCoordinate(place)) {
      invalidCoordinateIds.push(id);
    } else if (isCoordinateInsideRegion(place.place, args.bounds)) {
      viewportEligibleIds.push(id);
    } else {
      outsideViewportIds.push(id);
    }
  }
  const viewportEligibleSet = new Set(viewportEligibleIds);
  const uniqueRepresentedIds = [...occurrences.keys()].sort();
  const missingIds = viewportEligibleIds.filter((id) => !occurrences.has(id)).sort();
  const duplicateIds = [...new Set([
    ...duplicateSourceIds,
    ...[...occurrences]
    .filter(([, count]) => count > 1)
    .map(([id]) => id),
  ])].sort();
  const invalidCoordinateSet = new Set(invalidCoordinateIds);
  const filteredIds = [...sourceIds]
    .filter((id) => !eligibleIds.has(id) && !invalidCoordinateSet.has(id))
    .sort();
  const clusterInputMissingIds = args.clusteringEnabled
    ? [...eligibleIds]
      .filter((id) => !clusterInputIds.has(id) && !individualIdSet.has(id))
      .sort()
    : [];
  const representedInViewport = [...occurrences.keys()]
    .filter((id) => viewportEligibleSet.has(id)).length;
  const ok = (!args.clusteringEnabled || args.querySynchronized) &&
    missingIds.length === 0 &&
    duplicateIds.length === 0 &&
    invalidClusterIds.length === 0 &&
    clusterInputMissingIds.length === 0;

  return {
    datasetRevision: args.datasetRevision,
    datasetKey: args.datasetKey,
    cameraRevision: args.cameraRevision,
    viewportRevision: args.viewportRevision,
    zoom: args.zoom,
    bounds: { ...args.bounds },
    filterState: args.filterState,
    selectedPlaceId: args.selectedPlaceId,
    clusteringEnabled: args.clusteringEnabled,
    querySynchronized: args.querySynchronized,
    source_count: args.sourcePlaces.length,
    eligible_count: eligibleById.size,
    viewport_eligible_count: viewportEligibleIds.length,
    cluster_input_count: clusterInputIds.size,
    rendered_individual_count: individualIds.length,
    rendered_cluster_count: args.clusters.length,
    rendered_cluster_member_count: renderedClusterMemberCount,
    represented_in_viewport_count: representedInViewport,
    unique_represented_ids: uniqueRepresentedIds,
    missing_ids: missingIds,
    duplicate_ids: duplicateIds,
    invalid_cluster_ids: invalidClusterIds.sort(),
    outside_viewport_ids: outsideViewportIds.sort(),
    filtered_ids: filteredIds,
    invalid_coordinate_ids: invalidCoordinateIds.sort(),
    cluster_input_missing_ids: clusterInputMissingIds,
    ok,
  };
}

const MAX_MAP_CONSERVATION_LEDGERS = 30;
let recentLedgers: MapConservationLedger[] = [];

export function recordMapConservationLedger(ledger: MapConservationLedger): void {
  recentLedgers = [...recentLedgers, ledger].slice(-MAX_MAP_CONSERVATION_LEDGERS);
  if (__DEV__) console.debug('[map-conservation]', ledger);
}

export function getMapConservationLedgers(): readonly MapConservationLedger[] {
  return recentLedgers;
}

export function clearMapConservationLedgers(): void {
  recentLedgers = [];
}
