import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groundClaimedEvidence, heuristicEvidence, selectModelProvider, type AnalyzeInput } from '../src/providers/model.js';
import type { MediaPlaceEvidence } from '../src/types/evidence.js';
import { loadConfig } from '../src/config/env.js';
import { isMediaError } from '../src/types/media.js';
import { deduplicateOcrSegments } from '../src/providers/ocr.js';
import type { OcrSegment, TranscriptSegment } from '../src/types/media.js';

function analyzeInput(over: Partial<AnalyzeInput> = {}): AnalyzeInput {
  return {
    platform: 'instagram',
    canonicalUrl: 'https://www.instagram.com/reel/abc/',
    transcript: [],
    ocr: [],
    frames: [],
    signal: new AbortController().signal,
    ...over,
  };
}

test('heuristicEvidence: no text → insufficient', () => {
  const e = heuristicEvidence(analyzeInput());
  assert.equal(e.insufficientEvidence, true);
  assert.equal(e.places.length, 0);
});

test('heuristicEvidence: spoken name + visible address → explicit evidence', () => {
  const transcript: TranscriptSegment[] = [
    { startSeconds: 1.2, endSeconds: 3.5, text: "We're at Capones Cucina and it's incredible" },
  ];
  const ocr: OcrSegment[] = [{ timestampSeconds: 4, text: '19688 Beach Blvd Huntington Beach', confidence: 0.9 }];
  const e = heuristicEvidence(analyzeInput({ transcript, ocr }));
  assert.equal(e.insufficientEvidence, false);
  assert.equal(e.places.length, 1);
  const p = e.places[0]!;
  assert.ok(p.explicitEvidence.length >= 1);
  assert.ok(p.address && /Beach Blvd/.test(p.address));
});

test('heuristicEvidence: address only still surfaces explicit evidence', () => {
  const ocr: OcrSegment[] = [{ timestampSeconds: 2, text: '126 Main St', confidence: 0.8 }];
  const e = heuristicEvidence(analyzeInput({ ocr }));
  assert.equal(e.insufficientEvidence, false);
  assert.ok(e.places[0]!.explicitEvidence.some((x) => /Main St/.test(x.value)));
});

test('deduplicateOcrSegments collapses repeated adjacent text', () => {
  const segs: OcrSegment[] = [
    { timestampSeconds: 1, text: 'CAPONES CUCINA', confidence: 0.9 },
    { timestampSeconds: 2, text: 'capones  cucina', confidence: 0.8 },
    { timestampSeconds: 3, text: '19688 Beach Blvd', confidence: 0.9 },
  ];
  const out = deduplicateOcrSegments(segs);
  assert.equal(out.length, 2);
});

