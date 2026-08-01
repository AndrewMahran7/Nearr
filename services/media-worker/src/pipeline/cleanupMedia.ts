// services/media-worker/src/pipeline/cleanupMedia.ts
//
// Guaranteed teardown of everything a task produced (video, audio, frames,
// gray hashes, normalized copies, any browser/cache state). This wraps the
// per-job temp directory removal so the orchestrator can call it in `finally`
// on success, failure, cancellation, and timeout.

import type { JobTemp } from '../util/tempDir.js';
import { log } from '../util/logger.js';

export async function cleanupMedia(jobTemp: JobTemp, taskId: string): Promise<void> {
  try {
    await jobTemp.cleanup();
    log.info('temp_cleaned', { taskId });
  } catch {
    // cleanup is best-effort and must never throw out of `finally`.
    log.warn('temp_cleanup_failed', { taskId });
  }
}
