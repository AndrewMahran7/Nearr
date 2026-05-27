export type ProfileConfidence = 'high' | 'medium' | 'low';

export type InstagramProfileClassification =
  | 'restaurant_or_business'
  | 'food_creator'
  | 'repost_page'
  | 'personal_account'
  | 'unrelated_or_unknown';

export type InstagramProfileMetadata = {
  platform?: 'instagram';
  handle: string;
  displayName?: string;
  category?: string;
  bio?: string;
  website?: string;
  extractedName?: string;
  extractedAddress?: string;
  extractedCity?: string;
  classification: InstagramProfileClassification;
  confidence: ProfileConfidence;
  reasons: string[];
};

type BusinessEvidence = {
  extractedName?: string;
  extractedAddress?: string;
  extractedCity?: string;
  website?: string;
  hasBusinessKeyword: boolean;
  hasCreatorPhrase: boolean;
  hasBusinessCategory: boolean;
  hasCreatorCategory: boolean;
};

const PROFILE_BIO_MAX_LEN = 280;
const PROFILE_ADDRESS_RE =
  /\b\d{1,5}\s+[A-Za-z][\w'.\- ]{1,50}?\s+(?:st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|way|ln|lane|ct|court|pl|place|hwy|highway|wharf)\b\.?/i;
const PROFILE_CITY_STATE_RE =
  /\b([A-Z][a-zA-Z][\w'.\- ]{1,40}?)(?:,)?\s+([A-Z]{2})\b/;
const PROFILE_WEBSITE_RE =
  /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9][a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s"'<>]*)?/i;

const PROFILE_BUSINESS_KEYWORDS = [
  'restaurant', 'cafe', 'café', 'bar', 'bakery', 'kitchen', 'diner',
  'eatery', 'taqueria', 'pizzeria', 'bistro', 'grill', 'grotto',
  'coffee', 'seafood', 'sushi', 'ramen', 'burger', 'pizza', 'tacos',
  'breakfast', 'brunch', 'steakhouse', 'bbq', 'brewery', 'winery',
];

const PROFILE_BUSINESS_CATEGORIES = [
  'restaurant', 'seafood restaurant', 'american restaurant', 'italian restaurant',
  'coffee shop', 'cafe', 'bakery', 'bar', 'brewery', 'winery', 'food stand',
  'food truck', 'diner', 'pizzeria', 'taqueria', 'bistro', 'grill',
];

const PROFILE_CREATOR_PHRASES = [
  'food creator', 'food blogger', 'food critic', 'content creator',
  'creator', 'reviews', 'reviewer', 'food reviews', 'restaurant reviews',
  'media', 'magazine', 'newsletter', 'best eats', 'foodie', 'hungry',
  'eats', 'bites', 'finds',
];

const PROFILE_CREATOR_CATEGORIES = [
  'digital creator', 'creator', 'blogger', 'personal blog', 'public figure',
  'video creator', 'media/news company', 'media', 'news & media website',
];

export function pickMeta(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(
      `<meta[^>]+(?:property|name)=(["'])${escapeRegExp(prop)}\\1[^>]+content=(["'])([\\s\\S]*?)\\2`,
      'i',
    ),
    new RegExp(
      `<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]+(?:property|name)=(["'])${escapeRegExp(prop)}\\3`,
      'i',
    ),
  ];
  for (const re of patterns) {
    const match = html.match(re);
    const value = match?.[3] ?? match?.[2];
    if (value) return decodeHtml(value);
  }
  return null;
}

export function pickTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return match?.[1] ? decodeHtml(match[1]) : null;
}

export function parseInstagramPublicProfileHtml(params: {
  html: string;
  handle: string;
  website?: string;
}): InstagramProfileMetadata | null {
  const safeHandle = (params.handle ?? '').replace(/^@+/, '').trim();
  const html = params.html ?? '';
  if (!safeHandle || !html) return null;

  const ogTitle = pickMeta(html, 'og:title');
  const ogDescription = pickMeta(html, 'og:description');
  const metaDescription = pickMeta(html, 'description');
  const twitterTitle = pickMeta(html, 'twitter:title');
  const twitterDescription = pickMeta(html, 'twitter:description');
  const pageTitle = pickTitle(html);

  const displayName =
    parseDisplayNameFromOgTitle(ogTitle ?? twitterTitle ?? pageTitle ?? '') ??
    parseDisplayNameFromMetaDescription(metaDescription) ??
    undefined;

  const bio =
    extractInstagramBioFromMetaDescription(metaDescription ?? '') ??
    parseBioFromOgDescription(ogDescription ?? twitterDescription ?? metaDescription ?? '', displayName, safeHandle);

  const category = parseInstagramCategoryFromHtml(html) ?? undefined;
  const evidence = extractBusinessEvidenceFromProfileMetadata({
    displayName,
    category,
    bio,
    website: params.website,
  });
  const classification = classifyInstagramProfileMetadata({
    handle: safeHandle,
    category,
    evidence,
  });

  if (!displayName && !bio && !category) return null;

  return {
    platform: 'instagram',
    handle: safeHandle,
    displayName,
    category,
    bio,
    website: evidence.website,
    extractedName: evidence.extractedName,
    extractedAddress: evidence.extractedAddress,
    extractedCity: evidence.extractedCity,
    classification: classification.classification,
    confidence: classification.confidence,
    reasons: classification.reasons,
  };
}

export function parseDisplayNameFromOgTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^(.*?)\s*\(@[A-Za-z0-9._]+\)/);
  if (match?.[1]) return match[1].trim().slice(0, 80);
  const cleaned = value.split(/\s*[•|·]\s*/)[0]?.trim();
  return cleaned ? cleaned.slice(0, 80) : null;
}

export function parseDisplayNameFromMetaDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = value.match(/[-–]\s+(.*?)\s*\(@[A-Za-z0-9._]+\)\s+on Instagram:/i);
  return match?.[1] ? match[1].trim().slice(0, 80) : null;
}

export function extractInstagramBioFromMetaDescription(value: string | null | undefined): string | null {
  if (!value) return null;
  const quoted = value.match(/on Instagram:\s*[\u201C"]([\s\S]*?)[\u201D"]?\s*$/i);
  if (quoted?.[1]) {
    const bio = quoted[1].replace(/\s+/g, ' ').trim();
    return bio.length >= 2 ? bio.slice(0, PROFILE_BIO_MAX_LEN) : null;
  }
  const plain = value.match(/on Instagram:\s+([\s\S]{4,})/i);
  if (plain?.[1]) {
    const bio = plain[1].replace(/\s+/g, ' ').trim();
    return bio.length >= 2 ? bio.slice(0, PROFILE_BIO_MAX_LEN) : null;
  }
  return null;
}

export function parseBioFromOgDescription(
  description: string | null | undefined,
  displayName?: string,
  handle?: string,
): string | undefined {
  if (!description) return undefined;
  const sentinel = /See Instagram (?:photos|reels and photos|posts and reels|videos|reels) (?:from|by)\s+[^.\n]{1,80}\.?/i;
  let bio: string | undefined;
  const index = description.search(sentinel);
  if (index >= 0) {
    const after = description.slice(index).replace(sentinel, '').trim();
    if (after.length >= 4) bio = after;
  }
  if (!bio && description.length < 220 && !/Followers,\s*\d/i.test(description)) {
    bio = description;
  }
  if (!bio) return undefined;
  if (displayName) {
    bio = bio.replace(new RegExp(`^${escapeRegExp(displayName)}[\\s:,-]+`, 'i'), '');
  }
  if (handle) {
    bio = bio.replace(new RegExp(`^@?${escapeRegExp(handle)}[\\s:,-]+`, 'i'), '');
  }
  bio = bio.replace(/\s+/g, ' ').trim();
  return bio ? bio.slice(0, PROFILE_BIO_MAX_LEN) : undefined;
}

export function parseInstagramCategoryFromHtml(html: string): string | null {
  const patterns = [
    /"business_category_name"\s*:\s*"([^"]{2,80})"/i,
    /"category_name"\s*:\s*"([^"]{2,80})"/i,
    /"category"\s*:\s*"([^"]{2,80})"/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    if (match?.[1]) {
      const value = decodeHtml(match[1]).replace(/\s+/g, ' ').trim();
      if (value) return value.slice(0, 80);
    }
  }
  return null;
}

export function extractBusinessEvidenceFromProfileMetadata(params: {
  displayName?: string;
  category?: string;
  bio?: string;
  website?: string;
}): BusinessEvidence {
  const bioLower = (params.bio ?? '').toLowerCase();
  const categoryLower = (params.category ?? '').toLowerCase();
  const evidence: BusinessEvidence = {
    hasBusinessKeyword: PROFILE_BUSINESS_KEYWORDS.some((keyword) => bioLower.includes(keyword)),
    hasCreatorPhrase: PROFILE_CREATOR_PHRASES.some((phrase) => bioLower.includes(phrase)),
    hasBusinessCategory: PROFILE_BUSINESS_CATEGORIES.some((category) => categoryLower.includes(category)),
    hasCreatorCategory: PROFILE_CREATOR_CATEGORIES.some((category) => categoryLower.includes(category)),
  };

  if (params.bio) {
    const address = params.bio.match(PROFILE_ADDRESS_RE);
    if (address?.[0]) {
      evidence.extractedAddress = address[0].replace(/\s+/g, ' ').trim();
    }
    const cityState = params.bio.match(PROFILE_CITY_STATE_RE);
    if (cityState?.[1] && cityState?.[2]) {
      evidence.extractedCity = `${cityState[1].trim()}, ${cityState[2]}`;
    }
    const website = params.bio.match(PROFILE_WEBSITE_RE);
    if (website?.[0]) {
      evidence.website = normalizeWebsite(website[0]);
    }
  }

  if (params.website && !evidence.website) {
    evidence.website = normalizeWebsite(params.website);
  }

  if (params.displayName) {
    const hasCorroboration =
      !!evidence.extractedAddress ||
      !!evidence.extractedCity ||
      evidence.hasBusinessKeyword ||
      evidence.hasBusinessCategory;
    if (hasCorroboration) {
      evidence.extractedName = params.displayName.trim().slice(0, 80);
    }
  }

  return evidence;
}

