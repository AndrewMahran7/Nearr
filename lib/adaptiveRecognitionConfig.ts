/** Opt-in experiment switches. The absent configuration is the production baseline. */
export type AdaptiveRecognitionConfig = {
  version: 1;
  taxonomyCompatibility: boolean;
  literalSourceStreet: boolean;
  legacyTenantIdentity?: boolean;
};

export const BASELINE_ADAPTIVE_CONFIG: Readonly<AdaptiveRecognitionConfig> = Object.freeze({
  version: 1, taxonomyCompatibility: false, literalSourceStreet: false,
});

export function parseAdaptiveRecognitionConfig(value?: unknown): AdaptiveRecognitionConfig {
  if (value === undefined) return { ...BASELINE_ADAPTIVE_CONFIG };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_adaptive_config');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['version', 'taxonomyCompatibility', 'literalSourceStreet', 'legacyTenantIdentity'].includes(k)) ||
      v.version !== 1 || typeof v.taxonomyCompatibility !== 'boolean' || typeof v.literalSourceStreet !== 'boolean' ||
      (v.legacyTenantIdentity !== undefined && typeof v.legacyTenantIdentity !== 'boolean')) {
    throw new Error('invalid_adaptive_config');
  }
  return { version: 1, taxonomyCompatibility: v.taxonomyCompatibility, literalSourceStreet: v.literalSourceStreet,
    ...(v.legacyTenantIdentity !== undefined ? { legacyTenantIdentity: v.legacyTenantIdentity } : {}) };
}
