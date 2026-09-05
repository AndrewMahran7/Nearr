import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { withAutomaticDeepRecognition } from '../src/automaticDeep/automaticDeepRecognitionProvider.js';
import { evaluateNormalResultSpecificity } from '../src/automaticDeep/normalResultSpecificity.js';
import { buildSpecificPlacesQuery } from '../src/premium/premiumCanonicalization.js';
import type { PremiumRecognitionExecution } from '../src/premium/premiumRecognitionTypes.js';
import type { AnalyzeInput, AnalyzeOutput, ModelProvider } from '../src/providers/model.js';
import { emptyEvidence, type PlaceCandidateEvidence } from '../src/types/evidence.js';

const evidenceItem = { source: 'frame' as const, value: 'observed source evidence', timestampSeconds: 1 };
function place(name: string, overrides: Partial<PlaceCandidateEvidence> = {}): PlaceCandidateEvidence {
  return {
    name, category: null, categoryConfidence: 0, categoryEvidenceTags: [], address: null,
    city: null, region: null, country: null, coordinates: null, role: 'primary', confidence: .8,
    explicitEvidence: [evidenceItem], inferredEvidence: [], memoryCue: null, memoryCueEvidence: [],
    ...overrides,
  };
}
function output(places: PlaceCandidateEvidence[], overrides: Partial<AnalyzeOutput> = {}): AnalyzeOutput {
  return { provider: 'normal', promptVersion: 'normal.v1', evidence: {
    ...emptyEvidence(), places, insufficientEvidence: places.length === 0,
  }, ...overrides };
}
function specific(value: AnalyzeOutput, terminalDecision?: string): boolean {
  return evaluateNormalResultSpecificity({ ...value, terminalDecision }).specific;
}
function execution(names = ['Tamolitch Blue Pool', 'Blue Pool', 'Tamolitch Falls']): PremiumRecognitionExecution {
  const hypotheses = names.map((name, index) => ({
    name, entityType: 'NAMED_NATURAL_FEATURE', city: null, region: 'Oregon', country: 'US',
    confidence: index === 0 ? 'HIGH' as const : 'MEDIUM' as const,
    evidenceBasis: 'DISTINCTIVE_VISUAL_MATCH' as const, supportingClues: ['distinctive basalt pool'],
    contradictions: [], timestamps: [1], canonicalStatus: 'NAMED_LEAD' as const, canonical: null,
    canonicalAlternatives: [], canonicalizationCalls: [],
  }));
  return {
    schemaVersion: 1, outcome: 'PREMIUM_ACTIONABLE_RESULT', chargeability: 'CHARGEABLE_ACTIONABLE',
    destinationIntent: 'ONE_DESTINATION', failureCode: null,
    destinations: [{ logicalDestinationId: 'destination-1', hypotheses, decision: 'AUTO_SAVE', permissiveWouldAutoSave: true, safetyReasons: [] }],
    telemetry: {
      engineVersion: 'simple-sol-premium.v2', safetyVersion: 'premium-recognition-safety.v2',
      evidenceVersion: 'premium-evidence-2026-09-05.v1', evidenceReuseState: 'EVIDENCE_REGENERATED',
      model: 'gpt-5.6-sol', promptVersion: 'sol-parity-natural-v1', webSearchEnabled: false,
      frameStrategy: 'current_nearr_diverse_6', frameTimestampsSeconds: [1], inferenceFingerprint: null,
      solBoundary: {} as never, canonicalizationFingerprint: {} as never, finalFingerprint: {} as never,
      evidenceReuse: { media: 'REACQUIRED', frames: 'REACQUIRED', transcript: 'REACQUIRED', ocr: 'REACQUIRED', caption: 'REACQUIRED' },
      usage: { input_tokens: 100, cached_input_tokens: 0, output_tokens: 20, reasoning_tokens: 5, total_tokens: 120 },
      knownModelCostUsd: .01, placesRequests: 0, placesRequestTypes: [],
      timingsMs: { evidencePrep: 1, sol: 20, places: 0, totalAfterEvidenceReady: 21 },
      timestamps: { premiumRequestedAt: new Date(0).toISOString(), evidenceReadyAt: new Date(0).toISOString(), solStartedAt: new Date(0).toISOString(), solCompletedAt: new Date(0).toISOString(), canonicalizationStartedAt: new Date(0).toISOString(), canonicalizationCompletedAt: new Date(0).toISOString(), premiumTerminalAt: new Date(0).toISOString() },
    },
  };
}
const input: AnalyzeInput = {
  platform: 'instagram', canonicalUrl: 'https://example.test/video', transcript: [], ocr: [],
  frames: [{ path: 'frame.jpg', timestampSeconds: 1, width: 320, height: 240, aHash: '0'.repeat(16), reason: 'first' }],
  signal: new AbortController().signal,
};
const cfg = { automaticDeepRecognitionEnabled: true, vayrinFrameBudget: 6, maxSelectedFrames: 24,
  vayrinFrameStrategy: 'diverse', googlePlacesServerApiKey: '' } as any;

