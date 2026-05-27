// supabase/functions/process-share-link/metadata/normalizeText.ts
//
// Text normalization for share captions / titles / descriptions.
// Behaviorally identical to `cleanTitle`, `cleanDescription`,
// `buildQuery`, and `firstSentence` in the legacy index.ts.

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
