export const PLACE_FIND_FREE_LIFETIME_USES = 5;

export type PlaceFindPack = {
  key: 'small' | 'medium' | 'large';
  uses: 10 | 25 | 50;
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
    uses: 25,
    mockProductId: 'dev.mock.nearr.place_finds.25',
    mockDisplayPrice: '$8.99',
    mockPriceCents: 899,
  },
  {
    key: 'large',
    uses: 50,
    mockProductId: 'dev.mock.nearr.place_finds.50',
    mockDisplayPrice: '$15.99',
    mockPriceCents: 1599,
  },
] as const;

export type PlaceFindPriceSource = 'storekit' | 'dev_mock_config';

export function placeFindBalanceLabel(available: number): string {
  const count = Math.max(0, Math.floor(available));
  return `${count} place ${count === 1 ? 'find' : 'finds'} left`;
}

