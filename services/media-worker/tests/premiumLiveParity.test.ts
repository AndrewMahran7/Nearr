import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';
import {
  PREMIUM_EVIDENCE_VERSION,
  premiumEvidenceReuseDecision,
  sha256,
} from '../src/premium/premiumInferenceFingerprint.js';
import { buildSpecificPlacesQuery } from '../src/premium/premiumCanonicalization.js';
import {
  runPremiumRecognition,
  runPremiumRecognitionInference,
} from '../src/premium/premiumRecognition.js';
import { evaluatePremiumRecognitionSafety } from '../src/premium/premiumRecognitionSafety.js';
import { sourceEvidenceForPremium } from '../src/premium/premiumRecognitionAdapter.js';
import { parseSolParityPayload } from '../src/solParity/parser.js';
import {
  buildBoundedSolSourceContext,
  buildSolParityContext,
  SOL_PARITY_INSTRUCTIONS,
} from '../src/solParity/prompt.js';
import type {
  FrameSet,
  SolDestination,
  SolParityPayload,
  SourceEvidence,
} from '../src/solParity/types.js';

let directory = '';
let frameSet: FrameSet;
const evidence: SourceEvidence = {
  caption: 'private caption value',
  transcript: [{ startSeconds: 1, endSeconds: 2, text: 'private transcript value' }],
  ocr: [{ timestampSeconds: 1, text: 'private ocr value', confidence: 1 }],
  source_location_context: 'private location value',
  creator_handle: 'private creator',
  creator_name: null,
};

before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'premium-live-parity-'));
  const framePath = path.join(directory, 'frame.jpg');
  await writeFile(framePath, Buffer.from('fixed-frame-bytes'));
  frameSet = {
    arm: 'F1',
    strategy: 'current_nearr_diverse_6',
    considered_count: 1,
    mean_pairwise_distance: 0,
    frames: [{
      path: framePath,
      timestampSeconds: 1.25,
      width: 320,
      height: 240,
      aHash: '0'.repeat(16),
      reason: 'first',
    }],
  };
});
after(async () => { await rm(directory, { recursive: true, force: true }); });

function destination(name: string, region = 'Oregon'): SolDestination {
  return {
    name,
    entity_type: 'NAMED_NATURAL_FEATURE',
    city: null,
    region,
    country: 'United States',
    confidence: 'HIGH',
    alternatives: [],
    supporting_clues: ['A distinctive signed formation is visible in the supplied frame'],
    contradictions: [],
    web_research_used: false,
  };
}

function payload(result: SolDestination | null): SolParityPayload {
  return {
    scene_class: result ? 'ONE_DESTINATION' : 'UNKNOWN',
    destination_count: result ? 1 : 0,
    results: result ? [result] : [],
  };
}

function fakeFetch(result: SolParityPayload, capture?: (body: any) => void): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    capture?.(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({
      id: 'resp-live-parity-test',
      status: 'completed',
      output_text: JSON.stringify(result),
      output: [],
      usage: {
        input_tokens: 100,
        output_tokens: 20,
        total_tokens: 120,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 5 },
      },
    }), { status: 200 });
  }) as typeof fetch;
}

async function inference(result = payload(destination('Tamolitch Blue Pool'))) {
  return runPremiumRecognitionInference({
    frameSet,
    platform: 'instagram',
    canonicalUrl: 'https://www.instagram.com/reel/fixed/',
    evidence,
    env: { OPENAI_API_KEY: 'test' },
    fetchImpl: fakeFetch(result),
  });
}

async function recognition(result = payload(destination('Tamolitch Blue Pool'))) {
  return runPremiumRecognition({
    frameSet,
    platform: 'instagram',
    canonicalUrl: 'https://www.instagram.com/reel/fixed/',
    evidence,
    premiumRequestId: 'premium-test',
    shareJobId: 'job-test',
    evidenceReuseState: 'EVIDENCE_REGENERATED',
    googlePlacesApiKey: 'places-test',
    env: { OPENAI_API_KEY: 'test' },
    fetchImpl: fakeFetch(result),
    placesSearch: async () => ({ ok: true, results: [] }),
  });
}

