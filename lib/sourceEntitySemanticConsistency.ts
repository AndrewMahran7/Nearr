/**
 * Deterministic source-identity and semantic-consistency policy.
 *
 * This module deliberately knows nothing about a particular incident or
 * provider id. It answers two generic questions:
 *   1. Does first-party source metadata explicitly identify the business or
 *      place that this content is promoting?
 *   2. Is a provider candidate semantically compatible with that identity?
 */

export const SOURCE_ENTITY_POLICY_VERSION =
  'source-entity-semantic-consistency-2026-09-08.v1';

export type SourceEntityStrength = 'strong' | 'weak';
export type ContentRelation =
  | 'SOURCE_BUSINESS_IS_TARGET'
  | 'SOURCE_BUSINESS_PROMOTES_OTHER_PLACE'
  | 'VIDEO_CONTAINS_MULTIPLE_TARGETS'
  | 'ENTITY_MENTION_ONLY'
  | 'UNCERTAIN_RELATION';

export type SourceEntityCategory =
  | 'food'
  | 'lodging'
  | 'outdoors'
  | 'wellness'
  | 'shopping'
  | 'entertainment'
  | 'transportation'
  | 'education'
  | 'service'
  | 'other';

export type ExplicitSourceEntity = {
  name: string;
  entityType: 'business' | 'place';
  category: SourceEntityCategory | null;
  sources: Array<
    | 'platform_title'
    | 'creator_name'
    | 'creator_handle'
    | 'official_domain'
    | 'caption_repetition'
    | 'first_party_language'
  >;
  strength: SourceEntityStrength;
  relation: ContentRelation;
  country: string | null;
  locationHint: string | null;
  confidence: number;
};

export type SourceEntityCandidate = {
  name?: unknown;
  formattedAddress?: unknown;
  types?: unknown;
  primaryType?: unknown;
};

export type SourceEntityAssessment = {
  verdict: 'SUPPORTS' | 'CONTRADICTS' | 'UNKNOWN';
  nameAgreement: 'exact' | 'compatible' | 'conflict' | 'unknown';
  categoryCompatibility: 'compatible' | 'conflict' | 'unknown';
  geographyCompatibility: 'compatible' | 'conflict' | 'unknown';
  reasons: string[];
  hardContradiction: boolean;
};

const GENERIC_NAME_TOKENS = new Set([
  'and', 'the', 'official', 'restaurant', 'restaurants', 'cafe', 'coffee',
  'bar', 'bbq', 'barbecue', 'grill', 'kitchen', 'hotel', 'hotels', 'resort',
  'spa', 'wellness', 'center', 'centre', 'clinic', 'shop', 'store', 'company',
  'co', 'inc', 'llc', 'ltd', 'pty', 'at', 'in', 'on', 'of',
]);

