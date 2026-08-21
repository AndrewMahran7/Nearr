// supabase/functions/process-share-link/metadata/normalizeText.ts
//
// Text normalization for share captions / titles / descriptions.
// Behaviorally identical to `cleanTitle`, `cleanDescription`,
// `buildQuery`, and `firstSentence` in the legacy index.ts.

// Kept local because this module runs in Deno Edge and is also imported by the
// Node worker's cross-runtime contract tests. A `.ts` import works in Deno but
// violates the worker's NodeNext typecheck; a `.js` import does the reverse.
// The shared 10k contract is asserted against lib/sourceDescription.ts and the
// worker helper by scripts/testLongCaptionPreservation.ts.
export const SOURCE_DESCRIPTION_RETENTION_MAX = 10_000;

function boundedSourceDescription(raw: string): string {
  let bounded = raw.slice(0, SOURCE_DESCRIPTION_RETENTION_MAX);
  const last = bounded.charCodeAt(bounded.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) bounded = bounded.slice(0, -1);
  return bounded;
}

export function cleanTitle(raw: string | null): string | null {
  if (!raw) return null;
  const s = raw
    .trim()
    .replace(/\s+on TikTok.*/i, '')
    .replace(/\s*\|\s*Instagram.*/i, '')
    .replace(/\s*•\s*Instagram.*/i, '')
    .replace(/\s*\(@[^)]+\)\s*on Instagram.*/i, '')
    .replace(/\s*-\s*YouTube.*/i, '')
    .trim()
    .replace(/^["\u201C\u201D'`]+|["\u201C\u201D'`]+$/g, '')
    .trim();
  return s || null;
}

export function cleanDescription(raw: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;
  if (s.length > 240) s = s.slice(0, 237).trimEnd() + '\u2026';
  return s;
}

/**
 * Normalize creator-authored source text at the ingestion boundary. Unlike
 * `cleanDescription` (the legacy 240-character preview helper), this retains
 * useful source evidence up to the explicit abuse/transport guard.
 */
export function cleanIngestionCaption(raw: string | null): string | null {
  if (!raw) return null;
  const normalized = raw.trim();
  if (!normalized) return null;
  return normalized.length > SOURCE_DESCRIPTION_RETENTION_MAX
    ? boundedSourceDescription(normalized)
    : normalized;
}

export function firstSentence(s: string | null): string | null {
  if (!s) return null;
  const m = s.match(/^[^.!?\n]{4,}/);
  return m ? m[0].trim() : s.trim();
}

export function buildQuery(
  title: string | null,
  description: string | null,
): string | null {
  const candidate = title ?? firstSentence(description);
  if (!candidate) return null;
  let q = candidate
    .replace(/#[\p{L}\p{N}_]+/gu, ' ')
    .replace(/@[\p{L}\p{N}_.]+/gu, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+on Instagram\b.*$/i, ' ')
    .replace(/\s+on TikTok\b.*$/i, ' ')
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{So}\p{Sk}]/gu, ' ')
    .replace(/["\u201C\u201D'`]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (q.length > 120) q = q.slice(0, 120).trim();
  return q || null;
}
