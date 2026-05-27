import type { AIExtractResult } from './aiExtractPlace';

/**
 * @deprecated STAGE 4 — this module is part of the LEGACY query gating
 * layer. Logic is also duplicated inside the Edge Function (Deno cannot
 * import from lib/). The new agent (lib/shareAgent/agent.ts) makes its
 * own structured "evidence + decision" judgment via Gemini and the
 * deterministic safety gate. This module remains ONLY for the legacy
 * fallback path on host + Edge. Do NOT add new callers. Slated for
 * removal once the agent is mandatory.
 */

export type QueryEvidence = {
  title?: string | null;
  description?: string | null;
  transcript?: string | null;
  placeName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  sourceContext?: string | null;
  profileExtractedName?: string | null;
  profileExtractedAddress?: string | null;
  profileExtractedCity?: string | null;
  accountIdentityOnly?: boolean;
  accountIdentitySource?: string | null;
  ai?: Pick<AIExtractResult, 'query' | 'placeName' | 'address' | 'city' | 'state' | 'confidence' | 'needsUserConfirmation'> | null;
};

function isDisplayNameIdentitySource(source: string | null | undefined): boolean {
  return source === 'account-display-name' || source === 'account_display_name';
}

export type ExtractedQueryKind =
  | 'venue'
  | 'address'
  | 'location_context'
  | 'account_identity'
  | 'generic_content'
  | 'empty';

const ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][\w'.\- ]{1,50}?\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|wharf)\b/i;

const CITY_STATE_RE = /\b([A-Z][A-Za-z'\u2019.-]+(?:\s+[A-Z][A-Za-z'\u2019.-]+){0,3}),\s*([A-Z]{2})\b/;

const GENERIC_PREFIX_RE =
  /^(?:stuffin|pov|best|favorite|going here soon|going there soon|you need to try|you need to go|you have to try|come with me|come to|trying|ranking|hidden gem|date night|food recs?|must try|this place|this spot|this coffee shop|i tried|we tried|follow|check out|open daily for|viral|brunch|burger spot|taco spot|coffee spot|dinner spot)\b/i;

const GENERIC_PHRASE_RE =
  /\b(?:stuffin|grilled cheeses?|smashburgers?|best tacos?|best sushi|best smashburger|food recs?|date night spot|hidden gem|must try brunch|trying viral pizza|ranking burgers?|this place was fire|this spot was fire|you need to try this|come with me to try this place|pov you found the best sushi|full food review|vibes only|slaps|so good|fire|delicious|yummy)\b/i;

const CATEGORY_ONLY_TOKENS = new Set([
  'best', 'favorite', 'viral', 'hidden', 'gem', 'date', 'night', 'spot', 'stuffin',
  'going', 'here', 'soon', 'there', 'tonight',
  'grilled', 'cheese', 'cheeses', 'smashburger', 'smashburgers', 'burger', 'burgers',
  'taco', 'tacos', 'sushi', 'pizza', 'brunch', 'coffee', 'shop', 'place', 'this', 'that',
  'was', 'fire', 'food', 'recs', 'review', 'full', 'tried', 'trying', 'pov', 'found',
  'need', 'must', 'come', 'with', 'me', 'you', 'try', 'spot', 'dinner', 'lunch', 'breakfast',
  'open', 'daily', 'fries', 'burger', 'joint', 'daily', 'city', 'la', 'ny', 'nyc', 'new', 'york',
]);

const VENUE_HINT_TOKENS = [
  'cafe', 'café', 'bakery', 'bistro', 'diner', 'grill', 'rotisserie', 'grotto', 'trattoria',
  'taqueria', 'pizzeria', 'ramen', 'sushi', 'kitchen', 'market', 'bar', 'pub', 'brewery',
  'winery', 'coffee', 'house', 'office', 'burger joint', 'restaurant', 'eatery', 'tavern',
];

