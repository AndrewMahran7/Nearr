import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import { buildAutomaticFrameSets } from '../src/solParity/frames.js';
import { callSolParity, estimateSolModelCostUsd } from '../src/solParity/model.js';
import type { FrameSet, SolDestination, SolParityPayload, SourceEvidence } from '../src/solParity/types.js';
import { buildSpecificPlacesQuery, canonicalizePremiumHypothesis } from '../src/premium/premiumCanonicalization.js';
import { runPremiumRecognition, runPremiumRecognitionInference } from '../src/premium/premiumRecognition.js';
import { evaluatePremiumRecognitionSafety, inferPremiumEvidenceBasis } from '../src/premium/premiumRecognitionSafety.js';
import type { PremiumCanonicalCandidate, PremiumPlacesSearch } from '../src/premium/premiumRecognitionTypes.js';

let dir = '';
let frameSet: FrameSet;
const emptyEvidence: SourceEvidence = {
  caption: null, transcript: [], ocr: [], source_location_context: null,
  creator_handle: null, creator_name: null,
};

before(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'premium-sol-'));
  const framePath = path.join(dir, 'frame.jpg');
  await writeFile(framePath, Buffer.from('premium-frame'));
  frameSet = {
    arm: 'F1', strategy: 'current_nearr_diverse_6', considered_count: 1,
    mean_pairwise_distance: 0, frames: [{
      path: framePath, timestampSeconds: 2, width: 320, height: 240,
      aHash: '0'.repeat(16), reason: 'first',
    }],
  };
});
after(async () => { await rm(dir, { recursive: true, force: true }); });

function destination(name: string, overrides: Partial<SolDestination> = {}): SolDestination {
  return {
    name, entity_type: 'NAMED_NATURAL_FEATURE', city: null, region: 'Oregon', country: 'US',
    confidence: 'HIGH', alternatives: [],
    supporting_clues: ['A distinctive blue circular pool beneath a basalt forest ledge'],
    contradictions: [], web_research_used: false, ...overrides,
  };
}

function payload(results: SolDestination[], scene: SolParityPayload['scene_class'] = 'ONE_DESTINATION'): SolParityPayload {
  return { scene_class: scene, destination_count: results.length, results };
}

function solFetch(value: SolParityPayload | null, capture?: (body: any) => void): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    capture?.(JSON.parse(String(init?.body)));
    const output = value ? JSON.stringify(value) : '{}';
    return new Response(JSON.stringify({
      id: 'resp-premium-test', status: 'completed', output_text: output, output: [],
      usage: { input_tokens: 1000, output_tokens: 100, total_tokens: 1100,
        input_tokens_details: { cached_tokens: 100 }, output_tokens_details: { reasoning_tokens: 25 } },
    }), { status: 200 });
  }) as typeof fetch;
}

function canonical(name: string, address = 'Oregon, US', types = ['tourist_attraction']): PremiumCanonicalCandidate {
  return { googlePlaceId: `place-${name.toLowerCase().replace(/\W+/g, '-')}`, name,
    formattedAddress: address, latitude: 44, longitude: -122, types };
}

function searchFor(candidates: PremiumCanonicalCandidate[], calls?: string[]): PremiumPlacesSearch {
  return async (query) => { calls?.push(query); return { ok: true, results: candidates }; };
}

async function engine(value: SolParityPayload, options: {
  evidence?: SourceEvidence; places?: PremiumCanonicalCandidate[]; calls?: string[];
  allowDistinctiveVisualAutoSave?: boolean;
} = {}) {
  return runPremiumRecognition({
    frameSet, platform: 'instagram', canonicalUrl: 'https://instagram.com/reel/test/',
    evidence: options.evidence ?? emptyEvidence, googlePlacesApiKey: 'places-test',
    placesSearch: searchFor(options.places ?? value.results.map((item) => canonical(item.name)), options.calls),
    fetchImpl: solFetch(value), env: { OPENAI_API_KEY: 'test' },
    allowDistinctiveVisualAutoSave: options.allowDistinctiveVisualAutoSave,
  });
}

