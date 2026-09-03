/**
 * Pure state machine for a cluster-tap camera request.
 *
 * React Native Maps camera calls are fire-and-forget. This coordinator makes
 * that weak contract explicit: the target is chosen before dispatch, a tap can
 * issue at most one command, and watchdog/native failures only close the
 * transaction. A cluster interaction never selects a place.
 */

export type ClusterExpansionMember = {
  id: string;
  latitude: number;
  longitude: number;
};

export type ClusterExpansionRequest = {
  token: number;
  datasetKey: string;
  clusterId: number;
  clusterKey: string;
  memberIds: readonly string[];
  members: readonly ClusterExpansionMember[];
  currentZoom: number;
  targetZoom: number;
  latitude: number;
  longitude: number;
  targetRegion: {
    latitude: number;
    longitude: number;
    latitudeDelta: number;
    longitudeDelta: number;
  };
  target:
    | { kind: 'region' }
    | { kind: 'fit'; coordinates: readonly { latitude: number; longitude: number }[] }
    | { kind: 'none'; reason: 'max_zoom_overlap' | 'stale_cluster' | 'no_members' };
};

export type ClusterMembership = {
  clusterKey: string;
  memberIds: readonly string[];
};

export type ClusterExpansionAction =
  | { kind: 'none' }
  | { kind: 'queued'; request: ClusterExpansionRequest }
  | { kind: 'camera'; request: ClusterExpansionRequest }
  | { kind: 'ignored'; request: ClusterExpansionRequest; result: 'busy' }
  | { kind: 'failed'; request: ClusterExpansionRequest; result: 'timeout' | 'camera_exception' }
  | { kind: 'completed'; request: ClusterExpansionRequest; result: 'split' | 'settled' | 'max_zoom_overlap' | 'stale_cluster' | 'no_members' };

type ActiveExpansion = {
  request: ClusterExpansionRequest;
  phase: 'queued' | 'commanding' | 'settling';
  cameraCommandsIssued: number;
};

const NONE: ClusterExpansionAction = { kind: 'none' };

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const expected = new Set(left);
  return right.every((id) => expected.has(id));
}

export class MapClusterExpansionCoordinator {
  private active: ActiveExpansion | null = null;

  current(): Readonly<ActiveExpansion> | null {
    return this.active;
  }

  tap(request: ClusterExpansionRequest, mapUsable: boolean): ClusterExpansionAction {
    if (this.active) return { kind: 'ignored', request, result: 'busy' };
    if (request.target.kind === 'none') {
      return { kind: 'completed', request, result: request.target.reason };
    }
    this.active = {
      request,
      phase: mapUsable ? 'commanding' : 'queued',
      cameraCommandsIssued: 0,
    };
    return mapUsable ? { kind: 'camera', request } : { kind: 'queued', request };
  }

  mapBecameUsable(): ClusterExpansionAction {
    if (!this.active || this.active.phase !== 'queued') return NONE;
    this.active = { ...this.active, phase: 'commanding' };
    return { kind: 'camera', request: this.active.request };
  }

  cameraCommandIssued(): boolean {
    if (!this.active || this.active.phase !== 'commanding' || this.active.cameraCommandsIssued > 0) {
      return false;
    }
    this.active = { ...this.active, phase: 'settling', cameraCommandsIssued: 1 };
    return true;
  }

  cameraSettled(): ClusterExpansionAction {
    if (!this.active || this.active.phase !== 'settling') return NONE;
    const request = this.active.request;
    this.active = null;
    return { kind: 'completed', request, result: 'settled' };
  }

  /**
   * Verify only after native reports a completed region.  A missing member-set
   * means the original cluster became child clusters/individuals (or filtering
   * legitimately removed it), which is the successful outcome.
   */
  clustersRecomputed(current: readonly ClusterMembership[]): ClusterExpansionAction {
    if (!this.active || this.active.phase !== 'settling') return NONE;
    const unchanged = current.some((cluster) =>
      sameMembers(cluster.memberIds, this.active!.request.memberIds),
    );
    if (unchanged) return NONE;
    const request = this.active.request;
    this.active = null;
    return { kind: 'completed', request, result: 'split' };
  }

  cameraFailed(): ClusterExpansionAction {
    return this.finishFailure('camera_exception');
  }

  timeout(): ClusterExpansionAction {
    return this.finishFailure('timeout');
  }

  private finishFailure(result: 'timeout' | 'camera_exception'): ClusterExpansionAction {
    if (!this.active) return NONE;
    const request = this.active.request;
    this.active = null;
    return { kind: 'failed', request, result };
  }

  reset(): void {
    this.active = null;
  }
}

/** Stable, order-independent member identity used to verify a split. */
export function clusterMemberKey(memberIds: readonly string[]): string {
  return [...memberIds].sort().join('|');
}

type ClusterMarkerIdentity = {
  clusterId: number;
  datasetKey?: string;
  clusterKey?: string;
  latitude: number;
  longitude: number;
};

/**
 * Resolve a possibly stale native marker event against the latest render.
 *
 * An ephemeral Supercluster id is trusted only within the same dataset. Across
 * rebuilds, membership identity must match exactly. The previous unbounded
 * "nearest cluster" fallback could route a stale native event to an unrelated
 * group anywhere in the current viewport.
 */
export function resolveLatestClusterMarker<T extends ClusterMarkerIdentity>(
  tapped: ClusterMarkerIdentity,
  current: readonly T[],
): T | null {
  const sameMembership = tapped.clusterKey
    ? current.find((candidate) => candidate.clusterKey === tapped.clusterKey)
    : null;
  if (sameMembership) return sameMembership;
  if (!tapped.datasetKey) return null;
  return current.find((candidate) =>
    candidate.datasetKey === tapped.datasetKey && candidate.clusterId === tapped.clusterId,
  ) ?? null;
}

/**
 * A valid fit for both spread-out and perfectly co-located members.  The
 * epsilon corners prevent native fitToCoordinates implementations from
 * treating a zero-area bounds as a no-op.
 */
export function clusterMemberFitCoordinates(
  members: readonly ClusterExpansionMember[],
  minimumSpan = 0.0002,
): Array<{ latitude: number; longitude: number }> {
  if (members.length === 0) return [];
  let minLat = members[0]!.latitude;
  let maxLat = minLat;
  let minLng = members[0]!.longitude;
  let maxLng = minLng;
  for (const member of members.slice(1)) {
    minLat = Math.min(minLat, member.latitude);
    maxLat = Math.max(maxLat, member.latitude);
    minLng = Math.min(minLng, member.longitude);
    maxLng = Math.max(maxLng, member.longitude);
  }
  const latPad = Math.max(0, (minimumSpan - (maxLat - minLat)) / 2);
  const lngPad = Math.max(0, (minimumSpan - (maxLng - minLng)) / 2);
  return [
    { latitude: minLat - latPad, longitude: minLng - lngPad },
    { latitude: maxLat + latPad, longitude: maxLng + lngPad },
  ];
}

/** True only when a one-shot native fit can reveal spatially distinct points. */
export function clusterMembersHaveUsefulBounds(
  members: readonly ClusterExpansionMember[],
  minimumSpan = 0.00002,
): boolean {
  if (members.length < 2) return false;
  const unique = new Set(members.map((member) => `${member.latitude}:${member.longitude}`));
  if (unique.size < 2) return false;
  const latitudes = members.map((member) => member.latitude);
  const longitudes = members.map((member) => member.longitude);
  return Math.max(...latitudes) - Math.min(...latitudes) >= minimumSpan ||
    Math.max(...longitudes) - Math.min(...longitudes) >= minimumSpan;
}
