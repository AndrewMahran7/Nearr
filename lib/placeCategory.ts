/**
 * The single consumer-facing category contract used by every Nearr save path.
 * Google taxonomy stays as evidence; raw provider strings are never persisted
 * as a saved-place category or exposed as filter labels.
 */
export const NEARR_CATEGORIES = [
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert',
  'hotel', 'resort',
  'hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island', 'scenic_spot',
  'attraction', 'museum', 'entertainment', 'shopping', 'nightlife', 'sports',
  'fitness', 'wellness',
  'transportation', 'education', 'service', 'other',
] as const;

export type NearrCategory = (typeof NEARR_CATEGORIES)[number];
export type CategorySource =
  | 'google_primary_type'
  | 'google_types'
  | 'deterministic'
  | 'ai'
  | 'user'
  | 'fallback';

export const CATEGORY_MODEL_VERSION = 'nearr-category-2026-08-13.v3';
const CATEGORY_SET = new Set<string>(NEARR_CATEGORIES);

export function isNearrCategory(value: unknown): value is NearrCategory {
  return typeof value === 'string' && CATEGORY_SET.has(value);
}

/** Generic provider labels may support a classification but must never win it. */
const GENERIC_PROVIDER_TYPES = new Set([
  'establishment', 'point_of_interest', 'natural_feature', 'tourist_attraction',
  'premise', 'route', 'geocode',
]);
const DEFERRED_PROVIDER_TYPES = new Set([
  ...GENERIC_PROVIDER_TYPES,
  'food', 'lodging', 'store', 'service',
]);

export const GOOGLE_PRIMARY_TYPE_CATEGORY_MAP: Readonly<Record<string, NearrCategory>> = {
  // Food and drink. Keep useful venue identity ahead of broad food mappings.
  restaurant: 'restaurant', food: 'restaurant', meal_takeaway: 'restaurant', meal_delivery: 'restaurant',
  food_delivery: 'restaurant', cafeteria: 'restaurant', bistro: 'restaurant', buffet_restaurant: 'restaurant',
  steak_house: 'restaurant', sandwich_shop: 'restaurant', salad_shop: 'restaurant',
  cafe: 'cafe', coffee_shop: 'cafe', tea_house: 'cafe', cat_cafe: 'cafe', internet_cafe: 'cafe',
  bakery: 'bakery', pastry_shop: 'bakery', bagel_shop: 'bakery',
  bar: 'bar', pub: 'bar', cocktail_bar: 'bar', wine_bar: 'bar', sports_bar: 'bar',
  bar_and_grill: 'bar', beer_garden: 'bar',
  brewery: 'brewery', brewpub: 'brewery',
  winery: 'winery', vineyard: 'winery', wine_tasting_room: 'winery',
  dessert_shop: 'dessert', ice_cream_shop: 'dessert', candy_store: 'dessert', chocolate_shop: 'dessert',
  cake_shop: 'dessert', donut_shop: 'dessert', acai_shop: 'dessert', frozen_yogurt_shop: 'dessert',

  // Stay.
  hotel: 'hotel', motel: 'hotel', hostel: 'hotel', inn: 'hotel', lodging: 'hotel',
  bed_and_breakfast: 'hotel', guest_house: 'hotel', extended_stay_hotel: 'hotel',
  resort_hotel: 'resort', destination_resort: 'resort', spa_resort: 'resort',

  // Outdoors.
  hiking_area: 'hiking_trail', hiking_trail: 'hiking_trail', trail: 'hiking_trail',
  trailhead: 'hiking_trail', trail_head: 'hiking_trail',
  park: 'park', city_park: 'park', state_park: 'park', national_park: 'park',
  regional_park: 'park', dog_park: 'park', nature_preserve: 'park', wildlife_refuge: 'park',
  beach: 'beach', coastal_recreation_area: 'beach',
  waterfall: 'waterfall', waterfalls: 'waterfall',
  lake: 'lake',
  marina: 'marina', boat_ramp: 'marina', harbor: 'marina', harbour: 'marina',
  island: 'island',
  scenic_spot: 'scenic_spot', scenic_viewpoint: 'scenic_spot', viewpoint: 'scenic_spot',
  observation_deck: 'scenic_spot', observation_area: 'scenic_spot', vista_point: 'scenic_spot',
  mountain_peak: 'scenic_spot', woods: 'scenic_spot', river: 'scenic_spot',

  // Things to do.
  tourist_attraction: 'attraction', cultural_landmark: 'attraction', historical_landmark: 'attraction',
  historical_place: 'attraction', monument: 'attraction', castle: 'attraction', fountain: 'attraction',
  botanical_garden: 'attraction', garden: 'attraction', aquarium: 'attraction', zoo: 'attraction',
  campground: 'attraction', rv_park: 'attraction',
  museum: 'museum', art_museum: 'museum', history_museum: 'museum', art_gallery: 'museum',
  shopping_mall: 'shopping', market: 'shopping', farmers_market: 'shopping', flea_market: 'shopping',
  store: 'shopping', supermarket: 'shopping', grocery_store: 'shopping',
  movie_theater: 'entertainment', theater: 'entertainment', performing_arts_theater: 'entertainment',
  amusement_park: 'entertainment', amusement_center: 'entertainment', bowling_alley: 'entertainment',
  event_venue: 'entertainment', concert_hall: 'entertainment', comedy_club: 'entertainment',
  convention_center: 'entertainment', opera_house: 'entertainment', planetarium: 'entertainment',
  video_arcade: 'entertainment', karaoke: 'nightlife', casino: 'nightlife', night_club: 'nightlife',
  dance_hall: 'nightlife', live_music_venue: 'nightlife',
  arena: 'sports', athletic_field: 'sports', golf_course: 'sports', ice_skating_rink: 'sports',
  playground: 'sports', race_course: 'sports', ski_resort: 'sports', sports_activity_location: 'sports',
  sports_club: 'sports', sports_coaching: 'sports', sports_complex: 'sports', stadium: 'sports',
  swimming_pool: 'sports', tennis_court: 'sports', adventure_sports_center: 'sports',

  // Health.
  gym: 'fitness', fitness_center: 'fitness', climbing_gym: 'fitness', yoga_studio: 'fitness',
  pilates_studio: 'fitness', cycling_studio: 'fitness',
  spa: 'wellness', massage: 'wellness', massage_spa: 'wellness', sauna: 'wellness',
  wellness_center: 'wellness', recovery_center: 'wellness', recovery_studio: 'wellness',

  // Utility / less common.
  airport: 'transportation', international_airport: 'transportation', airstrip: 'transportation',
  bus_station: 'transportation', bus_stop: 'transportation', train_station: 'transportation',
  transit_station: 'transportation', transit_stop: 'transportation', transit_depot: 'transportation',
  subway_station: 'transportation', light_rail_station: 'transportation', tram_stop: 'transportation',
  ferry_terminal: 'transportation', ferry_service: 'transportation', taxi_stand: 'transportation',
  parking: 'transportation', parking_lot: 'transportation', parking_garage: 'transportation',
  university: 'education', college: 'education', school: 'education', preschool: 'education',
  primary_school: 'education', secondary_school: 'education', library: 'education',
  educational_institution: 'education', research_institute: 'education',
  visitor_center: 'service', tourist_information_center: 'service', travel_agency: 'service',
  government_office: 'service', post_office: 'service', bank: 'service', pharmacy: 'service',
  hospital: 'service', medical_center: 'service', medical_clinic: 'service', dental_clinic: 'service',
  dentist: 'service', doctor: 'service', veterinarian: 'service', veterinary_care: 'service',
  church: 'service', buddhist_temple: 'service', hindu_temple: 'service', mosque: 'service',
  shinto_shrine: 'service', synagogue: 'service', cemetery: 'service', service: 'service',
};

