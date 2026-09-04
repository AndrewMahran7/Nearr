import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { validateInferenceCase } from '../src/solParity/corpus.js';
import { parseSolParityPayload } from '../src/solParity/parser.js';
import { buildSolParityContext, SOL_PARITY_INSTRUCTIONS } from '../src/solParity/prompt.js';
import { callSolParity, estimateSolModelCostUsd, modelArmUsesWebSearch } from '../src/solParity/model.js';
import { canonicalizeDestination } from '../src/solParity/canonicalize.js';
import { simulateDecision } from '../src/solParity/decision.js';
import { loadGroundTruthAfterPersistence, persistModelAttempt, type PersistenceEvent } from '../src/solParity/persistence.js';
import type { FrameSet, PersistedModelAttempt, SolDestination, SolParityPayload, SourceEvidence } from '../src/solParity/types.js';

const destination: SolDestination = {
  name: 'Tamolitch Blue Pool', entity_type: 'NAMED_NATURAL_FEATURE', city: null, region: 'Oregon', country: 'United States',
  confidence: 'HIGH', alternatives: [], supporting_clues: ['blue pool'], contradictions: [], web_research_used: false,
};
const payload: SolParityPayload = { scene_class: 'ONE_DESTINATION', destination_count: 1, results: [destination] };
const evidence: SourceEvidence = { caption: 'x'.repeat(10_000), transcript: [{ startSeconds: 0, endSeconds: 1, text: 'y'.repeat(10_000) }], ocr: [{ timestampSeconds: 0, text: 'z'.repeat(5_000), confidence: 1 }], source_location_context: 'q'.repeat(1_000), creator_handle: null, creator_name: null };

test('ground-truth and candidate/cache fields cannot enter inference cases', () => {
  const base = { case_id: 'X', source: 'test', platform: 'instagram', source_url: 'https://www.instagram.com/p/x/', categories: [], manual_frames_directory: 'manual/X' };
  assert.equal(validateInferenceCase(base).case_id, 'X');
  for (const field of ['ground_truth', 'expected_answer', 'candidates', 'places_candidates', 'cached_identity', 'prior_hypothesis']) {
    assert.throws(() => validateInferenceCase({ ...base, [field]: 'leak' }), /forbidden_fields/);
  }
});

test('source evidence is bounded and M3 removes text context', () => {
  const full = buildSolParityContext({ platform: 'instagram', modelArm: 'M2', evidence });
  assert.equal(full.lengths.caption, 4_000);
  assert.equal(full.lengths.transcript, 8_000);
  assert.equal(full.lengths.ocr, 3_000);
  assert.equal(full.lengths.location, 300);
  const imagesOnly = buildSolParityContext({ platform: 'instagram', modelArm: 'M3', evidence });
  assert.deepEqual(imagesOnly.lengths, { caption: 0, transcript: 0, ocr: 0, location: 0 });
  assert.doesNotMatch(SOL_PARITY_INSTRUCTIONS, /candidate list|firewall|critic/i);
});

test('structured parser bounds ambiguity and preserves genuine multi-place output', () => {
  const rawDestination = { ...destination, alternatives: Array.from({ length: 5 }, (_, index) => ({ name: `Alt ${index}`, entity_type: 'UNKNOWN', city: null, region: null, country: null })) };
  const parsed = parseSolParityPayload({ scene_class: 'MULTIPLE_DESTINATIONS', destination_count: 2, results: [rawDestination, { ...destination, name: 'Second' }] });
  assert.equal(parsed?.results.length, 2);
  assert.equal(parsed?.results[0]?.alternatives.length, 3);
  assert.equal(parseSolParityPayload({ scene_class: 'ONE_DESTINATION', destination_count: 2, results: [rawDestination, rawDestination] }), null);
});

