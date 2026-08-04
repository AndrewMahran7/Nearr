export const NEARR_CATEGORIES = [
  'restaurant', 'cafe', 'bakery', 'bar', 'hotel', 'park', 'hiking_trail',
  'beach', 'scenic_spot', 'attraction', 'museum', 'shopping', 'entertainment',
  'nightlife', 'fitness', 'wellness', 'transportation', 'education', 'service', 'other',
] as const;

export type NearrCategory = (typeof NEARR_CATEGORIES)[number];
export type CategorySource = 'google_primary_type' | 'google_types' | 'ai' | 'user' | 'fallback';

export const CATEGORY_MODEL_VERSION = 'nearr-category-2026-08-03.v1';
const CATEGORY_SET = new Set<string>(NEARR_CATEGORIES);

export function isNearrCategory(value: unknown): value is NearrCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

export const GOOGLE_PRIMARY_TYPE_CATEGORY_MAP: Readonly<Record<string, NearrCategory>> = {
  restaurant: 'restaurant', cafe: 'cafe', coffee_shop: 'cafe', tea_house: 'cafe',
  bakery: 'bakery', pastry_shop: 'bakery', donut_shop: 'bakery',
  bar: 'bar', pub: 'bar', cocktail_bar: 'bar', wine_bar: 'bar',
  hotel: 'hotel', motel: 'hotel', resort_hotel: 'hotel', hostel: 'hotel', inn: 'hotel', lodging: 'hotel',
  park: 'park', city_park: 'park', state_park: 'park', national_park: 'park', dog_park: 'park',
  hiking_area: 'hiking_trail', hiking_trail: 'hiking_trail', trail_head: 'hiking_trail',
  beach: 'beach', scenic_spot: 'scenic_spot', observation_deck: 'scenic_spot', scenic_viewpoint: 'scenic_spot',
  museum: 'museum', art_museum: 'museum', history_museum: 'museum',
  tourist_attraction: 'attraction', cultural_landmark: 'attraction', historical_landmark: 'attraction',
  monument: 'attraction', campground: 'attraction',
  shopping_mall: 'shopping', market: 'shopping', store: 'shopping',
  movie_theater: 'entertainment', theater: 'entertainment', performing_arts_theater: 'entertainment',
  amusement_park: 'entertainment', night_club: 'nightlife', dance_hall: 'nightlife',
  gym: 'fitness', fitness_center: 'fitness', sports_activity_location: 'fitness',
  spa: 'wellness', wellness_center: 'wellness', yoga_studio: 'wellness',
  airport: 'transportation', bus_station: 'transportation', train_station: 'transportation',
  transit_station: 'transportation', subway_station: 'transportation', ferry_terminal: 'transportation',
  university: 'education', college: 'education', school: 'education', library: 'education',
  visitor_center: 'service', travel_agency: 'service',
};

function normalizedProviderType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized || null;
}

export function mapGoogleType(type: string | null | undefined): NearrCategory | null {
  const normalized = normalizedProviderType(type);
  if (!normalized) return null;
  const direct = GOOGLE_PRIMARY_TYPE_CATEGORY_MAP[normalized];
  if (direct) return direct;
  if (normalized === 'food' || normalized.endsWith('_restaurant')) return 'restaurant';
  if (normalized.endsWith('_store') || normalized.endsWith('_shop')) return 'shopping';
  if (normalized.includes('museum')) return 'museum';
  if (normalized.includes('airport') || normalized.includes('station')) return 'transportation';
  return null;
}

export type CategoryResolution = {
  category: NearrCategory;
  source: CategorySource;
  confidence: number;
  modelVersion: string;
  userOverridden: boolean;
  evidenceTags: string[];
};

export type CategoryResolutionInput = {
  userOverride?: NearrCategory | null;
  googlePrimaryType?: string | null;
  googleTypes?: readonly string[] | null;
  ai?: {
    category: NearrCategory;
    confidence: number;
    modelVersion: string;
    evidenceTags?: readonly string[];
  } | null;
};

