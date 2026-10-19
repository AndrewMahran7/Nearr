import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { runMediaTask, type TaskDeps } from '../src/pipeline/runMediaTask.js';
import type { MediaTask } from '../src/types/media.js';

const task: MediaTask = {
  id: 'adult-gate-test',
  share_job_id: 'parent-job',
  user_id: 'account-under-test',
  source_url: 'https://example.com/video',
  canonical_url: null,
  platform: 'instagram',
  status: 'processing',
  progress_stage: null,
  attempts: 1,
  max_attempts: 3,
};

test('unknown, underage, and revoked owners cannot reach any media or model provider', async () => {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  let providerCalls = 0;
  const query = (table: string) => ({
    update: (patch: Record<string, unknown>) => {
      updates.push({ table, patch });
      const chain = { eq: () => chain };
      return chain;
    },
  });
  const deps = {
    cfg: { tempDir: tmpdir(), jobTimeoutMs: 10_000 },
    client: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        assert.equal(name, 'is_adult_eligible_for_ai');
        assert.deepEqual(args, { p_user_id: task.user_id });
        return { data: false, error: null };
      },
      from: query,
    },
    resolvers: [{ resolve: () => { providerCalls++; throw new Error('media dispatched'); } }],
    transcription: { transcribe: () => { providerCalls++; throw new Error('transcription dispatched'); } },
    model: { analyze: () => { providerCalls++; throw new Error('model dispatched'); } },
    ocr: { extract: () => { providerCalls++; throw new Error('OCR dispatched'); } },
  } as unknown as TaskDeps;

  await runMediaTask(deps, task);
  assert.equal(providerCalls, 0);
  assert.deepEqual(updates.map(({ table, patch }) => [table, patch.status]), [
    ['share_media_tasks', 'needs_help'],
    ['share_jobs', 'needs_help'],
  ]);
  assert.equal(updates[0].patch.failure_code, 'age_eligibility_required');
  assert.equal(updates[1].patch.failure_code, 'age_eligibility_required');
});
