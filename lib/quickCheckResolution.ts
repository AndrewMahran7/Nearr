export type QuickCheckCandidate = {
  googlePlaceId: string;
  name: string;
  latitude: number | null;
  longitude: number | null;
};

const claimedInitialSearches = new Set<string>();

export function normalizeQuickCheckQuery(query: string | null | undefined): string {
  return (query ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function quickCheckSearchKey(
  jobId: string,
  logicalResultId: string,
  query: string,
): string {
  return `${jobId.trim()}:${logicalResultId.trim()}:${normalizeQuickCheckQuery(query)}`;
}

export function claimInitialQuickCheckSearch(key: string): boolean {
  if (!key || claimedInitialSearches.has(key)) return false;
  claimedInitialSearches.add(key);
  return true;
}

export function resetInitialQuickCheckSearchesForTests(): void {
  claimedInitialSearches.clear();
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

export function isStrongQuickCheckCandidate(
  query: string,
  candidate: QuickCheckCandidate,
): boolean {
  if (
    !candidate.googlePlaceId.trim() ||
    !candidate.name.trim() ||
    !Number.isFinite(candidate.latitude) ||
    !Number.isFinite(candidate.longitude)
  ) {
    return false;
  }
  const queryTokens = tokens(query);
  const nameTokens = new Set(tokens(candidate.name));
  return queryTokens.length > 0 && queryTokens.some((token) => nameTokens.has(token));
}

export function selectedQuickCheckCandidate<T extends QuickCheckCandidate>(
  query: string,
  candidates: readonly T[],
): T | null {
  return candidates.length === 1 && isStrongQuickCheckCandidate(query, candidates[0]!)
    ? candidates[0]!
    : null;
}
