import Constants from 'expo-constants';

import { getAppEnvironment } from '@/lib/appEnvironment';
import { premiumRequestsEnabledForEnvironment } from '@/lib/premiumRequestsPolicy';

function extraValue(key: string): string {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  return typeof extra[key] === 'string' ? (extra[key] as string) : '';
}

/** Canonical client policy for every new Premium surface and initiation. */
export function premiumRequestsEnabled(): boolean {
  return premiumRequestsEnabledForEnvironment({
    configured:
      process.env.EXPO_PUBLIC_PREMIUM_REQUESTS_ENABLED ||
      extraValue('premiumRequestsEnabled'),
    environment: getAppEnvironment(),
  });
}
