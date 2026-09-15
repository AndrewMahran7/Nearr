import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  evaluateGeographyAutoSave,
  evaluateGeographyConsistency,
  type SourceGeographyEvidence,
  GEOGRAPHY_CONSISTENCY_POLICY_VERSION,
} from '../lib/geographyConsistency';
import { planNamedLeadAutomaticRecovery } from '../lib/namedLeadAutomaticRecovery';

const source = (overrides: Partial<SourceGeographyEvidence> = {}): SourceGeographyEvidence => ({
  version: GEOGRAPHY_CONSISTENCY_POLICY_VERSION,
  kind: 'platform_location_tag',
  strength: 'strong',
  scope: 'region',
  label: 'Mallorca, Balearic Islands, Spain',
  locality: 'Mallorca',
  region: 'Balearic Islands',
  country: 'spain',
  coordinates: { lat: 39.6952629, lng: 3.0175712 },
  provenance: ['instagram_location_tag', 'provider_verified'],
  ...overrides,
});
const mallorca = {
  googlePlaceId: 'mallorca', name: 'Mallorca place',
  formattedAddress: 'Mallorca, Balearic Islands, Spain', latitude: 39.69, longitude: 3.01,
};
const girona = {
  googlePlaceId: 'girona', name: 'Sa coua de l infern',
  formattedAddress: 'Cadaques, Girona, Spain', latitude: 42.3174853, longitude: 3.3194587,
};

// 1. Same-area candidates remain eligible.
assert.equal(evaluateGeographyAutoSave({ source: source(), candidate: mallorca }).resolutionReason, 'geography_supported');
// 2. Cross-region candidates beyond the 200 km regional boundary are contradictory.
assert.equal(evaluateGeographyConsistency({ source: source(), candidate: girona }).status, 'CONTRADICTORY');
// 3. The founder Mallorca -> Girona regression cannot auto-save.
assert.equal(evaluateGeographyAutoSave({ source: source(), candidate: girona }).autoSaveEligible, false);
// 4. A verified exact identity may explicitly override geography.
assert.equal(evaluateGeographyAutoSave({ source: source(), candidate: girona, decisiveIndependentEvidence: true }).resolutionReason,
  'geography_conflict_decisive_override');
// 5. A vague creator/profile hint is not a hard gate.
assert.equal(evaluateGeographyConsistency({ source: source({ kind: 'creator_profile', strength: 'weak' }), candidate: girona }).status,
  'UNKNOWN');
// 6. An explicit address uses the tighter locality boundary.
assert.equal(evaluateGeographyConsistency({ source: source({ kind: 'explicit_address', scope: 'exact_place' }), candidate: girona }).distanceLimitKm, 75);
// 7. Country mismatch is contradictory for a strong source.
assert.equal(evaluateGeographyConsistency({ source: source({ coordinates: null }), candidate: {
  ...girona, formattedAddress: 'Cadaques, Girona, France',
} }).reason, 'strong_source_country_conflict');
// 8. Missing geography preserves existing behavior.
assert.equal(evaluateGeographyAutoSave({ source: null, candidate: girona }).autoSaveEligible, true);

const decisiveLead = {
  mentionId: 'one', displayName: 'Exact venue', contextLabel: 'Mallorca, Spain',
  evidenceKind: 'observable' as const, confidence: 0.91, upstreamSafetyDecision: 'AUTO_SAVE' as const,
  timestamps: [1, 2], suggestedQuery: 'Exact venue Mallorca Spain', resultType: 'RAW_NAME' as const,
};
// 9. Review is sticky: a weak lead cannot be promoted by a later singleton lookup.
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'needs_help', savedPlaceId: null,
  leads: [{ ...decisiveLead, confidence: 0.35, upstreamSafetyDecision: 'REVIEW' }] }).length, 0);
// 10. A decisive upstream identity remains eligible for bounded recovery.
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'needs_help', savedPlaceId: null,
  leads: [decisiveLead] }).length, 1);
// 11. A terminal/out-of-order result cannot restart automatic recovery.
assert.equal(planNamedLeadAutomaticRecovery({ jobId: 'job', status: 'completed', savedPlaceId: 'saved',
  leads: [decisiveLead] }).length, 0);

const edge = readFileSync('supabase/functions/process-share-jobs/index.ts', 'utf8');
const worker = readFileSync('services/media-worker/src/pipeline/runMediaTask.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20260914000001_recognition_geography_state_consistency.sql', 'utf8');
const card = readFileSync('components/CandidateConfirmationCard.tsx', 'utf8');
// 12. Source geography crosses both queue boundaries and is applied on all auto-save families.
assert.match(edge, /evidence_snapshot: \[\]/);
assert.match(edge, /source_geography: sourceGeography/);
assert.match(worker, /retainedSourceGeographyLabel\(task\.source_geography\)/);
assert.match(worker, /media\.metadataLocation \?\? retainedMetadataLocation/);
for (const path of ['premium', 'automatic_deep', 'media_mention', 'legacy_media', 'metadata',
  'recognition_cache_v2', 'recognition_cache_candidate_set', 'recognition_cache_trusted']) {
  assert.match(edge, new RegExp(`path: '${path}'`));
}
// 13. The DB is authoritative and updates aggregate, slot, ledger, and saved state together.
for (const contract of ["'{candidates}'", "'{mentionSlots}'", "'saveState'", "'savedPlaceId'",
  'share_job_place_results', "'resolutionReason'"]) assert.match(migration, new RegExp(contract));
assert.match(migration, /upstreamSafetyDecision'='AUTO_SAVE'/);
assert.match(migration, /confidence'\)::numeric,0\) >= 0\.9/);
// 14. UI ranking language cannot call a low-confidence candidate the best match.
assert.match(card, /startsWith\('Low'\) \? 'Possible match' : 'Best match'/);

console.log('recognition geography and authoritative state contracts: 14 cases ok');
