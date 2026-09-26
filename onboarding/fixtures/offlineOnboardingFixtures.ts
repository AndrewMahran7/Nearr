import type {
  OnboardingInterest,
  OnboardingPlatform,
  OnboardingTutorialFixture,
  OnboardingTutorialResult,
} from '../../lib/onboardingV2Core';

export type OfflineOnboardingCategory = 'outdoors' | 'food' | 'travel';
export type OfflineOnboardingAssetKey = 'dorset_quarry' | 'mad_yolks' | 'hydra_old_town';

export type OfflineOnboardingFixture = {
  id: string;
  platform: Exclude<OnboardingPlatform, 'other'>;
  category: OfflineOnboardingCategory;
  contentId: string;
  creatorDisplay: string;
  creatorHandle: string;
  caption: string;
  comments: readonly string[];
  shareSheetTitle: string;
  assetKey: OfflineOnboardingAssetKey;
  provenance: {
    sourceUrl: string;
    sourceKind: 'nearr_development' | 'exact_place_external_fallback';
  };
  place: {
    id: string;
    name: string;
    address: string;
    latitude: number;
    longitude: number;
    category: string;
    typeLabel: string;
    aiNote: string;
    distanceLabel: string;
    directionsLabel: string;
    nearby: readonly string[];
  };
};

export const OFFLINE_ONBOARDING_TIMING_MS = {
  postReceived: 0,
  scanningVideo: 420,
  lookingForClues: 900,
  matchingPlace: 1_380,
  found: 1_850,
} as const;

const CATEGORY_BY_INTEREST: Record<OnboardingInterest, OfflineOnboardingCategory> = {
  outdoors: 'outdoors',
  beaches: 'outdoors',
  food: 'food',
  cafes: 'food',
  travel: 'travel',
  things_to_do: 'travel',
  shopping: 'travel',
  anything: 'travel',
};

const PLATFORM_COPY: Record<Exclude<OnboardingPlatform, 'other'>, {
  creatorDisplay: string;
  creatorHandle: string;
  shareSheetTitle: string;
}> = {
  instagram: { creatorDisplay: 'Roam With Mina', creatorHandle: '@roamwithmina', shareSheetTitle: 'Instagram post' },
  tiktok: { creatorDisplay: 'One More Stop', creatorHandle: '@onemorestop', shareSheetTitle: 'TikTok video' },
  facebook: { creatorDisplay: 'Places Worth Going', creatorHandle: 'Places Worth Going', shareSheetTitle: 'Facebook reel' },
  youtube: { creatorDisplay: 'The Local Detour', creatorHandle: '@thelocaldetour', shareSheetTitle: 'YouTube Short' },
};

const CATEGORY_CONTENT: Record<OfflineOnboardingCategory, {
  assetKey: OfflineOnboardingAssetKey;
  caption: string;
  comments: readonly string[];
  place: OfflineOnboardingFixture['place'];
}> = {
  outdoors: {
    assetKey: 'dorset_quarry',
    caption: 'A hidden swimming spot carved into the Dorset coast. Save this one for a clear morning.',
    comments: ['Adding this to the summer list', 'That water color is unreal'],
    place: {
      id: 'onboarding-place-dorset-quarry',
      name: 'Dorset Quarry',
      address: '1848 VT-30, Dorset, VT 05251',
      latitude: 43.2359604,
      longitude: -73.0834756,
      category: 'outdoors',
      typeLabel: 'Swimming hole',
      aiNote: 'A scenic former marble quarry known for clear water and a relaxed outdoor stop.',
      distanceLabel: 'Saved for later',
      directionsLabel: 'Route preview ready',
      nearby: ['Dorset Village', 'Emerald Lake State Park', 'Mount Equinox Skyline Drive'],
    },
  },
  food: {
    assetKey: 'mad_yolks',
    caption: 'The brunch plate people keep asking about: poached eggs, avocado toast, crispy potatoes, and a proper latte.',
    comments: ['The potatoes look perfect', 'Saving this for Sunday'],
    place: {
      id: 'onboarding-place-mad-yolks',
      name: 'Mad Yolks',
      address: '1411 Pacific Ave, Santa Cruz, CA 95060',
      latitude: 36.9750378,
      longitude: -122.0266371,
      category: 'food',
      typeLabel: 'Breakfast restaurant',
      aiNote: 'A casual downtown breakfast stop known for egg sandwiches, brunch plates, and coffee.',
      distanceLabel: 'Saved for brunch',
      directionsLabel: 'Downtown Santa Cruz',
      nearby: ['Abbott Square Market', 'Pacific Garden Mall', 'Santa Cruz Wharf'],
    },
  },
  travel: {
    assetKey: 'hydra_old_town',
    caption: 'Stone lanes, sea views, and a sunset worth planning a whole afternoon around.',
    comments: ['This view belongs on the itinerary', 'Adding it to the trip map'],
    place: {
      id: 'onboarding-place-hydra-old-town',
      name: 'Hydra Old Town',
      address: 'Hydra 180 40, Greece',
      latitude: 37.3499,
      longitude: 23.4669,
      category: 'travel',
      typeLabel: 'Historic destination',
      aiNote: 'A car-free island town with stone lanes, harbor views, and easy walking routes through the old center.',
      distanceLabel: 'Saved for your trip',
      directionsLabel: 'Harbor walking route',
      nearby: ['Hydra Harbor', 'Historical Archives Museum', 'Kamini Beach'],
    },
  },
};

