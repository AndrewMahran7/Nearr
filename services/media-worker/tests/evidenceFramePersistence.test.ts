import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';

import { selectDurableEvidenceFrames, persistEvidenceFrames, evidenceFrameClaimPrefix } from '../src/pipeline/persistEvidenceFrames.js';
import type { MediaTask, SelectedFrame } from '../src/types/media.js';

function frame(timestampSeconds: number): SelectedFrame {
  return {
    path: `/tmp/frame-${timestampSeconds}.jpg`,
    timestampSeconds,
    width: 768,
    height: 432,
    aHash: String(timestampSeconds).padStart(16, '0'),
    reason: timestampSeconds === 0 ? 'first' : 'interval',
  };
}

const evidence = (timestamps: number[]) => ({
  places: [{
    name: 'Sunset Cliffs Natural Park', category: 'park' as const, categoryConfidence: 0.8,
    categoryEvidenceTags: [], address: null, city: 'San Diego',
    region: 'California', country: 'United States', coordinates: null, role: 'primary' as const,
    confidence: 0.8,
    explicitEvidence: timestamps.map((timestampSeconds) => ({
      source: 'frame' as const, value: 'Rocky coastline', timestampSeconds,
    })),
    inferredEvidence: [], memoryCue: null, memoryCueEvidence: [],
  }],
  multipleIntentionalPlaces: false,
  insufficientEvidence: false,
  warnings: [],
});

test('retains only frames actually selected by Vayrin, relevant first, capped at five', () => {
  const frames = [0, 4, 9, 14, 20, 30].map(frame);
  const selected = selectDurableEvidenceFrames({
    frames,
    evidence: evidence([9, 14]),
    vayrinSelectedTimestamps: [0, 4, 9, 14, 20, 30],
  });
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.slice(0, 2).map((item) => item.frame.timestampSeconds), [9, 14]);
  assert.ok(selected.every((item) => [0, 4, 9, 14, 20, 30].includes(item.frame.timestampSeconds)));
});

test('falls back to actual model input frames when Vayrin selection diagnostics are absent', () => {
  const frames = [0, 5, 10].map(frame);
  const selected = selectDurableEvidenceFrames({ frames, evidence: evidence([]) });
  assert.deepEqual(selected.map((item) => item.frame.timestampSeconds), [0, 5, 10]);
  assert.ok(selected.every((item) => item.relevance === 'analysis_coverage'));
});

const task = (attempts: number, lockedAt = '2026-10-08T20:00:00.000Z'): MediaTask => ({
  id: 'task', user_id: 'user', share_job_id: 'job', source_url: 'https://example.test/source',
  canonical_url: null, platform: 'instagram', status: 'processing', progress_stage: 'analyzing_evidence',
  attempts, max_attempts: 3, locked_at: lockedAt,
});

test('evidence paths preserve access-policy user/job prefix and isolate attempts and leases', () => {
  const one = evidenceFrameClaimPrefix(task(1));
  assert.ok(one?.startsWith('user/job/task--claim-1-'));
  assert.notEqual(one, evidenceFrameClaimPrefix(task(2)));
  assert.notEqual(one, evidenceFrameClaimPrefix(task(1, '2026-10-08T20:01:00Z')));
  assert.equal(one, evidenceFrameClaimPrefix(task(1, '2026-10-08T13:00:00-07:00')));
  assert.equal(evidenceFrameClaimPrefix({ ...task(1), locked_at: null }), null);
  assert.equal(evidenceFrameClaimPrefix(task(Number.NaN)), null);
});

test('late old-claim cleanup/upload cannot delete or replace newer accepted evidence', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'evidence-claim-race-'));
  const objects = new Map<string, Buffer>([['user/job/task/legacy.jpg', Buffer.from('legacy bytes')]]);
  const removed: string[] = [];
  let oldStarted!: () => void;
  let releaseOld!: () => void;
  const oldListingStarted = new Promise<void>((resolve) => { oldStarted = resolve; });
  const oldBlocked = new Promise<void>((resolve) => { releaseOld = resolve; });
  const oldPrefix = evidenceFrameClaimPrefix(task(1))!;
  const newPrefix = evidenceFrameClaimPrefix(task(2))!;
  const client = { storage: { from: () => ({
    list: async (prefix: string) => {
      if (prefix === oldPrefix) { oldStarted(); await oldBlocked; }
      return { data: [...objects.keys()].filter((key) => key.startsWith(`${prefix}/`))
        .map((key) => ({ name: key.slice(prefix.length + 1) })), error: null };
    },
    remove: async (keys: string[]) => { keys.forEach((key) => { removed.push(key); objects.delete(key); }); return { error: null }; },
    upload: async (key: string, bytes: Buffer) => { objects.set(key, Buffer.from(bytes)); return { error: null }; },
  }) } } as unknown as SupabaseClient;
  try {
    const oldFrame = { ...frame(1), path: path.join(directory, 'old.jpg') };
    const newFrame = { ...frame(1), path: path.join(directory, 'new.jpg') };
    await writeFile(oldFrame.path, 'old evidence'); await writeFile(newFrame.path, 'new evidence');
    const oldRun = persistEvidenceFrames(client, task(1), [{ frame: oldFrame, relevance: 'candidate_evidence' }]);
    await oldListingStarted;
    const accepted = await persistEvidenceFrames(client, task(2), [{ frame: newFrame, relevance: 'candidate_evidence' }]);
    assert.equal(accepted.length, 1);
    assert.ok(accepted[0]!.storagePath.startsWith(`${newPrefix}/`));
    releaseOld();
    const stale = await oldRun;
    assert.equal(stale.length, 1);
    assert.notEqual(stale[0]!.id, accepted[0]!.id);
    assert.equal(objects.get(accepted[0]!.storagePath)?.toString(), 'new evidence');
    assert.equal(objects.get(stale[0]!.storagePath)?.toString(), 'old evidence');
    assert.equal(objects.get('user/job/task/legacy.jpg')?.toString(), 'legacy bytes');
    assert.ok(removed.every((key) => !key.startsWith(`${newPrefix}/`)));
  } finally { releaseOld(); await rm(directory, { recursive: true, force: true }); }
});
