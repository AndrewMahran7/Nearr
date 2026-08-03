// services/media-worker/tests/cli.test.ts
//
// Deterministic tests for the media:inspect CLI's local-file support and
// provider gating. No network, no real video, no keys — pure logic + a tiny
// fake file for the copy/cleanup path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  parseInspectArgs,
  classifyVideoFile,
  isSupportedVideoExtension,
  fileExtension,
  buildProviderChecklist,
  type VideoFileFacts,
} from '../src/cli/inspectSupport.js';
import { prepareLocalFile } from '../src/cli/localFile.js';
import { loadConfig, type WorkerConfig } from '../src/config/env.js';
import { isMediaError } from '../src/types/media.js';

// ---- arg parsing (mutually exclusive) -------------------------------------
test('parseInspectArgs: --url only', () => {
  const r = parseInspectArgs(['node', 'x', '--url', 'https://a']);
  assert.equal(r.mode, 'url');
  if (r.mode === 'url') assert.equal(r.url, 'https://a');
});

test('parseInspectArgs: --file only + --out', () => {
  const r = parseInspectArgs(['node', 'x', '--file', 'C:/v.mp4', '--out', 'o.json']);
  assert.equal(r.mode, 'file');
  if (r.mode === 'file') {
    assert.equal(r.file, 'C:/v.mp4');
    assert.equal(r.out, 'o.json');
  }
});

test('parseInspectArgs: both --url and --file => error', () => {
  assert.equal(parseInspectArgs(['n', 'x', '--url', 'u', '--file', 'f']).mode, 'error');
});

test('parseInspectArgs: neither => error', () => {
  assert.equal(parseInspectArgs(['n', 'x']).mode, 'error');
});

test('parseInspectArgs: --file with no value => error', () => {
  assert.equal(parseInspectArgs(['n', 'x', '--file']).mode, 'error');
});

// ---- extensions -----------------------------------------------------------
test('isSupportedVideoExtension', () => {
  assert.ok(isSupportedVideoExtension('.mp4'));
  assert.ok(isSupportedVideoExtension('.MOV'));
  assert.ok(!isSupportedVideoExtension('.txt'));
  assert.ok(!isSupportedVideoExtension(''));
});

test('fileExtension handles Windows + no-ext + dotted dirs', () => {
  assert.equal(fileExtension('C:\\a\\b.MP4'), '.mp4');
  assert.equal(fileExtension('/x/y/noext'), '');
  assert.equal(fileExtension('/x.y/z'), '');
});

// ---- classifyVideoFile (pure) ---------------------------------------------
const facts = (o: Partial<VideoFileFacts>): VideoFileFacts => ({
  exists: true,
  isDirectory: false,
  isFile: true,
  sizeBytes: 1000,
  ext: '.mp4',
  ...o,
});

test('classifyVideoFile: happy path', () => {
  assert.deepEqual(classifyVideoFile(facts({}), 2000), { ok: true, sizeBytes: 1000, ext: '.mp4' });
});

test('classifyVideoFile: rejects each bad case', () => {
  const reason = (f: Partial<VideoFileFacts>, max = 2000) => {
    const r = classifyVideoFile(facts(f), max);
    return r.ok ? 'ok' : r.reason;
  };
  assert.equal(reason({ exists: false }), 'not_found');
  assert.equal(reason({ isDirectory: true }), 'is_directory');
  assert.equal(reason({ isFile: false }), 'not_a_regular_file');
  assert.equal(reason({ ext: '.txt' }), 'unsupported_type');
  assert.equal(reason({ sizeBytes: 0 }), 'empty');
  assert.equal(reason({ sizeBytes: 5000 }, 2000), 'too_large');
});

// ---- provider checklist (never reads values; injected presence) -----------
function fakeCfg(over: Partial<WorkerConfig>): WorkerConfig {
  return { ...loadConfig(), ...over } as WorkerConfig;
}

