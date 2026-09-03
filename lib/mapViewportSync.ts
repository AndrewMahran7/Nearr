import {
  regionToClusterBbox,
  regionToClusterZoom,
  type ClusterRegion,
} from './mapClustering';

export type MapViewportSource =
  | 'initial'
  | 'region_change'
  | 'region_change_complete'
  | 'native_readback'
  | 'layout';

export type MapViewportSnapshot = {
  region: ClusterRegion;
  bbox: [number, number, number, number];
  zoom: number;
  width: number;
  height: number;
  cameraRevision: number;
  viewportRevision: number;
  source: MapViewportSource;
  updatedAt: number;
};

export type CameraTransitionSource = 'gesture' | 'programmatic' | 'foreground';

export type CameraTransition = {
  revision: number;
  source: CameraTransitionSource;
};

export type MapBoundaries = {
  northEast: { latitude: number; longitude: number };
  southWest: { latitude: number; longitude: number };
};

function normalizedLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

/** Convert react-native-maps' native boundary readback into a Region. */
export function regionFromMapBoundaries(boundaries: MapBoundaries): ClusterRegion | null {
  const north = boundaries?.northEast?.latitude;
  const east = boundaries?.northEast?.longitude;
  const south = boundaries?.southWest?.latitude;
  const west = boundaries?.southWest?.longitude;
  if (![north, east, south, west].every(Number.isFinite)) return null;
  const latitudeDelta = Math.abs(north - south);
  const rawLongitudeDelta = normalizedLongitude(east - west);
  const longitudeDelta = rawLongitudeDelta < 0 ? rawLongitudeDelta + 360 : rawLongitudeDelta;
  if (latitudeDelta <= 0 || longitudeDelta <= 0) return null;
  return {
    latitude: (north + south) / 2,
    longitude: normalizedLongitude(west + longitudeDelta / 2),
    latitudeDelta,
    longitudeDelta,
  };
}

export function isUsableMapRegion(region: ClusterRegion | null | undefined): region is ClusterRegion {
  return !!region &&
    Number.isFinite(region.latitude) &&
    Number.isFinite(region.longitude) &&
    Number.isFinite(region.latitudeDelta) &&
    Number.isFinite(region.longitudeDelta) &&
    region.latitudeDelta > 0 &&
    region.longitudeDelta > 0;
}

export function nextMapViewportSnapshot(args: {
  previous: MapViewportSnapshot | null;
  region: ClusterRegion;
  cameraRevision: number;
  source: MapViewportSource;
  width?: number;
  height?: number;
  updatedAt?: number;
}): MapViewportSnapshot {
  if (!isUsableMapRegion(args.region)) {
    if (args.previous) return args.previous;
    throw new Error('map_viewport_invalid_initial_region');
  }
  const width = Number.isFinite(args.width) && (args.width ?? 0) > 0
    ? args.width!
    : args.previous?.width ?? 256;
  const height = Number.isFinite(args.height) && (args.height ?? 0) > 0
    ? args.height!
    : args.previous?.height ?? width;
  return {
    region: { ...args.region },
    bbox: regionToClusterBbox(args.region, 0),
    zoom: regionToClusterZoom({
      longitudeDelta: args.region.longitudeDelta,
      viewportWidth: width,
    }),
    width,
    height,
    cameraRevision: args.cameraRevision,
    viewportRevision: (args.previous?.viewportRevision ?? 0) + 1,
    source: args.source,
    updatedAt: args.updatedAt ?? Date.now(),
  };
}

export function nextCameraTransition(
  previousRevision: number,
  source: CameraTransitionSource,
): CameraTransition {
  return { revision: previousRevision + 1, source };
}

export function regionsApproximatelyEqual(
  left: ClusterRegion | null | undefined,
  right: ClusterRegion | null | undefined,
): boolean {
  if (!isUsableMapRegion(left) || !isUsableMapRegion(right)) return false;
  const latitudeTolerance = Math.max(1e-5, Math.abs(right.latitudeDelta) * 0.005);
  const longitudeTolerance = Math.max(1e-5, Math.abs(right.longitudeDelta) * 0.005);
  return Math.abs(left.latitude - right.latitude) <= latitudeTolerance &&
    Math.abs(normalizedLongitude(left.longitude - right.longitude)) <= longitudeTolerance &&
    Math.abs(left.latitudeDelta - right.latitudeDelta) <= latitudeTolerance &&
    Math.abs(left.longitudeDelta - right.longitudeDelta) <= longitudeTolerance;
}

/**
 * Programmatic continuous callbacks are observations, never query commits.
 * Once native state is settled, an unowned late callback from the same camera
 * revision may only repeat that settled state; it cannot replace it.
 */
export function shouldCommitContinuousRegion(args: {
  transition: CameraTransition | null;
  manualGestureActive: boolean;
  region: ClusterRegion;
  latestSettledSnapshot: MapViewportSnapshot | null;
}): boolean {
  if (!isUsableMapRegion(args.region)) return false;
  if (args.manualGestureActive || args.transition?.source === 'gesture') return true;
  if (args.transition) return false;
  const settled = args.latestSettledSnapshot;
  if (!settled) return true;
  if (settled.source !== 'native_readback' && settled.source !== 'region_change_complete') return true;
  return regionsApproximatelyEqual(settled.region, args.region);
}

/**
 * Region-complete events have no command token. Trust direct completion only
 * for a current user gesture whose final callback agrees with the latest
 * continuous native sample. Programmatic completions use native boundary
 * readback, preventing an older animation callback from being labelled with a
 * newer command revision.
 */
export function shouldCommitRegionCompletion(args: {
  transition: CameraTransition | null;
  detailsIsGesture?: boolean;
  completionRegion: ClusterRegion;
  latestObservedRegion: ClusterRegion | null;
}): boolean {
  if (!isUsableMapRegion(args.completionRegion)) return false;
  if (args.detailsIsGesture === false) return false;
  const gesture = args.detailsIsGesture === true || args.transition?.source === 'gesture';
  if (!gesture) return false;
  return regionsApproximatelyEqual(args.latestObservedRegion, args.completionRegion);
}

export function isClusterQuerySynchronized(
  cameraRevision: number,
  snapshot: MapViewportSnapshot | null,
): boolean {
  return !!snapshot && snapshot.cameraRevision === cameraRevision;
}

export function isLatestMapRepresentation(args: {
  resultViewportRevision: number;
  resultCameraRevision: number;
  resultDatasetRevision: number;
  latestViewportRevision: number;
  latestCameraRevision: number;
  latestDatasetRevision: number;
}): boolean {
  return args.resultViewportRevision === args.latestViewportRevision &&
    args.resultCameraRevision === args.latestCameraRevision &&
    args.resultDatasetRevision === args.latestDatasetRevision;
}
