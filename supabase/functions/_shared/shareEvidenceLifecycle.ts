export const SHARE_EVIDENCE_BUCKET = 'share-evidence';
export const MAX_RETAINED_EVIDENCE_FRAMES = 5;

const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/;
const SAFE_JPEG = /^[a-zA-Z0-9][a-zA-Z0-9._:-]*\.jpg$/i;

export type ShareEvidenceJob = {
  id: string;
  user_id: string;
  candidate_payload: unknown;
};

export function evidencePathsForOwnedJob(
  payload: unknown,
  expectedUserId: string,
  expectedJobId: string,
): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const frames = (payload as { evidenceFrames?: unknown }).evidenceFrames;
  if (!Array.isArray(frames)) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const frame of frames) {
    if (!frame || typeof frame !== 'object') continue;
    const rawPath = (frame as { storagePath?: unknown }).storagePath;
    if (typeof rawPath !== 'string') continue;
    const path = rawPath.trim();
    const segments = path.split('/');
    const safe = segments.length === 4
      && segments[0] === expectedUserId
      && segments[1] === expectedJobId
      && segments.slice(0, 3).every((segment) => SAFE_SEGMENT.test(segment))
      && SAFE_JPEG.test(segments[3] ?? '');
    if (!safe || seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
    if (paths.length === MAX_RETAINED_EVIDENCE_FRAMES) break;
  }
  return paths;
}

export type OwnedShareJobDeletionResult = {
  status: 'deleted' | 'forbidden' | 'evidence_cleanup_failed' | 'row_delete_failed';
  attemptedEvidenceObjects: number;
  removedEvidenceObjects: number;
  errorMessage: string | null;
};

/** Ordered deletion boundary: evidence first, database row second. Storage
 * failure retains the row and its retry references; missing objects are an
 * idempotent success when the Storage API returns no error. */
export async function deleteOwnedShareJob(args: {
  callerUserId: string;
  job: ShareEvidenceJob;
  removeEvidence: (paths: string[]) => Promise<{
    data?: unknown[] | null;
    error?: { message: string } | null;
  }>;
  deleteRow: () => Promise<{ error?: { message: string } | null }>;
}): Promise<OwnedShareJobDeletionResult> {
  if (args.job.user_id !== args.callerUserId) {
    return {
      status: 'forbidden', attemptedEvidenceObjects: 0,
      removedEvidenceObjects: 0, errorMessage: null,
    };
  }
  const paths = evidencePathsForOwnedJob(
    args.job.candidate_payload,
    args.callerUserId,
    args.job.id,
  );
  if (paths.length > 0) {
    try {
      const cleanup = await args.removeEvidence(paths);
      if (cleanup.error) {
        return {
          status: 'evidence_cleanup_failed',
          attemptedEvidenceObjects: paths.length,
          removedEvidenceObjects: Array.isArray(cleanup.data) ? cleanup.data.length : 0,
          errorMessage: cleanup.error.message.slice(0, 160),
        };
      }
      const deletion = await args.deleteRow();
      if (deletion.error) {
        return {
          status: 'row_delete_failed',
          attemptedEvidenceObjects: paths.length,
          removedEvidenceObjects: Array.isArray(cleanup.data) ? cleanup.data.length : paths.length,
          errorMessage: deletion.error.message.slice(0, 160),
        };
      }
      return {
        status: 'deleted',
        attemptedEvidenceObjects: paths.length,
        removedEvidenceObjects: Array.isArray(cleanup.data) ? cleanup.data.length : paths.length,
        errorMessage: null,
      };
    } catch (error) {
      return {
        status: 'evidence_cleanup_failed', attemptedEvidenceObjects: paths.length,
        removedEvidenceObjects: 0,
        errorMessage: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
      };
    }
  }
  const deletion = await args.deleteRow();
  return deletion.error
    ? {
        status: 'row_delete_failed', attemptedEvidenceObjects: 0,
        removedEvidenceObjects: 0, errorMessage: deletion.error.message.slice(0, 160),
      }
    : {
        status: 'deleted', attemptedEvidenceObjects: 0,
        removedEvidenceObjects: 0, errorMessage: null,
      };
}