test('checklist: noop providers => NOT a genuine content test', () => {
  const cfg = fakeCfg({ transcriptionProvider: 'noop', analysisProvider: 'heuristic' });
  const cl = buildProviderChecklist(cfg, () => false);
  assert.equal(cl.genuineContentTest, false);
  assert.ok(cl.blockers.length >= 1);
  // Visual analysis is the required capability and must be reported missing.
  assert.deepEqual(
    cl.missingRequired.map((m) => m.capability),
    ['visual_analysis'],
  );
  // Reports env var NAMES, not values.
  const transcription = cl.capabilities.find((c) => c.capability === 'transcription')!;
  assert.ok(transcription.envVars.some((v) => v.includes('MEDIA_TRANSCRIPTION_API_KEY')));
});

test('checklist: real providers => genuine + places configured', () => {
  const cfg = fakeCfg({ transcriptionProvider: 'openai', analysisProvider: 'gemini' });
  const present = new Set(['GEMINI_API_KEY', 'GOOGLE_PLACES_KEY']);
  const cl = buildProviderChecklist(cfg, (n) => present.has(n));
  assert.equal(cl.genuineContentTest, true);
  assert.equal(cl.placesVerificationConfigured, true);
  assert.equal(cl.blockers.length, 0);
});

test('checklist: gemini provider without key is NOT genuine', () => {
  const cfg = fakeCfg({ transcriptionProvider: 'openai', analysisProvider: 'gemini' });
  const cl = buildProviderChecklist(cfg, () => false);
  assert.equal(cl.genuineContentTest, false);
});

// ---- prepareLocalFile: copy into temp, original untouched, cleanup ---------
test('prepareLocalFile copies into temp, never mutates original, temp is removable', async () => {
  const cfg = loadConfig();
  const srcDir = await mkdtemp(path.join(tmpdir(), 'mi-src-'));
  const src = path.join(srcDir, 'clip.mp4');
  const bytes = Buffer.from('FAKE_VIDEO_BYTES');
  await writeFile(src, bytes);

  const work = await mkdtemp(path.join(tmpdir(), 'mi-work-'));
  const media = await prepareLocalFile(cfg, src, work);

  assert.equal(media.source, 'local-file');
  assert.ok(media.localFilePath.startsWith(work), 'copy must live in the isolated temp dir');
  assert.ok(media.canonicalUrl.startsWith('local-file://'));
  const destStat = await stat(media.localFilePath);
  assert.equal(destStat.size, bytes.length);

  // Original is byte-for-byte unchanged and still present.
  assert.equal((await readFile(src)).toString(), 'FAKE_VIDEO_BYTES');

  // Cleanup removes the temp COPY; the original survives.
  await rm(work, { recursive: true, force: true });
  await assert.rejects(stat(media.localFilePath), 'temp copy must be gone after cleanup');
  await stat(src); // original still there → no throw

  await rm(srcDir, { recursive: true, force: true });
});

test('prepareLocalFile rejects a directory', async () => {
  const cfg = loadConfig();
  const dir = await mkdtemp(path.join(tmpdir(), 'mi-dir-'));
  await assert.rejects(
    prepareLocalFile(cfg, dir, dir),
    (e) => isMediaError(e) && e.code === 'unsupported_url',
  );
  await rm(dir, { recursive: true, force: true });
});

test('prepareLocalFile rejects an unsupported file type', async () => {
  const cfg = loadConfig();
  const srcDir = await mkdtemp(path.join(tmpdir(), 'mi-txt-'));
  const src = path.join(srcDir, 'note.txt');
  await writeFile(src, 'not a video');
  const work = await mkdtemp(path.join(tmpdir(), 'mi-w2-'));
  await assert.rejects(
    prepareLocalFile(cfg, src, work),
    (e) => isMediaError(e) && e.code === 'invalid_media',
  );
  await rm(srcDir, { recursive: true, force: true });
  await rm(work, { recursive: true, force: true });
});

test('prepareLocalFile rejects a missing file', async () => {
  const cfg = loadConfig();
  const work = await mkdtemp(path.join(tmpdir(), 'mi-w3-'));
  await assert.rejects(
    prepareLocalFile(cfg, path.join(work, 'nope.mp4'), work),
    (e) => isMediaError(e) && e.code === 'unsupported_url' && e.detail === 'file_not_found',
  );
  await rm(work, { recursive: true, force: true });
});
