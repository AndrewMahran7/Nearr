import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  decisionForPlausibleCandidates,
  decisionForSelectionSemantics,
} from '../supabase/functions/process-share-jobs/ambiguityReview';
import {
  evaluateMediaAutoSave,
  mediaReviewDecision,
} from '../supabase/functions/process-share-jobs/mediaAutoSaveGate';
import { evaluateMetadataAutoSave } from '../supabase/functions/process-share-jobs/metadataAutoSaveGate';
import { recognitionCacheDecision } from '../supabase/functions/process-share-jobs/recognitionCache';
import type { MentionResult } from '../supabase/functions/process-share-link/resolver/nameDrivenResolver';
import type { VenueMention } from '../supabase/functions/process-share-jobs/mediaMentions';
import {
  classifyUnresolvedText,
  confirmationMode,
} from '../lib/vayrinCandidateConfirmation';
import { rankContextAwareCandidates } from '../lib/contextAwarePlacesResolution';
import {
  evaluateCachedSingletonAutoSave,
  rerankCachedCandidatePayload,
} from '../supabase/functions/process-share-jobs/contextAwareCacheReranking';

function canonical(overrides: Record<string, unknown> = {}) {
  return {
    googlePlaceId: 'google-parlor',
    name: 'Parlor Woodfire',
    formattedAddress: '123 Main St, Los Angeles, CA 90001, USA',
    latitude: 34.05,
    longitude: -118.24,
    primaryType: 'restaurant',
    types: ['restaurant', 'establishment'],
    businessStatus: 'OPERATIONAL',
    confidenceScore: 0.91,
    reasons: ['business_type', 'strong_name_match', 'state_match'],
    ...overrides,
  };
}

function metadata(candidates: unknown[], evidence: Record<string, unknown> = {}) {
  return evaluateMetadataAutoSave({
    result: { decision: 'candidate_confirmation', cleanSearchQuery: 'Parlor Woodfire', candidates },
    evidence,
  });
}

function mention(overrides: Partial<VenueMention> = {}): VenueMention {
  return {
    id: 'm1',
    displayName: 'Parlor Woodfire',
    normalizedName: 'parlor woodfire',
    distinctiveTokens: ['parlor', 'woodfire'],
    category: 'restaurant',
    sources: ['speech'],
    nameEvidenceSources: ['speech'],
    timestamps: [1],
    mentionCount: 1,
    repeated: false,
    confidence: 0.95,
    geo: { city: 'Los Angeles', region: 'California', country: 'United States' },
    identityEvidenceKind: 'observable',
    ...overrides,
  };
}

function mediaResult(overrides: Partial<MentionResult> = {}): MentionResult {
  const candidate = canonical();
  return {
    mentionId: 'm1',
    displayName: 'Parlor Woodfire',
    outcome: 'verified_single',
    query: 'Parlor Woodfire Los Angeles California',
    candidates: [candidate as any],
    scoring: [{
      googlePlaceId: candidate.googlePlaceId,
      name: candidate.name,
      rawScore: 100,
      normalizedScore: 0.91,
      reasons: ['business_type', 'strong_name_match', 'distinctive_token_match', 'state_match'],
      rejected: false,
      rejectionReason: null,
    }],
    ...overrides,
  };
}

function check(name: string, run: () => void): void {
  run();
  console.log(`PASS ${name}`);
}

check('1 zero viable candidates never auto-save', () => {
  assert.equal(metadata([]).eligible, false);
  assert.equal(decisionForPlausibleCandidates(0).decision, 'manual_fallback');
});

check('2 one strong canonical candidate auto-saves', () => {
  const decision = metadata([canonical()]);
  assert.equal(decision.plausibleCandidateCount, 1);
  assert.equal(decision.viableCandidateCount, 1);
  assert.equal(decision.independentQualityGatePassed, true);
  assert.equal(decision.eligible, true);
  assert.equal(decisionForPlausibleCandidates(1, !decision.eligible).decision, 'auto_save');
});

check('3 one weak lone survivor remains confirmation', () => {
  const decision = metadata([canonical({ reasons: ['business_type'], confidenceScore: 0.5 })]);
  assert.equal(decision.plausibleCandidateCount, 1);
  assert.equal(decision.viableCandidateCount, 0);
  assert.equal(decision.eligible, false);
  assert.deepEqual(decision.reasonCodes, ['weak_singleton']);
  assert.equal(decisionForPlausibleCandidates(1, !decision.eligible).decision, 'candidate_confirmation');
});

