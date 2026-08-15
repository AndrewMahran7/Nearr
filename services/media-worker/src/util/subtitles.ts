// services/media-worker/src/util/subtitles.ts
//
// PURE parsing/normalization of platform-supplied subtitle text (WebVTT, and
// plain SRT as a bonus) into Nearr's TranscriptSegment shape. Used by the
// captions-first transcript strategy (YouTube today; any future resolver that
// exposes real captions can reuse this) so the pipeline never pays for
// speech-to-text when a platform already published a transcript.
//
// Cleanup only — never rewrites meaning: strips cue timestamps/numbering/VTT
// markup tags, collapses whitespace, and merges the "rolling caption" style
// some auto-caption tracks use (each cue re-sends a growing prefix of the same
// sentence) into single segments so the transcript reads naturally instead of
// as a wall of near-duplicate lines.

import type { TranscriptSegment } from '../types/media.js';

const VTT_TIME_RE =
  /(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2,}):)?(\d{2}):(\d{2})[.,](\d{3})/;

function toSeconds(hours: string | undefined, minutes: string, seconds: string, ms: string): number {
  const h = hours ? Number(hours) : 0;
  return h * 3600 + Number(minutes) * 60 + Number(seconds) + Number(ms) / 1000;
}

function stripCueMarkup(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ') // VTT inline tags, incl. karaoke timestamps <00:00:01.000>
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * YouTube auto-captions commonly ship as a SLIDING WINDOW: each cue repeats
 * the tail of the previous cue's words before adding new ones (e.g. cue A
 * ends "...you know the rules and so do", cue B starts "love. You know the
 * rules and so do I. I feel..."). Find the longest word-level overlap between
 * the end of `prevText` and the start of `nextText` and stitch them into one
 * continuous line; also collapses the simpler case where one cue's text is
 * fully contained in the other (exact-duplicate / growing-prefix cues).
 * Returns null when the two cues don't actually overlap (distinct sentences),
 * so real transcript content is never merged away.
 */
function wordOverlapMerge(prevText: string, nextText: string, minOverlapWords = 2): string | null {
  const prevLower = prevText.toLowerCase();
  const nextLower = nextText.toLowerCase();
  if (nextLower.includes(prevLower)) return nextText;
  if (prevLower.includes(nextLower)) return prevText;

  const prevWords = prevText.split(' ').filter(Boolean);
  const nextWords = nextText.split(' ').filter(Boolean);
  const maxOverlap = Math.min(prevWords.length, nextWords.length);
  for (let k = maxOverlap; k >= minOverlapWords; k -= 1) {
    const prevTail = prevWords.slice(-k).join(' ').toLowerCase();
    const nextHead = nextWords.slice(0, k).join(' ').toLowerCase();
    if (prevTail === nextHead) {
      return [...prevWords, ...nextWords.slice(k)].join(' ');
    }
  }
  return null;
}

function collapseRollingCues(segments: TranscriptSegment[]): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  for (const seg of segments) {
    const prev = out[out.length - 1];
    const merged = prev ? wordOverlapMerge(prev.text, seg.text) : null;
    if (prev && merged !== null) {
      prev.text = merged;
      prev.endSeconds = Math.max(prev.endSeconds, seg.endSeconds);
      continue;
    }
    out.push({ ...seg });
  }
  return out;
}

/** Parse WebVTT (also tolerates SRT-style comma decimals) into transcript
 *  segments. Never throws — malformed input degrades to fewer/no segments. */
export function parseVttToSegments(vtt: string): TranscriptSegment[] {
  if (typeof vtt !== 'string' || !vtt.trim()) return [];
  const lines = vtt.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const raw: TranscriptSegment[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? '';
    const m = line.match(VTT_TIME_RE);
    if (m) {
      const start = toSeconds(m[1], m[2]!, m[3]!, m[4]!);
      const end = toSeconds(m[5], m[6]!, m[7]!, m[8]!);
      i += 1;
      const textLines: string[] = [];
      while (i < lines.length && (lines[i] ?? '').trim() !== '') {
        textLines.push(lines[i] ?? '');
        i += 1;
      }
      const text = stripCueMarkup(textLines.join(' '));
      if (text && Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        raw.push({ startSeconds: start, endSeconds: end, text });
      }
      continue;
    }
    i += 1;
  }
  return collapseRollingCues(raw);
}

/** Parse numbered SRT (`1\n00:00:01,000 --> 00:00:02,000\ntext\n\n...`). */
export function parseSrtToSegments(srt: string): TranscriptSegment[] {
  // The SRT cue-time format (comma decimals) is a strict subset of what
  // parseVttToSegments already tolerates; numbering lines simply never match
  // the time regex and are skipped.
  return parseVttToSegments(srt);
}

/** Final whitespace/empty-line normalization pass. Safe to call on any
 *  already-parsed segment list (including provider-supplied ones). */
export function normalizeTranscriptSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  return segments
    .map((s) => ({ ...s, text: s.text.replace(/\s+/g, ' ').trim() }))
    .filter((s) => s.text.length > 0);
}

/** Detect the subtitle text format from content sniffing (both formats are
 *  parsed identically today, but callers may want the label for diagnostics). */
export function detectSubtitleFormat(text: string): 'vtt' | 'srt' | 'unknown' {
  const head = text.slice(0, 32).trim().toUpperCase();
  if (head.startsWith('WEBVTT')) return 'vtt';
  if (/^\d+\s*$/.test(text.trim().split('\n')[0] ?? '')) return 'srt';
  return 'unknown';
}