function normalizedProviderType(value: string | null | undefined): string | null {
  const normalized = value?.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return normalized || null;
}

export function mapGoogleType(type: string | null | undefined): NearrCategory | null {
  const normalized = normalizedProviderType(type);
  if (!normalized || GENERIC_PROVIDER_TYPES.has(normalized)) return normalized === 'tourist_attraction' ? 'attraction' : null;
  const direct = GOOGLE_PRIMARY_TYPE_CATEGORY_MAP[normalized];
  if (direct) return direct;
  if (normalized.endsWith('_restaurant') || normalized === 'food') return 'restaurant';
  if (normalized.endsWith('_museum')) return 'museum';
  if (normalized.endsWith('_airport') || normalized.endsWith('_station')) return 'transportation';
  if (normalized.endsWith('_school')) return 'education';
  if (normalized.endsWith('_store')) return 'shopping';
  if (normalized.endsWith('_service') || normalized.endsWith('_clinic')) return 'service';
  return null;
}

const CATEGORY_SPECIFICITY: Readonly<Record<NearrCategory, number>> = {
  brewery: 100, winery: 100, dessert: 98, cafe: 96, bakery: 96, bar: 95, restaurant: 80,
  resort: 100, hotel: 85,
  waterfall: 100, marina: 100, island: 100, beach: 98, lake: 98, hiking_trail: 96,
  park: 94, scenic_spot: 90,
  museum: 98, nightlife: 96, sports: 94, entertainment: 90, shopping: 90, attraction: 50,
  fitness: 96, wellness: 96, transportation: 90, education: 90, service: 70, other: 0,
};

