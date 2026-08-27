/**
 * Shared, dependency-free semantic boundary for machine-produced place clues.
 *
 * A string is not a Places query merely because a model put it in a `name`
 * field.  This contract is consumed by metadata extraction, media mentions and
 * future structured Vayrin hypotheses so all resolver paths make the same
 * entity decision before provider I/O.
 */

export const VAYRIN_ENTITY_TYPES = [
  'PERSON',
  'ACTIVITY',
  'EVENT',
  'GENERIC_PLACE_TYPE',
  'BUSINESS_OR_VENUE',
  'NAMED_NATURAL_FEATURE',
  'LANDMARK',
  'CITY',
  'REGION',
  'COUNTRY',
  'GEOGRAPHIC_ALIAS',
  'PLACE_ALIAS',
  'UNKNOWN',
] as const;

export type VayrinEntityType = (typeof VAYRIN_ENTITY_TYPES)[number];

export type EntitySource =
  | 'caption'
  | 'hashtag'
  | 'creator_handle'
  | 'creator_name'
  | 'visible_text'
  | 'speech'
  | 'frame'
  | 'gemini'
  | 'vayrin_hypothesis'
  | 'suggested_query'
  | 'search_lead'
  | 'multi_place'
  | 'alias'
  | 'unknown';

export type EntitySceneContext = {
  environmentType?: string | null;
  setting?: string | null;
  activity?: string | null;
  visualAnchors?: readonly string[] | null;
};

export type EntityClassificationInput = {
  text: string;
  source?: EntitySource;
  contextText?: string | null;
  category?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
  scene?: EntitySceneContext | null;
  /** Explicit type supplied by a structured hypothesis. Deterministic strong
   * non-place evidence can still override it; model labels are not authority. */
  declaredType?: VayrinEntityType | null;
};

export type EntityClassification = {
  entityType: VayrinEntityType;
  confidence: 'high' | 'medium' | 'low';
  reasons: string[];
  /** Preferred provider search identity for a known contextual alias. */
  canonicalSearchName: string | null;
  /** Names that may establish identity when the display text is an alias. */
  matchAliases: string[];
  placesEligible: boolean;
  resolver: 'none' | 'business' | 'natural_feature' | 'landmark' | 'administrative_geography' | 'unknown_place';
};

const ACTIVITY_TERMS = new Set([
  'dods', 'cliff jump', 'cliff jumping', 'base jump', 'base jumping',
  'hike', 'hiking', 'swim', 'swimming', 'dive', 'diving', 'surf', 'surfing',
  'ski', 'skiing', 'snowboard', 'snowboarding', 'kayak', 'kayaking',
  'rafting', 'snorkel', 'snorkeling', 'climb', 'climbing', 'running',
]);

const EVENT_RE = /\b(world\s+record|competition|championship|festival|race|tournament|meet|games)\b/i;
const PERSON_CONTEXT_RE = /\b(athlete|climber|influencer|creator|record\s*holder|jumped|dives?|surfs?|skis?|by|with|featuring|feat\.?|profile|born)\b/i;
const BUSINESS_CONTEXT_RE = /\b(restaurant|cafe|café|hotel|resort|store|shop|bar|bakery|brewery|breakfast|menu|reservation|check\s*in|lobby|dining|retail|business|venue)\b/i;
const NATURAL_CONTEXT_RE = /\b(natural|coast|coastal|ocean|sea|cliff|volcanic|waterfall|falls|lake|river|beach|island|gorge|quarry|cave|cenote|trail|swimming\s+hole|reserve|national\s+park|scenic|mountain|canyon|pool|inlet)\b/i;
const LANDMARK_CONTEXT_RE = /\b(landmark|monument|bridge|castle|fort|temple|cathedral|historic|historical|memorial)\b/i;