check('4 one broad region is AREA MATCH and never exact auto-save', () => {
  const supai = canonical({
    googlePlaceId: 'google-supai',
    name: 'Supai',
    formattedAddress: 'Supai, AZ 86435, USA',
    primaryType: 'locality',
    types: ['locality', 'political'],
  });
  const decision = metadata([supai]);
  assert.equal(decision.eligible, false);
  assert.ok(decision.candidateRejectionReasons.includes('provider_entity_not_saveable'));
  assert.equal(confirmationMode([supai as any]), 'broad');
});

check('5 raw textual leads stay search-only before canonical resolution', () => {
  assert.equal(classifyUnresolvedText('Worlds Most Dangerous Waterfall Hole', 'text'), 'TEXTUAL_LEAD');
  assert.equal(metadata([]).selectedProviderId, null);
});

check('6 two canonical candidates remain confirmation', () => {
  const decision = metadata([canonical(), canonical({ googlePlaceId: 'google-parlor-2' })]);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reasonCodes[0], 'multiple_plausible_candidates');
  assert.equal(decisionForPlausibleCandidates(2).autoSave, false);
});

check('7 duplicate aliases collapse to one strong canonical identity', () => {
  const decision = metadata([
    canonical({ name: 'Parlor Woodfire' }),
    canonical({ name: 'The Parlor Woodfire' }),
  ]);
  assert.equal(decision.rawCandidateCount, 2);
  assert.equal(decision.plausibleCandidateCount, 1);
  assert.equal(decision.eligible, true);
});

check('8 rejected raw candidates do not weaken an independently strong survivor', () => {
  const decision = metadata([
    canonical(),
    canonical({ googlePlaceId: 'weak-reviewable', name: 'Nearby Business', reasons: ['business_type'], confidenceScore: 0.5 }),
    canonical({ googlePlaceId: 'broad-area', primaryType: 'locality', types: ['locality', 'political'] }),
  ]);
  assert.equal(decision.rawCandidateCount, 3);
  assert.equal(decision.plausibleCandidateCount, 2);
  assert.equal(decision.viableCandidateCount, 1);
  assert.equal(decision.independentQualityGatePassed, true);
  assert.equal(decision.eligible, true);
});

check('9 strong V3 CONTRADICTS rejects and never auto-saves', () => {
  const contradicted = mediaResult({
    outcome: 'rejected_insufficient_evidence',
    candidates: [],
    scoring: [{
      googlePlaceId: 'google-parlor', name: 'Parlor Woodfire', rawScore: -100,
      normalizedScore: 0, reasons: ['v3_strong_contradicts'], rejected: true,
      rejectionReason: 'v3_strong_contradicts',
    }],
  });
  const gate = evaluateMediaAutoSave({ mention: mention(), result: contradicted, allResults: [contradicted] });
  assert.equal(gate.eligible, false);
  assert.equal(gate.plausibleCandidateCount, 0);
});

check('10 UNKNOWN-heavy V3 singleton remains confirmation-only', () => {
  const gate = evaluateMediaAutoSave({
    mention: mention({ identityEvidenceKind: 'model_prior' }),
    result: mediaResult(),
    allResults: [mediaResult()],
  });
  assert.equal(gate.eligible, false);
  assert.ok(gate.reasonCodes.includes('model_prior_unverified'));
});

check('11 already-saved singleton reuses and enriches the canonical save path', () => {
  const source = readFileSync(resolve(process.cwd(), 'supabase/functions/process-share-link/save.ts'), 'utf8');
  assert.match(source, /reused:\s*true/);
  assert.match(source, /attachSavedPlaceSource/);
  assert.match(source, /SAVE_DUPLICATE_SOURCE_URL_REUSED/);
});

check('12 CANDIDATE_SET cache singleton saves only after rerank and safety gate', () => {
  const row = {
    id: 'cache-1', identity_key: 'instagram:post:1', platform: 'instagram', content_id: '1',
    canonical_url: 'https://instagram.com/reel/1', identity_version: 1,
    recognition_version: 'vayrin-recognition-2026-08-22.v1', result_type: 'candidate_set' as const,
    trust_level: 'CANDIDATE_SET' as const, canonical_place_id: null,
    candidate_payload: { candidates: [canonical()] }, invalidated_at: null,
  };
  assert.equal(recognitionCacheDecision(row, row.recognition_version).kind, 'candidate_set');
  assert.equal(decisionForSelectionSemantics(1, 'single_identity', true).decision, 'candidate_confirmation');
  const stale = rerankCachedCandidatePayload(row.candidate_payload)!;
  assert.equal(evaluateCachedSingletonAutoSave(stale).eligible, false);
  const contextual = rerankCachedCandidatePayload({
    ...row.candidate_payload,
    selectionMode: 'single_identity',
    recognitionContext: {
      locality: 'Los Angeles', region: 'CA', country: 'USA',
      coordinates: { lat: 34.05, lng: -118.24 }, confidence: 'exact',
      sourceKind: 'exact_source_evidence',
    },
  })!;
  assert.equal(evaluateCachedSingletonAutoSave(contextual).eligible, true);
});

