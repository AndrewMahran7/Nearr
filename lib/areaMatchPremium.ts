/**
 * Pure specificity policy for a useful coarse-area result.
 *
 * Recognition supplies structured identity/category/geography evidence. This
 * module answers the narrower product question: did the free pass resolve the
 * destination the media depicts, or only the area around it? UI copy is never
 * an input.
 */

export const AREA_RESULT_CLASSES = ['area_match', 'area_match_incomplete'] as const;
export type AreaResultClass = typeof AREA_RESULT_CLASSES[number];

export type IntendedSpecificity = 'AREA_DESTINATION' | 'SPECIFIC_PHYSICAL_DESTINATION';
export type ResolvedSpecificity = 'CITY' | 'REGION' | 'COUNTRY' | 'AREA';
export type AreaIntentSignal = 'area_destination' | 'grounded_identity' | 'physical_category' | 'physical_place_type';

export type AreaIdentity = {
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
};

export type AreaMatchSpecificity = {
  resultClass: AreaResultClass;
  area: AreaIdentity;
  intendedSpecificity: IntendedSpecificity;
  resolvedSpecificity: ResolvedSpecificity;
  exactDestinationResolved: false;
  premiumEligible: boolean;
  intentSignal: AreaIntentSignal;
};

export type AreaMatchSpecificityInput = {
  nameHint?: string | null;
  category?: string | null;
  placeType?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  /** Positive structured evidence that the administrative area itself is the destination. */
  areaIsDestination?: boolean;
};

const PHYSICAL_DESTINATION_CATEGORIES = new Set([
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
  'hotel', 'resort', 'hiking_trail', 'park', 'beach', 'waterfall', 'lake',
  'marina', 'island', 'scenic_spot', 'attraction', 'museum', 'shopping',
  'entertainment', 'nightlife', 'sports', 'fitness', 'wellness',
  'transportation', 'education', 'service',
]);

function clean(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return normalized || null;
}

function fold(value: string | null | undefined): string {
  return clean(value)?.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase() ?? '';
}

export function classifyAreaMatchSpecificity(
  input: AreaMatchSpecificityInput,
): AreaMatchSpecificity | null {
  const city = clean(input.city);
  const region = clean(input.region);
  const country = clean(input.country);
  const name = city ?? region ?? country;
  if (!name) return null;

  const resolvedSpecificity: ResolvedSpecificity = city
    ? 'CITY'
    : region
      ? 'REGION'
      : country
        ? 'COUNTRY'
        : 'AREA';
  const areaLabels = new Set([city, region, country].filter(Boolean).map(fold));
  const groundedIdentity = clean(input.nameHint);
  const identityIsMoreSpecific = !!groundedIdentity && !areaLabels.has(fold(groundedIdentity));
  const category = clean(input.category)?.toLocaleLowerCase() ?? null;
  const placeType = clean(input.placeType);

  let signal: AreaIntentSignal = 'area_destination';
  if (input.areaIsDestination !== true) {
    if (identityIsMoreSpecific) signal = 'grounded_identity';
    else if (category && PHYSICAL_DESTINATION_CATEGORIES.has(category)) signal = 'physical_category';
    else if (placeType) signal = 'physical_place_type';
  }
  const specificDestination = signal !== 'area_destination';

  return {
    resultClass: specificDestination ? 'area_match_incomplete' : 'area_match',
    area: { name, city, region, country },
    intendedSpecificity: specificDestination ? 'SPECIFIC_PHYSICAL_DESTINATION' : 'AREA_DESTINATION',
    resolvedSpecificity,
    exactDestinationResolved: false,
    premiumEligible: specificDestination,
    intentSignal: signal,
  };
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/** Fail-closed reader used by eligibility, adapters, and tests. */
export function isAreaMatchIncomplete(value: unknown): boolean {
  const row = record(value);
  return row?.resultClass === 'area_match_incomplete' &&
    row.intendedSpecificity === 'SPECIFIC_PHYSICAL_DESTINATION' &&
    (row.resolvedSpecificity === 'CITY' || row.resolvedSpecificity === 'REGION' ||
      row.resolvedSpecificity === 'COUNTRY' || row.resolvedSpecificity === 'AREA') &&
    row.exactDestinationResolved === false &&
    row.premiumEligible === true &&
    !!record(row.area);
}

export function areaMatchIncompleteFromPayload(payload: unknown): Record<string, unknown> | null {
  const partial = record(record(payload)?.partialResult);
  return isAreaMatchIncomplete(partial) ? partial : null;
}