test('1 parity runner and runtime share the exact inference function', async () => {
  let oldBody: any; let newBody: any;
  const value = payload([destination('Tamolitch Blue Pool')]);
  const old = await callSolParity({ frameSet, modelArm: 'M1', platform: 'instagram', evidence: emptyEvidence,
    env: { OPENAI_API_KEY: 'test' }, fetchImpl: solFetch(value, (body) => { oldBody = body; }) });
  const current = await runPremiumRecognitionInference({ frameSet, modelArm: 'M1', platform: 'instagram', evidence: emptyEvidence,
    env: { OPENAI_API_KEY: 'test' }, fetchImpl: solFetch(value, (body) => { newBody = body; }) });
  assert.deepEqual(newBody, oldBody); assert.deepEqual(current.payload, old.payload);
  const runner = await readFile(new URL('../src/cli/solParityBenchmark.ts', import.meta.url), 'utf8');
  assert.match(runner, /runPremiumRecognitionInference/);
});
test('2 premium inference makes no Gemini call', async () => {
  let url = ''; await runPremiumRecognitionInference({ frameSet, platform: 'instagram', evidence: emptyEvidence,
    env: { OPENAI_API_KEY: 'test' }, fetchImpl: (async (input, init) => { url = String(input); return solFetch(payload([]))(input, init); }) as typeof fetch });
  assert.equal(url, 'https://api.openai.com/v1/responses');
});
test('3 web search is off by default', async () => {
  let body: any; const out = await runPremiumRecognitionInference({ frameSet, platform: 'instagram', evidence: emptyEvidence,
    env: { OPENAI_API_KEY: 'test' }, fetchImpl: solFetch(payload([]), (value) => { body = value; }) });
  assert.equal(out.web_search_enabled, false); assert.equal('tools' in body, false);
});
test('4 no MCP or agent loop is present in the request', async () => {
  let body: any; await runPremiumRecognitionInference({ frameSet, platform: 'instagram', evidence: emptyEvidence,
    env: { OPENAI_API_KEY: 'test' }, fetchImpl: solFetch(payload([]), (value) => { body = value; }) });
  assert.doesNotMatch(JSON.stringify(body), /mcp|agent/i);
});
test('5 premium inference has no machine cache input', async () => {
  let body: any; await runPremiumRecognitionInference({ frameSet, platform: 'instagram', evidence: emptyEvidence,
    env: { OPENAI_API_KEY: 'test' }, fetchImpl: solFetch(payload([]), (value) => { body = value; }) });
  assert.doesNotMatch(JSON.stringify(body), /VERIFIED_AUTO_SAVE|CANDIDATE_SET|recognitionCache/);
});
test('6 Google candidates are never provided before Sol', async () => {
  const order: string[] = []; const value = payload([destination('Okere Falls')]);
  await runPremiumRecognition({ frameSet, platform: 'instagram', canonicalUrl: 'x', evidence: emptyEvidence,
    googlePlacesApiKey: 'key', env: { OPENAI_API_KEY: 'test' },
    fetchImpl: (async (input, init) => { order.push('sol'); return solFetch(value)(input, init); }) as typeof fetch,
    placesSearch: async () => { order.push('places'); return { ok: true, results: [canonical('Okere Falls')] }; } });
  assert.deepEqual(order, ['sol', 'places']);
});
test('7 source evidence bounds are inherited from the parity request', async () => {
  let body: any; const evidence = { ...emptyEvidence, caption: 'a'.repeat(9_000), transcript: [{ startSeconds: 0, endSeconds: 1, text: 'b'.repeat(10_000) }] };
  await runPremiumRecognitionInference({ frameSet, platform: 'instagram', evidence, env: { OPENAI_API_KEY: 'test' }, fetchImpl: solFetch(payload([]), (v) => { body = v; }) });
  const text = body.input[0].content[0].text as string; assert.ok(text.length < 14_000); assert.ok(!text.includes('a'.repeat(4_001)));
});
test('8 current F1 frame strategy and bounded count are preserved', () => {
  const frames = Array.from({ length: 10 }, (_, i) => ({ ...frameSet.frames[0]!, timestampSeconds: i, aHash: i.toString(16).padStart(16, '0') }));
  const f1 = buildAutomaticFrameSets(frames, 6, 'diverse').F1;
  assert.match(f1.strategy, /^current_nearr_diverse_6$/); assert.ok(f1.frames.length <= 6);
});
test('9 ambiguity is capped at three hypotheses per destination', async () => {
  const d = destination('Primary', { alternatives: [1, 2, 3, 4].map((i) => ({ name: `Alternative ${i}`, entity_type: 'LANDMARK', city: null, region: 'Oregon', country: 'US' })) });
  const out = await engine(payload([d]), { places: [] }); assert.equal(out.destinations[0]?.hypotheses.length, 3);
});
test('10 true multi-place outputs remain separate logical destinations', async () => {
  const out = await engine(payload([destination('Place One'), destination('Place Two')], 'MULTIPLE_DESTINATIONS'), { places: [] });
  assert.equal(out.destinations.length, 2); assert.notEqual(out.destinations[0]?.logicalDestinationId, out.destinations[1]?.logicalDestinationId);
});
test('11 one-destination ambiguity remains one logical destination', async () => {
  const d = destination('Place One', { alternatives: [{ name: 'Place Two', entity_type: 'LANDMARK', city: null, region: 'Oregon', country: 'US' }] });
  const out = await engine(payload([d]), { places: [] }); assert.equal(out.destinations.length, 1); assert.equal(out.destinations[0]?.hypotheses.length, 2);
});
test('12 provider no-match preserves a named lead', async () => {
  const out = await engine(payload([destination('Okere Falls')]), { places: [] }); assert.equal(out.destinations[0]?.decision, 'NAMED_LEAD'); assert.equal(out.destinations[0]?.hypotheses[0]?.name, 'Okere Falls');
});
test('13 a specific business identity is retained', async () => {
  const d = destination('Paradise Dynasty', { entity_type: 'BUSINESS', city: 'Costa Mesa', region: 'CA' });
  const out = await engine(payload([d]), { places: [canonical('Paradise Dynasty', 'Costa Mesa, CA', ['restaurant'])] }); assert.equal(out.destinations[0]?.hypotheses[0]?.canonical?.name, 'Paradise Dynasty');
});
test('14 tenant identity beats parent complex substitution', async () => {
  const d = destination('Paradise Dynasty', { entity_type: 'BUSINESS', city: 'Costa Mesa', region: 'CA' });
  const out = await engine(payload([d]), { places: [canonical('South Coast Plaza', 'Costa Mesa, CA', ['shopping_mall'])] }); assert.equal(out.destinations[0]?.hypotheses[0]?.canonical, null);
});
test('15 named natural features are retained', async () => { const out = await engine(payload([destination('Tamolitch Blue Pool')]), { places: [] }); assert.equal(out.destinations[0]?.hypotheses[0]?.name, 'Tamolitch Blue Pool'); });
test('16 an administrative area cannot replace a physical destination', async () => {
  const out = await engine(payload([destination('Lake Havasu')]), { places: [canonical('Lake Havasu City', 'Arizona', ['locality'])] }); assert.equal(out.destinations[0]?.hypotheses[0]?.canonical, null);
});
test('17 pipe-joined identities are normalized to one owner', () => { const query = buildSpecificPlacesQuery(destination('Burritos La Palma | South Coast Plaza', { city: 'Costa Mesa' })); assert.equal(query.includes('|'), false); assert.doesNotMatch(query, /South Coast Plaza/); });
test('18 generic Places fallback queries are rejected', () => { assert.throws(() => buildSpecificPlacesQuery(destination('waterfall', { region: 'Oregon' })), /generic_places_query_forbidden/); });
test('19 primary canonicalization stops after success', async () => { const calls: string[] = []; await canonicalizePremiumHypothesis({ hypothesis: destination('Blue Pool (Tamolitch Falls)'), apiKey: 'k', maxCalls: 2, search: searchFor([canonical('Blue Pool (Tamolitch Falls)')], calls) }); assert.equal(calls.length, 1); });
test('20 canonicalization performs at most two calls per strong hypothesis', async () => { const calls: string[] = []; await canonicalizePremiumHypothesis({ hypothesis: destination('Blue Pool (Tamolitch Falls)'), apiKey: 'k', maxCalls: 2, search: searchFor([], calls) }); assert.equal(calls.length, 2); });
test('21 exact names produce exact canonicalization', async () => { const out = await canonicalizePremiumHypothesis({ hypothesis: destination('Okere Falls'), apiKey: 'k', search: searchFor([canonical('Okere Falls')]) }); assert.equal(out.status, 'CANONICAL_EXACT'); });
test('22 a controlled parenthetical alias can canonicalize', async () => { let n = 0; const out = await canonicalizePremiumHypothesis({ hypothesis: destination('Tamolitch Blue Pool (Tamolitch Falls)'), apiKey: 'k', search: async () => ({ ok: true, results: ++n === 1 ? [] : [canonical('Tamolitch Falls')] }) }); assert.equal(out.status, 'CANONICAL_EXACT'); assert.equal(out.calls.length, 2); });
test('23 C07 famous-clip prior cannot unsafe-autosave', () => { const d = destination('San Diego Zoo', { entity_type: 'LANDMARK', supporting_clues: ["Matches the well-known first YouTube elephant video"] }); const basis = inferPremiumEvidenceBasis(d, { ...emptyEvidence, source_location_context: 'San Diego Zoo' }); const out = evaluatePremiumRecognitionSafety({ hypothesis: d, evidenceBasis: basis, canonicalStatus: 'CANONICAL_EXACT', canonical: canonical('San Diego Zoo', 'San Diego, CA'), hypothesisCount: 1, destinationCount: 1 }); assert.equal(basis, 'CONTEXTUAL_OR_MEMORY_PRIOR'); assert.equal(out.decision, 'REVIEW'); });
test('24 memory priors never auto-save', () => { const out = evaluatePremiumRecognitionSafety({ hypothesis: destination('Famous Place'), evidenceBasis: 'CONTEXTUAL_OR_MEMORY_PRIOR', canonicalStatus: 'CANONICAL_EXACT', canonical: canonical('Famous Place'), hypothesisCount: 1, destinationCount: 1, allowDistinctiveVisualAutoSave: true }); assert.equal(out.decision, 'REVIEW'); });
test('25 a safety downgrade preserves a review result, including low confidence', async () => { const out = await engine(payload([destination('Tamolitch Blue Pool', { confidence: 'LOW' })])); assert.equal(out.destinations[0]?.decision, 'REVIEW'); assert.equal(out.destinations.length, 1); });
test('26 strong source-visible identity may auto-save', async () => { const d = destination('Okere Falls'); const out = await engine(payload([d]), { evidence: { ...emptyEvidence, ocr: [{ timestampSeconds: 2, text: 'OKERE FALLS', confidence: 1 }] }, places: [canonical('Okere Falls')] }); assert.equal(out.destinations[0]?.decision, 'AUTO_SAVE'); });
test('27 actionable review remains chargeable', async () => { const out = await engine(payload([destination('Tamolitch Blue Pool')])); assert.equal(out.destinations[0]?.decision, 'REVIEW'); assert.equal(out.chargeability, 'CHARGEABLE_ACTIONABLE'); });
test('28 no useful result is non-chargeable', async () => { const out = await engine(payload([], 'UNKNOWN'), { places: [] }); assert.equal(out.outcome, 'PREMIUM_NO_USEFUL_RESULT'); assert.equal(out.chargeability, 'NON_CHARGEABLE_NO_RESULT'); });
test('29 technical model failure is non-chargeable', async () => { const out = await runPremiumRecognition({ frameSet, platform: 'instagram', canonicalUrl: 'x', evidence: emptyEvidence, googlePlacesApiKey: null, env: {}, fetchImpl: solFetch(null) }); assert.equal(out.outcome, 'PREMIUM_TECHNICAL_FAILURE'); assert.equal(out.chargeability, 'NON_CHARGEABLE_TECHNICAL_FAILURE'); });
test('30 USER_CONFIRMED bypass remains in the premium monetization contract', async () => { const source = await readFile(new URL('../../../lib/premiumRequestMonetization.ts', import.meta.url), 'utf8'); assert.match(source, /free_result_actionable/); assert.match(source, /saved_place_id/); });
test('31 runtime Premium path bypasses legacy machine cache reads', async () => { const source = await readFile(new URL('../src/pipeline/runMediaTask.ts', import.meta.url), 'utf8'); assert.match(source, /premiumModel!?\.analyze/); assert.doesNotMatch(await readFile(new URL('../src/premium/premiumRecognition.ts', import.meta.url), 'utf8'), /recognitionCache|CANDIDATE_SET|VERIFIED_AUTO_SAVE/); });
test('32 finalizer suppresses globally trusted cache writes', async () => { const source = await readFile(new URL('../../../supabase/functions/process-share-jobs/index.ts', import.meta.url), 'utf8'); assert.match(source, /__skipRecognitionCachePersist: true/); assert.match(source, /task\.task_kind === 'premium_recognition'/); });

