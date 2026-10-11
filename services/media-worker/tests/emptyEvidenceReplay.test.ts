import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyEvidenceReplayObservation } from '../src/evaluation/emptyEvidenceReplay.js';

function fixture() {
  return { autonomous: false, places: [], candidates: [{ name: 'later review lead' }], status: 'review',
    cost_usd: .12, provider_ledger_complete: true, elapsed_ms: 1000,
    entries: [{ operation: 'gemini_generate', status: 'complete', http_status: 200,
      dispatch_attempted: true, cost_usd: .02, request_sha256: 'cheap-prefix' },
    { operation: 'openai_responses', status: 'complete', http_status: 200,
      dispatch_attempted: true, cost_usd: .1, request_sha256: 'deep-suffix' }],
    inference_evidence: { normal_model_evidence: { places: [], partialPlaces: [],
      insufficientEvidence: true, multipleIntentionalPlaces: false },
    model_parse_diagnostics: { emitted: 0, accepted: 0, rejected: 0, topLevelInvalid: false,
      partialPreserved: 0, validationErrorClass: 'none' } } };
}

test('empty-prefix replay excludes later candidates/cost while retaining all original latency and immutable parent', () => {
  const original = fixture(), before = structuredClone(original);
  const result = emptyEvidenceReplayObservation(original);
  assert.equal(result.stopped, true);
  assert.equal(result.observation.status, 'review');
  assert.deepEqual(result.observation.candidates, []);
  assert.equal(result.observation.provider_calls, 1);
  assert.equal(result.observation.cost_usd, .02);
  assert.equal(result.observation.provider_usage[0].measurement, 'retained');
  assert.ok(result.observation.elapsed_ms >= original.elapsed_ms);
  assert.ok(Math.abs(result.savedUsd - .1) < 1e-10);
  assert.deepEqual(original, before);
});

test('unhealthy/missing prefixes and incomplete billing cannot manufacture a replay win', () => {
  for (const change of [
    (o: any) => { o.entries[0].http_status = 500; },
    (o: any) => { o.entries.splice(1); },
    (o: any) => { o.inference_evidence.model_parse_diagnostics.rejected = 1; },
    (o: any) => { o.inference_evidence.normal_model_evidence.multipleIntentionalPlaces = true; },
    (o: any) => { o.inference_evidence.normal_model_evidence.partialPlaces = [{}]; },
  ]) {
    const original = fixture(); change(original);
    assert.equal(emptyEvidenceReplayObservation(original).stopped, false);
  }
  const unknown = fixture(); unknown.provider_ledger_complete = false;
  assert.throws(() => emptyEvidenceReplayObservation(unknown), /complete_measured_ledger/);
  const autonomous = fixture(); autonomous.autonomous = true;
  assert.throws(() => emptyEvidenceReplayObservation(autonomous), /parent_has_autonomous/);
});
