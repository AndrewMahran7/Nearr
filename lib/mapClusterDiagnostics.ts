/** Bounded, privacy-safe diagnostics emitted only around explicit cluster taps. */

export type MapClusterDiagnosticEvent =
  | 'cluster_tap'
  | 'cluster_expand_requested'
  | 'cluster_expand_skipped'
  | 'cluster_expand_completed'
  | 'cluster_expand_timeout';

export type DiagnosticRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapClusterDiagnostic = {
  event: MapClusterDiagnosticEvent;
  timestamp: number;
  clusterId: number;
  memberCount: number;
  currentZoom: number;
  targetZoom: number;
  currentRegion: DiagnosticRegion | null;
  targetRegion: DiagnosticRegion | null;
  mapReady: boolean;
  selectedPin: boolean;
  selectedCluster: number | null;
  cameraOwner: 'user' | 'follow' | 'cluster';
  animationActive: boolean;
  filterKey: string;
  visibleMarkerCount: number;
  clusterChildCount: number;
  expansionDispatched: boolean;
  cameraCommandExecuted: boolean;
  clusteringRecomputed: boolean;
  resultingClusterCount: number | null;
  resultingMemberCount: number | null;
  result?: string;
};

const MAX_CLUSTER_DIAGNOSTICS = 40;
let diagnostics: MapClusterDiagnostic[] = [];

function rounded(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function roundedRegion(region: DiagnosticRegion | null): DiagnosticRegion | null {
  if (!region) return null;
  return {
    latitude: rounded(region.latitude),
    longitude: rounded(region.longitude),
    latitudeDelta: rounded(region.latitudeDelta),
    longitudeDelta: rounded(region.longitudeDelta),
  };
}

export function recordMapClusterDiagnostic(
  event: MapClusterDiagnosticEvent,
  fields: Omit<MapClusterDiagnostic, 'event' | 'timestamp' | 'currentRegion' | 'targetRegion'> & {
    currentRegion: DiagnosticRegion | null;
    targetRegion: DiagnosticRegion | null;
  },
): void {
  const entry: MapClusterDiagnostic = {
    ...fields,
    event,
    timestamp: Date.now(),
    currentZoom: rounded(fields.currentZoom),
    targetZoom: rounded(fields.targetZoom),
    currentRegion: roundedRegion(fields.currentRegion),
    targetRegion: roundedRegion(fields.targetRegion),
  };
  diagnostics = [...diagnostics, entry].slice(-MAX_CLUSTER_DIAGNOSTICS);
  if (__DEV__) console.debug(`[map] ${event}`, entry);
}

export function getMapClusterDiagnostics(): readonly MapClusterDiagnostic[] {
  return diagnostics;
}

export function clearMapClusterDiagnostics(): void {
  diagnostics = [];
}
