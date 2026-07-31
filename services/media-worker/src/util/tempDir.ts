// services/media-worker/src/util/tempDir.ts
//
// Per-job isolated temp directory with guaranteed teardown. Everything a task
// downloads or produces (video, audio, frames, browser state) lives under one
// directory that is removed in `finally` on success, failure, cancellation,
// and timeout.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export type JobTemp = {
  dir: string;
  file: (name: string) => string;
  cleanup: () => Promise<void>;
};

export async function createJobTemp(baseDir: string, taskId: string): Promise<JobTemp> {
  const root = baseDir || tmpdir();
  const safeId = taskId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40) || 'task';
  const dir = await mkdtemp(path.join(root, `nearr-media-${safeId}-`));
  return {
    dir,
    file: (name: string) => path.join(dir, name.replace(/[^a-zA-Z0-9._-]/g, '_')),
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true }).catch(() => {
        /* best-effort; never throw from cleanup */
      });
    },
  };
}