const SUPPORTED_PLATFORMS: Array<Exclude<OnboardingPlatform, 'other'>> = [
  'instagram', 'tiktok', 'facebook', 'youtube',
];
const SUPPORTED_CATEGORIES: OfflineOnboardingCategory[] = ['outdoors', 'food', 'travel'];

const PROVENANCE_BY_ASSET: Record<OfflineOnboardingAssetKey, OfflineOnboardingFixture['provenance']> = {
  dorset_quarry: {
    sourceUrl: 'https://www.instagram.com/reel/C9Z963muLHI/',
    sourceKind: 'nearr_development',
  },
  mad_yolks: {
    sourceUrl: 'https://www.instagram.com/p/C-BEtdnyGdR/',
    sourceKind: 'nearr_development',
  },
  hydra_old_town: {
    sourceUrl: 'https://www.youtube.com/watch?v=6e38Z0ErVoU',
    sourceKind: 'exact_place_external_fallback',
  },
};

export const OFFLINE_ONBOARDING_FIXTURES: readonly OfflineOnboardingFixture[] = SUPPORTED_PLATFORMS.flatMap(
  (platform) => SUPPORTED_CATEGORIES.map((category) => {
    const platformCopy = PLATFORM_COPY[platform];
    const categoryContent = CATEGORY_CONTENT[category];
    const contentId = `${platform}-${category}-offline-v1`;
    return {
      id: `onboarding-offline-${platform}-${category}-v1`,
      platform,
      category,
      contentId,
      creatorDisplay: platformCopy.creatorDisplay,
      creatorHandle: platformCopy.creatorHandle,
      caption: categoryContent.caption,
      comments: categoryContent.comments,
      shareSheetTitle: platformCopy.shareSheetTitle,
      assetKey: categoryContent.assetKey,
      provenance: PROVENANCE_BY_ASSET[categoryContent.assetKey],
      place: categoryContent.place,
    };
  }),
);

export function onboardingCategoryForInterest(
  interest: OnboardingInterest | null,
): OfflineOnboardingCategory {
  return interest ? CATEGORY_BY_INTEREST[interest] : 'travel';
}

export function selectOfflineOnboardingFixture(
  platform: OnboardingPlatform | null,
  interest: OnboardingInterest | null,
): OfflineOnboardingFixture {
  const selectedPlatform = platform && platform !== 'other' ? platform : 'instagram';
  const category = onboardingCategoryForInterest(interest);
  const fixture = OFFLINE_ONBOARDING_FIXTURES.find(
    (candidate) => candidate.platform === selectedPlatform && candidate.category === category,
  );
  if (!fixture) throw new Error(`offline_onboarding_fixture_invariant:${selectedPlatform}:${category}`);
  return fixture;
}

export function offlineFixtureById(id: string | null | undefined): OfflineOnboardingFixture | null {
  if (!id) return null;
  return OFFLINE_ONBOARDING_FIXTURES.find((fixture) => fixture.id === id) ?? null;
}

export function toOnboardingTutorialFixture(
  fixture: OfflineOnboardingFixture,
  selectedAt: string,
): OnboardingTutorialFixture {
  const source = `onboarding://${fixture.platform}/${fixture.contentId}`;
  return {
    id: fixture.id,
    revision: 1,
    role: 'primary',
    platform: fixture.platform,
    identityKey: `onboarding:v1:${fixture.platform}:${fixture.contentId}`,
    identityVersion: 1,
    contentId: fixture.contentId,
    canonicalUrl: source,
    launchUrl: source,
    thumbnailUrl: null,
    selectedAt,
  };
}

export function buildOfflineOnboardingResult(
  fixture: OfflineOnboardingFixture,
): OnboardingTutorialResult {
  const sourceUrl = `onboarding://${fixture.platform}/${fixture.contentId}`;
  return {
    jobId: `onboarding-scripted-job:${fixture.id}`,
    savedPlaceId: `onboarding-scripted-save:${fixture.place.id}`,
    fixtureId: fixture.id,
    fixtureRevision: 1,
    fixtureRole: 'primary',
    resolutionSource: 'onboarding_scripted',
    sourceUrl,
    place: {
      googlePlaceId: fixture.place.id,
      name: fixture.place.name,
      formattedAddress: fixture.place.address,
      latitude: fixture.place.latitude,
      longitude: fixture.place.longitude,
      primaryType: fixture.place.category,
      typeLabel: fixture.place.typeLabel,
      photoUrl: null,
      photoUrls: [],
    },
  };
}