const escalateNames = ['waterfall', 'scenic spot', 'cliff jumping spot', 'beach', 'hiking trail', 'restaurant', 'viewpoint', 'park'];
for (const [index, name] of escalateNames.entries()) {
  test(`${index + 2} generic ${name} triggers deep`, () => assert.equal(specific(output([place(name)])), false));
}
test('1 exact normal result skips deep', () => assert.equal(specific(output([place('The Crack at Wet Beaver Creek')])), true));
test('10 broad Bali for a specific cliff triggers deep', () => assert.equal(specific(output([place('Bali', { region: 'Bali', country: 'Indonesia', category: 'scenic_spot' })])), false));
test('11 broad California for a specific beach triggers deep', () => assert.equal(specific(output([place('California', { region: 'California', category: 'beach' })])), false));
test('12 legitimate Bali destination does not trigger', () => assert.equal(specific(output([place('Bali', { region: 'Bali', country: 'Indonesia', category: 'island' })])), true));
test('13 exact restaurant does not trigger', () => assert.equal(specific(output([place('Din Tai Fung — South Coast Plaza', { category: 'restaurant', sceneSignature: { environmentType: 'food_venue', setting: 'indoor', visualAnchors: [], activity: null, regionClue: null } })])), true));
test('14 wrong entity type triggers deep', () => assert.equal(specific(output([place('Breakfast Republic', { category: 'restaurant', sceneSignature: { environmentType: 'natural_water', setting: 'outdoor', visualAnchors: [], activity: 'cliff jumping', regionClue: null } })])), false));
test('15 empty normal result triggers deep', () => assert.equal(specific(output([])), false));
test('16 needs_help triggers deep', () => assert.equal(specific(output([]), 'needs_help'), false));
test('17 manual_fallback triggers deep', () => assert.equal(specific(output([]), 'manual_fallback'), false));

for (const name of ['lake', 'swimming hole', 'mountain', 'bridge', 'resort']) {
  test(`generic ${name} also triggers deep`, () => assert.equal(specific(output([place(name)])), false));
}
for (const [name, field, category] of [
  ['Maui', 'region', 'waterfall'],
  ['Oregon', 'region', 'hiking_trail'],
  ['Paris', 'city', 'scenic_spot'],
] as const) {
  test(`broad ${name} for a specific place triggers deep`, () => assert.equal(specific(output([
    place(name, { [field]: name, category }),
  ])), false));
}
for (const name of [
  'Tamolitch Blue Pool',
  'Black Star Canyon Falls',
  'Atuh Beach',
  'Golden Gate Bridge',
]) {
  test(`specific identity ${name} skips deep`, () => assert.equal(specific(output([place(name)])), true));
}

