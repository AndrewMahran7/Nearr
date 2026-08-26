/** Deterministic admission classifier for machine-proposed place identities.
 *
 * This module does not decide what a scene depicts. It decides whether a short
 * phrase contains enough lexical identity to be used as a Google Places name
 * query. Category and descriptive phrases remain useful evidence, but they are
 * discovery-only and must never enter recognition as a POI name.
 */

export type PlacePhraseClass =
  | 'SPECIFIC_IDENTITY'
  | 'GENERIC_PLACE_TYPE'
  | 'GEOGRAPHIC_CLUE'
  | 'DESCRIPTIVE_CLUE'
  | 'UNKNOWN';

export type PlaceSceneCategory =
  | 'food_drink'
  | 'natural'
  | 'stay'
  | 'culture'
  | 'recreation'
  | 'transport'
  | 'retail_service';

export type PlacePhraseClassification = {
  classification: PlacePhraseClass;
  normalized: string;
  placeType: string | null;
  sceneCategory: PlaceSceneCategory | null;
  nearrCategory: string | null;
  identityTokens: string[];
  reasonCode: string;
};

type TaxonomyEntry = {
  placeType: string;
  sceneCategory: PlaceSceneCategory;
  nearrCategory: string;
  aliases: string[];
};

const TAXONOMY: TaxonomyEntry[] = [
  { placeType: 'cenote', sceneCategory: 'natural', nearrCategory: 'scenic_spot', aliases: ['cenote', 'cenotes'] },
  { placeType: 'waterfall', sceneCategory: 'natural', nearrCategory: 'waterfall', aliases: ['waterfall', 'waterfalls', 'falls', 'cascade', 'cascades'] },
  { placeType: 'cave', sceneCategory: 'natural', nearrCategory: 'scenic_spot', aliases: ['cave', 'caves', 'cavern', 'caverns', 'grotto', 'grottoes'] },
  { placeType: 'beach', sceneCategory: 'natural', nearrCategory: 'beach', aliases: ['beach', 'beaches', 'cove', 'shore'] },
  { placeType: 'lake', sceneCategory: 'natural', nearrCategory: 'lake', aliases: ['lake', 'lakes', 'lagoon', 'reservoir'] },
  { placeType: 'river', sceneCategory: 'natural', nearrCategory: 'scenic_spot', aliases: ['river', 'rivers', 'creek', 'stream'] },
  { placeType: 'swimming_hole', sceneCategory: 'natural', nearrCategory: 'scenic_spot', aliases: ['swimming hole', 'swim hole'] },
  { placeType: 'cliff', sceneCategory: 'natural', nearrCategory: 'scenic_spot', aliases: ['cliff', 'cliffs', 'cliff jump', 'cliff jumping spot', 'bluff', 'headland'] },
  { placeType: 'viewpoint', sceneCategory: 'natural', nearrCategory: 'scenic_spot', aliases: ['viewpoint', 'view point', 'overlook', 'lookout', 'scenic viewpoint', 'scenic overlook'] },
  { placeType: 'island', sceneCategory: 'natural', nearrCategory: 'island', aliases: ['island', 'islands', 'islet'] },
  { placeType: 'trail', sceneCategory: 'recreation', nearrCategory: 'hiking_trail', aliases: ['trail', 'trails', 'hiking trail', 'hike', 'trailhead'] },
  { placeType: 'park', sceneCategory: 'recreation', nearrCategory: 'park', aliases: ['park', 'parks', 'playground', 'national park', 'state park'] },
  { placeType: 'marina', sceneCategory: 'recreation', nearrCategory: 'marina', aliases: ['marina', 'harbor', 'harbour', 'pier', 'dock'] },
  { placeType: 'restaurant', sceneCategory: 'food_drink', nearrCategory: 'restaurant', aliases: ['restaurant', 'restaurants', 'eatery', 'diner', 'bistro', 'food spot', 'pizza place', 'taco place'] },
  { placeType: 'cafe', sceneCategory: 'food_drink', nearrCategory: 'cafe', aliases: ['cafe', 'coffee shop', 'coffeehouse'] },
  { placeType: 'bar', sceneCategory: 'food_drink', nearrCategory: 'bar', aliases: ['bar', 'bars', 'pub', 'cocktail bar'] },
  { placeType: 'bakery', sceneCategory: 'food_drink', nearrCategory: 'bakery', aliases: ['bakery', 'bakeshop', 'patisserie'] },
  { placeType: 'brewery', sceneCategory: 'food_drink', nearrCategory: 'brewery', aliases: ['brewery', 'taproom'] },
  { placeType: 'winery', sceneCategory: 'food_drink', nearrCategory: 'winery', aliases: ['winery', 'vineyard'] },
  { placeType: 'hotel', sceneCategory: 'stay', nearrCategory: 'hotel', aliases: ['hotel', 'hotels', 'hostel', 'motel', 'inn'] },
  { placeType: 'resort', sceneCategory: 'stay', nearrCategory: 'resort', aliases: ['resort', 'resorts'] },
  { placeType: 'museum', sceneCategory: 'culture', nearrCategory: 'museum', aliases: ['museum', 'museums', 'gallery', 'art gallery'] },
  { placeType: 'landmark', sceneCategory: 'culture', nearrCategory: 'attraction', aliases: ['landmark', 'monument', 'attraction', 'temple', 'shrine', 'castle', 'fort'] },
  { placeType: 'bridge', sceneCategory: 'culture', nearrCategory: 'attraction', aliases: ['bridge', 'bridges'] },
  { placeType: 'station', sceneCategory: 'transport', nearrCategory: 'transportation', aliases: ['station', 'train station', 'bus station', 'airport', 'terminal'] },
  { placeType: 'store', sceneCategory: 'retail_service', nearrCategory: 'shopping', aliases: ['store', 'shop', 'market', 'mall'] },
  { placeType: 'spa', sceneCategory: 'retail_service', nearrCategory: 'wellness', aliases: ['spa', 'salon', 'wellness center'] },
  { placeType: 'gym', sceneCategory: 'recreation', nearrCategory: 'fitness', aliases: ['gym', 'fitness center'] },
];

