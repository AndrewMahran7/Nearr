import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { classifyTaggedAccounts } from '../lib/entityRolePolicy';
import {
  evaluateGeographyAutoSave,
  sourceGeographyFromCaptionText,
} from '../lib/geographyConsistency';
import {
  RECOGNITION_LONG_RUNNING_MS,
  recognitionQueueLabel,
  recognitionQueueState,
} from '../lib/recognitionQueueState';
import { buildShareJobDetailState } from '../lib/shareJobDetailState';
import { routeShareJobNotification } from '../lib/shareJobRouting';
import {
  candidateMatchStrength,
  reviewSelectionMode,
  toggleCandidateSelection,
} from '../lib/vayrinCandidateConfirmation';
import { extractHandles } from '../supabase/functions/process-share-link/evidence/handleExtraction';
import { extractEvidence } from '../supabase/functions/process-share-link/evidence/extractEvidence';
import { buildQueryPlan } from '../supabase/functions/process-share-link/resolver/queryBuilder';
import {
  scoreCandidates,
  toResolvedCandidate,
} from '../supabase/functions/process-share-link/resolver/placeScoring';
import { composeShareCompletionNotification } from '../supabase/functions/process-share-jobs/shareCompletionNotification';

const pradaSf = {
  googlePlaceId: 'prada-sf',
  name: 'Prada San Francisco Neiman Marcus',
  formattedAddress: '150 Stockton St, San Francisco, CA, United States',
  latitude: 37.787,
  longitude: -122.406,
  types: ['store', 'point_of_interest', 'establishment'],
};

function evidence(description: string, knownPosterHandle = 'creator') {
  const handles = extractHandles({
    platform: 'instagram',
    title: null,
    description,
    html: null,
    knownPosterHandle,
  });
  return extractEvidence({ platform: 'instagram', title: null, description, handles });
}

function pass(name: string, run: () => void): void {
  run();
  console.log(`PASS ${name}`);
}

pass('TEST 1 brand tag + unrelated geography', () => {
  const ev = evidence('Tour made it to Greece. Sponsored by @brand');
  assert.equal(ev.placeNameRole, 'BRAND');
  const scored = scoreCandidates([pradaSf], ev, 'Brand', null)[0]!;
  assert.ok(scored.score < 25);
  assert.ok(scored.reasons.includes('non_location_entity_text_only'));
});

pass('TEST 2 explicit venue mention', () => {
  const ev = evidence('Dinner at @loadedcafe');
  assert.equal(ev.placeNameRole, 'VENUE');
  const candidate = { ...pradaSf, googlePlaceId: 'loaded', name: 'Loaded Cafe' };
  assert.ok(scoreCandidates([candidate], ev, 'Loaded Cafe', null)[0]!.score >= 55);
});

pass('TEST 3 brand store genuinely depicted', () => {
  const ev = extractEvidence({
    platform: 'instagram',
    title: null,
    description: 'Sponsored by @brand',
    handles: extractHandles({
      platform: 'instagram', title: null, description: 'Sponsored by @brand', html: null, knownPosterHandle: 'creator',
    }),
    taggedLocation: {
      placeName: 'Brand Aoyama', address: 'Tokyo, Japan', latitude: 35.66, longitude: 139.71,
      sourceType: 'tagged_location', sourcePlatform: 'instagram',
      confidence: 'high', provenance: 'instagram_location_tag', sourceLocationId: 'tag-1', rawText: null,
    },
  });
  const candidate = { ...pradaSf, googlePlaceId: 'brand-aoyama', name: 'Brand Aoyama', formattedAddress: 'Tokyo, Japan' };
  assert.ok(scoreCandidates([candidate], ev, 'Brand', null)[0]!.score >= 49);
});

pass('TEST 4 country contradiction', () => {
  const source = sourceGeographyFromCaptionText('The tour made it to Greece');
  assert.equal(source?.country, 'Greece');
  assert.equal(evaluateGeographyAutoSave({ source, candidate: pradaSf }).status, 'CONTRADICTORY');
  assert.equal(evaluateGeographyAutoSave({ source, candidate: pradaSf }).autoSaveEligible, false);
});

pass('TEST 5 ambiguous entity', () => {
  const ev = evidence('The tour made it to Greece @brand');
  assert.equal(ev.placeNameRole, 'AMBIGUOUS');
  const resolved = toResolvedCandidate(scoreCandidates([pradaSf], ev, 'Brand', null)[0]!, ev.keys);
  assert.notEqual(candidateMatchStrength({ ...resolved, matchScore: resolved.confidenceScore }), 'high');
});

pass('TEST 6 failed media + weak text candidates', () => {
  const detail = buildShareJobDetailState({
    status: 'failed', decision: 'failed', failure_category: 'technical_failure', failure_code: 'processing_error',
    candidate_payload: { candidates: [{ ...pradaSf, matchScore: 0.92 }] },
  });
  assert.equal(detail.kind, 'manual');
  assert.equal(detail.candidates.length, 0);
  assert.equal(detail.failureCategory, 'technical_failure');
});

