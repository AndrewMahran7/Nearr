// services/media-worker/src/queue/processMediaTasks.ts
//
// Claim a batch of media tasks and run them with bounded concurrency. Claiming
// is atomic (FOR UPDATE SKIP LOCKED) so overlapping invocations (pg_net kick +
// pg_cron sweep) never process the same task twice.

import { claimMediaTasks, expireExhaustedTasks } from '../db/tasks.js';
import { runMediaTask, type TaskDeps } from '../pipeline/runMediaTask.js';
import { log } from '../util/logger.js';

export async function processMediaTasks(deps: TaskDeps): Promise<{ claimed: number; processed: number }> {
  const batchStartedAt = Date.now();
  const tasks = await claimMediaTasks(deps.client, deps.cfg);
  if (tasks.length === 0) {
    // Opportunistically clean up any exhausted rows even when idle.
    await expireExhaustedTasks(deps.client).catch(() => undefined);
    return { claimed: 0, processed: 0 };
  }

  const concurrency = Math.max(1, Math.min(deps.cfg.maxConcurrency, tasks.length));
  log.info('batch_started', {
    claimed: tasks.length,
    concurrency,
    configuredClaimBatch: deps.cfg.claimBatchSize,
    configuredMaxConcurrency: deps.cfg.maxConcurrency,
  });
  let index = 0;
  let processed = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const current = index;
      index += 1;
      const task = tasks[current];
      if (!task) return;
      try {
        await runMediaTask(deps, task);
        processed += 1;
      } catch (err) {
        // runMediaTask handles its own errors; this is a last-resort guard so
        // one task can never crash the batch.
        log.error('task_unhandled', {
          taskId: task.id,
          msg: err instanceof Error ? err.message : 'unknown',
        });
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  await expireExhaustedTasks(deps.client).catch(() => undefined);
  log.info('batch_completed', {
    claimed: tasks.length,
    processed,
    concurrency,
    durationMs: Date.now() - batchStartedAt,
  });
  return { claimed: tasks.length, processed };
}
