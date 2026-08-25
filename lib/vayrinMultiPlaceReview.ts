import { rowCandidate, selectedBatchTargets, type MultiPlaceBatch, type MultiPlaceBatchRow } from './multiPlaceBatch';
import type { ShareJobEvidenceFrame, ShareJobResultCandidate } from './shareJobResult';

export const MAX_VISIBLE_CANDIDATES_PER_MENTION = 3;
export const MAX_EVIDENCE_FRAMES_PER_MENTION = 3;

export function visibleMentionCandidates(row: MultiPlaceBatchRow): ShareJobResultCandidate[] {
  return row.candidates.slice(0, MAX_VISIBLE_CANDIDATES_PER_MENTION);
}

export function visibleMentionSearchCandidates(row: MultiPlaceBatchRow): ShareJobResultCandidate[] {
  return row.search.candidates.slice(0, MAX_VISIBLE_CANDIDATES_PER_MENTION);
}

/** Associate global analyzed frames with one mention only through its timestamps. */
export function evidenceFramesForMention(
  row: MultiPlaceBatchRow,
  frames: readonly ShareJobEvidenceFrame[],
): ShareJobEvidenceFrame[] {
  const timestamps = row.sourceTimestamps;
  const matched = timestamps.length > 0
    ? frames.filter((frame) => timestamps.some((timestamp) => Math.abs(timestamp - frame.timestampSeconds) <= 1.5))
    : [];
  const direct: ShareJobEvidenceFrame[] = row.sourceFrameUrl
    ? [{
        id: `mention:${row.logicalPlaceId}:${row.sourceTimestamps[0] ?? 0}`,
        storagePath: null,
        url: row.sourceFrameUrl,
        timestampSeconds: row.sourceTimestamps[0] ?? 0,
        width: null,
        height: null,
        relevance: 'candidate_evidence',
      }]
    : [];
  const seen = new Set<string>();
  return [...matched, ...direct].filter((frame) => {
    const key = frame.storagePath ?? frame.url ?? frame.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, MAX_EVIDENCE_FRAMES_PER_MENTION);
}

export function batchResolutionProgress(batch: MultiPlaceBatch): { resolved: number; total: number } {
  let resolved = 0;
  for (const id of batch.order) {
    const row = batch.rows[id]!;
    if (row.persistence !== 'pending' || (!row.userDismissed && row.resolution === 'resolved' && !!rowCandidate(row))) {
      resolved += 1;
    }
  }
  return { resolved, total: batch.order.length };
}

export function batchActionCounts(batch: MultiPlaceBatch): { total: number; newPlaces: number; sourceAttachments: number } {
  let newPlaces = 0;
  let sourceAttachments = 0;
  for (const target of selectedBatchTargets(batch)) {
    if (batch.rows[target.logicalPlaceId]?.savedPlaceId) sourceAttachments += 1;
    else newPlaces += 1;
  }
  return { total: newPlaces + sourceAttachments, newPlaces, sourceAttachments };
}

export function batchPrimaryActionLabel(counts: ReturnType<typeof batchActionCounts>): string {
  if (counts.newPlaces > 0 && counts.sourceAttachments > 0) {
    return `Save ${counts.newPlaces} ${counts.newPlaces === 1 ? 'place' : 'places'} · attach ${counts.sourceAttachments} ${counts.sourceAttachments === 1 ? 'source' : 'sources'}`;
  }
  if (counts.sourceAttachments > 0) {
    return counts.sourceAttachments === 1 ? 'Attach this video' : `Attach video to ${counts.sourceAttachments} places`;
  }
  return `Save ${counts.newPlaces} ${counts.newPlaces === 1 ? 'place' : 'places'}`;
}
