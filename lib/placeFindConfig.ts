export const PLACE_FIND_FREE_LIFETIME_USES = 5;

export type PlaceFindPack = {
  key: 'small' | 'medium' | 'large';
  uses: 10 | 30 | 75;
  mockProductId: string;
  mockDisplayPrice: string;
  mockPriceCents: number;
};

/**
 * Development price-preview variant A. These are deliberately mock product
 * identifiers and mock display prices; a real StoreKit surface must replace
 * displayPrice with Apple's localized Product metadata.
 */
export const PLACE_FIND_DEV_PACKS: readonly PlaceFindPack[] = [
  {
    key: 'small',
    uses: 10,
    mockProductId: 'dev.mock.nearr.place_finds.10',
    mockDisplayPrice: '$3.99',
    mockPriceCents: 399,
  },
  {
    key: 'medium',
    uses: 30,
    mockProductId: 'dev.mock.nearr.place_finds.25',
    mockDisplayPrice: '$8.99',
    mockPriceCents: 899,
  },
  {
    key: 'large',
    uses: 75,
    mockProductId: 'dev.mock.nearr.place_finds.50',
    mockDisplayPrice: '$15.99',
    mockPriceCents: 1599,
  },
] as const;

export type PlaceFindPriceSource = 'storekit' | 'dev_mock_config';

export type TokenPackPresentation = {
  name: 'Starter Pack' | 'Explorer Pack' | 'Treasure Pack';
  description: string;
  icon: 'zap' | 'compass' | 'map';
  recommended: boolean;
};

export function tokenPackPresentation(uses: number): TokenPackPresentation {
  if (uses === 10) {
    return {
      name: 'Starter Pack',
      description: 'For occasional saves and quick finds.',
      icon: 'zap',
      recommended: false,
    };
  }
  if (uses === 30) {
    return {
      name: 'Explorer Pack',
      description: 'For regular saving and trip planning.',
      icon: 'compass',
      recommended: true,
    };
  }
  return {
    name: 'Treasure Pack',
    description: 'Built for bigger trips and heavy saving.',
    icon: 'map',
    recommended: false,
  };
}

export function placeFindBalanceLabel(available: number): string {
  const count = Math.max(0, Math.floor(available));
  return `${count} ${count === 1 ? 'token' : 'tokens'}`;
}

