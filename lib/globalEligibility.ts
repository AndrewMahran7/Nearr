import policy from '../config/global-eligibility-policy.json';

export type AgeBand = 'under_13' | '13' | '14' | '15' | '16_17' | '18_plus';
export type EligibilityStatus = 'eligible' | 'under_minimum' | 'region_unavailable' | 'revoked';
export type EligibilityDeclaration = { ageBand: AgeBand; countryCode: string };
export const ELIGIBILITY_POLICY = policy;
export const AGE_BANDS: readonly AgeBand[] = ['under_13', '13', '14', '15', '16_17', '18_plus'];
const lowerBound: Record<AgeBand, number> = { under_13: 0, '13': 13, '14': 14, '15': 15, '16_17': 16, '18_plus': 18 };

/** Offline explanation only. This can never authorize a backend operation. */
export function assessDeclaration(input: EligibilityDeclaration): { status: EligibilityStatus; minimumAge: number | null } {
  if (!AGE_BANDS.includes(input.ageBand)) return { status: 'under_minimum', minimumAge: 13 };
  if (input.ageBand === 'under_13') return { status: 'under_minimum', minimumAge: 13 };
  const region = policy.regions[input.countryCode as keyof typeof policy.regions];
  if (!region) return { status: 'region_unavailable', minimumAge: null };
  return { status: lowerBound[input.ageBand] >= region.minimumAge ? 'eligible' : 'under_minimum', minimumAge: region.minimumAge };
}

export function isDeclaration(value: unknown): value is EligibilityDeclaration {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<EligibilityDeclaration>;
  return typeof item.countryCode === 'string' && /^[A-Z]{2}$/.test(item.countryCode) && AGE_BANDS.includes(item.ageBand as AgeBand);
}
