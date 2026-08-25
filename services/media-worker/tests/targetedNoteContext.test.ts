import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { evaluateAiPlaceNote } from '../../../lib/aiPlaceNote.js';
import { loadConfig } from '../src/config/env.js';
import {
  buildDurableTargetEvidence,
  buildTargetedNoteContext,
  findTargetEvidenceHandoff,
} from '../src/pipeline/targetedNoteContext.js';
import { selectModelProvider } from '../src/providers/model.js';
import {
  encodeRetainedFrameSnapshot,
  MAX_RETAINED_FRAME_BYTES,
  restoreRetainedFrameSnapshot,
} from '../src/pipeline/retainedFrameSnapshot.js';
import type { SelectedFrame } from '../src/types/media.js';

function frame(timestampSeconds: number): SelectedFrame {
  return {
    path: `frame-${timestampSeconds}.jpg`,
    timestampSeconds,
    width: 768,
    height: 1024,
    aHash: String(timestampSeconds).padStart(16, '0'),
    reason: 'interval',
  };
}

test('multi-place handoff isolates the final saved place scene', () => {
  const payload = {
    mentionSlots: [
      {
        mentionId: 'm1',
        displayName: 'Burger House',
        candidates: [{ googlePlaceId: 'g-a' }],
        noteEvidence: [{ source: 'frame', value: 'smashburger with crispy edges', timestampSeconds: 5 }],
        noteTimestamps: [5],
      },
      {
        mentionId: 'm2',
        displayName: 'Cliff Cove',
        candidates: [{ googlePlaceId: 'g-b' }],
        noteEvidence: [{ source: 'frame', value: 'turquoise cove surrounded by cliffs', timestampSeconds: 40 }],
        noteTimestamps: [40],
      },
    ],
  };
  const handoff = findTargetEvidenceHandoff([payload], { name: 'Burger House', googlePlaceId: 'g-a' });
  assert.deepEqual(handoff?.timestamps, [5]);
  assert.deepEqual(handoff?.evidence.map((item) => item.value), ['smashburger with crispy edges']);

  const context = buildTargetedNoteContext({
    frames: [frame(4), frame(5), frame(8), frame(39), frame(40), frame(43)],
    transcript: [
      { startSeconds: 3, endSeconds: 6, text: 'crispy smashburger' },
      { startSeconds: 38, endSeconds: 42, text: 'turquoise water' },
    ],
    ocr: [
      { timestampSeconds: 5, text: 'BURGER HOUSE', confidence: 1 },
      { timestampSeconds: 40, text: 'CLIFF COVE', confidence: 1 },
    ],
    handoff,
    maxFrames: 24,
  });
  assert.deepEqual(context.frames.map((item) => item.timestampSeconds), [4, 5, 8]);
  assert.deepEqual(context.transcript.map((item) => item.text), ['crispy smashburger']);
  assert.deepEqual(context.ocr.map((item) => item.text), ['BURGER HOUSE']);
  assert.equal(context.sceneScoped, true);

  const placeBHandoff = findTargetEvidenceHandoff(
    [payload],
    { name: 'Cliff Cove', googlePlaceId: 'g-b' },
  );
  const placeBContext = buildTargetedNoteContext({
    frames: [frame(4), frame(5), frame(8), frame(39), frame(40), frame(43)],
    transcript: [
      { startSeconds: 3, endSeconds: 6, text: 'crispy smashburger' },
      { startSeconds: 38, endSeconds: 42, text: 'turquoise water' },
    ],
    ocr: [
      { timestampSeconds: 5, text: 'BURGER HOUSE', confidence: 1 },
      { timestampSeconds: 40, text: 'CLIFF COVE', confidence: 1 },
    ],
    handoff: placeBHandoff,
    maxFrames: 24,
  });
  assert.deepEqual(placeBContext.frames.map((item) => item.timestampSeconds), [39, 40, 43]);
  assert.deepEqual(placeBContext.transcript.map((item) => item.text), ['turquoise water']);
  assert.deepEqual(placeBContext.ocr.map((item) => item.text), ['CLIFF COVE']);
  assert.deepEqual(placeBContext.evidence.map((item) => item.value), [
    'turquoise cove surrounded by cliffs',
  ]);
});

