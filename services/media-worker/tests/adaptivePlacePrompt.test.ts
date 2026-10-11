import test from 'node:test';
import assert from 'node:assert/strict';
import { recognitionPrompt } from '../src/prompts/adaptivePlaceEvidencePrompt.js';
import { PLACE_EVIDENCE_SYSTEM_PROMPT, PROMPT_VERSION } from '../src/prompts/placeEvidencePrompt.js';
import { DistinctPlaceSignal, parseEvidenceWithDiagnostics } from '../src/types/evidence.js';
import { selectModelProvider } from '../src/providers/model.js';
import { planMediaFinalization } from '../../../supabase/functions/process-share-jobs/mediaFinalizationPlanner.ts';
import { parseMediaEvidence } from '../../../supabase/functions/process-share-jobs/mediaEvidence.ts';

test('default prompt bytes stay fixed; experimental prompt lists exactly the runtime scene-change vocabulary', () => {
  assert.deepEqual(recognitionPrompt(), { prompt: PLACE_EVIDENCE_SYSTEM_PROMPT, version: PROMPT_VERSION });
  const prompt = recognitionPrompt(true);
  for (const signal of DistinctPlaceSignal.options) assert.ok(prompt.prompt.includes(signal));
  assert.ok(prompt.prompt.startsWith(PLACE_EVIDENCE_SYSTEM_PROMPT));
  assert.notEqual(prompt.version, PROMPT_VERSION);
  const raw = { places: [{ name: 'Silver Lantern Cafe', distinctPlaceSignals: ['new_destination'] }], multipleIntentionalPlaces: false, insufficientEvidence: false, warnings: [] };
  assert.equal(parseEvidenceWithDiagnostics(raw).diagnostics.rejected, 1, 'invalid model outputs remain rejected');
  raw.places[0]!.distinctPlaceSignals = ['distinct_named_venue'];
  assert.equal(parseEvidenceWithDiagnostics(raw).diagnostics.accepted, 1);
});

test('live normal-provider option sends the enumerated prompt and records its version', async () => {
  const previous = globalThis.fetch;
  try {
    for (const enabled of [false, true]) {
      globalThis.fetch = async (_url, init) => {
        const request = JSON.parse(init?.body as string);
        assert.equal(request.contents[0].parts[0].text.startsWith(recognitionPrompt(enabled).prompt), true);
        return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ places: [], multipleIntentionalPlaces: false, insufficientEvidence: true, warnings: [] }) }] } }] }));
      };
      const result = await selectModelProvider({ analysisProvider: 'gemini', geminiApiKey: 'synthetic', geminiModel: 'gemini-3.5-flash-lite', maxSelectedFrames: 24 } as any,
        { closedSignalVocabulary: enabled }).analyze({ platform: 'native', canonicalUrl: 'neutral://synthetic', frames: [], transcript: [], ocr: [], signal: new AbortController().signal });
      assert.equal(result.promptVersion, recognitionPrompt(enabled).version);
    }
  } finally { globalThis.fetch = previous; }
});

test('atomic set guard converts an incomplete multi-place save to review while preserving the candidate', () => {
  const parsed = parseMediaEvidence({ places: [{ name: 'Silver Lantern Cafe', category: 'cafe', address: '42 Lantern Avenue',
    city: 'Westhaven', country: 'Testland', role: 'primary', confidence: .99,
    explicitEvidence: [{ source: 'caption', value: 'Silver Lantern Cafe at 42 Lantern Avenue, Westhaven', timestampSeconds: 0 }], inferredEvidence: [] }],
    multipleIntentionalPlaces: true, insufficientEvidence: false });
  if (!parsed.ok) throw new Error('fixture_invalid');
  const candidate = { name: 'Silver Lantern Cafe', googlePlaceId: 'synthetic-lantern', latitude: 42, longitude: -71,
    formattedAddress: '42 Lantern Avenue, Westhaven, Testland', types: ['cafe'], confidenceScore: .96, matchScore: .96, reasons: ['address_verified'] };
  const args = { groundedEvidence: parsed.value, ordinaryResult: { decision: 'candidate_confirmation', safeToAutoSave: false,
    primaryCandidate: candidate, candidates: [candidate], cleanSearchQuery: 'synthetic' }, sourceGeography: null,
    context: { autoSaveAuthorized: true, auditRecordPresent: true } };
  const control = planMediaFinalization(args);
  const atomic = planMediaFinalization({ ...args, atomicMultiPlace: true });
  assert.equal(atomic.autonomousPlaces.length, 0);
  assert.equal(atomic.status, 'needs_help');
  assert.equal(atomic.multiPlaceDetected, true);
  assert.ok(atomic.reviewCandidates.some((c) => c.googlePlaceId === candidate.googlePlaceId));
  assert.deepEqual(planMediaFinalization({ ...args, atomicMultiPlace: false }), control);
  assert.ok(atomic.reasonCodes.includes('incomplete_multi_place_set_requires_review'));
});
