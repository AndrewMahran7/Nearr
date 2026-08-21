import type { OnboardingInterest, OnboardingPlatform } from '@/lib/onboardingV2Core';
import type { PlaceCandidate } from '@/services/placesService';

export type StarterPlatform = Exclude<OnboardingPlatform, 'other'>;
export type StarterDifficulty = 'easy' | 'medium' | 'hard';

export type OnboardingStarterContent = {
  id: string;
  platform: StarterPlatform;
  category: OnboardingInterest;
  subcategory: string | null;
  title: string;
  sourceUrl: string;
  thumbnail: string | null;
  creator: string | null;
  knownPlace: { name: string; locality: string | null } | null;
  difficulty: StarterDifficulty;
  onboardingPriority: number;
  active: boolean;
  tutorialEligible: boolean;
  /** Durable place payload used only after the explicit tutorial Save tap. */
  targetPlace?: PlaceCandidate;
  tutorialNote?: string;
  /** These links come from Nearr's existing regression corpus, but still need
   * physical device checks immediately before a production rollout. */
  verification: 'repository_regression_fixture_needs_device_validation';
};

/**
 * Small local registry, intentionally data-only. No recommendation engine and
 * no invented live URLs. Every entry already existed in Nearr's checked-in
 * recognition regression corpus before Onboarding V2.
 */