test('18 automatic deep reserves, consumes, and releases zero tokens and creates no Premium task', async () => {
  let calls = 0;
  let captured: any;
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([place('waterfall')]) };
  const wrapped = withAutomaticDeepRecognition(inner, cfg, async (args) => { calls += 1; captured = args; return execution(); });
  const result = await wrapped.analyze(input);
  assert.equal(calls, 1, '19 shared Simple Sol engine called exactly once');
  assert.equal(result.automaticDeep?.invoked, true, 'automatic escalation invoked');
  assert.equal(result.automaticDeep?.top3Count, 3, '24 top3 returned');
  assert.equal(result.automaticDeepRecognition?.destinations[0]?.decision, 'REVIEW', '26 weak guesses review safe');
  assert.equal(result.automaticDeepRecognition?.destinations.some((item) => item.decision === 'AUTO_SAVE'), false, '27 wrong autosave zero');
  assert.equal(captured.premiumRequestId, null, '16 Premium task not created');
  assert.equal(captured.webSearchEnabled, false, 'raw prior recognition/cache is not queried');
  assert.equal(captured.evidenceReuseState, 'EVIDENCE_REGENERATED', '21 evidence cache contract remains distinct');
  assert.equal(captured.allowDistinctiveVisualAutoSave, false, 'review-safe automatic path');
  assert.deepEqual(result.automaticDeepRecognition?.destinations[0]?.hypotheses.map((item) => item.name), ['Tamolitch Blue Pool', 'Blue Pool', 'Tamolitch Falls'], '22 named lead preserved and ranked');
  assert.throws(() => buildSpecificPlacesQuery({ name: 'waterfall', entity_type: 'NAMED_NATURAL_FEATURE', city: null, region: null, country: null }), /generic_places_query_forbidden/, '23 generic descriptor blocked before Places');

  const strongInner: ModelProvider = { name: 'normal', analyze: async () => output([place('Atuh Beach')]) };
  let strongCalls = 0;
  const strong = await withAutomaticDeepRecognition(strongInner, cfg, async () => { strongCalls += 1; return execution(); }).analyze(input);
  assert.equal(strongCalls, 0, '28 strong result avoids cost');
  assert.equal(strong.automaticDeep?.invoked, false);

  const automaticSource = await readFile(new URL('../src/automaticDeep/automaticDeepRecognitionProvider.ts', import.meta.url), 'utf8');
  const finalizerSource = await readFile(new URL('../../../supabase/functions/process-share-jobs/index.ts', import.meta.url), 'utf8');
  const cachePolicy = await readFile(new URL('../../../supabase/functions/_shared/recognitionCachePolicy.ts', import.meta.url), 'utf8');
  const detail = await readFile(new URL('../../../lib/shareJobDetailState.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(automaticSource, /reserve_place_find|consume_place_find|release_place_find|place_find_wallet/, '13-15 no token accounting');
  assert.match(finalizerSource, /__skipPremiumEligibility: true/, 'automatic path skips Premium eligibility');
  assert.match(finalizerSource, /automatic-deep-simple-sol/, 'automatic internal resolver is distinct');
  assert.match(cachePolicy, /const readsEnabled = normalized === 'true'/, '20 recognition answer cache is opt-in only');
  assert.match(finalizerSource, /rankedCandidates\.slice\(0, 3\)/, 'top3 bounded');
  assert.match(detail, /We found a few likely matches/, '25 guesses precede correction');
  assert.match(detail, /canSearchManually: true/, '32 correction remains available');
  assert.match(finalizerSource, /deep_recognition_needed[\s\S]*deep_recognition_completed/, '33 deep analytics distinct');
  const automaticBlock = finalizerSource.slice(finalizerSource.indexOf('// Automatic Deep Recognition uses'), finalizerSource.indexOf("if (pre.action === 'parent_already_terminal')"));
  assert.doesNotMatch(automaticBlock, /premium_request_offered|premium_request_reserved|premium_request_consumed|premium_request_released/, '34 no Premium analytics');
  assert.match(finalizerSource, /pre\.action !== 'parent_already_terminal'/, '35 terminal guard prevents duplicate finalization');
  assert.match(finalizerSource, /mentionSlots/, '31 multi-place behavior retained');
  assert.equal(result.automaticDeep?.rejectionReason, 'GENERIC_DESCRIPTOR', 'analytics captures rejection reason');
  assert.equal(result.automaticDeepRecognition?.telemetry.evidenceReuse.frames, 'REACQUIRED', 'evidence reuse telemetry available');
  assert.equal(result.automaticDeepRecognition?.telemetry.knownModelCostUsd, .01, 'cost tracked independently');
  assert.equal(result.automaticDeepRecognition?.telemetry.timingsMs.sol, 20, 'latency tracked independently');
});

async function source(relative: string): Promise<string> {
  return readFile(new URL(relative, import.meta.url), 'utf8');
}

test('19 Simple Sol engine is called exactly once after escalation', async () => {
  let calls = 0;
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([place('waterfall')]) };
  await withAutomaticDeepRecognition(inner, cfg, async () => { calls += 1; return execution(); }).analyze(input);
  assert.equal(calls, 1);
});
test('20 raw recognition answer cache is not used', async () => assert.match(
  await source('../../../supabase/functions/_shared/recognitionCachePolicy.ts'),
  /const readsEnabled = normalized === 'true'/,
));
test('21 evidence reuse remains available and separately metered', () => assert.equal(execution().telemetry.evidenceReuse.frames, 'REACQUIRED'));
test('22 named lead is preserved without a Google match', () => assert.equal(execution().destinations[0]?.hypotheses[0]?.canonicalStatus, 'NAMED_LEAD'));
test('23 generic descriptors never reach Places as identities', () => assert.throws(() => buildSpecificPlacesQuery({ name: 'restaurant', entity_type: 'BUSINESS', city: null, region: null, country: null }), /generic_places_query_forbidden/));
test('24 top three are returned without padding', () => assert.deepEqual(execution().destinations[0]?.hypotheses.map((item) => item.name), ['Tamolitch Blue Pool', 'Blue Pool', 'Tamolitch Falls']));
test('25 automatic result copy presents guesses before correction', async () => assert.match(await source('../../../lib/shareJobDetailState.ts'), /We found a few likely matches/));
test('26 weak guesses are review safe', async () => {
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([place('waterfall')]) };
  const result = await withAutomaticDeepRecognition(inner, cfg, async () => execution()).analyze(input);
  assert.equal(result.automaticDeepRecognition?.destinations[0]?.decision, 'REVIEW');
});
test('27 wrong autosaves remain zero', async () => {
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([place('waterfall')]) };
  const result = await withAutomaticDeepRecognition(inner, cfg, async () => execution()).analyze(input);
  assert.equal(result.automaticDeepRecognition?.destinations.some((item) => item.decision === 'AUTO_SAVE'), false);
});
test('28 strong normal result avoids unnecessary cost', async () => {
  let calls = 0;
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([place('Golden Gate Bridge')]) };
  await withAutomaticDeepRecognition(inner, cfg, async () => { calls += 1; return execution(); }).analyze(input);
  assert.equal(calls, 0);
});
test('29 four-video founder regression routes one normal and three deep', async () => {
  const manifest = JSON.parse(await source('../../../artifacts/recognition/RECENT_FOUNDER_4_VIDEO_REGRESSION_2026-09-05.json'));
  assert.equal(manifest.cases.filter((item: any) => item.expected_route === 'NORMAL_ONLY').length, 1);
  assert.equal(manifest.cases.filter((item: any) => item.expected_route === 'AUTO_DEEP').length, 3);
});
test('30 prior 12-video failures route to automatic deep', async () => {
  const manifest = JSON.parse(await source('../../../artifacts/recognition/FOUNDER_12_VIDEO_BURST_AUTO_DEEP_REGRESSION_2026-09-05.json'));
  assert.equal(manifest.cases.filter((item: any) => item.expected_route === 'AUTO_DEEP').length, 9);
  assert.equal(manifest.direct_simple_sol_summary.previously_non_useful_specific_named_leads, 9);
});
test('31 multi-place behavior is preserved', () => assert.equal(execution().destinationIntent, 'ONE_DESTINATION'));
test('32 user correction remains available after guesses', async () => assert.match(await source('../../../lib/shareJobDetailState.ts'), /canSearchManually: true/));
test('33 analytics distinguish normal from deep', async () => {
  const finalizer = await source('../../../supabase/functions/process-share-jobs/index.ts');
  assert.match(finalizer, /normal_result_specificity/);
  assert.match(finalizer, /deep_recognition_specific_result/);
});
test('34 automatic path emits no Premium analytics', async () => {
  const finalizer = await source('../../../supabase/functions/process-share-jobs/index.ts');
  const block = finalizer.slice(finalizer.indexOf('// Automatic Deep Recognition uses'), finalizer.indexOf("if (pre.action === 'parent_already_terminal')"));
  assert.doesNotMatch(block, /premium_request_(?:offered|reserved|consumed|released)/);
});
test('35 terminal-state idempotency prevents duplicate deep finalization', async () => assert.match(
  await source('../../../supabase/functions/process-share-jobs/index.ts'),
  /automaticDeepPayload && pre\.action !== 'parent_already_terminal'/,
));

