import { CLUSTER_MAX_ZOOM, type ClusterRegion } from './mapClustering';
import { regionsApproximatelyEqual, type MapViewportSource } from './mapViewportSync';

export type MapRepresentationCommitReason =
  | 'commit_initial'
  | 'commit_authoritative'
  | 'equivalent_representation'
  | 'invalid_bbox'
  | 'invalid_zoom'
  | 'missing_ids'
  | 'duplicate_ids'
  | 'non_conserved'
  | 'stale_dataset'
  | 'stale_camera'
  | 'stale_viewport'
  | 'superseded_candidate'
  | 'active_camera_transition'
  | 'transient_viewport';

export type MapRepresentation<
  TMarker extends { id: string },
  TCluster extends { id: string },
  TMetadata = undefined,
> = {
  id: string;
  datasetRevision: number;
  datasetKey: string;
  viewportRevision: number;
  cameraRevision: number;
  visualZoom: number;
  queryZoom: number;
  bbox: readonly [number, number, number, number];
  region: ClusterRegion;
  markers: readonly TMarker[];
  clusters: readonly TCluster[];
  representedIds: readonly string[];
  missingIds: readonly string[];
  duplicateIds: readonly string[];
  isConserved: boolean;
  source: MapViewportSource;
  createdAt: number;
  metadata: TMetadata;
};

export type MapRepresentationCommitContext = {
  currentDatasetRevision: number;
  currentCameraRevision: number;
  latestCommitEligibleViewportRevision: number;
  latestCandidateId: string;
  cameraTransitionActive: boolean;
};

export type MapRepresentationCommitDecision = {
  allowed: boolean;
  reason: MapRepresentationCommitReason;
};

export type MapRepresentationStabilityMetrics = {
  candidateCount: number;
  visibleCommitCount: number;
  emptyVisibleCommitCount: number;
  nonConservedVisibleCommitCount: number;
  staleVisibleCommitCount: number;
  invalidVisibleCommitCount: number;
  representationReversions: number;
};

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function coordinateSignature(value: number): string {
  return Number.isFinite(value) ? value.toFixed(6) : 'invalid';
}

export function isValidRepresentationBbox(
  bbox: readonly number[] | null | undefined,
): bbox is readonly [number, number, number, number] {
  if (!bbox || bbox.length !== 4 || !bbox.every(Number.isFinite)) return false;
  const [west, south, east, north] = bbox;
  return west! >= -360 && east! <= 360 && south! >= -90 && north! <= 90 &&
    east! > west! && north! > south!;
}

export function createMapRepresentation<
  TMarker extends { id: string },
  TCluster extends { id: string },
  TMetadata = undefined,
>(args: Omit<MapRepresentation<TMarker, TCluster, TMetadata>, 'id' | 'createdAt'> & {
  createdAt?: number;
}): MapRepresentation<TMarker, TCluster, TMetadata> {
  const markerIds = args.markers.map((marker) => marker.id).sort();
  const clusterIds = args.clusters.map((cluster) => cluster.id).sort();
  const signature = [
    args.datasetRevision,
    args.datasetKey,
    args.cameraRevision,
    args.viewportRevision,
    args.queryZoom,
    ...args.bbox.map(coordinateSignature),
    `m:${markerIds.join('|')}`,
    `c:${clusterIds.join('|')}`,
  ].join(';');
  return {
    ...args,
    id: `representation-${stableHash(signature)}`,
    createdAt: args.createdAt ?? Date.now(),
  };
}

function hasSameLogicalObjects<
  TMarker extends { id: string },
  TCluster extends { id: string },
  TMetadata,
>(
  left: MapRepresentation<TMarker, TCluster, TMetadata>,
  right: MapRepresentation<TMarker, TCluster, TMetadata>,
): boolean {
  if (left.datasetKey !== right.datasetKey || left.queryZoom !== right.queryZoom) return false;
  const leftMarkers = left.markers.map((item) => item.id).sort().join('|');
  const rightMarkers = right.markers.map((item) => item.id).sort().join('|');
  if (leftMarkers !== rightMarkers) return false;
  return left.clusters.map((item) => item.id).sort().join('|') ===
    right.clusters.map((item) => item.id).sort().join('|');
}

function isAuthoritativeSource(source: MapViewportSource): boolean {
  return source === 'native_readback' ||
    source === 'region_change_complete' ||
    source === 'initial' ||
    source === 'layout';
}

/**
 * Decide whether a fully calculated candidate may atomically replace the
 * currently rendered marker tree. Continuous viewport samples deliberately
 * fail here: they remain useful observations and pre-computation inputs, but
 * never become visible state.
 */
