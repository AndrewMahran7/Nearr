export const SHARE_EXTENSION_SUCCESS_LAYOUT = {
  approximateHeight: 282,
  cornerRadius: 28,
  horizontalPadding: 24,
  topPadding: 26,
  iconSize: 48,
  primaryHeight: 48,
  secondaryHeight: 44,
} as const;

export function queueIntro(count: number): string {
  return count === 1
    ? 'I found a place that needs a quick check.'
    : `I found ${count} places that need a quick check.`;
}

export function splitPlaceAddress(address: string | null | undefined): {
  locality: string | null;
  streetAddress: string | null;
} {
  if (!address?.trim()) return { locality: null, streetAddress: null };
  const parts = address.split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return { locality: null, streetAddress: address.trim() };

  const country = parts.at(-1)?.toUpperCase();
  const hasCountry = country === 'USA' || country === 'US' || country === 'UNITED STATES';
  const stateIndex = hasCountry ? parts.length - 2 : parts.length - 1;
  const cityIndex = stateIndex - 1;
  const locality = cityIndex >= 0
    ? [parts[cityIndex], parts[stateIndex]?.replace(/\s+\d{5}(?:-\d{4})?$/, '')]
        .filter(Boolean)
        .join(', ')
    : null;
  const streetAddress = cityIndex > 0 ? parts.slice(0, cityIndex).join(', ') : null;
  return { locality: locality || null, streetAddress };
}

export function processingMessage(status: string, ageMs: number): string {
  if (ageMs > 3 * 60 * 1000) return 'Taking a little longer…';
  return status === 'processing_metadata' ? 'Matching the location…' : 'Checking the post…';
}

export const PHASE_1_COPY = {
  emptyTitle: "You're all caught up",
  emptyBody: "Places you share will appear here while I'm checking them.",
  detailTitle: 'Quick check',
  suggestedHeading: 'I found a likely match',
  suggestedBody: 'Is this the place from the post?',
  alreadySavedHeading: 'You already saved this place',
  alreadySavedBody: "It's ready on your map.",
  viewOnMap: 'View on map',
  alternativeAction: 'Not the right place?',
  searchLabel: 'Search for the place',
  removeTitle: 'Remove this save?',
  removeMessage: 'This post will leave your queue.',
} as const;