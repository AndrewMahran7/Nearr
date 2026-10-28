/** Explicit server release mode, independent of temporary store availability.
 * This policy does not grant AI eligibility or user consent. */
export type PlusReleaseMode = 'paid' | 'free_only' | 'unavailable';
export function plusReleasePolicy(config: Record<string, unknown>) {
  const freeOnly = config.release_mode === 'free_only' && config.release_qualified === true
    && config.enforce_allowance === true && config.sales_enabled === false && config.free_finds === 3;
  // Missing mode is the legacy paid configuration, never an implicit free launch.
  const paidQualified = (config.release_mode === undefined || config.release_mode === 'paid')
    && config.release_qualified === true && config.catalog_verified === true
    && typeof config.revenuecat_app_id === 'string' && config.revenuecat_app_id.trim().length > 0;
  return { mode: (freeOnly ? 'free_only' : paidQualified ? 'paid' : 'unavailable') as PlusReleaseMode,
    freeOnly, paidQualified };
}
/** Missing/contradictory network fields must not advertise a qualified free plan. */
export function isFreeOnlyPlusStatus(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const status = value as Record<string, any>;
  return status.releaseMode === 'free_only' && status.salesEnabled === false
    && status.purchaseEligible === false && status.restoreAvailable === false
    && status.appUserId === null && status.entitlement === null && status.freeFinds === 3
    && status.usage?.limit === 3 && status.usage?.enforced === true;
}