const ARTICLES = new Set(['a', 'an', 'the', 'this', 'that']);
const DESCRIPTORS = new Set([
  'underground', 'hidden', 'secret', 'natural', 'beautiful', 'scenic', 'rocky',
  'local', 'nearby', 'small', 'big', 'large', 'public', 'private', 'famous',
  'popular', 'best', 'amazing', 'old', 'new', 'historic', 'outdoor', 'indoor',
  'freshwater', 'saltwater', 'blue', 'clear', 'deep', 'shallow', 'remote',
]);
const GEO_WORDS = new Set([
  'mexico', 'croatia', 'usa', 'canada', 'california', 'florida', 'texas',
  'norcal', 'socal', 'cancun', 'tulum', 'yucatan', 'quintana roo', 'san diego',
  'los angeles', 'new york', 'oregon', 'hawaii', 'bali', 'italy', 'france',
]);

function fold(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function aliasMatch(normalized: string): { entry: TaxonomyEntry; alias: string } | null {
  let best: { entry: TaxonomyEntry; alias: string } | null = null;
  for (const entry of TAXONOMY) {
    for (const alias of entry.aliases) {
      const normalizedAlias = fold(alias);
      if (` ${normalized} `.includes(` ${normalizedAlias} `) && (!best || normalizedAlias.length > best.alias.length)) {
        best = { entry, alias: normalizedAlias };
      }
    }
  }
  return best;
}

function stripKnownGeography(normalized: string, hints: readonly string[]): string {
  let result = ` ${normalized} `;
  // Strip only independently supplied context. A phrase such as "Los Angeles
  // Cafe" may be the actual business name; a separate city=Los Angeles field
  // is what makes "cafe" + that geography category-only.
  const values = hints.map(fold).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const value of values) result = result.replace(new RegExp(`\\s${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s`, 'g'), ' ');
  return result.replace(/\s+/g, ' ').trim();
}

function result(
  classification: PlacePhraseClass,
  normalized: string,
  match: ReturnType<typeof aliasMatch>,
  identityTokens: string[],
  reasonCode: string,
): PlacePhraseClassification {
  return {
    classification,
    normalized,
    placeType: match?.entry.placeType ?? null,
    sceneCategory: match?.entry.sceneCategory ?? null,
    nearrCategory: match?.entry.nearrCategory ?? null,
    identityTokens,
    reasonCode,
  };
}