test('groundClaimedEvidence keeps quoted caption/speech and drops fabricated claims', () => {
  const evidence: MediaPlaceEvidence = {
    places: [{
      name: 'Capones Cucina', category: null, categoryConfidence: 0, categoryEvidenceTags: [], address: null, city: null, region: null,
      country: null, coordinates: null, role: 'primary', confidence: 0.99,
      explicitEvidence: [
        { source: 'caption', value: 'Capones Cucina', timestampSeconds: null },
        { source: 'speech', value: 'welcome to Capones Cucina', timestampSeconds: 1 },
        { source: 'speech', value: 'Fabricated Cafe', timestampSeconds: 2 },
        { source: 'frame', value: 'CAPONES CUCINA', timestampSeconds: 3 },
      ],
      inferredEvidence: [],
      memoryCue: null,
      memoryCueEvidence: [],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  };
  const grounded = groundClaimedEvidence(evidence, {
    metadataTitle: 'Dinner at Capones Cucina',
    metadataDescription: null,
    transcript: [{ startSeconds: 0, endSeconds: 2, text: 'Welcome to Capones Cucina' }],
  });
  assert.deepEqual(grounded.places[0]!.explicitEvidence.map((item) => item.source), ['caption', 'speech', 'frame']);
  assert.ok(grounded.warnings.includes('ungrounded_explicit_evidence_dropped'));
});

test('groundClaimedEvidence marks inferred-only result insufficient', () => {
  const evidence: MediaPlaceEvidence = {
    places: [{
      name: 'Fabricated Cafe', category: null, categoryConfidence: 0, categoryEvidenceTags: [], address: null, city: null, region: null,
      country: null, coordinates: null, role: 'primary', confidence: 1,
      explicitEvidence: [{ source: 'caption', value: 'Fabricated Cafe', timestampSeconds: null }],
      inferredEvidence: [],
      memoryCue: null,
      memoryCueEvidence: [],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  };
  const grounded = groundClaimedEvidence(evidence, { metadataTitle: null, metadataDescription: null, transcript: [] });
  assert.equal(grounded.insufficientEvidence, true);
  assert.equal(grounded.places[0]!.explicitEvidence.length, 0);
});

test('groundClaimedEvidence drops an unsupported memory cue source', () => {
  const evidence: MediaPlaceEvidence = {
    places: [{
      name: 'Matcha House', category: 'cafe', categoryConfidence: 0.9, categoryEvidenceTags: [], address: null,
      city: null, region: null, country: null, coordinates: null, role: 'primary', confidence: 0.9,
      explicitEvidence: [{ source: 'caption', value: 'Matcha House', timestampSeconds: null }],
      inferredEvidence: [],
      memoryCue: 'Try the lobster roll and caviar flight they showed',
      memoryCueEvidence: [{ source: 'speech', value: 'lobster roll and caviar flight', timestampSeconds: 3 }],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  };
  const grounded = groundClaimedEvidence(evidence, {
    metadataTitle: 'Matcha House',
    metadataDescription: null,
    transcript: [{ startSeconds: 0, endSeconds: 2, text: 'Try the matcha flight' }],
  });
  assert.equal(grounded.places[0]!.memoryCue, null);
  assert.deepEqual(grounded.places[0]!.memoryCueEvidence, []);
});

test('a sign the model read survives when no separate OCR pass ran', () => {
  // Regression: `selectOcrProvider` returns the noop provider for every
  // configured value, so `ocr` is always empty and `ocrExtracted` is false.
  // Validating a visible-text cue claim against that empty stream is not a
  // stricter test, it is an unconditional one — it silently nulled the cue on
  // every post whose hook was a sign, menu board, or on-screen offer date.
  const evidence: MediaPlaceEvidence = {
    places: [{
      name: "Tuxedo Cat's Coffee", category: 'cafe', categoryConfidence: 0.9, categoryEvidenceTags: [],
      address: null, city: null, region: null, country: null, coordinates: null,
      role: 'primary', confidence: 0.9,
      explicitEvidence: [{ source: 'caption', value: "Tuxedo Cat's Coffee", timestampSeconds: null }],
      inferredEvidence: [],
      memoryCue: 'Special drink Sept 1-14. Definitely a limited-time move',
      memoryCueEvidence: [
        { source: 'visible_text', value: 'Special drink September 1 through September 14', timestampSeconds: 4 },
      ],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  };
  const grounded = groundClaimedEvidence(evidence, {
    metadataTitle: "Tuxedo Cat's Coffee",
    metadataDescription: null,
    transcript: [],
    ocr: [],
    ocrExtracted: false,
  });
  assert.equal(grounded.places[0]!.memoryCue, 'Special drink Sept 1-14. Definitely a limited-time move');
  assert.equal(grounded.places[0]!.memoryCueEvidence.length, 1);
});

test('a real OCR pass still corroborates visible-text cue claims', () => {
  const evidence: MediaPlaceEvidence = {
    places: [{
      name: 'Matcha House', category: 'cafe', categoryConfidence: 0.9, categoryEvidenceTags: [],
      address: null, city: null, region: null, country: null, coordinates: null,
      role: 'primary', confidence: 0.9,
      explicitEvidence: [{ source: 'caption', value: 'Matcha House', timestampSeconds: null }],
      inferredEvidence: [],
      memoryCue: 'That caviar flight on the board looks absurd',
      memoryCueEvidence: [{ source: 'visible_text', value: 'caviar flight', timestampSeconds: 3 }],
    }],
    multipleIntentionalPlaces: false,
    insufficientEvidence: false,
    warnings: [],
  };
  const grounded = groundClaimedEvidence(evidence, {
    metadataTitle: 'Matcha House',
    metadataDescription: null,
    transcript: [],
    ocr: [{ timestampSeconds: 0, text: 'MATCHA FLIGHT 12', confidence: 1 }],
    ocrExtracted: true,
  });
  assert.equal(grounded.places[0]!.memoryCue, null);
  assert.deepEqual(grounded.places[0]!.memoryCueEvidence, []);
});

test('Gemini 429 retains usable transcript evidence', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 429, headers: { 'retry-after': '45' } })) as typeof fetch;
  try {
    const provider = selectModelProvider({
      ...loadConfig(),
      analysisProvider: 'gemini',
      geminiApiKey: 'test-key',
      maxSelectedFrames: 0,
    });
    const output = await provider.analyze(analyzeInput({
      transcript: [{ startSeconds: 0, endSeconds: 2, text: "We're at Capones Cucina" }],
    }));
    assert.equal(output.provider, 'gemini+heuristic');
    assert.equal(output.evidence.places[0]?.name, 'Capones Cucina');
    assert.ok(output.evidence.warnings.includes('gemini_http_429'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Gemini 429 without partial evidence is retryable and honors Retry-After', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('', { status: 429, headers: { 'retry-after': '45' } })) as typeof fetch;
  try {
    const provider = selectModelProvider({
      ...loadConfig(),
      analysisProvider: 'gemini',
      geminiApiKey: 'test-key',
      maxSelectedFrames: 0,
    });
    await assert.rejects(
      () => provider.analyze(analyzeInput()),
      (error: unknown) => isMediaError(error) && error.code === 'provider_rate_limited' && error.retryAfterSeconds === 45,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