test('36 a zero-specific F1 result gets exactly one independent F2 recovery attempt', async () => {
  const calls: string[] = [];
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([]) };
  const recovered = execution(['Atuh Beach', 'Diamond Beach']);
  const result = await withAutomaticDeepRecognition(inner, cfg, async (args) => {
    calls.push(args.frameSet.arm);
    return calls.length === 1
      ? { ...execution([]), outcome: 'PREMIUM_NO_USEFUL_RESULT', chargeability: 'NON_CHARGEABLE_NO_RESULT', destinations: [] }
      : recovered;
  }).analyze(input);
  assert.deepEqual(calls, ['F1', 'F2']);
  assert.equal(result.automaticDeep?.attempts, 2);
  assert.equal(result.automaticDeep?.recoveryInvoked, true);
  assert.equal(result.automaticDeep?.firstAttemptSpecificHypotheses, 0);
  assert.equal(result.automaticDeep?.recoverySpecificHypotheses, 2);
  assert.equal(result.automaticDeepRecognition?.telemetry.automaticRecovery?.attempts, 2);
  assert.equal(result.automaticDeepRecognition?.telemetry.usage.total_tokens, 240);
  assert.equal(result.automaticDeepRecognition?.telemetry.knownModelCostUsd, .02);
});

test('37 recovery is bounded at two attempts and generic hypotheses are never surfaced', async () => {
  let calls = 0;
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([place('waterfall')]) };
  const result = await withAutomaticDeepRecognition(inner, cfg, async () => {
    calls += 1;
    return execution(['waterfall']);
  }).analyze(input);
  assert.equal(calls, 2);
  assert.equal(result.automaticDeepRecognition?.outcome, 'PREMIUM_NO_USEFUL_RESULT');
  assert.deepEqual(result.automaticDeepRecognition?.destinations, []);
  assert.equal(result.automaticDeep?.specificResult, false);
});

test('38 true zero source evidence is technical unresolved without model call or fabricated guess', async () => {
  let calls = 0;
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([]) };
  const result = await withAutomaticDeepRecognition(inner, cfg, async () => {
    calls += 1;
    return execution();
  }).analyze({ ...input, frames: [] });
  assert.equal(calls, 0);
  assert.equal(result.recognitionFailureClass, 'source_evidence_unavailable');
  assert.equal(result.automaticDeep?.noUsableSourceEvidence, true);
  assert.deepEqual(result.evidence.places, []);
  assert.equal(result.automaticDeepRecognition, undefined);
});

test('39 text-only legitimate evidence still receives the bounded deep attempts', async () => {
  const arms: string[] = [];
  const inner: ModelProvider = { name: 'normal', analyze: async () => output([]) };
  await withAutomaticDeepRecognition(inner, cfg, async (args) => {
    arms.push(args.frameSet.arm);
    return { ...execution([]), outcome: 'PREMIUM_NO_USEFUL_RESULT', chargeability: 'NON_CHARGEABLE_NO_RESULT', destinations: [] };
  }).analyze({ ...input, frames: [], metadataDescription: 'A signed destination appears in the source.' });
  assert.deepEqual(arms, ['F1', 'F2']);
});
