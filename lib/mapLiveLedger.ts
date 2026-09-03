import type { ClusterRegion } from './mapClustering';

export type MapLiveLedgerEntry = {
  eventType: string;
  timestamp: number;
  interactionId?: number | string | null;
  cameraTransactionId?: number | string | null;
  cameraTransactionState?: string | null;
  viewportRevision?: number;
  cameraRevision?: number;
  datasetRevision?: number;
  clusterIndexRevision?: string;
  nativeBbox?: readonly [number, number, number, number] | null;
  jsBbox?: readonly [number, number, number, number] | null;
  nativeRegion?: ClusterRegion | null;
  jsRegion?: ClusterRegion | null;
  nativeZoom?: number | null;
  derivedZoom?: number | null;
  queryZoom?: number | null;
  eligibleCount?: number;
  individualMarkerCount?: number;
  clusterCount?: number;
  representedCount?: number;
  missingCount?: number;
  duplicateCount?: number;
  result?: string;
};

const MAX_MAP_LIVE_LEDGER_ENTRIES = 100;
let entries: MapLiveLedgerEntry[] = [];

export function recordMapLiveLedger(entry: MapLiveLedgerEntry): void {
  entries = [...entries, { ...entry }].slice(-MAX_MAP_LIVE_LEDGER_ENTRIES);
}

export function getMapLiveLedger(): readonly MapLiveLedgerEntry[] {
  return entries;
}

export function clearMapLiveLedger(): void {
  entries = [];
}

export function installMapLiveLedgerDevDump(): void {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  (globalThis as typeof globalThis & { __NEARR_DUMP_MAP_LEDGER__?: () => readonly MapLiveLedgerEntry[] })
    .__NEARR_DUMP_MAP_LEDGER__ = getMapLiveLedger;
}
