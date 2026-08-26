import { rowCandidate, selectedBatchTargets, type MultiPlaceBatch, type MultiPlaceBatchRow } from './multiPlaceBatch';
import type { ShareJobEvidenceFrame, ShareJobResultCandidate } from './shareJobResult';

export const MAX_VISIBLE_CANDIDATES_PER_MENTION = 3;
export const MAX_EVIDENCE_FRAMES_PER_MENTION = 3;

/** Measured/estimated point budgets used by the disclosure regression tests. */
export const MULTI_PLACE_DISCLOSURE_LAYOUT = {
  collapsedMentionMinHeight: 72,
  expandedHeaderMinHeight: 72,
  evidencePreviewHeight: 92,
  compactCandidateEstimatedHeight: 156,
  mentionActionsHeight: 88,
  stickyFooterHeight: 72,
  introHeight: 96,
} as const;

export function visibleMentionCandidates(row: MultiPlaceBatchRow): ShareJobResultCandidate[] {
  return row.candidates.slice(0, MAX_VISIBLE_CANDIDATES_PER_MENTION);
}

export function visibleMentionSearchCandidates(row: MultiPlaceBatchRow): ShareJobResultCandidate[] {
  return row.search.candidates.slice(0, MAX_VISIBLE_CANDIDATES_PER_MENTION);
}

/** A terminal choice should stay compact until the user explicitly reopens it. */
export function mentionResolvedForDisclosure(row: MultiPlaceBatchRow): boolean {
  if (row.persistence !== 'pending' || row.userDismissed) return true;
  return row.resolution === 'resolved' && !!rowCandidate(row);
}

/** Open the first row that still needs a decision; resolved-only reviews stay collapsed. */
export function initialExpandedMentionId(batch: MultiPlaceBatch): string | null {
  return batch.order.find((id) => !mentionResolvedForDisclosure(batch.rows[id]!)) ?? null;
}

/** Truthful one-line status for the collapsed summary. */
export function mentionSummaryStatus(row: MultiPlaceBatchRow): string {
  if (row.persistence === 'already_saved') return 'Already saved · source attached';
  if (row.persistence === 'saved') return 'Saved · source attached';
  if (row.userDismissed) return 'No place selected';
  if (row.search.phase === 'searching') return 'Searching…';
  if (row.selectedForSave && row.savedPlaceId) return 'Selected · attach source';
  if (row.selectedForSave) return 'Selected';
  if (row.savedPlaceId) return 'Already saved';
  const candidateCount = visibleMentionCandidates(row).length;
  if (candidateCount > 0) return `${candidateCount} possible ${candidateCount === 1 ? 'match' : 'matches'}`;
  return 'Needs search';
}

export function estimatedDisclosureContentHeight(args: {
  mentionCount: number;
  expandedCandidateCount: number;
  hasEvidence: boolean;
  footerVisible: boolean;
}): number {
  const layout = MULTI_PLACE_DISCLOSURE_LAYOUT;
  return layout.introHeight +
    Math.max(0, args.mentionCount) * layout.collapsedMentionMinHeight +
    (args.hasEvidence ? layout.evidencePreviewHeight : 0) +
    Math.min(MAX_VISIBLE_CANDIDATES_PER_MENTION, Math.max(0, args.expandedCandidateCount)) * layout.compactCandidateEstimatedHeight +
    layout.mentionActionsHeight +
    (args.footerVisible ? layout.stickyFooterHeight : 0);
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
