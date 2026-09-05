// @ts-nocheck -- Supabase Edge/Deno runtime.
import {
  premiumRequestsEnabledForEnvironment,
  type PremiumRequestsEnvironment,
} from '../../../lib/premiumRequestsPolicy.ts';

const NEARR_DEV_PROJECT_REF = 'qnfxnmvxpjzfydgudtvs';
const NEARR_PRODUCTION_PROJECT_REF = 'rlqvxdwtetxsqxhqztkw';

function projectRef(url: string): string | null {
  try {
    return new URL(url).hostname.split('.')[0] || null;
  } catch {
    return null;
  }
}

function serverEnvironment(): PremiumRequestsEnvironment {
  const ref = projectRef(Deno.env.get('SUPABASE_URL') ?? '');
  if (ref === NEARR_DEV_PROJECT_REF) return 'development';
  if (ref === NEARR_PRODUCTION_PROJECT_REF) return 'production';
  return 'unknown';
}

/** Canonical server policy. Unknown projects fail closed. */
export function premiumRequestsEnabled(): boolean {
  return premiumRequestsEnabledForEnvironment({
    configured: Deno.env.get('PREMIUM_REQUESTS_ENABLED'),
    environment: serverEnvironment(),
  });
}