const COUNTRY_TLDS: Record<string, string> = {
  au: 'Australia', nz: 'New Zealand', uk: 'United Kingdom', gb: 'United Kingdom',
  ca: 'Canada', jp: 'Japan', sg: 'Singapore', de: 'Germany', fr: 'France',
  it: 'Italy', es: 'Spain', pt: 'Portugal', br: 'Brazil', mx: 'Mexico',
  in: 'India', id: 'Indonesia', th: 'Thailand', vn: 'Vietnam', za: 'South Africa',
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  Australia: ['australia', 'vic', 'victoria', 'nsw', 'queensland', 'qld', 'tasmania', 'wa 6', 'sa 5'],
  'New Zealand': ['new zealand', 'auckland', 'wellington', 'christchurch'],
  'United Kingdom': ['united kingdom', 'england', 'scotland', 'wales', 'northern ireland', ' uk'],
  Canada: ['canada', 'ontario', 'quebec', 'british columbia', 'alberta'],
  Japan: ['japan'], Singapore: ['singapore'], Germany: ['germany'], France: ['france'],
  Italy: ['italy'], Spain: ['spain'], Portugal: ['portugal'], Brazil: ['brazil'],
  Mexico: ['mexico'], India: ['india'], Indonesia: ['indonesia'], Thailand: ['thailand'],
  Vietnam: ['vietnam'], 'South Africa': ['south africa'],
  'United States': ['united states', ' usa', ', us', ' al ', ' ak ', ' az ', ' ar ', ' ca ', ' co ', ' ct ', ' de ', ' fl ', ' ga ', ' hi ', ' id ', ' il ', ' in ', ' ia ', ' ks ', ' ky ', ' la ', ' me ', ' md ', ' ma ', ' mi ', ' mn ', ' ms ', ' mo ', ' mt ', ' ne ', ' nv ', ' nh ', ' nj ', ' nm ', ' ny ', ' nc ', ' nd ', ' oh ', ' ok ', ' or ', ' pa ', ' ri ', ' sc ', ' sd ', ' tn ', ' tx ', ' ut ', ' vt ', ' va ', ' wa ', ' wv ', ' wi ', ' wy '],
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function normalizeSourceEntityName(value: unknown): string {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function meaningfulTokens(value: unknown): string[] {
  return normalizeSourceEntityName(value)
    .split(' ')
    .filter((token) => token.length >= 2 && !GENERIC_NAME_TOKENS.has(token));
}

function compact(value: unknown): string {
  return normalizeSourceEntityName(value).replace(/\b(?:official|the)\b/g, '').replace(/\s+/g, '');
}

function titleIdentity(title: string, platform: string): string | null {
  if (!title) return null;
  const platformName = platform === 'genericWeb' || platform === 'unknown'
    ? '(?:Instagram|TikTok|YouTube|Facebook|Snapchat)'
    : platform.replace(/^./, (c) => c.toUpperCase());
  const match = title.match(new RegExp(`^(.{2,100}?)\\s+on\\s+${platformName}\\s*:`, 'i'));
  const value = clean(match?.[1]);
  if (!value || /^@?[a-z0-9._-]+$/i.test(value) && !value.includes(' ')) return value || null;
  return value;
}

function domains(text: string): string[] {
  const found = text.match(/\b(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+(?:\.[a-z0-9-]+)+)(?:\/[^\s]*)?/gi) ?? [];
  return found.map((value) => value.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0]!.toLowerCase());
}

function countryFromDomains(values: string[]): string | null {
  for (const domain of values) {
    const labels = domain.split('.');
    const last = labels[labels.length - 1] ?? '';
    if (COUNTRY_TLDS[last]) return COUNTRY_TLDS[last];
  }
  return null;
}

export function inferSourceEntityCategory(text: string): SourceEntityCategory | null {
  const value = normalizeSourceEntityName(text);
  if (/\b(?:restaurant|bbq|barbecue|smokehouse|grill|cafe|coffee|bakery|bistro|pizza|pizzeria|taqueria|sushi|ramen|kitchen|food|dessert|brewery|winery|pub)\b/.test(value)) return 'food';
  if (/\b(?:hotel|resort|motel|hostel|lodging|inn|suites?)\b/.test(value)) return 'lodging';
  if (/\b(?:trail|hike|hiking|beach|waterfall|lake|park|island|marina|mount|mountain|cliff|canyon)\b/.test(value)) return 'outdoors';
  if (/\b(?:wellness|healing|spa|massage|yoga|fitness|gym|therapy|therapist|chiropractic|medical|dental|dentist|clinic)\b/.test(value)) return 'wellness';
  if (/\b(?:shop|shopping|store|boutique|market|mall)\b/.test(value)) return 'shopping';
  if (/\b(?:museum|cinema|theater|theatre|entertainment|nightclub|stadium)\b/.test(value)) return 'entertainment';
  if (/\b(?:airport|station|transit|transport|railway|ferry)\b/.test(value)) return 'transportation';
  if (/\b(?:school|college|university|education|academy)\b/.test(value)) return 'education';
  if (/\b(?:service|agency|consulting|accounting|law|repair)\b/.test(value)) return 'service';
  return null;
}

function inferCandidateCategory(candidate: SourceEntityCandidate): SourceEntityCategory | null {
  const types = [candidate.primaryType, ...(Array.isArray(candidate.types) ? candidate.types : [])]
    .map(clean)
    .join(' ');
  return inferSourceEntityCategory(`${clean(candidate.name)} ${types.replace(/_/g, ' ')}`);
}

function firstPartyRelation(text: string, isRoundup: boolean): ContentRelation {
  if (isRoundup) return 'VIDEO_CONTAINS_MULTIPLE_TARGETS';
  if (/\b(?:sponsored by|paid partnership|in partnership with|thanks to our sponsor)\b/i.test(text)) return 'ENTITY_MENTION_ONLY';
  if (/\b(?:we|our|us)\b.{0,45}\b(?:visited|hiked|climbed|explored|travelled|traveled|stayed at|went to|trip to|journey to)\b/i.test(text)) {
    return 'SOURCE_BUSINESS_PROMOTES_OTHER_PLACE';
  }
  if (/\b(?:book now|reserve|reservations?|our locations?|visit us|find us|our menu|we are open|open daily|shop now|stay with us)\b/i.test(text)) {
    return 'SOURCE_BUSINESS_IS_TARGET';
  }
  return 'UNCERTAIN_RELATION';
}

function repeatedIdentity(name: string, text: string): boolean {
  const needle = normalizeSourceEntityName(name);
  if (!needle) return false;
  const haystack = normalizeSourceEntityName(text);
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) >= 0) {
    count += 1;
    index += needle.length;
  }
  return count >= 2;
}