export function decideMapRepresentationCommit<
  TMarker extends { id: string },
  TCluster extends { id: string },
  TMetadata,
>(args: {
  candidate: MapRepresentation<TMarker, TCluster, TMetadata>;
  visible: MapRepresentation<TMarker, TCluster, TMetadata> | null;
  context: MapRepresentationCommitContext;
}): MapRepresentationCommitDecision {
  const { candidate, visible, context } = args;
  if (!isValidRepresentationBbox(candidate.bbox)) return { allowed: false, reason: 'invalid_bbox' };
  if (
    !Number.isInteger(candidate.queryZoom) ||
    candidate.queryZoom < 0 ||
    candidate.queryZoom > CLUSTER_MAX_ZOOM + 1
  ) {
    return { allowed: false, reason: 'invalid_zoom' };
  }
  if (candidate.missingIds.length > 0) return { allowed: false, reason: 'missing_ids' };
  if (candidate.duplicateIds.length > 0) return { allowed: false, reason: 'duplicate_ids' };
  if (!candidate.isConserved) return { allowed: false, reason: 'non_conserved' };
  if (candidate.datasetRevision !== context.currentDatasetRevision) {
    return { allowed: false, reason: 'stale_dataset' };
  }
  if (candidate.cameraRevision !== context.currentCameraRevision) {
    return { allowed: false, reason: 'stale_camera' };
  }
  if (candidate.viewportRevision !== context.latestCommitEligibleViewportRevision) {
    return { allowed: false, reason: 'stale_viewport' };
  }
  if (candidate.id !== context.latestCandidateId) {
    return { allowed: false, reason: 'superseded_candidate' };
  }
  if (context.cameraTransitionActive) {
    return { allowed: false, reason: 'active_camera_transition' };
  }
  if (visible && hasSameLogicalObjects(visible, candidate)) {
    return { allowed: false, reason: 'equivalent_representation' };
  }
  const stableLateContinuous = candidate.source === 'region_change' && !!visible &&
    regionsApproximatelyEqual(candidate.region, visible.region);
  if (!isAuthoritativeSource(candidate.source) && !stableLateContinuous) {
    return { allowed: false, reason: 'transient_viewport' };
  }
  if (visible?.id === candidate.id) {
    return { allowed: false, reason: 'equivalent_representation' };
  }
  return { allowed: true, reason: visible ? 'commit_authoritative' : 'commit_initial' };
}

/** Pure-test coordinator mirroring the React stale-while-revalidate contract. */
export class MapAtomicRepresentationCoordinator<
  TMarker extends { id: string },
  TCluster extends { id: string },
  TMetadata = undefined,
> {
  private visibleRepresentation: MapRepresentation<TMarker, TCluster, TMetadata> | null = null;
  private latestCandidateId = '';
  private committedIds: string[] = [];
  private counters: MapRepresentationStabilityMetrics = {
    candidateCount: 0,
    visibleCommitCount: 0,
    emptyVisibleCommitCount: 0,
    nonConservedVisibleCommitCount: 0,
    staleVisibleCommitCount: 0,
    invalidVisibleCommitCount: 0,
    representationReversions: 0,
  };

  visible(): MapRepresentation<TMarker, TCluster, TMetadata> | null {
    return this.visibleRepresentation;
  }

  metrics(): Readonly<MapRepresentationStabilityMetrics> {
    return { ...this.counters };
  }

  observe(candidate: MapRepresentation<TMarker, TCluster, TMetadata>): void {
    this.latestCandidateId = candidate.id;
    this.counters.candidateCount += 1;
  }

  commit(
    candidate: MapRepresentation<TMarker, TCluster, TMetadata>,
    context: Omit<MapRepresentationCommitContext, 'latestCandidateId'> & { latestCandidateId?: string },
  ): MapRepresentationCommitDecision {
    const decision = decideMapRepresentationCommit({
      candidate,
      visible: this.visibleRepresentation,
      context: {
        ...context,
        latestCandidateId: context.latestCandidateId ?? this.latestCandidateId,
      },
    });
    if (!decision.allowed) return decision;
    if (this.committedIds.includes(candidate.id) && this.visibleRepresentation?.id !== candidate.id) {
      this.counters.representationReversions += 1;
    }
    this.visibleRepresentation = candidate;
    this.committedIds = [...this.committedIds, candidate.id].slice(-100);
    this.counters.visibleCommitCount += 1;
    if (candidate.markers.length === 0 && candidate.clusters.length === 0) {
      this.counters.emptyVisibleCommitCount += 1;
    }
    if (!candidate.isConserved) this.counters.nonConservedVisibleCommitCount += 1;
    return decision;
  }
}
