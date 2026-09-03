export type ReservationStatus = 'reserved' | 'consumed' | 'released';

export type PlaceFindLedgerState = {
  available: number;
  reserved: number;
  grants: Set<string>;
  purchases: Set<string>;
  reservations: Map<string, { status: ReservationStatus; cycle: number }>;
};

export function emptyPlaceFindLedger(): PlaceFindLedgerState {
  return {
    available: 0,
    reserved: 0,
    grants: new Set(),
    purchases: new Set(),
    reservations: new Map(),
  };
}

function copy(state: PlaceFindLedgerState): PlaceFindLedgerState {
  return {
    ...state,
    grants: new Set(state.grants),
    purchases: new Set(state.purchases),
    reservations: new Map(state.reservations),
  };
}

export function grantPlaceFinds(
  state: PlaceFindLedgerState,
  idempotencyKey: string,
  uses: number,
): { state: PlaceFindLedgerState; replayed: boolean } {
  if (!Number.isInteger(uses) || uses <= 0) throw new Error('invalid_place_find_grant');
  if (state.grants.has(idempotencyKey)) return { state, replayed: true };
  const next = copy(state);
  next.grants.add(idempotencyKey);
  next.available += uses;
  return { state: next, replayed: false };
}

export function applyPlaceFindPurchase(
  state: PlaceFindLedgerState,
  transactionId: string,
  uses: number,
): { state: PlaceFindLedgerState; replayed: boolean } {
  if (state.purchases.has(transactionId)) return { state, replayed: true };
  const next = grantPlaceFinds(state, `purchase:${transactionId}`, uses).state;
  next.purchases.add(transactionId);
  return { state: next, replayed: false };
}

export function reservePlaceFind(
  state: PlaceFindLedgerState,
  jobId: string,
): { state: PlaceFindLedgerState; replayed: boolean } {
  const existing = state.reservations.get(jobId);
  if (existing?.status === 'reserved' || existing?.status === 'consumed') {
    return { state, replayed: true };
  }
  if (state.available < 1) throw new Error('insufficient_place_finds');
  const next = copy(state);
  next.available -= 1;
  next.reserved += 1;
  next.reservations.set(jobId, {
    status: 'reserved',
    cycle: (existing?.cycle ?? 0) + 1,
  });
  return { state: next, replayed: false };
}

export function consumePlaceFind(
  state: PlaceFindLedgerState,
  jobId: string,
): { state: PlaceFindLedgerState; replayed: boolean } {
  const existing = state.reservations.get(jobId);
  if (!existing) throw new Error('reservation_not_found');
  if (existing.status === 'consumed') return { state, replayed: true };
  if (existing.status !== 'reserved') throw new Error('reservation_terminal_conflict');
  const next = copy(state);
  next.reserved -= 1;
  next.reservations.set(jobId, { ...existing, status: 'consumed' });
  return { state: next, replayed: false };
}

export function releasePlaceFind(
  state: PlaceFindLedgerState,
  jobId: string,
): { state: PlaceFindLedgerState; replayed: boolean } {
  const existing = state.reservations.get(jobId);
  if (!existing) throw new Error('reservation_not_found');
  if (existing.status === 'released') return { state, replayed: true };
  if (existing.status !== 'reserved') throw new Error('reservation_terminal_conflict');
  const next = copy(state);
  next.available += 1;
  next.reserved -= 1;
  next.reservations.set(jobId, { ...existing, status: 'released' });
  return { state: next, replayed: false };
}

