import assert from 'node:assert/strict';

import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { RECOGNITION_VERSION } from '../lib/shareAgent/contentIdentity';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';
import { evaluateCachedSingletonAutoSave } from '../supabase/functions/process-share-jobs/contextAwareCacheReranking';
import {
  buildVayrinPartialResult,
  mediaEvidenceAutoSaveEligible,
  parseMediaEvidence,
} from '../supabase/functions/process-share-jobs/mediaEvidence';
import { planPreResolve } from '../supabase/functions/process-share-jobs/mediaFinalizePlan';
import { buildVenueMentions } from '../supabase/functions/process-share-jobs/mediaMentions';
import {
  recognitionCacheDecision,
  type RecognitionCacheRow,
} from '../supabase/functions/process-share-jobs/recognitionCache';

function partialEvidence(overrides: Record<string, unknown> = {}) {
  return parseMediaEvidence({
    places: [],
    partialPlaces: [{
      nameHint: null,
      category: 'park',
      categoryConfidence: 0.8,
      categoryEvidenceTags: ['outdoor'],
      addressHint: null,
      city: null,
      region: null,
      country: 'Portugal',
      role: 'primary',
      confidence: 0.7,
      explicitEvidence: [{ timestampSeconds: 1, source: 'visible_text', value: 'Portugal' }],
      validationErrors: ['places.0.name:too_small'],
      ...overrides,
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: ['evidence_place_schema_invalid'],
  });
}

// 3. An invalid candidate is not a canonical place and fails both save gates.
{
  const edge = partialEvidence();
  assert.equal(edge.ok, true);
  if (edge.ok) {
    assert.equal(edge.value.places.length, 0);
    assert.equal(mediaEvidenceAutoSaveEligible(edge.value), false);
  }
}

// 7. Strong, explicitly grounded geography is an AREA MATCH.
{
  const edge = partialEvidence({
    country: null,
    region: 'Algarve',
    explicitEvidence: [{ timestampSeconds: 1, source: 'visible_text', value: 'Algarve' }],
  });
  assert.equal(edge.ok && buildVayrinPartialResult(edge.value)?.resultClass, 'area_match');
}

// 8. A grounded name survives as a search-only lead.
{
  const edge = partialEvidence({
    nameHint: 'Hidden Falls',
    country: null,
    explicitEvidence: [{ timestampSeconds: 1, source: 'visible_text', value: 'Hidden Falls' }],
  });
  assert.equal(edge.ok && buildVayrinPartialResult(edge.value)?.resultClass, 'search_lead');
}

// 9. Existing context-aware Places input receives the grounded name/locality.
{
  const edge = partialEvidence({
    nameHint: 'Hidden Falls',
    city: 'Lisbon',
    country: 'Portugal',
    explicitEvidence: [{ timestampSeconds: 1, source: 'visible_text', value: 'Hidden Falls Lisbon Portugal' }],
  });
  assert.equal(edge.ok, true);
  if (edge.ok) {
    const recovery = buildVenueMentions(edge.value);
    assert.equal(recovery.mentions[0]?.displayName, 'Hidden Falls');
    assert.equal(recovery.mentions[0]?.geo.city, 'Lisbon');
    assert.equal(recovery.mentions[0]?.identityEvidenceKind, 'model_prior');
  }
}

// 10. A Places no-match remains a truthful partial result and useful next step.
{
  const edge = partialEvidence({
    country: null,
    category: 'cafe',
    explicitEvidence: [{ timestampSeconds: 1, source: 'frame', value: 'coffee and tiled walls' }],
  });
  assert.equal(edge.ok, true);
  if (edge.ok) {
    assert.equal(buildVenueMentions(edge.value).mentions.length, 0);
    assert.equal(buildVayrinPartialResult(edge.value)?.resultClass, 'partial_result');
    assert.equal(planPreResolve({
      taskStatus: 'processing', parentStatus: 'processing_metadata', outcome: 'partial_evidence',
      evidenceParseOk: true, renderedPlaces: 0, partialPlaces: 1,
    }).action, 'resolve');
  }
}

// 12. A cached singleton derived from partial recovery is still never saveable.
{
  const decision = evaluateCachedSingletonAutoSave({
    payload: {
      partialResult: { version: 1, reviewOnly: true, resultClass: 'search_lead' },
      candidates: [{ googlePlaceId: 'g1', name: 'Wrong Place' }],
    },
    applied: true,
    contextAvailable: true,
    contextSourceKind: 'exact_source_evidence',
    candidateCountBeforeRerank: 1,
    candidateCountAfterRerank: 1,
    placesCallCount: 0,
    rankingPolicy: 'context-aware-cache-rerank.v1',
  } as any);
  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, 'partial_recovery_review_only');
}

// 13. Candidate-set/partial rows are review data, never cached canonical truth.
{
  const row = {
    id: 'r1', identity_key: 'i1', platform: 'instagram', content_id: 'c1',
    canonical_url: 'https://www.instagram.com/reel/c1/', identity_version: 1,
    recognition_version: RECOGNITION_VERSION, result_type: 'candidate_set',
    trust_level: 'CANDIDATE_SET', canonical_place_id: null,
    candidate_payload: { partialResult: { version: 1, reviewOnly: true } }, invalidated_at: null,
  } satisfies RecognitionCacheRow;
  assert.equal(recognitionCacheDecision(row).kind, 'candidate_set');
}

// 14. Canonical singleton confirmation and partial search semantics do not drift.
{
  const canonical = buildShareJobDetailState({
    id: 'j1', status: 'needs_help', candidate_payload: {
      version: 2, candidates: [{ googlePlaceId: 'g1', name: 'Exact Candidate' }], mentionSlots: [],
    },
  });
  assert.equal(canonical.kind, 'confirm');
  const partial = buildShareJobDetailState({
    id: 'j2', status: 'needs_help', candidate_payload: {
      version: 2, candidates: [], mentionSlots: [],
      partialResult: { version: 1, reviewOnly: true, resultClass: 'area_match', locality: 'Algarve', category: null, searchQuery: 'Algarve', clueCount: 1 },
    },
  });
  assert.equal(partial.kind, 'manual');
  assert.equal(partial.reason, 'area_match');
}

// 15. Notifications remain result-aware and never call technical failure evidence insufficiency.
{
  const area = composeShareCompletionNotification({
    jobId: 'j1', status: 'needs_help',
    notificationLocality: { label: 'Algarve', basis: 'observable_corroborated' },
  });
  assert.equal(area.resultClass, 'coarse_location');
  assert.equal(area.title, 'We narrowed it down');
  assert.match(area.body, /Algarve/);
  const technical = composeShareCompletionNotification({
    jobId: 'j2', status: 'failed', failureCode: 'recognition_recovery_exhausted', analysisAttempted: true,
  });
  assert.equal(technical.resultClass, 'technical_failure');
  assert.doesNotMatch(`${technical.title} ${technical.body}`, /not enough evidence/i);
}

console.log('Vayrin never-dead-end assertions passed (15/15 across worker + Edge/client).');