test('1 parity/runtime share the bounded evidence builder', () => {
  const bounded = buildBoundedSolSourceContext({ modelArm: 'M1', evidence });
  const context = buildSolParityContext({ platform: 'instagram', modelArm: 'M1', evidence });
  assert.equal(context.lengths.caption, bounded.caption.length);
  assert.equal(context.lengths.transcript, bounded.transcript.length);
});
test('2 parity/runtime share the prompt builder', async () => {
  const call = await inference();
  assert.equal(call.prompt_version, 'sol-parity-natural-v1');
  assert.equal(call.fingerprint?.prompt.promptHash, sha256(SOL_PARITY_INSTRUCTIONS));
});
test('3 parity/runtime share the structured parser', () => {
  assert.equal(parseSolParityPayload(payload(destination('Dorset Quarry')))?.results[0]?.name, 'Dorset Quarry');
});
test('4 runtime uses the minimal canonicalizer', async () => {
  const source = await readFile(new URL('../src/premium/premiumRecognition.ts', import.meta.url), 'utf8');
  assert.match(source, /canonicalizePremiumHypothesis/);
  const harness = await readFile(new URL('../src/cli/solParityBenchmark.ts', import.meta.url), 'utf8');
  assert.match(harness, /completePremiumRecognition/);
});
test('5 same evidence produces the same request fingerprint', async () => {
  const first = await inference();
  const second = await inference();
  assert.equal(first.fingerprint?.fingerprintId, second.fingerprint?.fingerprintId);
});
test('6 frame hashes and byte lengths are persisted', async () => {
  const call = await inference();
  assert.equal(call.fingerprint?.frames[0]?.imageSha256, sha256(Buffer.from('fixed-frame-bytes')));
  assert.equal(call.fingerprint?.frames[0]?.byteLength, 17);
});
test('7 bounded source-context hashes are persisted', async () => {
  const call = await inference();
  assert.match(call.fingerprint?.sourceContext.transcriptHash ?? '', /^[a-f0-9]{64}$/);
  assert.equal(call.fingerprint?.sourceContext.transcriptLength, 31);
});
test('8 prompt hash is persisted', async () => {
  assert.match((await inference()).fingerprint?.prompt.promptHash ?? '', /^[a-f0-9]{64}$/);
});
test('9 structured-result hash is persisted', async () => {
  assert.match((await recognition()).telemetry.solBoundary.structuredResultHash ?? '', /^[a-f0-9]{64}$/);
});
test('10 canonical-result hash is persisted', async () => {
  assert.match((await recognition()).telemetry.canonicalizationFingerprint.hash, /^[a-f0-9]{64}$/);
});
test('11 fingerprint diagnostics contain no raw transcript', async () => {
  assert.doesNotMatch(JSON.stringify((await inference()).fingerprint), /private transcript value/);
});
test('12 Sol boundary contains no chain-of-thought or raw model output', async () => {
  const boundary = JSON.stringify((await recognition()).telemetry.solBoundary);
  assert.doesNotMatch(boundary, /chain.of.thought|raw_model_output|reasoning_text/i);
});
test('13 stale evidence version triggers regeneration', () => {
  const decision = premiumEvidenceReuseDecision({ version: 'old', frameCount: 1, frameHashes: ['a'.repeat(64)] });
  assert.equal(decision.state, 'EVIDENCE_REUSE_VERSION_MISMATCH');
  assert.equal(decision.mustRegenerate, true);
});
test('14 compatible evidence is reusable', () => {
  const decision = premiumEvidenceReuseDecision({ version: PREMIUM_EVIDENCE_VERSION, frameCount: 1, frameHashes: ['a'.repeat(64)] });
  assert.equal(decision.state, 'EVIDENCE_REUSE_VALID');
  assert.equal(decision.mustRegenerate, false);
});
test('15 missing persisted frame triggers regeneration', () => {
  const decision = premiumEvidenceReuseDecision({ version: PREMIUM_EVIDENCE_VERSION, frameCount: 2, frameHashes: ['a'.repeat(64)] });
  assert.equal(decision.state, 'EVIDENCE_REUSE_INCOMPLETE');
  assert.equal(decision.mustRegenerate, true);
});
test('16 Premium runtime has no machine recognition cache', async () => {
  const source = await readFile(new URL('../src/premium/premiumRecognition.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /recognitionCache|VERIFIED_AUTO_SAVE|CANDIDATE_SET/);
});
test('17 Premium request calls no Gemini model', async () => {
  let target = '';
  await runPremiumRecognitionInference({
    frameSet, platform: 'instagram', evidence,
    env: { OPENAI_API_KEY: 'test' },
    fetchImpl: (async (url, init) => { target = String(url); return fakeFetch(payload(null))(url, init); }) as typeof fetch,
  });
  assert.equal(target, 'https://api.openai.com/v1/responses');
});
test('18 web search remains absent', async () => {
  let request: any;
  await runPremiumRecognitionInference({
    frameSet, platform: 'instagram', evidence,
    env: { OPENAI_API_KEY: 'test' },
    fetchImpl: fakeFetch(payload(null), (value) => { request = value; }),
  });
  assert.equal('tools' in request, false);
});
test('19 MCP remains absent', async () => {
  let request: any;
  await runPremiumRecognitionInference({
    frameSet, platform: 'instagram', evidence,
    env: { OPENAI_API_KEY: 'test' },
    fetchImpl: fakeFetch(payload(null), (value) => { request = value; }),
  });
  assert.doesNotMatch(JSON.stringify(request), /mcp/i);
});
test('20 critic and second-pass orchestration remain absent', async () => {
  const source = await readFile(new URL('../src/premium/premiumRecognition.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /critic|second.?pass|recursive.?retry/i);
});
test('21 actionable Premium results bypass the legacy pre-resolver', async () => {
  const source = await readFile(new URL('../../../supabase/functions/process-share-jobs/index.ts', import.meta.url), 'utf8');
  assert.match(source, /valid Premium payload is authoritative/);
  assert.doesNotMatch(source, /pre\.action !== 'manual_fallback'[\s\S]{0,160}PREMIUM_ACTIONABLE_RESULT/);
});
test('22 safety downgrade preserves the result', async () => {
  const output = await recognition(payload(destination('Tamolitch Blue Pool')));
  assert.equal(output.destinations[0]?.decision, 'NAMED_LEAD');
  assert.equal(output.outcome, 'PREMIUM_ACTIONABLE_RESULT');
});
test('23 chargeability cannot erase a visible review result', async () => {
  const output = await recognition(payload(destination('Lake Havasu')));
  assert.equal(output.destinations.length, 1);
  assert.equal(output.chargeability, 'CHARGEABLE_ACTIONABLE');
});
test('24 acquisition failure retains the token-release finalizer path', async () => {
  const source = await readFile(new URL('../../../supabase/functions/process-share-jobs/index.ts', import.meta.url), 'utf8');
  assert.match(source, /!premium && pre\.action !== 'manual_fallback'/);
});
test('25 duplicate Premium request remains idempotent', async () => {
  const source = await readFile(new URL('../../../supabase/migrations/20260904000001_premium_request_monetization.sql', import.meta.url), 'utf8');
  assert.match(source, /v_job\.premium_state in \('reserved','processing','useful_result','no_useful_result','failed','cancelled'\)/);
});

const priority: Array<[string, string, string]> = [
  ['26 R01', 'Cirque de Gens', 'France'],
  ['27 R02', 'Black Rock Beach', 'Maui'],
  ['28 R03', 'Tamolitch Blue Pool', 'Oregon'],
  ['29 R04', 'Dorset Marble Quarry', 'Vermont'],
  ['30 R05', 'Okere Falls', 'New Zealand'],
  ['31 R06', 'Lake Havasu', 'Arizona'],
  ['32 R07', 'Stryn cliff-diving site', 'Norway'],
  ['33 R08', 'Mokulua Islands', 'Hawaii'],
  ['34 Paradise', 'Paradise Dynasty', 'Costa Mesa'],
];
for (const [name, identity, region] of priority) {
  test(name + ' keeps specific identity and geography in the canonical query', () => {
    const query = buildSpecificPlacesQuery(destination(identity, region));
    assert.match(query, new RegExp(identity.replace(/[.*+?^\x24{}()|[\]\\]/g, '\\$&'), 'i'));
    assert.match(query, new RegExp(region, 'i'));
  });
}
test('35 C07 remains useful but review-safe', () => {
  const hypothesis = destination('San Diego Zoo', 'California');
  hypothesis.entity_type = 'LANDMARK';
  hypothesis.supporting_clues = ['The well-known first YouTube elephant video is recognizable'];
  const safety = evaluatePremiumRecognitionSafety({
    hypothesis,
    evidenceBasis: 'CONTEXTUAL_OR_MEMORY_PRIOR',
    canonicalStatus: 'CANONICAL_EXACT',
    canonical: {
      googlePlaceId: 'zoo',
      name: 'San Diego Zoo',
      formattedAddress: 'San Diego, California',
      latitude: 32.7,
      longitude: -117.1,
      types: ['zoo'],
    },
    hypothesisCount: 1,
    destinationCount: 1,
    allowDistinctiveVisualAutoSave: true,
  });
  assert.equal(safety.decision, 'REVIEW');
});

test('adapter uses the same bounded evidence representation', () => {
  const adapted = sourceEvidenceForPremium({
    platform: 'instagram',
    canonicalUrl: 'https://example.com',
    transcript: evidence.transcript,
    ocr: evidence.ocr,
    frames: frameSet.frames,
    metadataDescription: evidence.caption,
    metadataLocation: evidence.source_location_context,
    metadataCreatorHandle: evidence.creator_handle,
    signal: new AbortController().signal,
  });
  assert.equal(buildBoundedSolSourceContext({ modelArm: 'M1', evidence: adapted }).caption, evidence.caption);
});
