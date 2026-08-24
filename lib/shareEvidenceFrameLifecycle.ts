export const MAX_RETAINED_EVIDENCE_FRAMES = 5;
export const SIGNED_URL_TTL_SECONDS = 60 * 60;

function isSafeEvidenceFrameStoragePath(path: string, expectedJobId?: string): boolean {
  const segments = path.split('/');
  if (segments.length !== 4 || segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  if (expectedJobId && segments[1] !== expectedJobId) return false;
  return /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(segments[0]!)
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(segments[1]!)
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(segments[2]!)
    && /^[a-zA-Z0-9][a-zA-Z0-9._:-]*\.jpg$/.test(segments[3]!);
}

export function evidenceFrameStoragePaths(payload: unknown, expectedJobId?: string): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const frames = (payload as { evidenceFrames?: unknown }).evidenceFrames;
  if (!Array.isArray(frames)) return [];
  return [...new Set(frames.flatMap((raw) => {
    if (!raw || typeof raw !== 'object') return [];
    const path = (raw as { storagePath?: unknown }).storagePath;
    if (typeof path !== 'string') return [];
    const trimmed = path.trim();
    return isSafeEvidenceFrameStoragePath(trimmed, expectedJobId) ? [trimmed] : [];
  }))].slice(0, MAX_RETAINED_EVIDENCE_FRAMES);
}

export type EvidenceFrameCleanupResult = {
  status: 'not_needed' | 'success' | 'failed';
  attempted: number;
  removed: number;
  errorMessage: string | null;
};

/** Delete only references scoped to this job. Missing objects are an
 * idempotent success; a Storage error is returned for production observability. */
export async function cleanupShareEvidenceFrames(
  payload: unknown,
  jobId: string,
  remove: (paths: string[]) => Promise<{ data?: unknown[] | null; error?: { message: string } | null }>,
): Promise<EvidenceFrameCleanupResult> {
  const paths = evidenceFrameStoragePaths(payload, jobId);
  if (paths.length === 0) return { status: 'not_needed', attempted: 0, removed: 0, errorMessage: null };
  try {
    const { data, error } = await remove(paths);
    if (error) {
      return {
        status: 'failed', attempted: paths.length,
        removed: Array.isArray(data) ? data.length : 0,
        errorMessage: error.message.slice(0, 160),
      };
    }
    return {
      status: 'success', attempted: paths.length,
      removed: Array.isArray(data) ? data.length : paths.length,
      errorMessage: null,
    };
  } catch (error) {
    return {
      status: 'failed', attempted: paths.length, removed: 0,
      errorMessage: error instanceof Error ? error.message.slice(0, 160) : 'unknown',
    };
  }
}
