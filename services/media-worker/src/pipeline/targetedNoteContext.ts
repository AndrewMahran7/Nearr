import type { EvidenceItem } from '../types/evidence.js';
import type { OcrSegment, SelectedFrame, TranscriptSegment } from '../types/media.js';

export type TargetEvidenceHandoff = {
  evidence: EvidenceItem[];
  timestamps: number[];
};

export type TargetedNoteContext = {
  frames: SelectedFrame[];
  transcript: TranscriptSegment[];
  ocr: OcrSegment[];
  evidence: EvidenceItem[];
  sceneScoped: boolean;
};

const MAX_EVIDENCE_ITEMS = 16;
const MAX_EVIDENCE_VALUE = 240;

function finiteTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizedIdentity(value: unknown): string {
  return typeof value === 'string'
    ? value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
    : '';
}

export function sanitizeTargetEvidence(value: unknown): EvidenceItem[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: EvidenceItem[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as Record<string, unknown>;
    if (!['caption', 'speech', 'visible_text', 'frame'].includes(String(row.source))) continue;
    const text = typeof row.value === 'string'
      ? row.value.replace(/\s+/g, ' ').trim().slice(0, MAX_EVIDENCE_VALUE)
      : '';
    if (text.length < 3) continue;
    const timestampSeconds = finiteTimestamp(row.timestampSeconds);
    const key = `${row.source}|${timestampSeconds ?? ''}|${text.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      source: row.source as EvidenceItem['source'],
      value: text,
      timestampSeconds,
    });
    if (result.length === MAX_EVIDENCE_ITEMS) break;
  }
  return result;
}

/** Find a final-place handoff in newest-first candidate payloads. Provider ID
 * wins; exact normalized final identity is the custom-place fallback. */
export function findTargetEvidenceHandoff(
  payloads: readonly unknown[],
  target: { name: string; googlePlaceId?: string | null },
): TargetEvidenceHandoff | null {
  const targetName = normalizedIdentity(target.name);
  for (const payload of payloads) {
    if (!payload || typeof payload !== 'object') continue;
    const slots = (payload as Record<string, unknown>).mentionSlots;
    if (!Array.isArray(slots)) continue;
    for (const raw of slots) {
      if (!raw || typeof raw !== 'object') continue;
      const slot = raw as Record<string, unknown>;
      const candidates = Array.isArray(slot.candidates) ? slot.candidates : [];
      const providerMatch = !!target.googlePlaceId && candidates.some((candidate) =>
        !!candidate && typeof candidate === 'object' &&
        (candidate as Record<string, unknown>).googlePlaceId === target.googlePlaceId,
      );
      const nameMatch = !target.googlePlaceId && [slot.primaryVenueName, slot.displayName]
        .some((value) => normalizedIdentity(value) === targetName);
      if (!providerMatch && !nameMatch) continue;
      const evidence = sanitizeTargetEvidence(slot.noteEvidence);
      const timestamps = [...new Set([
        ...(Array.isArray(slot.noteTimestamps) ? slot.noteTimestamps : []),
        ...evidence.map((item) => item.timestampSeconds),
      ].map(finiteTimestamp).filter((item): item is number => item !== null))]
        .sort((a, b) => a - b)
        .slice(0, 16);
      if (evidence.length || timestamps.length) return { evidence, timestamps };
    }
  }
  return null;
}

function distanceTo(t: number, targets: readonly number[]): number {
  return targets.reduce((best, target) => Math.min(best, Math.abs(t - target)), Infinity);
}

function selectFrames(
  frames: readonly SelectedFrame[],
  timestamps: readonly number[],
  windowSeconds: number,
  maxFrames: number,
): SelectedFrame[] {
  if (!timestamps.length) return frames.slice(0, maxFrames);
  const ordered = [...frames].sort((a, b) =>
    distanceTo(a.timestampSeconds, timestamps) - distanceTo(b.timestampSeconds, timestamps) ||
    a.timestampSeconds - b.timestampSeconds,
  );
  const inWindow = ordered.filter(
    (frame) => distanceTo(frame.timestampSeconds, timestamps) <= windowSeconds,
  );
  const selected = inWindow.length ? inWindow : ordered.slice(0, Math.max(1, timestamps.length));
  return selected.slice(0, maxFrames).sort((a, b) => a.timestampSeconds - b.timestampSeconds);
}

function selectTranscript(
  transcript: readonly TranscriptSegment[],
  timestamps: readonly number[],
  windowSeconds: number,
): TranscriptSegment[] {
  if (!timestamps.length) return [...transcript];
  return transcript.filter((segment) => timestamps.some((target) =>
    segment.startSeconds <= target + windowSeconds && segment.endSeconds >= target - windowSeconds,
  ));
}

function selectOcr(
  ocr: readonly OcrSegment[],
  timestamps: readonly number[],
  windowSeconds: number,
): OcrSegment[] {
  if (!timestamps.length) return [...ocr];
  return ocr.filter((segment) => distanceTo(segment.timestampSeconds, timestamps) <= windowSeconds);
}

export function buildTargetedNoteContext(args: {
  frames: readonly SelectedFrame[];
  transcript: readonly TranscriptSegment[];
  ocr: readonly OcrSegment[];
  handoff?: TargetEvidenceHandoff | null;
  expanded?: boolean;
  maxFrames: number;
}): TargetedNoteContext {
  const timestamps = args.handoff?.timestamps ?? [];
  const expanded = args.expanded === true;
  const windowSeconds = expanded ? 8 : 3;
  return {
    frames: selectFrames(args.frames, timestamps, windowSeconds, expanded ? 16 : 8)
      .slice(0, args.maxFrames),
    transcript: selectTranscript(args.transcript, timestamps, windowSeconds + 2),
    ocr: selectOcr(args.ocr, timestamps, windowSeconds),
    evidence: sanitizeTargetEvidence(args.handoff?.evidence ?? []),
    sceneScoped: timestamps.length > 0,
  };
}

export function mergeTargetEvidence(
  current: readonly EvidenceItem[],
  generated: readonly EvidenceItem[],
): EvidenceItem[] {
  return sanitizeTargetEvidence([...current, ...generated]);
}
