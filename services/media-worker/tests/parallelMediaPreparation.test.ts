import { test } from 'node:test';
import assert from 'node:assert/strict';
import { joinMediaBranches } from '../src/pipeline/prepareMediaEvidence.js';

test('parallel evidence joins only when both branches finish and preserves their values', async () => {
  const events: string[] = [];
  let releaseAudio!: () => void;
  let releaseFrames!: () => void;
  const audioReady = new Promise<void>((resolve) => { releaseAudio = resolve; });
  const framesReady = new Promise<void>((resolve) => { releaseFrames = resolve; });
  const run = joinMediaBranches(new AbortController().signal, true,
    async () => { events.push('audio-start'); await audioReady; return 'transcript'; },
    async () => { events.push('frames-start'); await framesReady; return ['frame1', 'frame2']; });
  assert.deepEqual(events, ['audio-start', 'frames-start']);
  releaseFrames();
  releaseAudio();
  assert.deepEqual(await run, ['transcript', ['frame1', 'frame2']]);
});

test('fatal branch aborts sibling and awaits its cleanup before returning', async () => {
  let cleaned = false;
  const failure = new Error('bad_frames');
  await assert.rejects(joinMediaBranches(new AbortController().signal, true,
    (signal) => new Promise((resolve) => signal.addEventListener('abort', () => {
      queueMicrotask(() => { cleaned = true; resolve('cancelled'); });
    }, { once: true })),
    async () => { throw failure; }), (error) => error === failure);
  assert.equal(cleaned, true);
});

test('parent cancellation reaches both branches and no evidence result escapes', async () => {
  const parent = new AbortController();
  const cancelled: string[] = [];
  const branch = (name: string) => (signal: AbortSignal) => new Promise<string>((resolve) => {
    signal.addEventListener('abort', () => { cancelled.push(name); resolve(name); }, { once: true });
  });
  const run = joinMediaBranches(parent.signal, true, branch('audio'), branch('frames'));
  parent.abort();
  await assert.rejects(run, { name: 'AbortError' });
  assert.deepEqual(cancelled, ['audio', 'frames']);
});

test('expected ASR failure still joins intact visual evidence', async () => {
  const result = await joinMediaBranches(new AbortController().signal, true,
    async () => ({ status: 'failed', segments: [] }), async () => ['first_place', 'second_place']);
  assert.equal(result[0].status, 'failed');
  assert.deepEqual(result[1], ['first_place', 'second_place']);
});

test('serial replay preserves baseline ordering and pre-abort invokes nothing', async () => {
  const events: string[] = [];
  await joinMediaBranches(new AbortController().signal, false,
    async () => { events.push('audio'); return 1; }, async () => { events.push('frames'); return 2; });
  assert.deepEqual(events, ['audio', 'frames']);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(joinMediaBranches(controller.signal, true,
    async () => { throw new Error('must_not_run'); }, async () => { throw new Error('must_not_run'); }), { name: 'AbortError' });
});