const regressionQueries: Array<[string, string, string]> = [
  ['33 R01 regression keeps a specific cliff identity', 'Steinsdalsfossen Cliff Ledge', 'Norway'],
  ['34 R02 regression keeps Maui geography', 'Black Rock Beach', 'Maui'],
  ['35 R03 regression keeps Tamolitch family', 'Tamolitch Blue Pool', 'Oregon'],
  ['36 R04 regression keeps Dorset', 'Dorset Marble Quarry', 'Vermont'],
  ['37 R05 regression keeps Okere Falls', 'Okere Falls', 'New Zealand'],
  ['38 R06 regression keeps Lake Havasu physical identity', 'Lake Havasu', 'Arizona'],
  ['39 R07 regression keeps Norway qualifier', 'Hellesylt Waterfall', 'Norway'],
  ['40 R08 regression keeps Mokulua natural identity', 'Mokulua Islands', 'Hawaii'],
  ['41 Paradise regression keeps restaurant identity', 'Paradise Dynasty', 'Costa Mesa'],
];
for (const [name, identity, region] of regressionQueries) {
  test(name, () => { const query = buildSpecificPlacesQuery(destination(identity, { region })); assert.match(query, new RegExp(identity.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')); assert.match(query, new RegExp(region, 'i')); });
}
test('42 multi-place request budgets remain independent', async () => { const calls: string[] = []; const out = await engine(payload([destination('Okere Falls'), destination('Dorset Marble Quarry')], 'MULTIPLE_DESTINATIONS'), { calls, places: [] }); assert.equal(out.destinations.length, 2); assert.equal(calls.length, 2); });
test('43 known Sol token cost is accounted without treating unknown as zero', () => { assert.equal(estimateSolModelCostUsd({ input_tokens: 1000, cached_input_tokens: 100, output_tokens: 100, reasoning_tokens: 20, total_tokens: 1100 }), 0.00564); assert.equal(estimateSolModelCostUsd({ input_tokens: null, cached_input_tokens: null, output_tokens: null, reasoning_tokens: null, total_tokens: null }), null); });
test('44 latency telemetry records every ordered stage', async () => { const out = await engine(payload([destination('Okere Falls')]), { places: [] }); const t = out.telemetry.timestamps; assert.ok(t.evidenceReadyAt <= t.solStartedAt); assert.ok(t.solStartedAt <= t.solCompletedAt); assert.ok(t.solCompletedAt <= t.canonicalizationStartedAt); assert.ok(t.canonicalizationStartedAt <= t.premiumTerminalAt); });
test('45 request-budget telemetry exactly accounts for Places calls', async () => { const calls: string[] = []; const d = destination('Blue Pool (Tamolitch Falls)'); const out = await engine(payload([d]), { calls, places: [] }); assert.equal(out.telemetry.placesRequests, calls.length); assert.ok(out.telemetry.placesRequests <= 2); });
test('46 Premium acquisition failures settle without requiring a Sol payload', async () => { const source = await readFile(new URL('../../../supabase/functions/process-share-jobs/index.ts', import.meta.url), 'utf8'); assert.match(source, /!premium && pre\.action !== 'manual_fallback'/); assert.match(source, /skipRecognitionCachePersist: task\.task_kind === 'premium_recognition'/); });
