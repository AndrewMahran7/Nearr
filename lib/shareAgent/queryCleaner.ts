/**
 * Shared helpers for cleaning social-media caption text before sending it
 * to Google Places, and for extracting likely US street addresses
 * deterministically (i.e. without relying on the model's self-report).
 *
 * Used by BOTH the React Native host app (lib/shareAgent/agent.ts) and
 * the Deno Edge Function (supabase/functions/process-share-link/index.ts)
 * via relative `.ts` imports — keep this file dependency-free and pure.
 *
 * The goal of this module is small and explicit:
 *   - Avoid sending entire noisy captions to Google Places.
 *   - Detect explicit street addresses deterministically so the safety
 *     gate's `caption_explicit_address` evidence key cannot be faked or
 *     missed by Gemini.
 *
 * NON-goals: this is not a full address parser, not a transcript fixer,
 * not a venue extractor. Keep additions conservative.
 */

const SOCIAL_WRAPPER_PATTERNS: RegExp[] = [
  // "Joe (@joehuang) on Instagram:" / "...on TikTok:"
  /\bon\s+(?:instagram|tiktok|facebook|youtube|threads)\s*[:|\-–—]?/gi,
  // "Joe on Instagram: " variants without parens
  /\([^)]*@[^)]*\)/g,
  // Leading credits like "Reels by ..." / "Posted by ..."
  /\b(?:reels?|video|posted)\s+by\s+[^\n.|]+/gi,
];

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu;
const HANDLE_RE = /@[A-Za-z0-9._]+/g;
const URL_RE = /\bhttps?:\/\/\S+/gi;
// Strip pictographs / emoji but keep letters, digits, basic punctuation.
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\uFE0F]/gu;

// Casual / sentiment caption phrases that are NOT place names. Used to keep
// prose like "pretty cool spot!! glad i stopped by" from being sent to Google
// Places as a query seed. Conservative and only ever applied to the caption-
// PROSE fallback seed — never to an explicit venue/address query.
const CASUAL_CAPTION_RE = new RegExp(
  [
    'pretty cool',
    'cool spot',
    'glad i',
    'stopped by',
    "i'?ll def",
    'be back',
    'bigger menu',
    'so good',
    'highly recommend',
    'must try',
    'need to try',
    'you have to',
    'go check',
    'this place',
    'this spot',
    'the vibe',
    '10\\s*/\\s*10',
    'obsessed',
    'slightly bigger',
    'love this',
    'loved this',
    'came (?:here|thru|through)',
    'wish they had',
  ].join('|'),
  'i',
);

/**
 * True when a caption seed reads as casual sentiment prose rather than a
 * place name ("pretty cool spot!! glad i stopped by"). Pure + conservative.
 */
export function isCasualCaptionSeed(seed: string | null | undefined): boolean {
  if (!seed) return false;
  return CASUAL_CAPTION_RE.test(seed);
}

/**
 * Clean a social-media caption / title for use as a Google Places query.
 * Strips handles, hashtags, URLs, emoji, common wrapper phrases, then
 * collapses whitespace and trims to `maxLen` (default 80).
 *
 * Returns an empty string if nothing meaningful is left.
 */