const BUSINESS_NAME_RE = /\b(cafe|café|restaurant|kitchen|grill|bar|bakery|bistro|hotel|resort|inn|hostel|steak\s*house|steakhouse|bread\s*(?:&|and)\s*breakfast|market|store|shop|brewery|winery|pub|diner|taqueria|pizzeria|museum)\b/i;
const LANDMARK_NAME_RE = /\b(bridge|monument|memorial|castle|fort|temple|cathedral|tower|palace)\b/i;
const NATURAL_NAME_RE = /\b(falls?|waterfalls?|lakes?|ponds?|rivers?|beaches?|islands?|gorges?|quarr(?:y|ies)|caves?|cenotes?|trails?|cliffs?|swimming\s+holes?|reserves?|national\s+parks?|scenic\s+areas?|canyons?|mountains?|peaks?|springs?|pools?|narrows|wave)\b/i;
const GENERIC_NATURAL_RE = /^(?:the\s+)?(?:waterfalls?|lakes?|ponds?|rivers?|beaches?|islands?|gorges?|quarr(?:y|ies)|caves?|cenotes?|trails?|cliffs?|swimming\s+holes?|reserves?|national\s+parks?|scenic\s+areas?|parks?|lookouts?|viewpoints?)$/i;
const ADMIN_CITY_RE = /\b(city|town|village|municipality|borough)\s*$/i;
const ADMIN_REGION_RE = /\b(county|province|state|territory|region|district|prefecture)\s*$/i;

type AliasRecord = {
  aliases: readonly string[];
  canonical: string;
  alternatives: readonly string[];
  geography: readonly string[];
  natural: boolean;
};

/** Small curated equivalence vocabulary, not a one-off answer map. Entries are
 * aliases whose meaning cannot be recovered from English morphology alone.
 * Generic alias handling below still covers "The Narrows", "Blue Pool", etc. */
const GEOGRAPHIC_ALIASES: readonly AliasRecord[] = [
  {
    aliases: ['mokes', 'the mokes', 'mokulua'],
    canonical: 'Mokulua Islands',
    alternatives: ['Moku Nui', 'Moku Iki'],
    geography: ['hawaii', 'kailua', 'oahu'],
    natural: true,
  },
];

const COUNTRY_NAMES = new Set([
  'new zealand', 'norway', 'united states', 'usa', 'canada', 'mexico', 'spain',
  'portugal', 'nicaragua', 'costa rica', 'australia', 'iceland', 'france',
  'italy', 'japan', 'indonesia', 'thailand', 'brazil', 'united kingdom', 'uk',
]);

const NATURAL_CATEGORIES = new Set([
  'hiking_trail', 'park', 'beach', 'waterfall', 'lake', 'marina', 'island',
  'scenic_spot', 'nature_preserve', 'national_park', 'cave', 'river', 'gorge',
]);
const BUSINESS_CATEGORIES = new Set([
  'restaurant', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'dessert', 'hotel',
  'resort', 'shopping', 'entertainment', 'nightlife', 'fitness', 'wellness',
  'transportation', 'education', 'service',
]);

export function foldEntityText(value: string): string {
  return (value ?? '')
    .toLowerCase()
    .replace(/[øØ]/g, 'o')
    .replace(/[ðÐ]/g, 'd')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9#'&+\- ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function activityMatch(text: string): boolean {
  const folded = foldEntityText(text).replace(/^#/, '');
  if (ACTIVITY_TERMS.has(folded)) return true;
  return [...ACTIVITY_TERMS].some((term) => folded === term || folded.startsWith(`${term} `));
}

function sceneText(input: EntityClassificationInput): string {
  return [
    input.contextText,
    input.category,
    input.city,
    input.region,
    input.country,
    input.scene?.environmentType,
    input.scene?.activity,
    ...(input.scene?.visualAnchors ?? []),
  ].filter(Boolean).join(' ');
}

function findAlias(text: string, context: string): AliasRecord | null {
  const folded = foldEntityText(text).replace(/^the\s+/, '');
  const compact = folded.replace(/[^a-z0-9]/g, '');
  for (const record of GEOGRAPHIC_ALIASES) {
    const aliasMatched = record.aliases.some((alias) => {
      const normalizedAlias = foldEntityText(alias).replace(/^the\s+/, '');
      const compactAlias = normalizedAlias.replace(/[^a-z0-9]/g, '');
      return normalizedAlias === folded || compact === compactAlias ||
        record.geography.some((geo) => compact === `${compactAlias}${foldEntityText(geo).replace(/[^a-z0-9]/g, '')}`);
    });
    if (!aliasMatched) continue;
    if (record.geography.length === 0 || record.geography.some((geo) => foldEntityText(context).includes(foldEntityText(geo)))) {
      return record;
    }
  }
  return null;
}

function looksLikePersonName(text: string): boolean {
  const clean = text.trim().replace(/^@/, '');
  if (!/^[\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]+){1,3}$/u.test(clean)) return false;
  if (BUSINESS_NAME_RE.test(clean) || NATURAL_NAME_RE.test(clean) || LANDMARK_NAME_RE.test(clean)) return false;
  return true;
}