export function resolvePlaceCategory(input: CategoryResolutionInput): CategoryResolution {
  if (input.userOverride && isNearrCategory(input.userOverride)) {
    return { category: input.userOverride, source: 'user', confidence: 1, modelVersion: CATEGORY_MODEL_VERSION, userOverridden: true, evidenceTags: ['user_override'] };
  }
  const primary = mapGoogleType(input.googlePrimaryType);
  if (primary) {
    return { category: primary, source: 'google_primary_type', confidence: 1, modelVersion: CATEGORY_MODEL_VERSION, userOverridden: false, evidenceTags: [`primary_type:${normalizedProviderType(input.googlePrimaryType)}`] };
  }
  for (const type of input.googleTypes ?? []) {
    const mapped = mapGoogleType(type);
    if (mapped) {
      return { category: mapped, source: 'google_types', confidence: 0.95, modelVersion: CATEGORY_MODEL_VERSION, userOverridden: false, evidenceTags: [`google_type:${normalizedProviderType(type)}`] };
    }
  }
  if (input.ai && isNearrCategory(input.ai.category)) {
    return { category: input.ai.category, source: 'ai', confidence: Math.max(0, Math.min(1, input.ai.confidence)), modelVersion: input.ai.modelVersion, userOverridden: false, evidenceTags: [...(input.ai.evidenceTags ?? [])].slice(0, 8) };
  }
  return { category: 'other', source: 'fallback', confidence: 0, modelVersion: CATEGORY_MODEL_VERSION, userOverridden: false, evidenceTags: ['no_supported_category_signal'] };
}

export const CATEGORY_LABELS: Readonly<Record<NearrCategory, string>> = {
  restaurant: 'Restaurant', cafe: 'Cafe', bakery: 'Bakery', bar: 'Bar', hotel: 'Hotel',
  park: 'Park', hiking_trail: 'Hiking trail', beach: 'Beach', scenic_spot: 'Scenic spot',
  attraction: 'Attraction', museum: 'Museum', shopping: 'Shopping', entertainment: 'Entertainment',
  nightlife: 'Nightlife', fitness: 'Fitness', wellness: 'Wellness', transportation: 'Transportation',
  education: 'Education', service: 'Service', other: 'Other',
};

export const CATEGORY_FILTER_GROUPS = {
  all: NEARR_CATEGORIES,
  food: ['restaurant', 'bakery', 'bar'] as const,
  cafes: ['cafe'] as const,
  hotels: ['hotel'] as const,
  outdoors: ['park', 'hiking_trail', 'beach', 'scenic_spot'] as const,
  attractions: ['attraction', 'museum', 'entertainment', 'nightlife', 'education'] as const,
  shopping: ['shopping'] as const,
  fitness_wellness: ['fitness', 'wellness'] as const,
  other: ['transportation', 'service', 'other'] as const,
} satisfies Record<string, readonly NearrCategory[]>;

export type CategoryFilterGroup = keyof typeof CATEGORY_FILTER_GROUPS;

export function isCategoryFilterGroup(value: string): value is CategoryFilterGroup {
  return Object.prototype.hasOwnProperty.call(CATEGORY_FILTER_GROUPS, value);
}

export function displayCategory(category: NearrCategory | null | undefined): NearrCategory {
  return category && isNearrCategory(category) ? category : 'other';
}

export function categoryMatchesFilter(category: NearrCategory | null | undefined, filter: CategoryFilterGroup): boolean {
  if (filter === 'all') return true;
  return (CATEGORY_FILTER_GROUPS[filter] as readonly NearrCategory[]).includes(displayCategory(category));
}

export function savedPlaceCategory(saved: {
  category?: string | null;
  place?: { category?: string | null; google_primary_type?: string | null; google_types?: string[] | null } | null;
}): NearrCategory {
  if (isNearrCategory(saved.category)) return saved.category;
  if (isNearrCategory(saved.place?.category)) return saved.place.category;
  return resolvePlaceCategory({
    googlePrimaryType: saved.place?.google_primary_type,
    googleTypes: saved.place?.google_types,
  }).category;
}