pass('TEST 7 review-ready job', () => {
  const note = composeShareCompletionNotification({ status: 'needs_help', jobId: 'job-7', candidateCount: 2 });
  assert.equal(note.resultClass, 'multiple_candidates');
  assert.equal(note.data.type, 'share_job_needs_help');
});

pass('TEST 8 true failure', () => {
  const note = composeShareCompletionNotification({
    status: 'failed', jobId: 'job-8', candidateCount: 2, failureCategory: 'technical_failure', failureCode: 'processing_error',
  });
  assert.equal(note.resultClass, 'technical_failure');
  assert.equal(note.data.type, 'share_job_needs_help');
});

pass('TEST 9 stale needs-review notification tap', () => {
  assert.deepEqual(routeShareJobNotification({
    type: 'share_job_needs_help', jobId: 'job-9', reviewMode: 'single', savedPlaceId: 'stale-snapshot',
  }), { kind: 'queue_item', jobId: 'job-9' });
});

pass('TEST 10 stale failure notification tap', () => {
  assert.deepEqual(routeShareJobNotification({
    type: 'share_job_needs_help', jobId: 'job-10', failureCategory: 'technical_failure',
  }), { kind: 'queue_item', jobId: 'job-10' });
});

pass('TEST 11 early speculative candidate geography', () => {
  const queueSource = readFileSync('app/share-jobs/index.tsx', 'utf8');
  assert.match(queueSource, /isProcessing\s*\?\s*sourceGeographyLabel\(retainedSourceGeography\)/s);
  assert.doesNotMatch(queueSource, /const locality = splitPlaceAddress\(firstCandidate\?\.formattedAddress\)\.locality/);
});

pass('TEST 12 long-running state', () => {
  const state = recognitionQueueState({ status: 'processing_metadata', progressStage: 'analyzing_media', ageMs: RECOGNITION_LONG_RUNNING_MS });
  assert.equal(state, 'taking_longer');
  assert.match(recognitionQueueLabel(state), /You can leave Nearr/);
});

pass('TEST 13 Priority-1 geography protection', () => {
  const source = {
    version: 'recognition-geography-consistency-2026-09-14.v1' as const,
    kind: 'platform_location_tag' as const,
    strength: 'strong' as const,
    scope: 'locality' as const,
    label: 'Mallorca, Spain', locality: 'Mallorca', region: null, country: 'Spain',
    coordinates: { lat: 39.6, lng: 2.9 }, provenance: ['platform_tag'],
  };
  const girona = { ...pradaSf, formattedAddress: 'Girona, Spain', latitude: 41.98, longitude: 2.82 };
  assert.equal(evaluateGeographyAutoSave({ source, candidate: girona }).autoSaveEligible, false);
});

pass('TEST 14 user selection authority', () => {
  assert.deepEqual(toggleCandidateSelection([], 'chosen', 'exclusive'), ['chosen']);
  assert.deepEqual(toggleCandidateSelection(['other'], 'chosen', 'exclusive'), ['chosen']);
});

pass('TEST 15 multi-place remains supported', () => {
  assert.equal(reviewSelectionMode([
    { candidates: [{ ...pradaSf }], identityHypotheses: [] },
    { candidates: [{ ...pradaSf, googlePlaceId: 'other' }], identityHypotheses: [] },
  ]), 'multiple');
});

pass('FOUNDER REPLAY (offline)', () => {
  const ev = evidence('The Pump Foil tour made it to Greece 🇬🇷 @prada @redbull @redbullgre');
  assert.equal(ev.captionGeography?.country, 'Greece');
  assert.equal(ev.placeNameRole, 'AMBIGUOUS');
  assert.ok(buildQueryPlan(ev).queries.every((query) => /Greece/i.test(query)));
  const scored = scoreCandidates([pradaSf], ev, 'Prada', null)[0]!;
  assert.ok(scored.score < 25);
  assert.equal(evaluateGeographyAutoSave({ source: ev.captionGeography, candidate: pradaSf }).status, 'CONTRADICTORY');
});

pass('LATENCY INSTRUMENTATION CONTRACT', () => {
  const edge = readFileSync('supabase/functions/process-share-jobs/index.ts', 'utf8');
  const worker = readFileSync('services/media-worker/src/pipeline/runMediaTask.ts', 'utf8');
  const migration = readFileSync('supabase/migrations/20260914000002_recognition_entity_role_latency_state.sql', 'utf8');
  assert.match(edge, /event:\s*'recognition_stage_timing'/);
  assert.match(worker, /recognition_stage_timing/);
  assert.match(edge, /evidence_snapshot:\s*\[\]/);
  assert.match(edge, /source_geography:\s*sourceGeography/);
  assert.match(migration, /source_geography jsonb/);
  assert.match(edge, /permanentContractError/);
});

console.log('Recognition entity-role, latency, and authoritative-state regression: 15/15 PASS');