function result(
  entityType: VayrinEntityType,
  confidence: EntityClassification['confidence'],
  reasons: string[],
  canonicalSearchName: string | null = null,
  matchAliases: string[] = [],
): EntityClassification {
  const resolver: EntityClassification['resolver'] =
    entityType === 'BUSINESS_OR_VENUE' || entityType === 'PLACE_ALIAS' ? 'business' :
    entityType === 'NAMED_NATURAL_FEATURE' || entityType === 'GEOGRAPHIC_ALIAS' ? 'natural_feature' :
    entityType === 'LANDMARK' ? 'landmark' :
    entityType === 'CITY' || entityType === 'REGION' || entityType === 'COUNTRY' ? 'administrative_geography' :
    entityType === 'UNKNOWN' ? 'unknown_place' : 'none';
  return {
    entityType,
    confidence,
    reasons,
    canonicalSearchName,
    matchAliases,
    placesEligible: resolver !== 'none',
    resolver,
  };
}

export function classifyEntity(input: EntityClassificationInput): EntityClassification {
  const raw = (input.text ?? '').trim();
  const text = foldEntityText(raw).replace(/^#/, '');
  const context = sceneText(input);
  const foldedContext = foldEntityText(context);
  if (!text) return result('UNKNOWN', 'low', ['empty_entity']);

  if (input.source === 'creator_handle' || input.source === 'creator_name') {
    return result('PERSON', 'high', ['creator_identity_source']);
  }
  if (activityMatch(text)) return result('ACTIVITY', 'high', ['activity_lexicon']);
  if (EVENT_RE.test(text)) return result('EVENT', 'high', ['event_phrase']);

  const alias = findAlias(text, context);
  if (alias && (alias.natural || NATURAL_CONTEXT_RE.test(context))) {
    return result(
      'GEOGRAPHIC_ALIAS',
      'high',
      ['known_geographic_alias', 'source_geography_match'],
      alias.canonical,
      [alias.canonical, ...alias.alternatives],
    );
  }

  const naturalContext = NATURAL_CONTEXT_RE.test(context) || NATURAL_CATEGORIES.has(foldEntityText(input.category ?? '').replace(/ /g, '_'));
  const businessContext = BUSINESS_CONTEXT_RE.test(context) || BUSINESS_CATEGORIES.has(foldEntityText(input.category ?? '').replace(/ /g, '_'));
  const landmarkContext = LANDMARK_CONTEXT_RE.test(context) || input.category === 'attraction';

  // Strong contextual person grammar wins before fuzzy business-name search.
  // It also catches a possessivized/munged single token such as "Kenstorne's"
  // when the caption says athlete/world record/jumped.
  if (!businessContext && !naturalContext && (PERSON_CONTEXT_RE.test(context) || /\bworld\s+record\b/i.test(context))) {
    if (looksLikePersonName(raw) || /^[\p{L}][\p{L}'-]{3,}$/u.test(raw)) {
      return result('PERSON', 'high', ['person_name_grammar', 'person_context']);
    }
  }

  if (COUNTRY_NAMES.has(text) || (input.country && foldEntityText(input.country) === text)) return result('COUNTRY', 'high', ['country_lexicon']);
  if (input.city && foldEntityText(input.city) === text) return result('CITY', 'high', ['matches_structured_city']);
  if (input.region && foldEntityText(input.region) === text) return result('REGION', 'high', ['matches_structured_region']);
  if (ADMIN_CITY_RE.test(raw)) return result('CITY', 'high', ['administrative_city_suffix']);
  if (ADMIN_REGION_RE.test(raw)) return result('REGION', 'high', ['administrative_region_suffix']);

  if (GENERIC_NATURAL_RE.test(raw) && !businessContext) return result('GENERIC_PLACE_TYPE', 'high', ['generic_natural_category']);
  if (NATURAL_NAME_RE.test(raw) && !BUSINESS_NAME_RE.test(raw) && !businessContext) {
    return result('NAMED_NATURAL_FEATURE', 'high', ['named_natural_feature_grammar']);
  }
  if (naturalContext && /^(?:the\s+)?[\p{L}][\p{L}'-]+(?:\s+[\p{L}][\p{L}'-]+){0,3}$/u.test(raw)) {
    return result('GEOGRAPHIC_ALIAS', 'medium', ['natural_scene_alias_shape'], raw, [raw]);
  }
  if (LANDMARK_NAME_RE.test(raw) || landmarkContext) {
    return result('LANDMARK', LANDMARK_NAME_RE.test(raw) ? 'high' : 'medium', ['landmark_semantics']);
  }

  if (BUSINESS_NAME_RE.test(raw) || businessContext || /^(?:in[\s-]?n[\s-]?out|mcdonald'?s|wendy'?s)$/i.test(raw)) {
    return result('BUSINESS_OR_VENUE', 'high', ['business_name_or_context']);
  }

  // A model declaration is useful only after deterministic non-place and
  // high-signal contextual checks have had a chance to veto it.
  if (input.declaredType && input.declaredType !== 'UNKNOWN') {
    return result(input.declaredType, 'medium', ['structured_declared_entity_type']);
  }

  // Do not guess that every title-cased human-looking string is a person: real
  // businesses named after people are common. Without contextual grammar the
  // safe classification is UNKNOWN, which may reach review but not receive
  // person-specific suppression.
  return result('UNKNOWN', 'low', ['no_durable_semantic_signal']);
}

export type TypedHashtag = {
  raw: string;
  value: string;
  classification: EntityClassification;
};

const HASHTAG_GEO_SUFFIXES = ['newzealand', 'hawaii', 'norway', 'kailua', 'rotorua'];
const COMPACT_GEO_LABELS: Readonly<Record<string, string>> = {
  newzealand: 'new zealand',
};

function expandHashtagValue(raw: string): string {
  const compact = foldEntityText(raw).replace(/^#/, '').replace(/[^a-z0-9]/g, '');
  if (COMPACT_GEO_LABELS[compact]) return COMPACT_GEO_LABELS[compact]!;
  if (/^[a-z]+falls$/.test(compact)) return `${compact.slice(0, -5)} falls`;
  for (const suffix of HASHTAG_GEO_SUFFIXES) {
    if (compact.length > suffix.length && compact.endsWith(suffix)) {
      return `${compact.slice(0, -suffix.length)} ${suffix}`.trim();
    }
  }
  return compact;
}

/** Type every hashtag independently; callers decide whether it is an identity,
 * geography or activity clue. This function never concatenates hashtags into
 * a synthetic venue name. */
export function classifyHashtags(
  caption: string,
  context: Omit<EntityClassificationInput, 'text' | 'source'> = {},
): TypedHashtag[] {
  const matches = (caption ?? '').match(/#[\p{L}\p{N}_-]+/gu) ?? [];
  return matches.map((raw) => {
    const value = expandHashtagValue(raw);
    return {
      raw,
      value,
      classification: classifyEntity({ ...context, text: value, source: 'hashtag', contextText: `${context.contextText ?? ''} ${caption}` }),
    };
  });
}
