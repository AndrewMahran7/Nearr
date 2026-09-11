export type CandidatePresentationTrigger =
  | 'recognition_result'
  | 'multi_place'
  | 'wrong_place'
  | 'automatic_correction'
  | 'manual_correction'
  | 'map_candidate'
  | 'other';

export type CandidatePresentationContext = {
  trigger: CandidatePresentationTrigger;
  jobId?: string | null;
  candidateIndex?: number | null;
  candidateCount?: number | null;
};

export type CandidateHydrationReason =
  | 'required'
  | 'inactive'
  | 'existing_photo_data'
  | 'source_media'
  | 'lookup_disabled'
  | 'missing_place_id';

export type CandidateHydrationDecision = {
  shouldRequest: boolean;
  reason: CandidateHydrationReason;
};

export function normalizedPhotoUrls(
  urls: readonly (string | null | undefined)[] | null | undefined,
  max = 5,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const value of urls ?? []) {
    const uri = typeof value === 'string' ? value.trim() : '';
    if (!uri || seen.has(uri)) continue;
    seen.add(uri);
    normalized.push(uri);
    if (normalized.length >= Math.max(0, max)) break;
  }
  return normalized;
}

/**
 * Optional provider hydration is the final fallback, never a mount side-effect.
 * Source/frame media counts as a useful preview and therefore avoids Details.
 */
export function candidateHydrationDecision(input: {
  active: boolean;
  allowGoogleLookup?: boolean;
  googlePlaceId?: string | null;
  photoUrls?: readonly (string | null | undefined)[] | null;
  sourceUri?: string | null;
  fallbackSourceUri?: string | null;
}): CandidateHydrationDecision {
  if (normalizedPhotoUrls(input.photoUrls).length > 0) {
    return { shouldRequest: false, reason: 'existing_photo_data' };
  }
  if (input.sourceUri?.trim() || input.fallbackSourceUri?.trim()) {
    return { shouldRequest: false, reason: 'source_media' };
  }
  if (input.allowGoogleLookup === false) {
    return { shouldRequest: false, reason: 'lookup_disabled' };
  }
  if (!input.active) return { shouldRequest: false, reason: 'inactive' };
  if (!input.googlePlaceId?.trim()) {
    return { shouldRequest: false, reason: 'missing_place_id' };
  }
  return { shouldRequest: true, reason: 'required' };
}

/** Last explicit selection wins; otherwise the first rendered candidate is active. */
export function activeCandidatePlaceId(
  candidateIds: readonly (string | null | undefined)[],
  selectedIds: Iterable<string>,
): string | null {
  const valid = new Set(candidateIds.filter((id): id is string => typeof id === 'string' && id.length > 0));
  const selected = [...selectedIds].filter((id) => valid.has(id));
  return selected[selected.length - 1] ?? [...valid][0] ?? null;
}

export type CandidatePhotoCacheOutcome = 'requested' | 'deduped' | 'cache_hit';

export type CandidatePhotoCache = {
  get: (placeId: string) => Promise<string[]>;
  getWithOutcome: (
    placeId: string,
    onCallerOutcome?: (outcome: CandidatePhotoCacheOutcome, placeId: string) => void,
  ) => Promise<{
    urls: string[];
    outcome: CandidatePhotoCacheOutcome;
  }>;
  invalidate: (placeId: string) => void;
};

/** Small process-lifetime cache: coalesces equal in-flight requests and revisits. */
export function createCandidatePhotoCache(
  load: (placeId: string) => Promise<readonly string[]>,
  onOutcome?: (outcome: CandidatePhotoCacheOutcome, placeId: string) => void,
): CandidatePhotoCache {
  const values = new Map<string, string[]>();
  const inFlight = new Map<string, Promise<string[]>>();

  const getWithOutcome: CandidatePhotoCache['getWithOutcome'] = (placeId, onCallerOutcome) => {
      const key = placeId.trim();
      const cached = values.get(key);
      if (cached) {
        onOutcome?.('cache_hit', key);
        onCallerOutcome?.('cache_hit', key);
        return Promise.resolve({ urls: cached, outcome: 'cache_hit' });
      }
      const pending = inFlight.get(key);
      if (pending) {
        onOutcome?.('deduped', key);
        onCallerOutcome?.('deduped', key);
        return pending.then((urls) => ({ urls, outcome: 'deduped' as const }));
      }
      onOutcome?.('requested', key);
      onCallerOutcome?.('requested', key);
      const request = load(key)
        .then((urls) => normalizedPhotoUrls(urls))
        .catch(() => [])
        .then((urls) => {
          values.set(key, urls);
          return urls;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, request);
      return request.then((urls) => ({ urls, outcome: 'requested' as const }));
  };

  return {
    get(placeId: string) {
      return getWithOutcome(placeId).then((result) => result.urls);
    },
    getWithOutcome,
    invalidate(placeId: string) {
      const key = placeId.trim();
      values.delete(key);
      inFlight.delete(key);
    },
  };
}

/** Only pages the user has actually reached may mount a remote image. */
export function visitCandidatePhoto(
  visited: ReadonlySet<number>,
  index: number,
  photoCount: number,
): ReadonlySet<number> {
  if (index < 0 || index >= photoCount || visited.has(index)) return visited;
  return new Set([...visited, index]);
}
