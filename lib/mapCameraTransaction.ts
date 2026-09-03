import type { ClusterRegion } from './mapClustering';

export type CameraTransactionReason =
  | 'cluster_tap'
  | 'fit_children'
  | 'user_location'
  | 'programmatic_focus'
  | 'foreground_restore'
  | 'other';

export type CameraTransactionState =
  | 'commanding'
  | 'settling'
  | 'settled'
  | 'cancelled'
  | 'failed';

export type CameraTransaction = {
  id: number;
  reason: CameraTransactionReason;
  state: CameraTransactionState;
  startedAt: number;
  startingViewportRevision: number;
  targetCenter?: { latitude: number; longitude: number };
  targetZoom?: number;
  targetRegion?: ClusterRegion;
  expectedClusterId?: number | string;
  cameraCommandsIssued: number;
  terminalReason?: string;
};

export type StartCameraTransaction = Omit<
  CameraTransaction,
  'id' | 'state' | 'cameraCommandsIssued' | 'terminalReason'
>;

function activeState(state: CameraTransactionState): boolean {
  return state === 'commanding' || state === 'settling';
}

function normalizedLongitude(value: number): number {
  return ((value + 180) % 360 + 360) % 360 - 180;
}

export function cameraTargetMatches(
  target: Pick<CameraTransaction, 'targetCenter' | 'targetZoom' | 'targetRegion'>,
  observedRegion: ClusterRegion,
  observedZoom: number,
): boolean {
  const targetCenter = target.targetCenter ?? (target.targetRegion
    ? { latitude: target.targetRegion.latitude, longitude: target.targetRegion.longitude }
    : undefined);
  const centerMatches = !targetCenter || (
    Math.abs(targetCenter.latitude - observedRegion.latitude) <= Math.max(0.01, observedRegion.latitudeDelta * 0.03) &&
    Math.abs(normalizedLongitude(targetCenter.longitude - observedRegion.longitude)) <=
      Math.max(0.01, observedRegion.longitudeDelta * 0.03)
  );
  const zoomMatches = target.targetZoom == null || Math.abs(target.targetZoom - observedZoom) <= 1;
  return centerMatches && zoomMatches;
}

/**
 * Owns all imperative camera commands. A transaction can issue exactly one
 * command. Further programmatic starts are rejected until native state settles,
 * fails, or a user gesture cancels ownership.
 */
export class MapCameraTransactionCoordinator {
  private nextId = 0;
  private transaction: CameraTransaction | null = null;

  current(): Readonly<CameraTransaction> | null {
    return this.transaction;
  }

  active(): Readonly<CameraTransaction> | null {
    return this.transaction && activeState(this.transaction.state) ? this.transaction : null;
  }

  start(input: StartCameraTransaction): Readonly<CameraTransaction> | null {
    if (this.active()) return null;
    this.transaction = {
      ...input,
      id: ++this.nextId,
      state: 'commanding',
      cameraCommandsIssued: 0,
    };
    return this.transaction;
  }

  commandIssued(id: number): Readonly<CameraTransaction> | null {
    if (!this.transaction || this.transaction.id !== id || this.transaction.state !== 'commanding') {
      return null;
    }
    if (this.transaction.cameraCommandsIssued >= 1) return null;
    this.transaction = {
      ...this.transaction,
      state: 'settling',
      cameraCommandsIssued: 1,
    };
    return this.transaction;
  }

  settle(id: number, observedRegion?: ClusterRegion, observedZoom?: number): Readonly<CameraTransaction> | null {
    if (!this.transaction || this.transaction.id !== id || !activeState(this.transaction.state)) return null;
    const targetMatched = observedRegion && observedZoom != null
      ? cameraTargetMatches(this.transaction, observedRegion, observedZoom)
      : true;
    this.transaction = {
      ...this.transaction,
      state: 'settled',
      terminalReason: targetMatched ? 'native_target_observed' : 'native_state_observed',
    };
    return this.transaction;
  }

  fail(id: number, reason: string): Readonly<CameraTransaction> | null {
    if (!this.transaction || this.transaction.id !== id || !activeState(this.transaction.state)) return null;
    this.transaction = { ...this.transaction, state: 'failed', terminalReason: reason };
    return this.transaction;
  }

  cancelActive(reason = 'user_gesture'): Readonly<CameraTransaction> | null {
    if (!this.active() || !this.transaction) return null;
    this.transaction = { ...this.transaction, state: 'cancelled', terminalReason: reason };
    return this.transaction;
  }

  reset(reason = 'lifecycle_reset'): void {
    this.cancelActive(reason);
  }
}
