/** Local deterministic policy controls, NOT labeled recognition videos. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { planAutomaticCompletion } from '../lib/automaticCompletion';
import { planNamedLeadAutomaticRecovery } from '../lib/namedLeadAutomaticRecovery';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import { evaluateMediaAutoSave } from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import { evaluateGeographyAutoSave, sourceGeographyFromCaptionText } from '../lib/geographyConsistency';
import { classifyTaggedAccounts } from '../lib/entityRolePolicy';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { planPreResolve } from '../supabase/functions/process-share-jobs/mediaFinalizePlan';
import { resolveRecognitionCachePolicy, recognitionCachePolicyForRun } from '../supabase/functions/_shared/recognitionCachePolicy';

export const PRODUCTION_SHA = 'e9daf499cfb276ea7072b651642a04218b90ccf9';
export type SafetyReplayRow = { caseId: string; kind: 'synthetic_policy_control'; production: string | null; repaired: string; expected: string; passed: boolean };
function productionModule(file: string): any {
  const source = execFileSync('git', ['show', `${PRODUCTION_SHA}:${file}`], { encoding: 'utf8' });
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const sandbox = { exports: {} };
  vm.runInNewContext(output, sandbox, { timeout: 1000, filename: `${PRODUCTION_SHA}/${file}` });
  return sandbox.exports;
}
export function runSafetyReplays(): SafetyReplayRow[] {
  const legacyAutomatic = productionModule('lib/automaticCompletion.ts').planAutomaticCompletion;
  const legacyNamed = productionModule('lib/namedLeadAutomaticRecovery.ts').planNamedLeadAutomaticRecovery;
  const rows: SafetyReplayRow[] = [];
  const check = (caseId: string, actual: unknown, expected: unknown, old: unknown = null) => {
    assert.equal(actual, expected, caseId);
    rows.push({ caseId, kind: 'synthetic_policy_control', production: old === null ? null : String(old), repaired: String(actual), expected: String(expected), passed: true });
  };
  const candidate = (id = 'synthetic-a', extra: Record<string, unknown> = {}) => ({
    googlePlaceId: id, name: 'Example Restaurant', formattedAddress: '123 Main St, Los Angeles, CA, USA',
    latitude: 34.05, longitude: -118.24, types: ['restaurant'], businessStatus: 'OPERATIONAL',
    confidenceScore: 0.97, reasons: ['business_type', 'compact_name_match', 'state_match'], ...extra,
  });
  for (const [name, candidates, expected] of [
    ['plausibility_is_not_identity', [candidate()], 'escalate'],
    ['review_stays_review', [candidate('a', { exactIdentityStrength: 'candidate_bound', upstreamSafetyDecision: 'REVIEW' })], 'escalate'],
    ['reject_stays_reject', [candidate('a', { exactIdentityStrength: 'candidate_bound', upstreamSafetyDecision: 'REJECT' })], 'escalate'],
    ['same_name_branches_need_review', [candidate('a', { exactIdentityStrength: 'source_named' }), candidate('b')], 'escalate'],
    ['unique_caption_name_remains_automatic', [candidate('a', { exactIdentityStrength: 'source_named' })], 'save'],
    ['unique_bound_address_remains_automatic', [candidate('a', { exactIdentityStrength: 'candidate_bound' }), candidate('b')], 'save'],
    ['two_bound_addresses_cannot_choose_branch', [candidate('a', { exactIdentityStrength: 'candidate_bound' }), candidate('b', { exactIdentityStrength: 'candidate_bound' })], 'escalate'],
    ['semantic_contradiction_rejected', [candidate('a', { exactIdentityStrength: 'candidate_bound', reasons: ['source_entity_semantic_conflict'] })], 'escalate'],
    ['broad_area_not_exact_place', [candidate('a', { types: ['locality'], exactIdentityStrength: 'source_named' })], 'escalate'],
  ] as const) {
    check(name, planAutomaticCompletion(candidates as any).action, expected, legacyAutomatic(candidates).action);
  }
  const lead = { mentionId: 'one', displayName: 'Example Restaurant', contextLabel: 'Los Angeles', evidenceKind: 'observable' as const,
    confidence: 0.99, upstreamSafetyDecision: 'AUTO_SAVE' as const, timestamps: [1, 3], suggestedQuery: 'Example Restaurant Los Angeles', resultType: 'RAW_NAME' as const };
  for (const status of ['needs_help', 'failed', 'cancelled', 'completed', 'processing_metadata']) {
    const input = { jobId: 'synthetic-job', status, savedPlaceId: null, leads: [lead] };
    check(`named_lead_status_${status}`, planNamedLeadAutomaticRecovery(input).length, status === 'needs_help' ? 1 : 0, legacyNamed(input).length);
  }
  const reviewLead = { jobId: 'synthetic-job', status: 'needs_help', savedPlaceId: null, leads: [{ ...lead, confidence: .35, upstreamSafetyDecision: 'REVIEW' as const }] };
  check('review_lead_not_promoted_by_singleton', planNamedLeadAutomaticRecovery(reviewLead).length, 0, legacyNamed(reviewLead).length);
  const meta = (c: any[], evidence: any = {}) => evaluateMetadataAutoSave({ result: { decision: 'candidate_confirmation', candidates: c }, evidence }).eligible;
  check('metadata_singleton_without_identity', meta([candidate()]), false);
  check('metadata_exact_address', meta([candidate()], { address: { raw: '123 Main St' } }), true);
  check('metadata_same_address_wrong_tenant', meta([candidate('parent', { name: 'Example Shopping Center', reasons: ['business_type', 'address_verified'] })], { address: { raw: '123 Main St' }, venueNameHints: ['Example Restaurant'] }), false);
  const mention: any = { id: 'm1', displayName: 'Example Restaurant', normalizedName: 'example restaurant', distinctiveTokens: ['example', 'restaurant'], category: 'restaurant', sources: ['speech'], nameEvidenceSources: ['speech'], timestamps: [1], mentionCount: 1, repeated: false, confidence: .95, geo: { city: 'Los Angeles', region: 'California', country: 'United States' } };
  const result: any = { mentionId: 'm1', displayName: 'Example Restaurant', outcome: 'verified_single', candidates: [candidate()], scoring: [{ googlePlaceId: 'synthetic-a', name: 'Example Restaurant', rawScore: 100, normalizedScore: .97, reasons: ['business_type', 'compact_name_match', 'distinctive_token_match', 'state_match'], rejected: false, rejectionReason: null }] };
  const media = (m: any, r = result, all = [r]) => evaluateMediaAutoSave({ mention: m, result: r, allResults: all }).eligible;
  check('media_source_speech_positive', media(mention), true);
  check('media_model_prior_negative', media({ ...mention, identityEvidenceKind: 'model_prior' }), false);
  check('media_creator_negative', media({ ...mention, creatorHandleEvidenceOnly: true }), false);
  check('media_unresolved_sibling', media({ ...mention, identityAlternatives: [{ ...mention, displayName: 'Example Other Restaurant' }] }), false);
  check('greece_prada_country_veto', evaluateGeographyAutoSave({ source: sourceGeographyFromCaptionText('The tour made it to Greece'), candidate: candidate('prada', { name: 'Prada San Francisco', formattedAddress: 'San Francisco, CA, United States' }) }).autoSaveEligible, false);
  const mallorca: any = { version: 'recognition-geography-consistency-2026-09-14.v1', kind: 'platform_location_tag', strength: 'strong', scope: 'region', label: 'Mallorca, Spain', locality: 'Mallorca', region: null, country: 'Spain', coordinates: { lat: 39.6953, lng: 3.0176 }, provenance: ['platform_location_tag'] };
  check('mallorca_girona_region_veto', evaluateGeographyAutoSave({ source: mallorca, candidate: candidate('girona', { latitude: 42.3175, longitude: 3.3195, formattedAddress: 'Cadaques, Girona, Spain' }) }).autoSaveEligible, false);
  const role = (captionText: string) => classifyTaggedAccounts({ captionText, taggedHandles: ['brand'] })[0]!.role;
  check('sponsor_is_not_a_venue', role('Sponsored by @brand'), 'BRAND');
  check('bare_tag_is_ambiguous', role('Tour in Greece @brand'), 'AMBIGUOUS');
  check('locative_brand_store_is_a_venue', role('Dinner at @brand'), 'VENUE');
  check('failed_job_hides_confident_candidates', buildShareJobDetailState({ status: 'failed', failure_category: 'technical_failure', candidate_payload: { candidates: [candidate()] } }).candidates.length, 0);
  const pre = (status: string) => planPreResolve({ taskStatus: 'processing', parentStatus: status, outcome: 'evidence', evidenceParseOk: true, renderedPlaces: 2 }).action;
  check('failed_parent_not_finalized', pre('failed'), 'parent_already_terminal');
  check('review_parent_not_overwritten', pre('needs_help'), 'parent_already_terminal');
  check('multi_place_evidence_continues', pre('processing_metadata'), 'resolve');
  check('cache_default_suspended', resolveRecognitionCachePolicy(() => undefined).readsEnabled, false);
  check('qualification_cannot_use_answer_cache', recognitionCachePolicyForRun(resolveRecognitionCachePolicy(() => 'true'), 'qualification_fresh').readsEnabled, false);
  return rows;
}
if (require.main === module) {
  const rows = runSafetyReplays();
  const out = process.argv.indexOf('--out');
  if (out >= 0 && process.argv[out + 1]) {
    mkdirSync(dirname(process.argv[out + 1]!), { recursive: true });
    writeFileSync(process.argv[out + 1]!, JSON.stringify({ kind: 'synthetic_policy_controls_not_accuracy', productionSha: PRODUCTION_SHA, rows }, null, 2) + '\n');
  }
  console.log(`PASS ${rows.length} deterministic safety controls; ${rows.filter(row => row.production !== null && row.production !== row.repaired).length} direct Production policy differences. Not an accuracy benchmark.`);
}