function handleSupportsName(name: string, handles: string[]): boolean {
  const nameTokens = meaningfulTokens(name);
  if (nameTokens.length === 0) return false;
  return handles.some((handle) => {
    const value = compact(handle).replace(/official$/i, '');
    return nameTokens.every((token) => value.includes(token));
  });
}

function domainSupportsName(name: string, values: string[]): boolean {
  const tokens = meaningfulTokens(name);
  return tokens.length > 0 && values.some((domain) => {
    const host = compact(domain.split('.')[0]);
    return tokens.every((token) => host.includes(token));
  });
}

export function detectExplicitSourceEntity(input: {
  platform: string;
  title?: string | null;
  description?: string | null;
  creatorHandle?: string | null;
  creatorName?: string | null;
  venueNameHints?: string[];
  isRoundup?: boolean;
}): ExplicitSourceEntity | null {
  const title = clean(input.title);
  const description = clean(input.description);
  const combined = `${title}\n${description}`.trim();
  const titleName = titleIdentity(title, input.platform);
  const creatorName = clean(input.creatorName);
  const name = titleName || creatorName;
  if (!name || name.length < 2 || name.length > 100) return null;

  const foundDomains = domains(combined);
  const handles = [clean(input.creatorHandle), ...(combined.match(/@[a-z0-9._-]{2,50}/gi) ?? [])]
    .map((value) => value.replace(/^@/, ''))
    .filter(Boolean);
  const sources: ExplicitSourceEntity['sources'] = [];
  if (titleName) sources.push('platform_title');
  if (creatorName && normalizeSourceEntityName(creatorName) === normalizeSourceEntityName(name)) sources.push('creator_name');
  if (handleSupportsName(name, handles)) sources.push('creator_handle');
  if (domainSupportsName(name, foundDomains)) sources.push('official_domain');
  if (repeatedIdentity(name, combined)) sources.push('caption_repetition');
  if (/\b(?:book now|reserve|reservations?|our locations?|visit us|find us|our menu|we are open|stay with us)\b/i.test(combined)) sources.push('first_party_language');

  const category = inferSourceEntityCategory(`${name} ${description}`);
  const categoryInIdentity = inferSourceEntityCategory(name);
  const corroborators = sources.filter((source) => source !== 'platform_title' && source !== 'creator_name').length;
  // Category words in the post body can describe the depicted destination
  // ("hike", "beach") rather than the creator. Only a category embedded in
  // the identity itself can corroborate that the identity is a business.
  const hasBusinessContext = !!categoryInIdentity || sources.includes('official_domain') || sources.includes('first_party_language');
  const strength: SourceEntityStrength = corroborators >= 1 && sources.length >= 2 && hasBusinessContext
    ? 'strong'
    : 'weak';
  let relation = firstPartyRelation(combined, input.isRoundup === true);
  if (relation === 'UNCERTAIN_RELATION' && strength === 'strong' && sources.includes('first_party_language')) {
    relation = 'SOURCE_BUSINESS_IS_TARGET';
  }
  const locationHint = /\blocations?\s*:/i.test(combined)
    ? clean(input.venueNameHints?.[0]) || null
    : null;

  return {
    name,
    entityType: 'business',
    category,
    sources: [...new Set(sources)],
    strength,
    relation,
    country: countryFromDomains(foundDomains),
    locationHint,
    confidence: strength === 'strong' ? Math.min(0.98, 0.72 + corroborators * 0.08) : 0.42,
  };
}