export function classifyPlacePhrase(
  value: string | null | undefined,
  options: { geographicHints?: readonly string[] } = {},
): PlacePhraseClassification {
  const raw = typeof value === 'string' ? value.trim() : '';
  const normalized = fold(raw);
  if (!normalized) return result('UNKNOWN', normalized, null, [], 'empty_phrase');

  // A known real-world edge: article + type can itself be a proper brand.
  // Keep this exception intentionally exact and case-sensitive.
  if (raw === 'The Cave') {
    const match = aliasMatch(normalized);
    return result('SPECIFIC_IDENTITY', normalized, match, ['the', 'cave'], 'explicit_brand_exception');
  }

  const withoutGeo = stripKnownGeography(normalized, options.geographicHints ?? []);
  const geoOnly = !withoutGeo && normalized.length > 0;
  if (geoOnly || GEO_WORDS.has(normalized) || (options.geographicHints ?? []).some((hint) => fold(hint) === normalized)) {
    return result('GEOGRAPHIC_CLUE', normalized, null, [], 'geographic_only');
  }

  const match = aliasMatch(withoutGeo || normalized);
  if (!match) {
    const tokens = normalized.split(' ').filter(Boolean);
    const nameShaped = /[A-Z]/.test(raw) || /['&.-]/.test(raw) || tokens.length >= 2;
    return result(nameShaped ? 'SPECIFIC_IDENTITY' : 'UNKNOWN', normalized, null, tokens, nameShaped ? 'name_shaped' : 'unclassified');
  }

  const phrase = withoutGeo || normalized;
  const aliasTokens = new Set(match.alias.split(' '));
  const residual = phrase.split(' ').filter((token) => !ARTICLES.has(token) && !aliasTokens.has(token));
  const descriptorOnly = residual.length > 0 && residual.every((token) =>
    DESCRIPTORS.has(token) || /^\d+$/.test(token) || /^(foot|feet|ft|meter|metre|meters|metres)$/.test(token));
  const hasMeasurement = /\b\d+\s*(?:foot|feet|ft|meter|metre|meters|metres)\b/.test(phrase);

  if (residual.length === 0) {
    return result('GENERIC_PLACE_TYPE', normalized, match, [], 'category_only_candidate');
  }
  // "Hidden Falls" is a common proper-name form. Preserve it when the model
  // supplied that exact title-shaped identity, while lowercase scene prose
  // ("hidden falls") remains descriptive.
  if (descriptorOnly && residual.length === 1 && residual[0] === 'hidden' && /^Hidden\s/.test(raw)) {
    return result('SPECIFIC_IDENTITY', normalized, match, residual, 'title_shaped_hidden_name');
  }
  if (descriptorOnly || hasMeasurement) {
    return result('DESCRIPTIVE_CLUE', normalized, match, residual, 'descriptive_category_only');
  }

  // Two category terms can form a proper name when the latter is a business
  // suffix ("Waterfall Cafe", "Cave Restaurant").
  const secondMatch = aliasMatch(residual.join(' '));
  if (secondMatch && secondMatch.entry.sceneCategory === 'food_drink') {
    return result('SPECIFIC_IDENTITY', normalized, match, residual, 'category_term_brand_name');
  }
  return result('SPECIFIC_IDENTITY', normalized, match, residual, 'distinctive_identity_token');
}

export function isMachineGeneratedIdentityPhrase(
  value: string | null | undefined,
  options: { geographicHints?: readonly string[] } = {},
): boolean {
  return classifyPlacePhrase(value, options).classification === 'SPECIFIC_IDENTITY';
}

export function isCategoryOrDescriptivePlacePhrase(value: string | null | undefined): boolean {
  const kind = classifyPlacePhrase(value).classification;
  return kind === 'GENERIC_PLACE_TYPE' || kind === 'DESCRIPTIVE_CLUE';
}

/** Manual search is an explicit discovery action and is intentionally outside
 * the recognition guard. Machine hypotheses must carry specific identity. */
export function placeQueryIsAdmitted(
  value: string | null | undefined,
  origin: 'machine_recognition' | 'manual_search',
  options: { geographicHints?: readonly string[] } = {},
): boolean {
  if (origin === 'manual_search') return typeof value === 'string' && value.trim().length > 0;
  return isMachineGeneratedIdentityPhrase(value, options);
}

export const PLACE_TYPE_TAXONOMY = TAXONOMY.map(({ aliases, ...entry }) => ({ ...entry, aliases: [...aliases] }));
