import { canonicalContentIdentity } from './shareAgent/contentIdentity';
import {
  evidenceFramesFromPayload,
  normalizeMentionSlots,
  type ShareJobEvidenceFrame,
} from './shareJobResult';
import type { PlaceSourceCard } from './placeSources';

export type PlaceSourceEvidenceResult = {
  sourceUrl: string | null;
  logicalResultId: string | null;
  savedPlaceId: string | null;
  candidatePayload: unknown;
  finalizedAt: string | null;
};

function sourceKey(url: string | null): string | null {
  if (!url?.trim()) return null;
  return canonicalContentIdentity(url)?.key ?? `url:${url.trim().toLowerCase()}`;
}

function relevanceRank(frame: ShareJobEvidenceFrame): number {
  if (frame.relevance === 'vayrin_selected') return 0;
  if (frame.relevance === 'candidate_evidence') return 1;
  return 2;
}

/** Pick the retained frame most closely associated with this saved result.
 * When an older payload has no mention timestamps, producer ordering remains
 * authoritative. */
export function bestEvidenceFrameForSavedResult(
  result: Pick<PlaceSourceEvidenceResult, 'candidatePayload' | 'logicalResultId' | 'savedPlaceId'>,
): ShareJobEvidenceFrame | null {
  const frames = evidenceFramesFromPayload(result.candidatePayload);
  if (frames.length === 0) return null;

  const payload = result.candidatePayload && typeof result.candidatePayload === 'object'
    ? result.candidatePayload as Record<string, unknown>
    : null;
  const slots = normalizeMentionSlots(payload?.mentionSlots);
  const slot = slots.find((candidate) => candidate.mentionId === result.logicalResultId) ??
    slots.find((candidate) => candidate.savedPlaceId === result.savedPlaceId) ??
    null;
  const timestamps = slot?.sourceTimestamps ?? [];
  if (timestamps.length === 0) return frames[0] ?? null;

  return frames
    .map((frame, index) => ({
      frame,
      index,
      distance: Math.min(...timestamps.map((timestamp) => Math.abs(timestamp - frame.timestampSeconds))),
    }))
    .sort((left, right) => left.distance - right.distance ||
      relevanceRank(left.frame) - relevanceRank(right.frame) ||
      left.index - right.index)[0]?.frame ?? null;
}

/** Match result-ledger evidence back to each exact source post. */
export function selectPlaceSourceEvidenceFrames(
  sources: readonly Pick<PlaceSourceCard, 'key' | 'url'>[],
  results: readonly PlaceSourceEvidenceResult[],
): Record<string, ShareJobEvidenceFrame> {
  const sorted = [...results].sort((left, right) =>
    (right.finalizedAt ?? '').localeCompare(left.finalizedAt ?? ''));
  const selected: Record<string, ShareJobEvidenceFrame> = {};

  for (const source of sources) {
    const identity = sourceKey(source.url);
    if (!identity) continue;
    for (const result of sorted) {
      if (sourceKey(result.sourceUrl) !== identity) continue;
      const frame = bestEvidenceFrameForSavedResult(result);
      if (frame) {
        selected[source.key] = frame;
        break;
      }
    }
  }
  return selected;
}

/** Image fallback order for the card renderer. A failed URI is removed by the
 * view and the next candidate is used on the following render. */
export function placeSourcePreviewCandidates(
  evidenceFrameUrl: string | null | undefined,
  sourceThumbnailUrl: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  return [evidenceFrameUrl, sourceThumbnailUrl].flatMap((value) => {
    const url = value?.trim();
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [url];
  });
}