export function cleanPlacesSeed(input: string | null | undefined, maxLen = 80): string {
  if (!input) return '';
  let s = String(input);
  for (const re of SOCIAL_WRAPPER_PATTERNS) s = s.replace(re, ' ');
  // Platform boilerplate that social sites use as og:title/description and
  // which otherwise leaks into Google Places (e.g. TikTok's "TikTok - Make
  // Your Day" makes Places return "TikTok Inc."). Never a real place query.
  s = s.replace(/\btik\s*tok\b\s*[-–—|:]*\s*make your day\b/gi, ' ');
  s = s.replace(/\bmake your day\b/gi, ' ');
  s = s.replace(URL_RE, ' ');
  s = s.replace(HANDLE_RE, ' ');
  s = s.replace(HASHTAG_RE, ' ');
  s = s.replace(EMOJI_RE, ' ');
  // Drop quotes, smart-quotes, and stray punctuation runs.
  s = s.replace(/["“”‘’]/g, ' ');
  s = s.replace(/[|•·]/g, ' ');
  // Collapse repeated dashes / spaces.
  s = s.replace(/[\-–—]{2,}/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.length > maxLen) s = s.slice(0, maxLen).trim();
  return s;
}

export type LikelyAddress = {
  /** Raw matched address text, normalized for whitespace. */
  raw: string;
  /** Best-effort city extracted from a "<address>, <city>" suffix. */
  city: string | null;
  /** Best-effort state extracted from a "..., <city>, <ST>" suffix. */
  state: string | null;
};

// Conservative US street-address regex. Requires a leading number, a
// street word boundary, and one of a list of common suffixes. We do NOT
// claim international coverage — that's deferred until we have evidence
// it's worth the false-positive cost. International addresses without a
// recognized suffix simply won't trigger the address-first path; they
// still flow through the normal name-based extraction.
const STREET_SUFFIXES =
  '(?:street|st|avenue|ave|av|road|rd|boulevard|blvd|drive|dr|lane|ln|way|wy|court|ct|place|pl|terrace|ter|highway|hwy|parkway|pkwy|circle|cir|plaza|plz|square|sq|alley|aly|broadway)';
const STREET_ADDRESS_RE = new RegExp(
  // number  +  1-5 word street name  +  suffix  +  optional unit
  `\\b(\\d{1,6}(?:\\-\\d+)?\\s+[A-Za-z0-9'\\.]+(?:\\s+[A-Za-z0-9'\\.]+){0,4}\\s+${STREET_SUFFIXES})\\b(?:\\.|,|\\s+(?:suite|ste|apt|unit|#)\\s*[A-Za-z0-9\\-]+)?`,
  'i',
);

const STATE_RE = /\b([A-Z]{2})\b/;

/**
 * Try to extract a likely US street address from arbitrary social text.
 * Returns null if no convincing address is found.
 */
export function extractLikelyAddress(
  input: string | null | undefined,
): LikelyAddress | null {
  const all = extractLikelyAddresses(input, 1);
  return all.length > 0 ? all[0] : null;
}

/**
 * Extract up to `max` distinct likely US street addresses from arbitrary
 * social text. Returns [] if no convincing address is found.
 *
 * Two addresses are considered the same when their normalized `raw`
 * (lowercased + collapsed whitespace) match. The order returned is the
 * order they appear in the source text.
 */
export function extractLikelyAddresses(
  input: string | null | undefined,
  max = 10,
): LikelyAddress[] {
  if (!input) return [];
  const text = String(input).replace(/\s+/g, ' ');
  // Global, case-insensitive scan so we don't stop at the first match.
  const globalRe = new RegExp(STREET_ADDRESS_RE.source, 'gi');
  const out: LikelyAddress[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = globalRe.exec(text)) !== null && out.length < max) {
    const rawAddress = (m[1] ?? '').trim();
    if (!rawAddress) continue;
    const key = rawAddress.toLowerCase().replace(/\s+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    const matchEnd = (m.index ?? 0) + m[0].length;
    const tail = text.slice(matchEnd, matchEnd + 80);
    let city: string | null = null;
    let state: string | null = null;
    const cityMatch = tail.match(
      /^\s*,?\s*([A-Z][A-Za-z\.\- ]{1,40}?)(?:\s*,\s*([A-Z]{2})\b|\s*$|[\.,;\n])/,
    );
    if (cityMatch) {
      city = cityMatch[1].trim().replace(/[\s,]+$/, '') || null;
      state = (cityMatch[2] ?? null) as string | null;
    }
    if (!state) {
      const stateM = tail.match(STATE_RE);
      if (stateM) state = stateM[1];
    }
    if (city) {
      const lc = city.toLowerCase();
      if (/^(best|new|open|fresh|amazing|good|great|happy|the|a|an)$/.test(lc.split(' ')[0])) {
        city = null;
      }
    }
    out.push({ raw: rawAddress, city, state });
  }
  return out;
}

/**
 * Build an ordered list of clean Places queries to try given the source
 * text and any extracted hints. Earlier queries are preferred.
 *
 * Always returns at most `max` unique non-empty queries.
 */
export function buildCleanPlacesQueries(args: {
  title: string | null | undefined;
  description: string | null | undefined;
  /** A pre-extracted address, if any. */
  address?: LikelyAddress | null;
  /** A pre-extracted venue name hint, if any. */
  placeName?: string | null;
  /** A pre-extracted city hint, if any. */
  city?: string | null;
  /** Profile display name to try last as a weak fallback. */
  profileDisplayName?: string | null;
  /**
   * When false, do NOT fall back to raw caption prose (cleaned title /
   * description) as a Places query seed. Set false by callers that have no
   * explicit place evidence (no address / venue hint / venue handle) so a
   * casual caption never queries random businesses. Defaults to true to keep
   * the in-app agent behavior unchanged.
   */
  allowGenericCaptionSeed?: boolean;
  max?: number;
}): string[] {
  const max = args.max ?? 5;
  const queries: string[] = [];
  const push = (q: string | null | undefined) => {
    if (!q) return;
    const t = q.trim();
    if (!t) return;
    if (queries.find((existing) => existing.toLowerCase() === t.toLowerCase())) return;
    queries.push(t);
  };

  // 2026-05-27 — Patch 6: venue+address first.
  //
  // Bare-address queries ("415 Seabright Ave, Santa Cruz, CA") frequently
  // come back as Google's generic <number> <street> address card and
  // downstream code can't tell that from a real business at the same
  // address. When the caller supplies an explicit placeName hint
  // (caption-derived venue, "📍 <Name>", or a venue-like handle), we
  // try `<placeName> <address>, <city>, <state>` BEFORE any bare-
  // address variant so Google's text search returns the actual
  // business first.
  if (args.placeName && args.address) {
    const a = args.address;
    if (a.city && a.state) push(`${args.placeName} ${a.raw}, ${a.city}, ${a.state}`);
    if (a.city) push(`${args.placeName} ${a.raw}, ${a.city}`);
    push(`${args.placeName} ${a.raw}`);
  }

  // 1. Address-first (strongest evidence per docs/architecture).
  if (args.address) {
    const a = args.address;
    if (a.city && a.state) push(`${a.raw}, ${a.city}, ${a.state}`);
    if (a.city) push(`${a.raw}, ${a.city}`);
    push(a.raw);
    if (args.placeName && a.city) push(`${args.placeName} ${a.city}`);
  }

  // 2. Explicit name + city.
  if (args.placeName && args.city) push(`${args.placeName} ${args.city}`);
  if (args.placeName) push(args.placeName);
  // "&" ↔ "and" variant so "NOVA Kitchen & Bar" also tries "NOVA Kitchen
  // and Bar" (Google usually normalizes this, but the extra seed is cheap
  // and improves recall for ampersand venue names).
  if (args.placeName && /\s*&\s*/.test(args.placeName)) {
    const andName = args.placeName.replace(/\s*&\s*/g, ' and ');
    if (args.city) push(`${andName} ${args.city}`);
    push(andName);
  }

  // 3. Cleaned title (caption text with social noise stripped).
  //    Skipped entirely when the caller has no explicit place evidence, or
  //    when the text reads as casual sentiment prose — either way it would
  //    only query random Places.
  const allowGenericSeed = args.allowGenericCaptionSeed !== false;
  const cleanedTitle = cleanPlacesSeed(args.title);
  if (
    allowGenericSeed &&
    cleanedTitle &&
    cleanedTitle.split(/\s+/).length >= 2 &&
    !isCasualCaptionSeed(cleanedTitle)
  ) {
    push(cleanedTitle);
  }

  // 4. Cleaned description fallback (same guards as the title seed).
  const cleanedDesc = cleanPlacesSeed(args.description);
  if (
    allowGenericSeed &&
    cleanedDesc &&
    cleanedDesc.toLowerCase() !== cleanedTitle.toLowerCase() &&
    cleanedDesc.split(/\s+/).length >= 2 &&
    !isCasualCaptionSeed(cleanedDesc)
  ) {
    push(cleanedDesc);
  }

  // 5. Profile display name as last-resort weak fallback (the safety
  //    gate will downgrade if this is the only signal — see
  //    display_name_only in lib/shareAgent/safety.ts).
  if (args.profileDisplayName && args.city) {
    push(`${args.profileDisplayName} ${args.city}`);
  }

  return queries.slice(0, max);
}
