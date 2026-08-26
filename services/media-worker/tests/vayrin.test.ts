import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';

import type { WorkerConfig } from '../src/config/env.js';
import type { ModelProvider } from '../src/providers/model.js';
import type { SelectedFrame } from '../src/types/media.js';
import { emptyEvidence } from '../src/types/evidence.js';
import { meanPairwiseDistance, selectFramesForVayrin } from '../src/vayrin/frameSelection.js';
import {
  extractResponseText,
  isRetryableFailure,
  parseVayrinPayload,
  resolveVayrinApiKey,
  runVisualGeolocation,
} from '../src/vayrin/visualGeolocationClient.js';
import {
  deduplicateSceneHypotheses,
  payloadToEvidence,
  shouldRunVayrinFallback,
  withVayrinFallback,
} from '../src/vayrin/visualGeolocationProvider.js';

function frame(index: number, hash: string): SelectedFrame {
  return {
    path: `frame-${index}.jpg`, timestampSeconds: index, width: 768, height: 432,
    aHash: hash, reason: index === 0 ? 'first' : 'interval',
  };
}

function hypothesis(name: string) {
  return {
    name, place_type: 'beach', city: 'Los Angeles', region: 'California',
    country: 'United States', specificity: 'natural_feature', confidence: 0.8,
    reasoning_summary: 'Distinctive sandstone bluff and beach geometry.',
    supporting_visual_clues: ['sandstone bluff'], supporting_textual_clues: [],
    conflicting_clues: [], needs_external_verification: true,
    evidence_basis: 'distinctive_visual_match' as const,
  };
}

test('diverse frame selection preserves chronology and increases visual spread', () => {
  const frames = [
    frame(0, '0000000000000000'), frame(1, '0000000000000001'),
    frame(2, 'ffffffffffffffff'), frame(3, 'fffffffffffffffe'),
  ];
  const uniform = selectFramesForVayrin(frames, 'uniform', 2);
  const diverse = selectFramesForVayrin(frames, 'diverse', 2);
  assert.deepEqual(diverse.frames.map((item) => item.timestampSeconds), [0, 3]);
  assert.deepEqual(diverse.decisions, [
    { timestampSeconds: 0, reason: 'boundary_first' },
    { timestampSeconds: 3, reason: 'boundary_last' },
  ]);
  assert.ok(meanPairwiseDistance(diverse.frames) >= meanPairwiseDistance(uniform.frames));
});

test('diverse selection cannot starve an earlier scene', () => {
  const frames = Array.from({ length: 18 }, (_, index) =>
    frame(index, index < 8 ? '0000000000000000' : index.toString(16).padStart(16, 'f')),
  );
  const selected = selectFramesForVayrin(frames, 'diverse', 6).frames;
  assert.ok(selected.filter((item) => item.timestampSeconds < 8).length >= 2);
  assert.ok(selected.filter((item) => item.timestampSeconds >= 8).length >= 2);
});

test('coarse metadata does not suppress the visual fallback', () => {
  assert.deepEqual(shouldRunVayrinFallback({
    enabled: true, frameCount: 8, insufficientEvidence: false,
    explicitPlaceCount: 1, geographicOnlyPlaceCount: 1,
  }), { run: true, reason: 'only_coarse_geography' });
});

test('clean empty evidence does not spend Sol without a grounded recovery input', () => {
  assert.deepEqual(shouldRunVayrinFallback({
    enabled: true, frameCount: 8, insufficientEvidence: true,
    explicitPlaceCount: 0, geographicOnlyPlaceCount: 0,
    usefulPartialPlaceCount: 0, technicalFailure: false,
  }), { run: false, reason: 'no_grounded_recovery_input' });
});

test('grounded partial recovery uses cheap Places while technical emptiness may use Sol', () => {
  assert.deepEqual(shouldRunVayrinFallback({
    enabled: true, frameCount: 8, insufficientEvidence: false,
    explicitPlaceCount: 0, geographicOnlyPlaceCount: 0,
    usefulPartialPlaceCount: 1, technicalFailure: true,
  }), { run: false, reason: 'partial_recovery_sufficient' });
  assert.deepEqual(shouldRunVayrinFallback({
    enabled: true, frameCount: 8, insufficientEvidence: true,
    explicitPlaceCount: 0, geographicOnlyPlaceCount: 0,
    usefulPartialPlaceCount: 0, technicalFailure: true,
  }), { run: true, reason: 'technical_output_recovery' });
});

test('disabled feature flag returns the original provider and cannot call OpenAI', () => {
  const inner: ModelProvider = {
    name: 'test',
    async analyze() {
      return { provider: 'test', promptVersion: 'test', evidence: emptyEvidence() };
    },
  };
  const wrapped = withVayrinFallback(inner, {
    vayrinVisualGeolocationEnabled: false,
  } as WorkerConfig);
  assert.equal(wrapped, inner);
});

test('multi-place payload remains multiple with timestamp-associated segments', () => {
  const first = hypothesis('First Beach');
  const second = { ...hypothesis('Second Beach'), city: 'San Diego' };
  const mapped = payloadToEvidence({
    place_hypotheses: [first], multiple_distinct_places_visible: true,
    additional_place_segments: [{ frame_timestamps_seconds: [12, 18], hypotheses: [second] }],
    metadata_was_sufficient: false,
  });
  assert.equal(mapped.evidence.multipleIntentionalPlaces, true);
  assert.deepEqual(mapped.evidence.places.map((place) => place.name), ['First Beach', 'Second Beach']);
  assert.equal(mapped.evidence.places[1]?.explicitEvidence[0]?.timestampSeconds, 12);
});

