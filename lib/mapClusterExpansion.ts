/**
 * Pure state machine for a cluster-tap camera request.
 *
 * React Native Maps camera calls are fire-and-forget.  This coordinator makes
 * that weak contract explicit: a tap is queued until the map is usable, the
 * resulting clustering is verified, one member-bounds fit is allowed, and a
 * member selection is the terminal fallback.  There is never an unbounded
 * retry and no state can remain "animating" forever.
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
};

export type ClusterMembership = {
  clusterKey: string;
  memberIds: readonly string[];
};

export type ClusterExpansionAction =
  | { kind: 'none' }
  | { kind: 'queued'; request: ClusterExpansionRequest }
  | { kind: 'primary_camera'; request: ClusterExpansionRequest }
  | { kind: 'fallback_fit'; request: ClusterExpansionRequest }
  | { kind: 'fallback_select'; request: ClusterExpansionRequest }
  | { kind: 'completed'; request: ClusterExpansionRequest; result: 'split' | 'fallback_selection' };

type ActiveExpansion = {
  request: ClusterExpansionRequest;
  phase: 'queued' | 'primary' | 'fallback';
  cameraSettled: boolean;
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
    this.active = {
      request,
      phase: mapUsable ? 'primary' : 'queued',
      cameraSettled: false,
    };
    return mapUsable ? { kind: 'primary_camera', request } : { kind: 'queued', request };
  }

  mapBecameUsable(): ClusterExpansionAction {
    if (!this.active || this.active.phase !== 'queued') return NONE;
    this.active = { ...this.active, phase: 'primary', cameraSettled: false };
    return { kind: 'primary_camera', request: this.active.request };
  }

  cameraSettled(): void {
    if (this.active && this.active.phase !== 'queued') {
      this.active = { ...this.active, cameraSettled: true };
    }
  }

  /**
   * Verify only after native reports a completed region.  A missing member-set
   * means the original cluster became child clusters/individuals (or filtering
   * legitimately removed it), which is the successful outcome.
   */
  clustersRecomputed(current: readonly ClusterMembership[]): ClusterExpansionAction {
    if (!this.active || this.active.phase === 'queued' || !this.active.cameraSettled) return NONE;
    const unchanged = current.some((cluster) =>
      sameMembers(cluster.memberIds, this.active!.request.memberIds),
    );
    if (unchanged) return NONE;
    const request = this.active.request;
    this.active = null;
    return { kind: 'completed', request, result: 'split' };
  }

  cameraFailed(): ClusterExpansionAction {
    return this.advanceAfterFailure();
  }

  timeout(): ClusterExpansionAction {
    return this.advanceAfterFailure();
  }

  private advanceAfterFailure(): ClusterExpansionAction {
    if (!this.active || this.active.phase === 'queued') return NONE;
    if (this.active.phase === 'primary') {
      this.active = { ...this.active, phase: 'fallback', cameraSettled: false };
      return { kind: 'fallback_fit', request: this.active.request };
    }
    const request = this.active.request;
    this.active = null;
    return { kind: 'fallback_select', request };
  }

  completeFallbackSelection(request: ClusterExpansionRequest): ClusterExpansionAction {
    return { kind: 'completed', request, result: 'fallback_selection' };
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
  canonicalClusterKey?: string;
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
  const sameCanonicalMembership = tapped.canonicalClusterKey
    ? current.find((candidate) =>
        candidate.canonicalClusterKey === tapped.canonicalClusterKey,
      )
    : null;
  if (sameCanonicalMembership) return sameCanonicalMembership;
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