export function classifyInstagramProfileMetadata(params: {
  handle: string;
  category?: string;
  evidence: BusinessEvidence;
}): {
  classification: InstagramProfileClassification;
  confidence: ProfileConfidence;
  reasons: string[];
} {
  const reasons: string[] = [];
  const { evidence } = params;

  if (evidence.hasCreatorCategory) {
    reasons.push('category_creator');
    return { classification: 'food_creator', confidence: 'high', reasons };
  }
  if (evidence.hasCreatorPhrase) {
    reasons.push('bio_creator_phrase');
    return { classification: 'food_creator', confidence: 'high', reasons };
  }
  if (evidence.extractedAddress) {
    reasons.push('bio_address');
    if (evidence.extractedCity) reasons.push('bio_city_state');
    if (evidence.hasBusinessCategory) reasons.push('category_business');
    return { classification: 'restaurant_or_business', confidence: 'high', reasons };
  }
  if ((evidence.hasBusinessKeyword || evidence.hasBusinessCategory) && evidence.extractedCity) {
    if (evidence.hasBusinessKeyword) reasons.push('bio_business_keyword');
    if (evidence.hasBusinessCategory) reasons.push('category_business');
    reasons.push('bio_city_state');
    return { classification: 'restaurant_or_business', confidence: 'high', reasons };
  }
  if (evidence.hasBusinessKeyword || evidence.hasBusinessCategory) {
    if (evidence.hasBusinessKeyword) reasons.push('bio_business_keyword');
    if (evidence.hasBusinessCategory) reasons.push('category_business');
    return { classification: 'restaurant_or_business', confidence: 'medium', reasons };
  }

  reasons.push('no_bio_evidence');
  return { classification: 'unrelated_or_unknown', confidence: 'low', reasons };
}

export function isVerifiedVenueProfile(
  profile: Pick<InstagramProfileMetadata, 'classification' | 'extractedName' | 'extractedAddress' | 'extractedCity'> | null | undefined,
): boolean {
  return !!(
    profile &&
    profile.classification === 'restaurant_or_business' &&
    profile.extractedName &&
    (profile.extractedAddress || profile.extractedCity)
  );
}

export function buildVerifiedProfileQuery(
  profile: Pick<InstagramProfileMetadata, 'classification' | 'extractedName' | 'extractedAddress' | 'extractedCity'> | null | undefined,
): string | null {
  if (!isVerifiedVenueProfile(profile)) return null;
  const verifiedProfile = profile!;
  return [verifiedProfile.extractedName, verifiedProfile.extractedAddress ?? verifiedProfile.extractedCity]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim() || null;
}

export function pickBestVerifiedVenueProfile<T extends InstagramProfileMetadata>(
  profiles: T[] | null | undefined,
  preferredHandles: Array<string | null | undefined> = [],
): T | null {
  const list = (profiles ?? []).filter((profile) => isVerifiedVenueProfile(profile));
  if (list.length === 0) return null;
  const preferred = preferredHandles
    .map((handle) => (handle ?? '').trim().toLowerCase())
    .filter(Boolean);
  return [...list].sort((left, right) => {
    const leftPreferred = preferred.includes(left.handle.toLowerCase()) ? 1 : 0;
    const rightPreferred = preferred.includes(right.handle.toLowerCase()) ? 1 : 0;
    if (leftPreferred !== rightPreferred) return rightPreferred - leftPreferred;
    const leftScore = (left.extractedAddress ? 2 : 0) + (left.extractedCity ? 1 : 0);
    const rightScore = (right.extractedAddress ? 2 : 0) + (right.extractedCity ? 1 : 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    return left.handle.localeCompare(right.handle);
  })[0] ?? null;
}

function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => {
      const code = parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const code = parseInt(dec, 10);
      if (!Number.isFinite(code) || code <= 0) return '';
      try {
        return String.fromCodePoint(code);
      } catch {
        return '';
      }
    })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}