export const ONBOARDING_STARTER_CONTENT: readonly OnboardingStarterContent[] = [
  {
    id: 'ig-mad-yolks-santa-cruz',
    platform: 'instagram',
    category: 'food',
    subcategory: 'breakfast',
    title: 'Mad Yolks in Santa Cruz',
    sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
    thumbnail: null,
    creator: 'Mad Yolks',
    knownPlace: { name: 'Mad Yolks', locality: 'Santa Cruz, CA' },
    difficulty: 'easy',
    onboardingPriority: 100,
    active: true,
    tutorialEligible: true,
    targetPlace: {
      googlePlaceId: 'ChIJa-286P5BjoARx03hogk54cw',
      name: 'Mad Yolks',
      formattedAddress: '1411 Pacific Ave, Santa Cruz, CA 95060, USA',
      latitude: 36.9750378,
      longitude: -122.0266371,
      category: 'Breakfast restaurant',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Mad%20Yolks&query_place_id=ChIJa-286P5BjoARx03hogk54cw',
      rawTypes: ['breakfast_restaurant', 'restaurant', 'food', 'establishment'],
      primaryType: 'breakfast_restaurant',
      primaryTypeDisplayName: 'Breakfast restaurant',
      googleMapsTypeLabel: 'Breakfast restaurant',
      shortFormattedAddress: '1411 Pacific Ave, Santa Cruz',
      businessStatus: 'OPERATIONAL',
    },
    tutorialNote: 'Fresh breakfast sandwiches and house-baked brioche in downtown Santa Cruz.',
    verification: 'repository_regression_fixture_needs_device_validation',
  },
  {
    id: 'ig-2nd-floor-huntington-beach',
    platform: 'instagram',
    category: 'food',
    subcategory: 'brunch',
    title: 'Brunch at 2nd Floor',
    sourceUrl: 'https://www.instagram.com/p/DYpcd2ZBTsZ/',
    thumbnail: null,
    creator: '2nd Floor',
    knownPlace: { name: '2nd Floor', locality: 'Huntington Beach, CA' },
    difficulty: 'easy',
    onboardingPriority: 90,
    active: true,
    tutorialEligible: true,
    targetPlace: {
      googlePlaceId: 'ChIJE5pV1UMh3YARIhsItpUt0K8',
      name: '2nd Floor',
      formattedAddress: '126 Main St, Huntington Beach, CA 92648, USA',
      latitude: 33.6577917,
      longitude: -118.0009472,
      category: 'American restaurant',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=2nd%20Floor&query_place_id=ChIJE5pV1UMh3YARIhsItpUt0K8',
      rawTypes: ['american_restaurant', 'restaurant', 'food', 'establishment'],
      primaryType: 'american_restaurant',
      primaryTypeDisplayName: 'American restaurant',
      googleMapsTypeLabel: 'American restaurant',
      shortFormattedAddress: '126 Main St, Huntington Beach',
      businessStatus: 'OPERATIONAL',
    },
    tutorialNote: 'A lively brunch spot near the Huntington Beach pier.',
    verification: 'repository_regression_fixture_needs_device_validation',
  },
  {
    id: 'ig-paradise-dynasty-costa-mesa',
    platform: 'instagram',
    category: 'travel',
    subcategory: 'restaurant',
    title: 'Paradise Dynasty in Costa Mesa',
    sourceUrl: 'https://www.instagram.com/p/DX77lghIHeG/',
    thumbnail: null,
    creator: null,
    knownPlace: { name: 'Paradise Dynasty', locality: 'Costa Mesa, CA' },
    difficulty: 'easy',
    onboardingPriority: 80,
    active: true,
    tutorialEligible: true,
    targetPlace: {
      googlePlaceId: 'ChIJl25h7GXf3IAR6OBs3e4cxrM',
      name: 'Paradise Dynasty',
      formattedAddress: "3333 Bristol Street, BLM, 1 Bloomingdale's, Costa Mesa, CA 92626, USA",
      latitude: 33.6887216,
      longitude: -117.8880952,
      category: 'Chinese restaurant',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Paradise%20Dynasty&query_place_id=ChIJl25h7GXf3IAR6OBs3e4cxrM',
      rawTypes: ['chinese_restaurant', 'restaurant', 'food', 'establishment'],
      primaryType: 'chinese_restaurant',
      primaryTypeDisplayName: 'Chinese restaurant',
      googleMapsTypeLabel: 'Chinese restaurant',
      shortFormattedAddress: '3333 Bristol St, Costa Mesa',
      businessStatus: 'OPERATIONAL',
    },
    tutorialNote: 'Colorful soup dumplings inside South Coast Plaza in Costa Mesa.',
    verification: 'repository_regression_fixture_needs_device_validation',
  },
  {
    id: 'ig-brooklyn-city-pizzeria',
    platform: 'instagram',
    category: 'food',
    subcategory: 'pizza',
    title: 'Brooklyn City Pizzeria',
    sourceUrl: 'https://www.instagram.com/reel/CxdY35frOrf/',
    thumbnail: null,
    creator: null,
    knownPlace: { name: 'Brooklyn City Pizzeria', locality: 'Laguna Niguel, CA' },
    difficulty: 'medium',
    onboardingPriority: 70,
    active: true,
    tutorialEligible: false,
    verification: 'repository_regression_fixture_needs_device_validation',
  },
  {
    id: 'ig-capones-cucina',
    platform: 'instagram',
    category: 'food',
    subcategory: 'restaurant',
    title: "Capone's Cucina",
    sourceUrl: 'https://www.instagram.com/reel/DUWyZkfgbT4/',
    thumbnail: null,
    creator: null,
    knownPlace: { name: "Capone's Cucina", locality: 'Huntington Beach, CA' },
    difficulty: 'medium',
    onboardingPriority: 60,
    active: true,
    tutorialEligible: false,
    verification: 'repository_regression_fixture_needs_device_validation',
  },
  {
    id: 'ig-hellfire-bay-western-australia',
    platform: 'instagram',
    category: 'beaches',
    subcategory: 'beach',
    title: 'Hellfire Bay in Western Australia',
    sourceUrl: 'https://www.instagram.com/reel/DYq7Q3Lza0G/',
    thumbnail: null,
    creator: null,
    knownPlace: { name: 'Hellfire Bay', locality: 'Western Australia' },
    difficulty: 'hard',
    onboardingPriority: 50,
    active: true,
    tutorialEligible: true,
    targetPlace: {
      googlePlaceId: 'ChIJ-93O_bZkWyoRWSPSBABfQR0',
      name: 'Hellfire Bay',
      formattedAddress: 'Cape Le Grand National Park, Road, Cape Le Grand WA 6450, Australia',
      latitude: -34.0034813,
      longitude: 122.1690916,
      category: 'Tourist attraction',
      googleMapsUrl: 'https://www.google.com/maps/search/?api=1&query=Hellfire%20Bay&query_place_id=ChIJ-93O_bZkWyoRWSPSBABfQR0',
      rawTypes: ['tourist_attraction', 'beach', 'natural_feature'],
      primaryType: 'tourist_attraction',
      primaryTypeDisplayName: 'Tourist attraction',
      googleMapsTypeLabel: 'Beach',
      shortFormattedAddress: 'Cape Le Grand National Park, WA',
      businessStatus: 'OPERATIONAL',
    },
    tutorialNote: 'White sand and turquoise water in Cape Le Grand National Park.',
    verification: 'repository_regression_fixture_needs_device_validation',
  },
] as const;