export function buildExplicitSourceEntityQuery(entity: ExplicitSourceEntity): string | null {
  if (entity.strength !== 'strong' || entity.relation !== 'SOURCE_BUSINESS_IS_TARGET') return null;
  return [entity.name, entity.locationHint, entity.category === 'food' ? 'restaurant' : entity.category, entity.country]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

function namesAgree(sourceName: string, candidateName: unknown): SourceEntityAssessment['nameAgreement'] {
  const source = normalizeSourceEntityName(sourceName);
  const candidate = normalizeSourceEntityName(candidateName);
  if (!source || !candidate) return 'unknown';
  if (source === candidate) return 'exact';
  const sourceTokens = meaningfulTokens(source);
  const candidateTokens = new Set(meaningfulTokens(candidate));
  if (sourceTokens.length > 0 && sourceTokens.every((token) => candidateTokens.has(token))) return 'compatible';
  return 'conflict';
}

function geography(candidateAddress: unknown, expectedCountry: string | null): SourceEntityAssessment['geographyCompatibility'] {
  if (!expectedCountry) return 'unknown';
  const address = ` ${normalizeSourceEntityName(candidateAddress)} `;
  if (!address.trim()) return 'unknown';
  const expectedAliases = COUNTRY_ALIASES[expectedCountry] ?? [expectedCountry.toLowerCase()];
  if (expectedAliases.some((alias) => address.includes(alias.toLowerCase()))) return 'compatible';
  for (const [country, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (country === expectedCountry) continue;
    if (aliases.some((alias) => address.includes(alias.toLowerCase()))) return 'conflict';
  }
  return 'unknown';
}

export function assessSourceEntityCandidate(
  entity: ExplicitSourceEntity | null | undefined,
  candidate: SourceEntityCandidate,
): SourceEntityAssessment {
  const unknown: SourceEntityAssessment = {
    verdict: 'UNKNOWN', nameAgreement: 'unknown', categoryCompatibility: 'unknown',
    geographyCompatibility: 'unknown', reasons: [], hardContradiction: false,
  };
  if (!entity || entity.strength !== 'strong') return unknown;
  if (entity.relation !== 'SOURCE_BUSINESS_IS_TARGET') {
    return { ...unknown, reasons: [`content_relation:${entity.relation.toLowerCase()}`] };
  }

  const nameAgreement = namesAgree(entity.name, candidate.name);
  const candidateCategory = inferCandidateCategory(candidate);
  const categoryCompatibility = !entity.category || !candidateCategory
    ? 'unknown'
    : entity.category === candidateCategory ? 'compatible' : 'conflict';
  const geographyCompatibility = geography(candidate.formattedAddress, entity.country);
  const reasons: string[] = [];
  if (nameAgreement === 'conflict') reasons.push('provider_name_collision_blocked');
  if (categoryCompatibility === 'conflict') reasons.push('provider_category_conflict_blocked');
  if (geographyCompatibility === 'conflict') reasons.push('provider_geography_conflict_blocked');

  // A strong first-party identity is itself authoritative only when the
  // content relation says the source business is the destination. In that
  // narrow state, a different provider name is a hard contradiction. Category
  // and country conflicts are additional independent vetoes, never rescuers.
  const hardContradiction = nameAgreement === 'conflict' ||
    categoryCompatibility === 'conflict' || geographyCompatibility === 'conflict';
  return {
    verdict: hardContradiction ? 'CONTRADICTS' : nameAgreement === 'exact' || nameAgreement === 'compatible' ? 'SUPPORTS' : 'UNKNOWN',
    nameAgreement,
    categoryCompatibility,
    geographyCompatibility,
    reasons,
    hardContradiction,
  };
}
