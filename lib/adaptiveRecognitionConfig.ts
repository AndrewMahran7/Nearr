/** Opt-in experiment switches. The absent configuration is the production baseline. */
export type AdaptiveRecognitionConfig = {
  version: 1;
  taxonomyCompatibility: boolean;
  literalSourceStreet: boolean;
  legacyTenantIdentity?: boolean;
  deepRecoveryNewEvidenceOnly?: boolean;
  closedSignalVocabulary?: boolean;
  atomicMultiPlace?: boolean;
  legacyParentCategoryVeto?: boolean;
  emptyEvidenceReview?: boolean;
};

export const BASELINE_ADAPTIVE_CONFIG: Readonly<AdaptiveRecognitionConfig> = Object.freeze({
  version: 1, taxonomyCompatibility: false, literalSourceStreet: false,
});

export function parseAdaptiveRecognitionConfig(value?: unknown): AdaptiveRecognitionConfig {
  if (value === undefined) return { ...BASELINE_ADAPTIVE_CONFIG };
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_adaptive_config');
  const v = value as Record<string, unknown>;
  if (Object.keys(v).some((k) => !['version', 'taxonomyCompatibility', 'literalSourceStreet', 'legacyTenantIdentity', 'deepRecoveryNewEvidenceOnly', 'closedSignalVocabulary', 'atomicMultiPlace', 'legacyParentCategoryVeto', 'emptyEvidenceReview'].includes(k)) ||
      v.version !== 1 || typeof v.taxonomyCompatibility !== 'boolean' || typeof v.literalSourceStreet !== 'boolean' ||
      (v.legacyTenantIdentity !== undefined && typeof v.legacyTenantIdentity !== 'boolean') ||
      ['deepRecoveryNewEvidenceOnly', 'closedSignalVocabulary', 'atomicMultiPlace', 'legacyParentCategoryVeto', 'emptyEvidenceReview'].some((key) => v[key] !== undefined && typeof v[key] !== 'boolean')) {
    throw new Error('invalid_adaptive_config');
  }
  return { version: 1, taxonomyCompatibility: v.taxonomyCompatibility, literalSourceStreet: v.literalSourceStreet,
    ...(v.legacyTenantIdentity !== undefined ? { legacyTenantIdentity: v.legacyTenantIdentity } : {}),
    ...(v.deepRecoveryNewEvidenceOnly !== undefined ? { deepRecoveryNewEvidenceOnly: v.deepRecoveryNewEvidenceOnly as boolean } : {}),
    ...(v.closedSignalVocabulary !== undefined ? { closedSignalVocabulary: v.closedSignalVocabulary as boolean } : {}),
    ...(v.atomicMultiPlace !== undefined ? { atomicMultiPlace: v.atomicMultiPlace as boolean } : {}),
    ...(v.emptyEvidenceReview !== undefined ? { emptyEvidenceReview: v.emptyEvidenceReview as boolean } : {}),
    ...(v.legacyParentCategoryVeto !== undefined ? { legacyParentCategoryVeto: v.legacyParentCategoryVeto as boolean } : {}) };
}
