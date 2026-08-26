import assert from 'node:assert/strict';
import test from 'node:test';

import { planPreResolve } from '../../../supabase/functions/process-share-jobs/mediaFinalizePlan.js';
import {
  parseMediaEvidence,
  selectRenderablePlaces,
} from '../../../supabase/functions/process-share-jobs/mediaEvidence.js';
import { planTaskFailure } from '../src/pipeline/runMediaTask.js';
import { parseEvidenceWithDiagnostics } from '../src/types/evidence.js';
import { MediaError } from '../src/types/media.js';
import {
  isCoarseGeographicPlace,
  shouldRunVayrinFallback,
} from '../src/vayrin/visualGeolocationProvider.js';

const evidenceItem = {
  timestampSeconds: 1,
  source: 'visible_text',
  value: 'Example Pier',
} as const;

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    name: 'Example Pier',
    category: 'attraction',
    categoryConfidence: 0.9,
    categoryEvidenceTags: ['visible destination text'],
    address: null,
    city: 'Example City',
    region: 'Example Region',
    country: 'Example Country',
    coordinates: null,
    role: 'primary',
    confidence: 0.9,
    explicitEvidence: [evidenceItem],
    inferredEvidence: [],
    memoryCue: null,
    memoryCueEvidence: [],
    ...overrides,
  };
}

function envelope(places: unknown[], overrides: Record<string, unknown> = {}) {
  return {
    places,
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
    ...overrides,
  };
}

test('1: empty name reproduces places.0.name:too_small and discards the candidate', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([candidate({ name: '' })]));
  assert.deepEqual(parsed.diagnostics.rejectionPaths, ['places.0.name:too_small']);
  assert.equal(parsed.diagnostics.rejected, 1);
  assert.equal(parsed.evidence.places.length, 0);
  assert.equal(parsed.evidence.insufficientEvidence, true);
});

test('2: a provider id cannot currently rescue a missing name', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([
    candidate({ name: undefined, googlePlaceId: 'provider-id-redacted' }),
  ]));
  assert.equal(parsed.diagnostics.rejected, 1);
  assert.match(parsed.diagnostics.rejectionPaths[0] ?? '', /places\.0\.name:invalid_type/);
  assert.equal(parsed.evidence.places.length, 0);
});

test('3: address and model coordinates cannot currently rescue a missing name', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([
    candidate({
      name: undefined,
      address: '1 Example Street',
      coordinates: { lat: 1, lng: 2 },
    }),
  ]));
  assert.equal(parsed.diagnostics.rejected, 1);
  assert.equal(parsed.evidence.places.length, 0);
});

test('4: an invalid optional category rejects an otherwise valid candidate', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([
    candidate({ category: 'not-a-nearr-category' }),
  ]));
  assert.equal(parsed.diagnostics.rejected, 1);
  assert.match(parsed.diagnostics.rejectionPaths[0] ?? '', /category:invalid_enum_value/);
  assert.equal(parsed.evidence.places.length, 0);
});

test('5: evidence normalization is shape-only; an empty object value still rejects the candidate', () => {
  const shapeMalformed = parseEvidenceWithDiagnostics(envelope([
    candidate({
      explicitEvidence: [evidenceItem, 'malformed'],
      inferredEvidence: ['malformed'],
    }),
  ]));
  assert.equal(shapeMalformed.diagnostics.rejected, 0);
  assert.deepEqual(shapeMalformed.evidence.places[0]?.explicitEvidence, [evidenceItem]);
  assert.deepEqual(shapeMalformed.evidence.places[0]?.inferredEvidence, []);

  const semanticallyMalformed = parseEvidenceWithDiagnostics(envelope([
    candidate({
      explicitEvidence: [evidenceItem, { source: 'speech', value: '' }],
    }),
  ]));
  assert.equal(semanticallyMalformed.diagnostics.rejected, 1);
  assert.match(
    semanticallyMalformed.diagnostics.rejectionPaths[0] ?? '',
    /explicitEvidence\.1\.value:too_small/,
  );
  assert.equal(semanticallyMalformed.evidence.places.length, 0);
});

