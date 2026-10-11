/** Differential controls against frozen pre-extraction Edge statements. No real media or labels. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildShareJobCandidatePayload } from '../lib/shareJobResult';
import { nativeNearrPlaceId, planAutomaticCompletion } from '../lib/automaticCompletion';
import { evaluateGeographyAutoSave, sourceGeographyFromTaggedLocation } from '../lib/geographyConsistency';
import { evaluateMediaAutoSave, MEDIA_AUTO_SAVE_RULE_VERSION } from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import { mediaEvidenceExactIdentityStrength, mediaEvidenceAutoSaveEligible, renderMediaEvidenceCaption } from '../supabase/functions/process-share-jobs/mediaEvidence';
import { buildVenueMentions } from '../supabase/functions/process-share-jobs/mediaMentions';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { mergeMediaCaption } from '../supabase/functions/process-share-jobs/mediaSourceMetadata';
import { planFromResolverDecision } from '../supabase/functions/process-share-jobs/decisionMapping';
import { planPostResolve } from '../supabase/functions/process-share-jobs/mediaFinalizePlan';
import { automaticDeepCandidates, premiumRuntimePlan, planAutomaticDeepFinalization,
  planMediaMentionFinalization, planLegacyMediaFinalization, prepareMediaResolverInput,
  planMediaFinalization } from '../supabase/functions/process-share-jobs/mediaFinalizationPlanner';

const fixture = JSON.parse(readFileSync('scripts/fixtures/mediaFinalizationBeforeExtraction.json', 'utf8'));
assert.equal(fixture.sourceSha256, 'c88121fa96f43200e42ff35318416f3e5a3764f4d45bebfbad2f2bea70fc569d');
const dependencies = { buildShareJobCandidatePayload, nativeNearrPlaceId, planAutomaticCompletion,
  evaluateMediaAutoSave, MEDIA_AUTO_SAVE_RULE_VERSION, mediaEvidenceExactIdentityStrength,
  mediaEvidenceAutoSaveEligible, planFromResolverDecision, planPostResolve,
  recognitionGeographyDecision: ({ job, candidate, decisiveIndependentEvidence }: any) =>
    evaluateGeographyAutoSave({ source: job.sourceGeography, candidate, decisiveIndependentEvidence }),
};
const code = `${fixture.safeCandidate}\n${fixture.runtime}\n${fixture.automaticDeepCandidates}
function mention(mention, mentionResult, mentionResults, autoSaveAuthorized, mediaRunId, job) {
  ${fixture.mention}
  return {gate, blockingReasons, candidate, geography, mayAutoSave};
}
function legacy(result, parsed, job) {
  ${fixture.legacy}
  return {plan, legacyExactIdentityStrength, legacyMediaCompletion, legacyCandidate, legacyGeography, post};
}
function deep(automaticDeep, job) {
  const mentionSlots = automaticDeep.candidatePayload.mentionSlots ?? [];
  ${fixture.deep}
    return {completion, geography: automaticDeepGeography, mayAutoSave: true};
  }
  return {completion, geography: automaticDeepGeography, mayAutoSave: false};
}
return {mention, legacy, deep, premiumRuntimePlan, automaticDeepCandidates};`;
const oracle = new Function(...Object.keys(dependencies), ts.transpileModule(code, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText)(...Object.values(dependencies));

// A network call during any planner invocation is a test failure.
const previousFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('Synthetic planner tests must not use the network'); };
let parityChecks = 0;
const normalized = (value: any) => JSON.parse(JSON.stringify(value));
function compare(actual: any, expected: any, label: string) {
  const copy = { ...actual };
  delete copy.blockedOutcome;
  for (const key of ['geography', 'legacyGeography']) {
    if (copy[key]) { copy[key] = { ...copy[key] }; delete copy[key].input; }
  }
  assert.deepEqual(normalized(copy), normalized(expected), label);
  parityChecks++;
}
function candidate(id = 'synthetic-a', extra: any = {}) {
  return { googlePlaceId: id, name: 'Copper Finch', latitude: 10, longitude: 20,
    formattedAddress: '123 Example Street, Example City', types: ['restaurant'],
    confidenceScore: .97, evidence: [], reasons: [], ...extra };
}
function mention(id = 'm1', extra: any = {}) {
  return { id, displayName: 'Copper Finch', normalizedName: 'copper finch',
    distinctiveTokens: ['copper', 'finch'], category: 'restaurant', sources: ['speech'],
    nameEvidenceSources: ['speech'], timestamps: [1], mentionCount: 1, repeated: false,
    confidence: .97, geo: { city: null, region: null, country: null }, ...extra };
}
function mentionResult(id = 'm1', c = candidate(), extra: any = {}) {
  return { mentionId: id, displayName: c.name, outcome: 'verified_single', query: c.name,
    candidates: [c], scoring: [{ googlePlaceId: c.googlePlaceId, name: c.name,
      rawScore: 100, normalizedScore: .97,
      reasons: ['business_type', 'compact_name_match', 'distinctive_token_match'],
      rejected: false, rejectionReason: null }], ...extra };
}
function evidence(extra: any = {}, placeExtra: any = {}) {
  return { places: [{ name: 'Copper Finch', category: 'restaurant', address: null,
    city: null, region: null, country: null, coordinates: null, role: 'primary',
    confidence: .97, explicitEvidence: [{ source: 'speech', value: 'Copper Finch', timestampSeconds: 1 }],
    inferredEvidence: [], ...placeExtra }], multipleIntentionalPlaces: false,
    insufficientEvidence: false, warnings: [], ...extra } as any;
}
function result(candidates = [candidate()], extra: any = {}) {
  return { decision: 'auto_save', safeToAutoSave: true, primaryCandidate: candidates[0],
    candidates, diagnostics: {}, cleanSearchQuery: 'Copper Finch', ...extra };
}
const far = sourceGeographyFromTaggedLocation({ taggedLocation: {
  placeName: 'Synthetic opposite region', latitude: -30, longitude: -60, confidence: 'high',
}, granularity: 'exact_place' });
const near = sourceGeographyFromTaggedLocation({ taggedLocation: {
  placeName: 'Synthetic nearby location', latitude: 10, longitude: 20, confidence: 'high',
}, granularity: 'exact_place' });

try {
  const scenarios: Array<[string, any, any, any[]?]> = [
    ['source named', mention(), mentionResult()],
    ['missing mention', undefined, mentionResult()],
    ['model prior', mention('m1', { identityEvidenceKind: 'model_prior' }), mentionResult()],
    ['creator only', mention('m1', { creatorHandleEvidenceOnly: true }), mentionResult()],
    ['unresolved identity', mention('m1', { identityAlternatives: [mention('alt')] }), mentionResult()],
    ['provider failure', mention(), mentionResult('m1', candidate(), { outcome: 'provider_error', candidates: [], scoring: [] })],
    ['no match', mention(), mentionResult('m1', candidate(), { outcome: 'no_match', candidates: [], scoring: [] })],
    ['duplicate canonical', mention(), mentionResult(), [mentionResult(), mentionResult('m2')]],
    ['invalid coordinates', mention(), mentionResult('m1', candidate('a', { latitude: null }))],
    ['address decisive', mention(), mentionResult('m1', candidate(), { scoring: [{ googlePlaceId: 'synthetic-a', name: 'Copper Finch', normalizedScore: .97, rawScore: 100, reasons: ['address_verified', 'business_type', 'compact_name_match'], rejected: false }] })],
  ];
  for (const [label, m, mr, all] of scenarios) for (const sourceGeography of [null, near, far]) {
    for (const autoSaveAuthorized of [false, true]) for (const auditRecordPresent of [false, true]) {
      compare(planMediaMentionFinalization({ mention: m, mentionResult: mr, mentionResults: all ?? [mr],
        sourceGeography, context: { autoSaveAuthorized, auditRecordPresent } }),
      oracle.mention(m, mr, all ?? [mr], autoSaveAuthorized, auditRecordPresent ? 'audit-id' : null, { sourceGeography }), label);
    }
  }
  const evidences = [evidence(), evidence({ multipleIntentionalPlaces: true }), evidence({ insufficientEvidence: true }),
    evidence({}, { identityEvidenceKind: 'model_prior' }), evidence({}, { confidence: .3 }),
    evidence({}, { category: null }), evidence({}, { address: '123 Example Street', explicitEvidence: [{ source: 'visible_text', value: '123 Example Street' }] }),
    evidence({ places: [] })];
  for (const ev of evidences) for (const sourceGeography of [null, near, far]) {
    for (const rr of [result(), result([], { decision: 'manual_fallback' }),
      result([candidate(), candidate('b')], { decision: 'candidate_picker', safeToAutoSave: false }),
      result([candidate('a', { reasons: ['address_verified'] })]),
      result([candidate('a', { reasons: ['semantic_contradiction'] })]),
      result([candidate()], { decision: 'candidate_confirmation', safeToAutoSave: false })]) {
      compare(planLegacyMediaFinalization({ ordinaryResult: rr, groundedEvidence: ev, sourceGeography }),
        oracle.legacy(rr, { value: ev }, { sourceGeography }), 'legacy combinations');
    }
  }
  function runtime(decision: string, extra: any = {}, hypothesisExtra: any = {}) {
    return { schemaVersion: 1, outcome: 'PREMIUM_ACTIONABLE_RESULT', destinations: [{
      logicalDestinationId: 'synthetic-destination', decision,
      hypotheses: [{ name: 'Copper Finch', confidence: 'HIGH', evidenceBasis: 'EXPLICIT_SOURCE_NAME',
        canonicalStatus: 'VERIFIED', canonical: candidate(), ...hypothesisExtra }],
    }], ...extra };
  }
  const runtimes = [null, {}, { schemaVersion: 1 }, runtime('AUTO_SAVE'), runtime('REVIEW'), runtime('REJECT'),
    runtime('AUTO_SAVE', {}, { canonical: null, providerParent: candidate('parent') }),
    runtime('AUTO_SAVE', {}, { canonical: candidate('a', { latitude: null }) }),
    runtime('AUTO_SAVE', { destinations: [runtime('AUTO_SAVE').destinations[0], { ...runtime('AUTO_SAVE').destinations[0], logicalDestinationId: 'second' }] }),
    runtime('AUTO_SAVE', {}, { evidenceBasis: 'CONTEXTUAL_OR_MEMORY_PRIOR', confidence: 'LOW' }),
    runtime('NO_MATCH', { outcome: 'PREMIUM_NO_USEFUL_RESULT' }),
    runtime('AUTO_SAVE', { destinations: Array.from({ length: 12 }, (_, n) => ({ ...runtime('AUTO_SAVE').destinations[0], logicalDestinationId: `d${n}` })) }),
  ];
  for (const raw of runtimes) {
    const plan = premiumRuntimePlan(raw);
    assert.deepEqual(normalized(plan), normalized(oracle.premiumRuntimePlan(raw)), 'runtime normalization parity'); parityChecks++;
    if (!plan) continue;
    assert.deepEqual(normalized(automaticDeepCandidates(plan)), normalized(oracle.automaticDeepCandidates(plan)), 'deep candidates parity'); parityChecks++;
    for (const sourceGeography of [null, near, far]) compare(planAutomaticDeepFinalization({ runtimePlan: plan, sourceGeography }), oracle.deep(plan, { sourceGeography }), 'automatic deep');
  }

  // Product-level controls check the evaluation wrapper, not just extracted bodies.
  const context = { autoSaveAuthorized: true, auditRecordPresent: true };
  const base = { groundedEvidence: evidence(), sourceGeography: null, context };
  const deepReview = planMediaFinalization({ ...base, automaticDeepRuntime: runtime('REVIEW') });
  assert.equal(deepReview.autonomousPlaces.length, 0, 'upstream REVIEW survives candidate conversion');
  assert.equal(deepReview.status, 'needs_help');
  const deepMulti = planMediaFinalization({ ...base, automaticDeepRuntime: runtimes[8] });
  assert.equal(deepMulti.autonomousPlaces.length, 0, 'current deep multi policy stays review-only');
  assert.equal(deepMulti.multiPlaceDetected, true);
  const m1 = mention(), m2 = mention('m2', { displayName: 'Amber Steps', normalizedName: 'amber steps', distinctiveTokens: ['amber', 'steps'] });
  const r1 = mentionResult(), r2 = mentionResult('m2', candidate('synthetic-b', { name: 'Amber Steps' }));
  const namedInput = { ...base, mediaMentions: { mentions: [m1, m2], geoContext: {}, relationships: [], partialMentions: 0 } as any,
    ordinaryResult: result([r1.candidates[0], r2.candidates[0]], { diagnostics: { mentionResults: [r1, r2] } }) };
  const multi = planMediaFinalization(namedInput);
  assert.equal(multi.status, 'auto_save');
  assert.deepEqual(multi.autonomousPlaces.map((p) => p.logicalResultId), ['m1', 'm2']);
  assert.equal(multi.multiPlaceDetected, true);
  const disabled = planMediaFinalization({ ...namedInput, context: { ...context, autoSaveAuthorized: false } });
  assert.equal(disabled.autonomousPlaces.length, 0);
  assert.equal(disabled.reviewCandidates.length, 2);
  const mixed = planMediaFinalization({ ...namedInput, mediaMentions: { ...namedInput.mediaMentions, mentions: [m1] } });
  assert.equal(mixed.status, 'needs_help'); assert.equal(mixed.autonomousPlaces.length, 1);
  assert.equal(mixed.reviewCandidates[0].googlePlaceId, 'synthetic-b');
  const prior = planMediaFinalization({ ...base, groundedEvidence: evidence({}, { identityEvidenceKind: 'model_prior' }), ordinaryResult: result() });
  assert.equal(prior.autonomousPlaces.length, 0);
  assert.equal(planMediaFinalization({ ...base, automaticDeepRuntime: {} }).status, 'invalid');
  assert.equal(planMediaFinalization({ ...base, automaticDeepRuntime: runtime('NO_MATCH', { outcome: 'PREMIUM_NO_USEFUL_RESULT' }) }).status, 'retry');
  // The existing legacy route does not consult the mention-lane flag or audit gate.
  assert.equal(planMediaFinalization({ ...base, context: { autoSaveAuthorized: false, auditRecordPresent: false }, ordinaryResult: result() }).status, 'auto_save');
  const before = JSON.stringify(namedInput); planMediaFinalization(namedInput);
  assert.equal(JSON.stringify(namedInput), before, 'planner does not mutate input');

  for (const sourceMetadata of [null, { title: 'Synthetic visit', description: 'Copper Finch @copperfinch', creatorHandle: 'synthetic_author', creatorName: 'Synthetic Author' } as any]) {
    const ev = evidence();
    const prepared = prepareMediaResolverInput({ platform: 'tiktok', groundedEvidence: ev, sourceMetadata });
    const rendered = renderMediaEvidenceCaption(ev);
    const handles = sourceMetadata ? extractHandles({ platform: 'tiktok', title: sourceMetadata.title, description: sourceMetadata.description, html: null, knownPosterHandle: sourceMetadata.creatorHandle })
      : { posterHandle: null, taggedHandles: [], venueHandles: [], posterNameHint: null };
    const merged = mergeMediaCaption(sourceMetadata, rendered);
    assert.deepEqual(prepared, { rendered, handles, mediaEvidence: extractEvidence({ platform: 'tiktok', title: merged.title, description: merged.description, handles, taggedLocation: null, creatorName: sourceMetadata?.creatorName ?? null }), mediaMentions: buildVenueMentions(ev) });
  }
  const worker = readFileSync('supabase/functions/process-share-jobs/index.ts', 'utf8');
  for (const fn of ['planAutomaticDeepFinalization', 'planMediaMentionFinalization', 'planLegacyMediaFinalization', 'prepareMediaResolverInput']) assert.match(worker, new RegExp(`${fn}\\(\\{`));
  assert.doesNotMatch(worker, /function (premiumRuntimePlan|automaticDeepCandidates|safeCandidate)\(/);
  console.log(`PASS media finalization extraction: ${parityChecks} differential synthetic controls plus routing, preparation and immutability checks`);
} finally { globalThis.fetch = previousFetch; }
