// services/media-worker/src/cli/localFile.ts
//
// Local-file input for media:inspect. Validates a user-supplied video path
// against the SAME production limits, copies it into an isolated temp dir, and
// returns a ResolvedMedia so the rest of the pipeline (inspectMedia → normalize
// → audio → transcribe → frames → analyze) runs UNCHANGED — the copy is the
// only new step, standing in for the network "download" stage. The user's
// original file is never modified, moved, or deleted.

import { stat, copyFile } from 'node:fs/promises';
import path from 'node:path';

import type { WorkerConfig } from '../config/env.js';
import type { ResolvedMedia } from '../types/media.js';
import { MediaError } from '../types/media.js';
import {
  classifyVideoFile,
  fileExtension,
  mimeForExtension,
  type VideoFileValidation,
} from './inspectSupport.js';

const REASON_TO_ERROR: Record<Exclude<VideoFileValidation, { ok: true }>['reason'], MediaError> = {
  not_found: new MediaError('unsupported_url', 'file_not_found'),
  is_directory: new MediaError('unsupported_url', 'path_is_directory'),
  not_a_regular_file: new MediaError('unsupported_url', 'not_a_regular_file'),
  unsupported_type: new MediaError('invalid_media', 'unsupported_file_type'),
  empty: new MediaError('invalid_media', 'empty_file'),
  too_large: new MediaError('file_too_large', 'exceeds_max_download_bytes'),
};

/**
 * Validate + copy a local video into `workDir`. Returns a ResolvedMedia whose
 * `localFilePath` points at the COPY inside the isolated temp dir. Throws a
 * MediaError (same taxonomy as the resolvers) on any validation failure.
 */
export async function prepareLocalFile(
  cfg: WorkerConfig,
  filePath: string,
  workDir: string,
): Promise<ResolvedMedia> {
  const ext = fileExtension(filePath);

  let facts;
  try {
    const s = await stat(filePath);
    facts = { exists: true, isDirectory: s.isDirectory(), isFile: s.isFile(), sizeBytes: s.size, ext };
  } catch {
    facts = { exists: false, isDirectory: false, isFile: false, sizeBytes: 0, ext };
  }

  const validation = classifyVideoFile(facts, cfg.maxDownloadBytes);
  if (!validation.ok) {
    throw REASON_TO_ERROR[validation.reason];
  }

  // Copy INTO the isolated temp dir. copyFile reads the source and writes a new
  // file — it never modifies or removes the original.
  const destPath = path.join(workDir, `source${ext}`);
  await copyFile(filePath, destPath);

  return {
    // A non-network, non-signed identifier — never a filesystem path or URL with
    // secrets. Only the basename is exposed.
    canonicalUrl: `local-file://${path.basename(filePath)}`,
    localFilePath: destPath,
    mimeType: mimeForExtension(ext),
    sizeBytes: validation.sizeBytes,
    source: 'local-file',
    warnings: [],
  };
}
