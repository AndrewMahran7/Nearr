/**
 * Pure Premium Request availability policy shared by app and Edge runtimes.
 *
 * New Premium initiation is enabled by default in development/preview and
 * disabled by default in production/unknown environments. An explicit boolean
 * flag is authoritative, which makes re-enabling a configuration-only change.
 */

export type PremiumRequestsEnvironment =
  | 'development'
  | 'preview'
  | 'production'
  | 'unknown';

export const PREMIUM_REQUESTS_SUSPENDED_REASON = 'premium_requests_suspended';

function configuredBoolean(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return null;
}

export function premiumRequestsEnabledForEnvironment(args: {
  configured?: unknown;
  environment: PremiumRequestsEnvironment;
}): boolean {
  const configured = configuredBoolean(args.configured);
  if (configured !== null) return configured;
  return args.environment === 'development' || args.environment === 'preview';
}
