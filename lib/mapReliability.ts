import type { ClusterRegion, MapClusterMarker } from './mapClustering';

type MarkerPlace = {
  id: string;
  place: { latitude: number; longitude: number };
};

export type MarkerConservationReport = {
  ok: boolean;
  eligibleIds: readonly string[];
  individualIds: readonly string[];
  clusterMemberIds: readonly string[];
  offscreenIds: readonly string[];
  missingOnscreenIds: readonly string[];
  duplicateIds: readonly string[];
  invalidClusterIds: readonly string[];
};

function normalizedLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function isCoordinateInsideRegion(
  coordinate: { latitude: number; longitude: number },
  region: ClusterRegion,
): boolean {
  const halfLatitude = Math.abs(region.latitudeDelta) / 2;
  if (coordinate.latitude < region.latitude - halfLatitude || coordinate.latitude > region.latitude + halfLatitude) {
    return false;
  }
  if (Math.abs(region.longitudeDelta) >= 360) return true;
  const halfLongitude = Math.abs(region.longitudeDelta) / 2;
  const delta = Math.abs(normalizedLongitude(coordinate.longitude - region.longitude));
  return delta <= halfLongitude;
}

/**
 * Executable ownership invariant for one settled map frame.
 *
 * Every canonical eligible id must occur exactly once as an individual or a
 * cluster member, unless its coordinate is outside the visible region. Cluster
 * counts are checked against canonical unique members, not engine metadata.
 */
export function inspectMarkerConservation<T extends MarkerPlace>(args: {
  eligiblePlaces: readonly T[];
  individualIds: readonly string[];
  clusters: readonly Pick<MapClusterMarker, 'id' | 'count' | 'engineCount' | 'memberIds'>[];
  region: ClusterRegion;
}): MarkerConservationReport {
  const eligibleById = new Map<string, T>();
  const duplicateInputIds = new Set<string>();
  for (const place of args.eligiblePlaces) {
    if (eligibleById.has(place.id)) duplicateInputIds.add(place.id);
    else eligibleById.set(place.id, place);
  }

  const occurrences = new Map<string, number>();
  const individualIds = args.individualIds.filter((id) => !!id);
  individualIds.forEach((id) => occurrences.set(id, (occurrences.get(id) ?? 0) + 1));

  const clusterMemberIds: string[] = [];
  const invalidClusterIds: string[] = [];
  for (const cluster of args.clusters) {
    const uniqueMembers = new Set(cluster.memberIds);
    const invalid =
      uniqueMembers.size !== cluster.memberIds.length ||
      cluster.count !== uniqueMembers.size ||
      cluster.engineCount !== uniqueMembers.size ||
      [...uniqueMembers].some((id) => !eligibleById.has(id));
    if (invalid) invalidClusterIds.push(cluster.id);
    for (const id of cluster.memberIds) {
      clusterMemberIds.push(id);
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1);
    }
  }

  const missingOnscreenIds: string[] = [];
  const offscreenIds: string[] = [];
  const duplicateIds = new Set<string>(duplicateInputIds);
  for (const [id, place] of eligibleById) {
    const count = occurrences.get(id) ?? 0;
    if (count > 1) duplicateIds.add(id);
    if (count !== 0) continue;
    if (isCoordinateInsideRegion(place.place, args.region)) missingOnscreenIds.push(id);
    else offscreenIds.push(id);
  }
  for (const [id, count] of occurrences) {
    if (!eligibleById.has(id) || count > 1) duplicateIds.add(id);
  }

  const report: MarkerConservationReport = {
    ok: missingOnscreenIds.length === 0 && duplicateIds.size === 0 && invalidClusterIds.length === 0,
    eligibleIds: [...eligibleById.keys()].sort(),
    individualIds: [...individualIds].sort(),
    clusterMemberIds: [...clusterMemberIds].sort(),
    offscreenIds: offscreenIds.sort(),
    missingOnscreenIds: missingOnscreenIds.sort(),
    duplicateIds: [...duplicateIds].sort(),
    invalidClusterIds: invalidClusterIds.sort(),
  };
  return report;
}

export function assertMarkerConservation<T extends MarkerPlace>(
  args: Parameters<typeof inspectMarkerConservation<T>>[0],
): MarkerConservationReport {
  const report = inspectMarkerConservation(args);
  if (!report.ok) {
    throw new Error(
      `marker_conservation_failed missing=${report.missingOnscreenIds.join(',')} ` +
      `duplicates=${report.duplicateIds.join(',')} invalid_clusters=${report.invalidClusterIds.join(',')}`,
    );
  }
  return report;
}

export type MapReliabilityEvent =
  | 'map_dataset_changed'
  | 'map_cluster_index_rebuilt'
  | 'map_marker_conservation_failed'
  | 'map_cluster_tap'
  | 'map_cluster_expand_requested'
  | 'map_cluster_expand_completed'
  | 'map_cluster_expand_fallback'
  | 'map_cluster_expand_failed'
  | 'map_pin_tap'
  | 'map_interaction_slow'
  | 'map_camera_loop_guard'
  | 'map_cluster_membership_invalid';

export type MapReliabilityDiagnostic = {
  event: MapReliabilityEvent;
  timestamp: number;
  datasetGeneration?: number;
  placeCount?: number;
  visibleIndividualCount?: number;
  clusterCount?: number;
  clusterMemberCount?: number;
  zoom?: number;
  filter?: string;
  durationMs?: number;
  cameraState?: string;
  mapReady?: boolean;
  result?: string;
};

const MAX_DIAGNOSTICS = 80;
let diagnostics: MapReliabilityDiagnostic[] = [];

export function recordMapReliabilityDiagnostic(
  event: MapReliabilityEvent,
  fields: Omit<MapReliabilityDiagnostic, 'event' | 'timestamp'> = {},
): void {
  const entry = {
    ...fields,
    event,
    timestamp: Date.now(),
    ...(fields.durationMs == null ? {} : { durationMs: Math.round(fields.durationMs * 10) / 10 }),
  };
  diagnostics = [...diagnostics, entry].slice(-MAX_DIAGNOSTICS);
  if (__DEV__) console.debug(`[map-reliability] ${event}`, entry);
}

export function getMapReliabilityDiagnostics(): readonly MapReliabilityDiagnostic[] {
  return diagnostics;
}

export function clearMapReliabilityDiagnostics(): void {
  diagnostics = [];
}