test('Sol region-only output survives as noncanonical AREA evidence', () => {
  const broad = {
    ...hypothesis('Algarve'),
    city: null,
    region: 'Algarve',
    country: 'Portugal',
    specificity: 'region',
  };
  const mapped = payloadToEvidence({
    place_hypotheses: [broad],
    multiple_distinct_places_visible: false,
    additional_place_segments: [],
    metadata_was_sufficient: false,
  });
  assert.equal(mapped.evidence.places.length, 0);
  assert.equal(mapped.evidence.partialPlaces?.[0]?.region, 'Algarve');
  assert.equal(mapped.evidence.partialPlaces?.[0]?.nameHint, null);
  assert.equal(mapped.evidence.insufficientEvidence, false);
});

test('same-scene alternatives share one logical place while distinct scenes do not', () => {
  const first = hypothesis('North Cove');
  const spellingVariant = { ...hypothesis('North-Cove'), confidence: 0.7 };
  const alternative = { ...hypothesis('South Cove'), confidence: 0.65 };
  const secondScene = { ...hypothesis('Harbor Point'), city: 'San Diego' };
  assert.equal(deduplicateSceneHypotheses([first, spellingVariant, alternative]).length, 2);
  const mapped = payloadToEvidence({
    place_hypotheses: [first, spellingVariant, alternative],
    multiple_distinct_places_visible: true,
    additional_place_segments: [{ frame_timestamps_seconds: [15], hypotheses: [secondScene] }],
    metadata_was_sufficient: false,
  });
  assert.deepEqual(mapped.evidence.places.map((place) => place.logicalPlaceId), [
    'vayrin-scene-1', 'vayrin-scene-1', 'vayrin-scene-2',
  ]);
  assert.equal(mapped.evidence.multipleIntentionalPlaces, true);
});

test('famous-clip or contextual recognition is marked as a model prior', () => {
  const prior = { ...hypothesis('Famous Place'), evidence_basis: 'contextual_or_memory_prior' as const };
  const place = payloadToEvidence({
    place_hypotheses: [prior], multiple_distinct_places_visible: false,
    additional_place_segments: [], metadata_was_sufficient: false,
  }).evidence.places[0];
  assert.equal(place?.identityEvidenceKind, 'model_prior');
});

test('malformed structured output fails closed', () => {
  assert.equal(parseVayrinPayload(null), null);
  assert.equal(parseVayrinPayload({ nope: [] }), null);
  assert.deepEqual(parseVayrinPayload({
    place_hypotheses: [{ name: 'unsupported shape' }],
    multiple_distinct_places_visible: false,
    additional_place_segments: [], metadata_was_sufficient: false,
  })?.place_hypotheses, []);
});

test('Responses API extraction skips reasoning items and reads message content', () => {
  assert.equal(extractResponseText({
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'message', content: [{ type: 'output_text', text: '{"ok":true}' }] },
    ],
  }), '{"ok":true}');
});

test('API client keeps the key out of request JSON and returns structured usage', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'vayrin-client-test-'));
  const imagePath = path.join(directory, 'frame.png');
  await writeFile(imagePath, Buffer.from([137, 80, 78, 71]));
  const secret = 'test-secret-that-must-not-surface';
  const originalFetch = globalThis.fetch;
  let requestBody = '';
  globalThis.fetch = async (_input, init) => {
    requestBody = String(init?.body ?? '');
    const payload = {
      place_hypotheses: [hypothesis('Known Place')], multiple_distinct_places_visible: false,
      additional_place_segments: [], metadata_was_sufficient: false,
    };
    return new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(payload) }] }],
      usage: { input_tokens: 100, output_tokens: 25, total_tokens: 125 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const result = await runVisualGeolocation({
      frames: [{ path: imagePath, timestampSeconds: 1.5 }],
      context: { locationMetadata: 'Los Angeles, California' },
      env: { VAYRIN_OPENAI_API_KEY: secret },
    });
    assert.equal(result.ok, true);
    assert.equal(requestBody.includes(secret), false);
    assert.equal(requestBody.includes('data:image/png;base64,'), true);
    assert.equal(requestBody.includes('"store":false'), true);
    if (result.ok) {
      assert.equal(result.usage.totalTokens, 125);
      assert.equal(result.frameCount, 1);
      assert.equal(result.sentFrameCount, 1);
      assert.deepEqual(result.sentTimestampsSeconds, [1.5]);
    }
  } finally {
    globalThis.fetch = originalFetch;
    await rm(directory, { recursive: true, force: true });
  }
});

test('key resolution is environment-only and retry classification is transient-only', () => {
  const resolution = resolveVayrinApiKey({ OPENAI_API_KEY: '  key  ' });
  assert.equal(resolution.ok, true);
  if (resolution.ok) assert.equal(resolution.variable, 'OPENAI_API_KEY');
  assert.equal(isRetryableFailure('transient'), true);
  assert.equal(isRetryableFailure('malformed'), false);
  assert.equal(isRetryableFailure('permanent'), false);
});