test('6: a valid partial candidate without explicit evidence parses but is not resolvable', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([
    candidate({ explicitEvidence: [], inferredEvidence: [evidenceItem] }),
  ]));
  assert.equal(parsed.diagnostics.accepted, 1);
  const edge = parseMediaEvidence(parsed.evidence);
  assert.equal(edge.ok, true);
  if (!edge.ok) return;
  assert.equal(selectRenderablePlaces(edge.value).length, 0);
  assert.deepEqual(planPreResolve({
    taskStatus: 'processing',
    parentStatus: 'processing_metadata',
    outcome: 'evidence',
    evidenceParseOk: true,
    renderedPlaces: 0,
  }), {
    action: 'manual_fallback',
    failureCode: 'insufficient_evidence',
    taskTerminalStatus: 'needs_help',
    supplemental: false,
  });
});

test('7: invalid JSON/top-level output is structurally distinct from genuine empty evidence', () => {
  assert.throws(() => JSON.parse('{"places":['), SyntaxError);
  const parsed = parseEvidenceWithDiagnostics('{"places":[');
  assert.equal(parsed.diagnostics.topLevelInvalid, true);
  assert.deepEqual(parsed.evidence.warnings, ['evidence_schema_invalid']);
});

test('8: a provider timeout retries before becoming a technical terminal failure', () => {
  const error = new MediaError('provider_unavailable', 'test_timeout');
  const retry = planTaskFailure(
    error,
    { attempts: 1, max_attempts: 3 },
    { retryBaseSeconds: 2, retryMaxSeconds: 30 },
    () => 0,
  );
  assert.equal(retry.action, 'requeue');
  const exhausted = planTaskFailure(
    error,
    { attempts: 3, max_attempts: 3 },
    { retryBaseSeconds: 2, retryMaxSeconds: 30 },
    () => 0,
  );
  assert.deepEqual(exhausted, { action: 'finalize', outcome: 'failed' });
});

test('9: an exhausted Places/provider failure remains technical, not insufficient evidence', () => {
  assert.deepEqual(planPreResolve({
    taskStatus: 'processing',
    parentStatus: 'processing_metadata',
    outcome: 'failed',
    failureCode: 'provider_unavailable',
    evidenceParseOk: false,
    renderedPlaces: 0,
  }), {
    action: 'manual_fallback',
    failureCode: 'provider_unavailable',
    taskTerminalStatus: 'failed',
    supplemental: false,
  });
});

test('10: genuine empty evidence is accepted without a validation rejection', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([], { insufficientEvidence: true }));
  assert.equal(parsed.diagnostics.topLevelInvalid, false);
  assert.equal(parsed.diagnostics.rejected, 0);
  assert.equal(parsed.evidence.insufficientEvidence, true);
  assert.equal(parsed.evidence.places.length, 0);
});

test('11: weak region-only evidence is preserved but escalates as coarse geography', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([
    candidate({
      name: 'Example Region',
      city: null,
      region: 'Example Region',
      explicitEvidence: [{ ...evidenceItem, value: 'Example Region' }],
    }),
  ]));
  const place = parsed.evidence.places[0];
  assert.ok(place);
  assert.equal(isCoarseGeographicPlace(place), true);
  assert.deepEqual(shouldRunVayrinFallback({
    enabled: true,
    frameCount: 6,
    insufficientEvidence: false,
    explicitPlaceCount: 1,
    geographicOnlyPlaceCount: 1,
  }), { run: true, reason: 'only_coarse_geography' });
});

test('12: one malformed sibling does not erase another valid candidate', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([
    candidate(),
    candidate({ name: '', role: 'secondary' }),
  ], { multipleIntentionalPlaces: true }));
  assert.equal(parsed.diagnostics.accepted, 1);
  assert.equal(parsed.diagnostics.rejected, 1);
  assert.equal(parsed.evidence.places.length, 1);
  assert.equal(parsed.evidence.insufficientEvidence, false);
});