test('unsaved candidates have observations but no note-generation obligation', () => {
  const payload = {
    mentionSlots: [{
      mentionId: 'm1',
      displayName: 'Hotel One',
      candidates: [{ googlePlaceId: 'g-hotel' }],
      noteEvidence: [{ source: 'frame', value: 'infinity pool overlooking the ocean', timestampSeconds: 9 }],
      aiNote: null,
    }],
  };
  const handoff = findTargetEvidenceHandoff([payload], { name: 'Hotel One', googlePlaceId: 'g-hotel' });
  assert.equal(handoff?.evidence.length, 1);
  assert.equal(payload.mentionSlots[0]!.aiNote, null);
});

test('weak unscoped context can widen from focused to representative frames', () => {
  const frames = Array.from({ length: 20 }, (_, index) => frame(index));
  const focused = buildTargetedNoteContext({
    frames,
    transcript: [],
    ocr: [],
    handoff: null,
    maxFrames: 24,
  });
  const expanded = buildTargetedNoteContext({
    frames,
    transcript: [],
    ocr: [],
    handoff: null,
    expanded: true,
    maxFrames: 24,
  });
  assert.equal(focused.frames.length, 8);
  assert.equal(expanded.frames.length, 16);
});

test('extracted target text is durable before a provider outage', () => {
  const evidence = buildDurableTargetEvidence({
    current: [{ source: 'frame', value: 'oceanfront pool', timestampSeconds: 9 }],
    transcript: [{ text: 'the pool faces the ocean', startSeconds: 8, endSeconds: 10 }],
    transcriptSource: 'speech',
    ocr: [{ text: 'ROOFTOP POOL', timestampSeconds: 9, confidence: 1 }],
    metadataTitle: 'A hotel tour',
    metadataDescription: 'Creator caption',
    includeMetadata: false,
  });
  assert.deepEqual(evidence.map((item) => item.source), ['frame', 'visible_text', 'speech']);
  assert.ok(evidence.every((item) => item.timestampSeconds !== null));
  assert.ok(!evidence.some((item) => item.value === 'Creator caption'));
});

test('unscoped source metadata is retained as bounded caption evidence', () => {
  const evidence = buildDurableTargetEvidence({
    current: [],
    transcript: [],
    transcriptSource: 'caption',
    ocr: [],
    metadataTitle: '  Ocean   hotel tour  ',
    metadataDescription: 'Infinity pool overlooking the water',
    includeMetadata: true,
  });
  assert.deepEqual(evidence.map((item) => item.value), [
    'Ocean hotel tour',
    'Infinity pool overlooking the water',
  ]);
});