check('13 context-aware reranking singleton still passes the quality gate', () => {
  const ranked = rankContextAwareCandidates({
    query: 'Parlor Woodfire',
    candidates: [
      canonical(),
      canonical({ googlePlaceId: 'duplicate-closed', businessStatus: 'CLOSED_PERMANENTLY' }),
    ],
    context: {
      mode: 'source', inferredCoordinates: { lat: 34.05, lng: -118.24 },
      inferredLocality: 'Los Angeles', inferredRegion: 'California', inferredCountry: 'United States',
      regionConfidence: 'strong', expectedCategory: 'restaurant', sourceEvidence: ['creator_caption_geo'],
      videoGeoHints: [], nearbyResolvedMentions: [], userLocation: null, manualExpansionRequested: false,
    },
  });
  assert.equal(ranked.visible.length, 1);
  assert.equal(metadata([ranked.visible[0]!.candidate]).eligible, true);
  assert.equal(metadata([{ ...ranked.visible[0]!.candidate, reasons: ['business_type'] }]).eligible, false);
});

check('14 multi-place applies singleton logic per mention without cross-slot corruption', () => {
  const first = mediaResult();
  const second = mediaResult({ mentionId: 'm2', displayName: 'Second Place' });
  second.candidates[0] = canonical({ googlePlaceId: 'google-second-a', name: 'Second Place' }) as any;
  second.scoring[0] = {
    ...second.scoring[0]!, googlePlaceId: 'google-second-a', name: 'Second Place', normalizedScore: 0.92,
  };
  second.candidates.push(canonical({ googlePlaceId: 'google-second-b', name: 'Second Place Downtown' }) as any);
  second.scoring.push({
    ...second.scoring[0]!, googlePlaceId: 'google-second-b', name: 'Second Place Downtown', normalizedScore: 0.9,
  });
  const firstGate = evaluateMediaAutoSave({ mention: mention(), result: first, allResults: [first, second] });
  const secondGate = evaluateMediaAutoSave({
    mention: mention({ id: 'm2', displayName: 'Second Place', normalizedName: 'second place', distinctiveTokens: ['second', 'place'] }),
    result: second,
    allResults: [first, second],
  });
  assert.equal(firstGate.eligible, true);
  assert.equal(secondGate.eligible, false);
  assert.equal(mediaReviewDecision([second]), 'multi_candidate_confirmation');
});

check('15 singleton auto-save retains current canonical save/source/cache semantics', () => {
  const worker = readFileSync(resolve(process.cwd(), 'supabase/functions/process-share-jobs/index.ts'), 'utf8');
  assert.match(worker, /auto_save_share_job_place_result/);
  assert.match(worker, /saveForUser\(\{/);
  assert.match(worker, /attachSavedPlaceSource\(\{/);
  assert.match(worker, /trust:\s*'VERIFIED_AUTO_SAVE'/);
  assert.doesNotMatch(worker, /singleton[^\n]{0,80}(?:insert|upsert)/i);
});

check('16 Supai region fixture cannot silently become an exact POI', () => {
  const supai = canonical({
    googlePlaceId: 'google-supai', name: 'Supai', formattedAddress: 'Supai, AZ, USA',
    primaryType: 'locality', types: ['locality', 'political'],
  });
  assert.equal(metadata([supai]).eligible, false);
  assert.equal(confirmationMode([supai as any]), 'broad');
});

check('17 raw In-N-Out name never auto-saves before canonical resolution', () => {
  assert.equal(classifyUnresolvedText('In-N-Out', 'identity'), 'RAW_NAME');
  assert.equal(metadata([]).eligible, false);
});

check('V3 SUPPORTS may enter the normal gate but does not bypass it', () => {
  const media = mediaResult();
  assert.equal(evaluateMediaAutoSave({ mention: mention(), result: media, allResults: [media] }).eligible, true);
});

console.log('All Vayrin singleton auto-save deterministic cases passed.');