function normalize(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenize(value: string | null | undefined): string[] {
  return normalize(value).split(' ').filter(Boolean);
}

function hasStructuredVenueEvidence(evidence: QueryEvidence): boolean {
  return !!(
    evidence.placeName ||
    evidence.address ||
    evidence.city ||
    evidence.state ||
    evidence.sourceContext ||
    evidence.profileExtractedName ||
    evidence.profileExtractedAddress ||
    evidence.profileExtractedCity ||
    evidence.ai?.placeName ||
    evidence.ai?.address ||
    evidence.ai?.city ||
    evidence.ai?.state
  );
}

function hasVerifiedProfileEvidence(evidence: QueryEvidence): boolean {
  return !!(
    evidence.profileExtractedName &&
    (evidence.profileExtractedAddress || evidence.profileExtractedCity)
  );
}

export function isGenericContentQuery(query: string | null | undefined): boolean {
  const normalized = normalize(query);
  if (!normalized) return true;
  if (ADDRESS_RE.test(query ?? '')) return false;
  if (GENERIC_PREFIX_RE.test(normalized)) return true;
  if (GENERIC_PHRASE_RE.test(normalized)) return true;

  const tokens = tokenize(normalized);
  if (tokens.length === 0) return true;

  const unknownTokens = tokens.filter((token) => !CATEGORY_ONLY_TOKENS.has(token));
  if (unknownTokens.length === 0) return true;
  if (unknownTokens.length === 1 && tokens.length >= 3 && !VENUE_HINT_TOKENS.some((hint) => normalized.includes(hint))) {
    return true;
  }

  return false;
}

export function looksLikeVenueNameCandidate(query: string | null | undefined): boolean {
  const raw = (query ?? '').trim();
  if (!raw) return false;
  if (ADDRESS_RE.test(raw)) return false;
  if (isGenericContentQuery(raw)) return false;

  const normalized = normalize(raw);
  if (VENUE_HINT_TOKENS.some((hint) => normalized.includes(hint))) return true;
  if (CITY_STATE_RE.test(raw)) return true;

  const tokens = tokenize(raw);
  if (tokens.length >= 2 && tokens.some((token) => token.length >= 4)) {
    return true;
  }
  return false;
}

export function hasVenueEvidence(query: string | null | undefined, evidence: QueryEvidence): boolean {
  if (ADDRESS_RE.test(query ?? '')) return true;
  if (hasStructuredVenueEvidence(evidence)) return true;
  if (hasVerifiedProfileEvidence(evidence)) return true;

  const hasTranscriptName = !!evidence.transcript && looksLikeVenueNameCandidate(query);
  if (hasTranscriptName) return true;

  if (
    isDisplayNameIdentitySource(evidence.accountIdentitySource) &&
    looksLikeVenueNameCandidate(query)
  ) {
    return true;
  }

  if (evidence.accountIdentitySource === 'verified_profile') {
    return true;
  }

  return false;
}

export function classifyExtractedQuery(
  query: string | null | undefined,
  evidence: QueryEvidence,
): ExtractedQueryKind {
  const raw = (query ?? '').trim();
  if (!raw) return 'empty';
  if (ADDRESS_RE.test(raw) || !!evidence.address || !!evidence.ai?.address) return 'address';
  if (evidence.accountIdentitySource === 'verified_profile' && hasVerifiedProfileEvidence(evidence)) {
    return 'venue';
  }
  if (evidence.accountIdentityOnly) return 'account_identity';
  if ((evidence.city || evidence.state || evidence.sourceContext) && looksLikeVenueNameCandidate(raw)) {
    return 'location_context';
  }
  if (looksLikeVenueNameCandidate(raw) && hasVenueEvidence(raw, evidence)) return 'venue';
  if (isGenericContentQuery(raw)) return 'generic_content';
  if (looksLikeVenueNameCandidate(raw)) return 'venue';
  return 'generic_content';
}

export function shouldSearchPlaces(
  query: string | null | undefined,
  evidence: QueryEvidence,
): boolean {
  const kind = classifyExtractedQuery(query, evidence);
  if (kind === 'empty' || kind === 'generic_content') return false;
  if (kind === 'account_identity') {
    return isDisplayNameIdentitySource(evidence.accountIdentitySource) ||
      evidence.accountIdentitySource === 'verified_profile';
  }
  return true;
}