function bestSupportingType(types: readonly string[] | null | undefined): {
  category: NearrCategory;
  type: string;
} | null {
  let best: { category: NearrCategory; type: string; score: number } | null = null;
  for (const rawType of types ?? []) {
    const type = normalizedProviderType(rawType);
    if (!type || DEFERRED_PROVIDER_TYPES.has(type)) continue;
    const category = mapGoogleType(type);
    if (!category) continue;
    const score = CATEGORY_SPECIFICITY[category];
    if (!best || score > best.score) best = { category, type, score };
  }
  return best ? { category: best.category, type: best.type } : null;
}

function normalizedName(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const BUSINESS_NAME_GUARD = /\b(dental|dentist|dentistry|cafe|coffee|restaurant|grill|kitchen|hotel|motel|resort|apartments?|church|market|store|shop|salon|clinic|medical|realty|brewery|brewing|winery|bar|school)\b/;
const NATURAL_CONTEXT_TYPES = new Set([
  'establishment', 'point_of_interest', 'natural_feature', 'tourist_attraction',
  'park', 'city_park', 'state_park', 'national_park', 'regional_park', 'nature_preserve',
  'hiking_area', 'hiking_trail', 'trail', 'trailhead', 'trail_head', 'beach',
  'waterfall', 'lake', 'marina', 'island', 'scenic_spot', 'mountain_peak', 'woods', 'river',
]);

function hasNaturalContext(types: readonly (string | null | undefined)[] | null | undefined): boolean {
  const normalized = (types ?? []).map(normalizedProviderType).filter((type): type is string => !!type);
  return normalized.length === 0 || normalized.some((type) => NATURAL_CONTEXT_TYPES.has(type));
}

function deterministicNameCategory(input: CategoryResolutionInput): {
  category: NearrCategory;
  evidenceTag: string;
  confidence: number;
} | null {
  const name = normalizedName(input.placeName);
  if (!name) return null;
  const types = [input.googlePrimaryType, ...(input.googleTypes ?? [])];

  if (/\b(brewery|brewpub)\b/.test(name) || /\bbrewing(?: company| co)?$/.test(name)) {
    return { category: 'brewery', evidenceTag: 'name:brewery_identity', confidence: 0.94 };
  }
  if (/\b(winery|vineyard|wine tasting room)\b/.test(name)) {
    return { category: 'winery', evidenceTag: 'name:winery_identity', confidence: 0.94 };
  }
  if (/\b(ice cream|gelato|dessert|chocolatier|candy)\b/.test(name)) {
    return { category: 'dessert', evidenceTag: 'name:dessert_identity', confidence: 0.88 };
  }
  if (/\b(restaurant|pizzeria|taqueria|eatery)$/.test(name)) {
    return { category: 'restaurant', evidenceTag: 'name:restaurant_identity', confidence: 0.88 };
  }
  if (/\bresort\b/.test(name) && types.some((type) => ['lodging', 'hotel', 'resort_hotel'].includes(normalizedProviderType(type) ?? ''))) {
    return { category: 'resort', evidenceTag: 'name_and_type:resort_identity', confidence: 0.92 };
  }

  if (!hasNaturalContext(types) || BUSINESS_NAME_GUARD.test(name)) return null;
  if (/\b(waterfall|waterfalls)\b/.test(name) || /\bfalls$/.test(name)) {
    return { category: 'waterfall', evidenceTag: 'name_and_context:waterfall_identity', confidence: 0.94 };
  }
  if (/\bmarina\b/.test(name) || /\b(harbor|harbour)$/.test(name)) {
    return { category: 'marina', evidenceTag: 'name_and_context:marina_identity', confidence: 0.93 };
  }
  if (/\b(beach|cove)$/.test(name)) {
    return { category: 'beach', evidenceTag: 'name_and_context:coastal_identity', confidence: 0.91 };
  }
  if (/\bisland$/.test(name)) {
    return { category: 'island', evidenceTag: 'name_and_context:island_identity', confidence: 0.93 };
  }
  if (/\b(regional|national|state|city)? ?(park|preserve|reserve)$/.test(name)) {
    return { category: 'park', evidenceTag: 'name_and_context:park_identity', confidence: 0.92 };
  }
  if (/\b(trail|trailhead|trail head)$/.test(name) || /\bpeak$/.test(name)) {
    return { category: 'hiking_trail', evidenceTag: 'name_and_context:hiking_identity', confidence: 0.90 };
  }
  if (/\blake$/.test(name) || /^lake\b/.test(name)) {
    return { category: 'lake', evidenceTag: 'name_and_context:lake_identity', confidence: 0.90 };
  }
  if (/\b(gorge|scenic overlook|overlook|viewpoint|vista point|punch bowls?|river|creek|caves?|hot springs)$/.test(name)) {
    return { category: 'scenic_spot', evidenceTag: 'name_and_context:scenic_identity', confidence: 0.88 };
  }
  if (/\bscenic\b/.test(name)) {
    return { category: 'scenic_spot', evidenceTag: 'name_and_context:explicit_scenic_identity', confidence: 0.88 };
  }
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
  /** Kept only to honor genuine legacy overrides. New product flows never set it. */
  userOverride?: NearrCategory | null;
  placeName?: string | null;
  googlePrimaryType?: string | null;
  googleTypes?: readonly string[] | null;
  /** Existing structured media evidence; no separate category LLM call. */
  ai?: {
    category: NearrCategory;
    confidence: number;
    modelVersion: string;
    evidenceTags?: readonly string[];
  } | null;
};

function resolved(
  category: NearrCategory,
  source: CategorySource,
  confidence: number,
  evidenceTags: string[],
  modelVersion = CATEGORY_MODEL_VERSION,
  userOverridden = false,
): CategoryResolution {
  return { category, source, confidence, modelVersion, userOverridden, evidenceTags };
}

export function resolvePlaceCategory(input: CategoryResolutionInput): CategoryResolution {
  if (input.userOverride && isNearrCategory(input.userOverride)) {
    return resolved(input.userOverride, 'user', 1, ['legacy_user_override'], CATEGORY_MODEL_VERSION, true);
  }

  const primaryType = normalizedProviderType(input.googlePrimaryType);
  const primary = mapGoogleType(primaryType);
  const primaryIsCoarse = !!primaryType && DEFERRED_PROVIDER_TYPES.has(primaryType);
  if (primary && !primaryIsCoarse) {
    return resolved(primary, 'google_primary_type', 1, [`primary_type:${primaryType}`]);
  }

  const supporting = bestSupportingType(input.googleTypes);
  if (supporting) {
    return resolved(supporting.category, 'google_types', 0.96, [`google_type:${supporting.type}`]);
  }

  const deterministic = deterministicNameCategory(input);
  if (deterministic) {
    return resolved(deterministic.category, 'deterministic', deterministic.confidence, [deterministic.evidenceTag]);
  }

  if (input.ai && isNearrCategory(input.ai.category) && input.ai.category !== 'other') {
    return resolved(
      input.ai.category,
      'ai',
      Math.max(0, Math.min(1, input.ai.confidence)),
      [...(input.ai.evidenceTags ?? ['structured_media_category'])].slice(0, 8),
      input.ai.modelVersion,
    );
  }

  // Broad mapped types are intentionally deferred so name/type identity or
  // structured media evidence can refine them first.
  if (primary) {
    return resolved(primary, 'google_primary_type', 0.75, [`coarse_primary_type:${primaryType}`]);
  }
  for (const type of (input.googleTypes ?? []).map(normalizedProviderType)) {
    if (!type || !DEFERRED_PROVIDER_TYPES.has(type)) continue;
    const category = mapGoogleType(type);
    if (category) return resolved(category, 'google_types', 0.7, [`coarse_google_type:${type}`]);
  }
  return resolved('other', 'fallback', 0, ['no_supported_category_signal']);
}

export const CATEGORY_LABELS: Readonly<Record<NearrCategory, string>> = {
  restaurant: 'Restaurant', cafe: 'Cafe', bakery: 'Bakery', bar: 'Bar', brewery: 'Brewery',
  winery: 'Winery', dessert: 'Dessert', hotel: 'Hotel', resort: 'Resort', hiking_trail: 'Hiking',
  park: 'Park', beach: 'Beach', waterfall: 'Waterfall', lake: 'Lake', marina: 'Marina', island: 'Island',
  scenic_spot: 'Scenic Spot', attraction: 'Attraction', museum: 'Museum', entertainment: 'Entertainment',
  shopping: 'Shopping', nightlife: 'Nightlife', sports: 'Sports', fitness: 'Fitness', wellness: 'Wellness',
  transportation: 'Transportation', education: 'Education', service: 'Service', other: 'Other',
};

export const CATEGORY_FILTER_GROUPS = {
  all: NEARR_CATEGORIES,
  food: ['restaurant', 'bakery', 'bar', 'brewery', 'winery', 'dessert'] as const,
  cafes: ['cafe'] as const,
  hotels: ['hotel', 'resort'] as const,
  outdoors: ['hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island', 'scenic_spot'] as const,
  attractions: ['attraction', 'museum', 'entertainment', 'nightlife', 'sports', 'education'] as const,
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
  place?: {
    name?: string | null;
    category?: string | null;
    google_primary_type?: string | null;
    google_types?: string[] | null;
  } | null;
}): NearrCategory {
  if (isNearrCategory(saved.category)) return saved.category;
  if (isNearrCategory(saved.place?.category)) return saved.place.category;
  return resolvePlaceCategory({
    placeName: saved.place?.name,
    googlePrimaryType: saved.place?.google_primary_type,
    googleTypes: saved.place?.google_types,
  }).category;
}
