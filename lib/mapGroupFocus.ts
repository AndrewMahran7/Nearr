export type MapGroupFocusSource = 'share_job_saved' | 'share_saved' | 'development_preview';

export type MapGroupFocusRequest = {
  id: string;
  savedPlaceIds: string[];
  source: MapGroupFocusSource;
  failedCount: number;
};

type GroupResolvablePlace = {
  id: string;
  place?: {
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

export type ResolvedMapGroup<T> = {
  places: T[];
  coordinatePlaces: T[];
  missingIds: string[];
  missingCoordinateIds: string[];
};

export type MapGroupFitDecision = 'wait' | 'fit' | 'ignore';

export function decideMapGroupFit(args: {
  requestId: string | null | undefined;
  handledRequestId: string | null;
  mapReady: boolean;
  layoutHeight: number;
  waitingForPlaces: boolean;
}): MapGroupFitDecision {
  if (!args.requestId || args.handledRequestId === args.requestId) return 'ignore';
  if (!args.mapReady || args.layoutHeight <= 0 || args.waitingForPlaces) return 'wait';
  return 'fit';
}

const MAX_ACTIVE_REQUESTS = 8;
const MAX_GROUP_SIZE = 50;
const requests = new Map<string, MapGroupFocusRequest>();
let requestSequence = 0;

function normalizeIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of ids) {
    const id = typeof value === 'string' ? value.trim() : '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length === MAX_GROUP_SIZE) break;
  }
  return result;
}

export function createMapGroupFocusRequest(args: {
  savedPlaceIds: readonly string[];
  source: MapGroupFocusSource;
  failedCount?: number;
}): MapGroupFocusRequest | null {
  const savedPlaceIds = normalizeIds(args.savedPlaceIds);
  if (savedPlaceIds.length === 0) return null;

  requestSequence += 1;
  const request: MapGroupFocusRequest = {
    id: `group-${Date.now().toString(36)}-${requestSequence.toString(36)}`,
    savedPlaceIds,
    source: args.source,
    failedCount: Math.max(0, Math.floor(args.failedCount ?? 0)),
  };
  requests.set(request.id, request);
  while (requests.size > MAX_ACTIVE_REQUESTS) {
    const oldestId = requests.keys().next().value as string | undefined;
    if (!oldestId) break;
    requests.delete(oldestId);
  }
  return request;
}

export function getMapGroupFocusRequest(id: unknown): MapGroupFocusRequest | null {
  if (typeof id !== 'string' || !id.trim()) return null;
  return requests.get(id.trim()) ?? null;
}

export function clearMapGroupFocusRequest(id: unknown): void {
  if (typeof id === 'string') requests.delete(id.trim());
}

export function resolveMapGroupPlaces<T extends GroupResolvablePlace>(
  allPlaces: readonly T[],
  savedPlaceIds: readonly string[],
): ResolvedMapGroup<T> {
  const byId = new Map(allPlaces.map((place) => [place.id, place]));
  const places: T[] = [];
  const coordinatePlaces: T[] = [];
  const missingIds: string[] = [];
  const missingCoordinateIds: string[] = [];

  for (const id of normalizeIds(savedPlaceIds)) {
    const place = byId.get(id);
    if (!place) {
      missingIds.push(id);
      continue;
    }
    places.push(place);
    if (
      Number.isFinite(place.place?.latitude) &&
      Number.isFinite(place.place?.longitude)
    ) {
      coordinatePlaces.push(place);
    } else {
      missingCoordinateIds.push(id);
    }
  }
  return { places, coordinatePlaces, missingIds, missingCoordinateIds };
}

export function mapGroupEdgePadding(args: {
  topChromeHeight: number;
  bottomOverlayHeight: number;
  horizontal?: number;
}): { top: number; right: number; bottom: number; left: number } {
  const horizontal = Math.max(24, Math.round(args.horizontal ?? 48));
  return {
    top: Math.max(48, Math.round(args.topChromeHeight + 24)),
    right: horizontal,
    bottom: Math.max(72, Math.round(args.bottomOverlayHeight + 24)),
    left: horizontal,
  };
}