test('web search is enabled only for M2/M3 and exact frame bytes/timestamps are recorded', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-parity-test-'));
  try {
    const framePath = path.join(dir, 'frame.jpg');
    await writeFile(framePath, Buffer.from('representative-frame'));
    const frameSet: FrameSet = { arm: 'F1', strategy: 'test', considered_count: 1, mean_pairwise_distance: 0, frames: [{ path: framePath, timestampSeconds: 12.4, width: 10, height: 20, aHash: '0'.repeat(16), reason: 'first' }] };
    for (const arm of ['M1', 'M2', 'M3'] as const) {
      let requestBody: Record<string, unknown> = {};
      const result = await callSolParity({ frameSet, modelArm: arm, platform: 'instagram', evidence, env: { OPENAI_API_KEY: 'test' }, fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify({ id: 'resp_test', status: 'completed', output_text: JSON.stringify(payload), output: [], usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 5 } } }), { status: 200 });
      }});
      assert.equal('tools' in requestBody, modelArmUsesWebSearch(arm));
      assert.equal(result.frame_manifest[0]?.timestamp_seconds, 12.4);
      assert.match(result.frame_manifest[0]?.sha256 ?? '', /^[a-f0-9]{64}$/);
      assert.deepEqual(result.payload, payload);
    }
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('post-model canonicalization preserves a named lead on provider no-match', async () => {
  let calls = 0;
  const result = await canonicalizeDestination({ destination, apiKey: 'test', search: async () => { calls += 1; return { ok: true, results: [] }; } });
  assert.equal(calls, 1);
  assert.equal(result.status, 'NAMED_LEAD');
  assert.equal(result.model_identity.name, 'Tamolitch Blue Pool');
  assert.equal(simulateDecision(payload, [result]), 'WOULD_SHOW_NAMED_LEAD');
});

test('high-confidence exact canonical result is simulated only, never saved', async () => {
  const result = await canonicalizeDestination({ destination, apiKey: 'test', search: async () => ({ ok: true, results: [{ googlePlaceId: 'place-1', name: 'Tamolitch Blue Pool', formattedAddress: 'Oregon, United States', latitude: 1, longitude: 2, types: ['tourist_attraction'] }] }) });
  assert.equal(result.status, 'CANONICAL_EXACT');
  assert.equal(simulateDecision(payload, [result]), 'WOULD_AUTO_SAVE');
});

test('cost accounting returns unknown for missing usage and prices cached tokens separately', () => {
  assert.equal(estimateSolModelCostUsd({ input_tokens: null, cached_input_tokens: null, output_tokens: 1, reasoning_tokens: null, total_tokens: null }), null);
  assert.equal(estimateSolModelCostUsd({ input_tokens: 1_000_000, cached_input_tokens: 500_000, output_tokens: 1_000_000, reasoning_tokens: 0, total_tokens: 2_000_000 }), 22.2);
});

test('responses are persisted and fsynced before ground truth is loaded', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'sol-parity-order-'));
  const attemptsPath = path.join(dir, 'attempts.jsonl');
  const truthPath = path.join(dir, 'truth.json');
  const events: PersistenceEvent[] = [];
  try {
    await writeFile(truthPath, '{"schema_version":1,"cases":[]}');
    const attempt = { schema_version: 1, run_id: 'run', attempt_id: 'attempt', persisted_at: new Date().toISOString(), case_id: 'X', source_url: 'https://example.com', platform: 'instagram', frame_arm: 'F1', model_arm: 'M1', model: 'gpt-5.6-sol', prompt_version: 'v1', web_search_enabled: false, images_only: false, input_manifest: { frame_count: 0, frames: [], caption_characters: 0, transcript_characters: 0, ocr_characters: 0, source_location_characters: 0 }, timings_ms: { acquisition: 1, frame_extraction: 1, transcription: 1, ocr: 1, sol: 1, web_search: null, canonicalization: null, total: 5 }, usage: { input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null }, estimated_model_cost_usd: null, web_search_calls: 0, web_search_queries: [], web_search_sources: [], response_id: null, response_status: null, raw_model_output: null, payload: null, failure: { kind: 'malformed', code: 'test' } } satisfies PersistedModelAttempt;
    await persistModelAttempt(attemptsPath, attempt, events);
    await loadGroundTruthAfterPersistence(truthPath, events);
    assert.deepEqual(events.map((event) => event.kind), ['response_persisted', 'ground_truth_loaded']);
    assert.match(await readFile(attemptsPath, 'utf8'), /"attempt_id":"attempt"/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('experiment code has no recognition-cache dependency, candidate-first request, production target, or deployment hook', async () => {
  const root = path.resolve(import.meta.dirname, '..');
  const runner = await readFile(path.join(root, 'src', 'cli', 'solParityBenchmark.ts'), 'utf8');
  const model = await readFile(path.join(root, 'src', 'solParity', 'model.ts'), 'utf8');
  assert.doesNotMatch(`${runner}\n${model}`, /VERIFIED_AUTO_SAVE|CANDIDATE_SET|recognitionCache|deployWorker|publishUpdate|SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(runner, /persistModelAttempt\(attemptsPath, attempt\)[\s\S]*canonicalizeDestination/);
  assert.match(runner, /production_target: false/);
  assert.doesNotMatch(model, /places_candidates|googlePlaceId|ground.?truth/i);
});