const TUTORIAL_CONTENT_BY_INTEREST: Readonly<Record<OnboardingInterest, string>> = {
  food: 'ig-mad-yolks-santa-cruz',
  outdoors: 'ig-hellfire-bay-western-australia',
  travel: 'ig-paradise-dynasty-costa-mesa',
  beaches: 'ig-hellfire-bay-western-australia',
  shopping: 'ig-paradise-dynasty-costa-mesa',
  anything: 'ig-2nd-floor-huntington-beach',
};

export type OnboardingTutorialConfig = {
  platform: StarterPlatform;
  category: OnboardingInterest;
  sourceStyle: StarterPlatform;
  contentId: string;
  asset: { kind: 'native_placeholder_frame'; uri: null; finalAssetRequired: true };
};

function tutorialSlots(platform: StarterPlatform): Record<OnboardingInterest, OnboardingTutorialConfig> {
  return Object.fromEntries(
    Object.entries(TUTORIAL_CONTENT_BY_INTEREST).map(([category, contentId]) => [
      category,
      {
        platform,
        category: category as OnboardingInterest,
        sourceStyle: platform,
        contentId,
        asset: { kind: 'native_placeholder_frame', uri: null, finalAssetRequired: true },
      },
    ]),
  ) as Record<OnboardingInterest, OnboardingTutorialConfig>;
}

/** Explicit platform + category → shell + source fixture + final-asset slot. */
export const ONBOARDING_TUTORIAL_CONFIG: Readonly<
  Record<StarterPlatform, Readonly<Record<OnboardingInterest, OnboardingTutorialConfig>>>
> = {
  instagram: tutorialSlots('instagram'),
  tiktok: tutorialSlots('tiktok'),
  youtube: tutorialSlots('youtube'),
  facebook: tutorialSlots('facebook'),
};

/** Future Practice recovery asset hook. Keep null until Andrew supplies approved media. */
export const ONBOARDING_PRACTICE_HELP_VIDEO = {
  uri: null as string | null,
  status: 'awaiting_approved_asset' as const,
};

function score(
  item: OnboardingStarterContent,
  platform: OnboardingPlatform | null,
  interest: OnboardingInterest | null,
): number {
  return (
    item.onboardingPriority +
    (platform && platform !== 'other' && item.platform === platform ? 1_000 : 0) +
    (interest && item.category === interest ? 500 : 0)
  );
}
export function selectTutorialContent(
  platform: OnboardingPlatform | null,
  interest: OnboardingInterest | null,
): OnboardingStarterContent | null {
  if (!platform || platform === 'other' || !interest) return null;
  const item = starterContentById(ONBOARDING_TUTORIAL_CONFIG[platform][interest].contentId);
  return item?.active && item.tutorialEligible && item.targetPlace ? item : null;
}

export function starterContentById(id: string | null | undefined): OnboardingStarterContent | null {
  if (!id) return null;
  return ONBOARDING_STARTER_CONTENT.find((item) => item.id === id) ?? null;
}

export function selectPracticeContent(input: {
  platform: OnboardingPlatform | null;
  interest: OnboardingInterest | null;
  excludeContentIds?: readonly string[];
  limit?: number;
}): OnboardingStarterContent[] {
  const excluded = new Set(input.excludeContentIds ?? []);
  const ranked = [...ONBOARDING_STARTER_CONTENT]
    .filter((item) => item.active && !excluded.has(item.id))
    .sort((a, b) => score(b, input.platform, input.interest) - score(a, input.platform, input.interest));

  // When available, put one different category in the first three so Nearr
  // does not teach itself as only a restaurant finder.
  const first = ranked[0];
  if (!first) return [];
  const diverse = ranked.find((item) => item.category !== first.category);
  const ordered = diverse
    ? [first, diverse, ...ranked.filter((item) => item !== first && item !== diverse)]
    : ranked;
  return ordered.slice(0, input.limit ?? 3);
}

export function platformLabel(platform: StarterPlatform): string {
  const labels: Record<StarterPlatform, string> = {
    instagram: 'Instagram',
    tiktok: 'TikTok',
    youtube: 'YouTube',
    facebook: 'Facebook',
  };
  return labels[platform];
}
