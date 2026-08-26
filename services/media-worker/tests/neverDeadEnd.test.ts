import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyRecognitionFinalResult } from '../src/pipeline/recognitionOutcome.js';
import { parseEvidenceWithDiagnostics } from '../src/types/evidence.js';

const explicit = (value: string) => [{ timestampSeconds: 1, source: 'visible_text', value }];
const malformed = (overrides: Record<string, unknown> = {}) => ({
  name: '',
  category: 'park',
  categoryConfidence: 0.8,
  categoryEvidenceTags: ['outdoor'],
  address: null,
  city: null,
  region: null,
  country: 'Portugal',
  coordinates: { lat: 88, lng: 177 },
  role: 'primary',
  confidence: 0.7,
  explicitEvidence: explicit('Portugal'),
  inferredEvidence: [],
  memoryCue: null,
  memoryCueEvidence: [],
  ...overrides,
});
const envelope = (places: unknown[]) => ({
  places,
  multipleIntentionalPlaces: false,
  insufficientEvidence: false,
  warnings: [],
});

test('1 invalid name does not discard valid country', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([malformed()]));
  assert.equal(parsed.evidence.places.length, 0);
  assert.equal(parsed.evidence.partialPlaces?.[0]?.country, 'Portugal');
});

test('2 invalid name does not discard valid category', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([malformed()]));
  assert.equal(parsed.evidence.partialPlaces?.[0]?.category, 'park');
  assert.equal(parsed.diagnostics.partialPreserved, 1);
});

test('4 partial evidence survives validation as review-only, never canonical', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([malformed()]));
  assert.equal(parsed.evidence.insufficientEvidence, false);
  assert.equal(parsed.evidence.places.length, 0);
  assert.deepEqual(parsed.evidence.partialPlaces?.[0]?.explicitEvidence, explicit('Portugal'));
  assert.equal(classifyRecognitionFinalResult({ evidence: parsed.evidence }).outcome, 'partial_evidence');
});

test('5 technical failure is not insufficient evidence', () => {
  const parsed = parseEvidenceWithDiagnostics('not-an-envelope');
  assert.deepEqual(classifyRecognitionFinalResult({
    evidence: parsed.evidence,
    parseDiagnostics: parsed.diagnostics,
    recognitionFailureClass: 'model_schema_invalid',
  }), {
    outcome: 'failed',
    resultClass: 'technical_failure',
    failureCode: 'recognition_recovery_exhausted',
  });
});

test('6 empty Sol recovery preserves an existing partial result', () => {
  const parsed = parseEvidenceWithDiagnostics(envelope([malformed()]));
  assert.equal(classifyRecognitionFinalResult({
    evidence: parsed.evidence,
    recognitionFailureClass: 'recovery_empty',
  }).outcome, 'partial_evidence');
});

test('11 genuine no evidence becomes insufficient evidence', () => {
  const parsed = parseEvidenceWithDiagnostics({
    places: [], multipleIntentionalPlaces: false, insufficientEvidence: true, warnings: [],
  });
  assert.equal(classifyRecognitionFinalResult({ evidence: parsed.evidence }).outcome, 'insufficient_evidence');
});

test('model-authored partialPlaces are ignored', () => {
  const parsed = parseEvidenceWithDiagnostics({
    places: [],
    partialPlaces: [{
      nameHint: 'Injected', category: 'park', categoryConfidence: 1,
      categoryEvidenceTags: [], addressHint: null, city: null, region: null,
      country: null, role: 'primary', confidence: 1,
      explicitEvidence: explicit('Injected'), validationErrors: [],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  });
  assert.deepEqual(parsed.evidence.partialPlaces, []);
});