test('one bounded frame snapshot survives temp cleanup and rejects oversized blobs', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nearr-retained-frame-'));
  const source = path.join(dir, 'source.jpg');
  const restored = path.join(dir, 'restored.jpg');
  try {
    await writeFile(source, new Uint8Array([0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]));
    const snapshot = await encodeRetainedFrameSnapshot([{ ...frame(12), path: source }]);
    assert.ok(snapshot);
    await rm(source);
    const retained = await restoreRetainedFrameSnapshot({
      value: snapshot?.postgresBytea,
      timestampSeconds: snapshot?.timestampSeconds,
      outputPath: restored,
    });
    assert.equal(retained?.timestampSeconds, 12);
    assert.deepEqual([...await readFile(restored)], [0xff, 0xd8, 0x11, 0x22, 0xff, 0xd9]);
    const oversized = path.join(dir, 'oversized.jpg');
    await writeFile(oversized, new Uint8Array(MAX_RETAINED_FRAME_BYTES + 1));
    assert.equal(await encodeRetainedFrameSnapshot([{ ...frame(13), path: oversized }]), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

const visualCases = [
  {
    label: 'food',
    placeName: 'Burger House',
    category: 'restaurant',
    observation: 'smashburger with crispy edges',
    note: 'That smashburger with crispy edges looked ridiculous.',
  },
  {
    label: 'outdoor',
    placeName: 'Cliff Cove',
    category: 'beach',
    observation: 'cliff-lined turquoise cove',
    note: 'That turquoise cove makes me want to dive in.',
  },
  {
    label: 'hotel',
    placeName: 'Ocean Hotel',
    category: 'hotel',
    observation: 'infinity pool overlooking the ocean',
    note: "I'd stay for that infinity pool alone.",
  },
  {
    label: 'visible activity',
    placeName: 'Cliff Cove',
    category: 'beach',
    observation: 'people jumping from the cliff into the water below',
    note: 'People were jumping from the cliff into the water below.',
  },
] as const;

for (const fixture of visualCases) {
  test(`visual-heavy ${fixture.label} fixture yields a grounded cue with empty text`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'nearr-note-'));
    const imagePath = path.join(dir, 'frame.jpg');
    await writeFile(imagePath, new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    const originalFetch = globalThis.fetch;
    let requestBody: any = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body));
      const modelPayload = {
        note: fixture.note,
        evidence: [{ source: 'frame', value: fixture.observation, timestampSeconds: 7 }],
      };
      return new Response(JSON.stringify({
        candidates: [{ content: { parts: [{ text: JSON.stringify(modelPayload) }] } }],
        usageMetadata: {
          promptTokenCount: 900,
          candidatesTokenCount: 80,
          thoughtsTokenCount: 20,
          totalTokenCount: 1000,
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    try {
      const provider = selectModelProvider({
        ...loadConfig(),
        analysisProvider: 'gemini',
        geminiApiKey: 'test-key',
        maxSelectedFrames: 8,
      });
      const output = await provider.analyze({
        platform: 'instagram',
        canonicalUrl: 'https://www.instagram.com/reel/visual/',
        transcript: [],
        ocr: [],
        ocrExtracted: false,
        frames: [{ ...frame(7), path: imagePath }],
        metadataTitle: null,
        metadataDescription: null,
        targetPlace: { name: fixture.placeName, category: fixture.category },
        signal: new AbortController().signal,
      });
      const place = output.evidence.places[0]!;
      const evaluated = evaluateAiPlaceNote({
        placeName: fixture.placeName,
        proposedNote: place.memoryCue,
        evidence: place.memoryCueEvidence,
      });
      assert.equal(evaluated.note, fixture.note);
      assert.equal(requestBody.contents[0].parts.filter((part: any) => part.inlineData).length, 1);
      assert.match(requestBody.systemInstruction.parts[0].text, /Vayrin Voice/);
      assert.match(requestBody.systemInstruction.parts[0].text, /does not summarize videos/i);
      assert.match(requestBody.contents[0].parts[0].text, /untrusted_saved_post_evidence/);
      assert.equal(requestBody.generationConfig.temperature, 1);
      assert.equal(requestBody.generationConfig.maxOutputTokens, 256);
      assert.equal(requestBody.generationConfig.thinkingConfig.thinkingBudget, 0);
      assert.deepEqual(output.usage, {
        inputTokens: 900,
        outputTokens: 80,
        thinkingTokens: 20,
        totalTokens: 1000,
      });
      assert.ok(Number.isFinite(output.latencyMs));
    } finally {
      globalThis.fetch = originalFetch;
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('provider outage recovers from durable evidence after frames are gone', async () => {
  const retainedEvidence = buildDurableTargetEvidence({
    current: [{ source: 'frame', value: 'smashburger with crispy edges', timestampSeconds: 7 }],
    transcript: [],
    transcriptSource: 'speech',
    ocr: [],
    includeMetadata: false,
  });
  const provider = selectModelProvider({
    ...loadConfig(),
    analysisProvider: 'gemini',
    geminiApiKey: 'test-key',
    maxSelectedFrames: 8,
  });
  const originalFetch = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = (async () => {
    attempts += 1;
    if (attempts === 1) return new Response('', { status: 503 });
    const modelPayload = {
      note: 'That smashburger with crispy edges looked ridiculous.',
      evidence: retainedEvidence,
    };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: JSON.stringify(modelPayload) }] } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  const input = {
    platform: 'instagram',
    canonicalUrl: 'https://www.instagram.com/reel/outage/',
    transcript: [],
    ocr: [],
    ocrExtracted: false,
    frames: [],
    metadataTitle: null,
    metadataDescription: null,
    targetPlace: { name: 'Burger House', category: 'restaurant' },
    retainedEvidence,
    signal: new AbortController().signal,
  };
  try {
    await assert.rejects(provider.analyze(input), /provider_unavailable/);
    const recovered = await provider.analyze(input);
    assert.equal(attempts, 2);
    assert.equal(
      recovered.evidence.places[0]?.memoryCue,
      'That smashburger with crispy edges looked ridiculous.',
    );
    assert.deepEqual(recovered.evidence.places[0]?.memoryCueEvidence, retainedEvidence);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
