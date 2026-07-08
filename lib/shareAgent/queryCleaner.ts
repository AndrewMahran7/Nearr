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
  /** Raw matched address text, normalized for whitespace. Includes a
   *  suite / unit token when one immediately follows the street. */
  raw: string;
  /** Best-effort city extracted from a "<address>, <city>" suffix OR a
   *  "<city>, <address>" prefix ("📍 Downey, 8502 Telegraph Rd."). */
  city: string | null;
  /** Best-effort two-letter US state ("CA"). Full state names in the
   *  source ("California") are normalized to their abbreviation. */
  state: string | null;
  /** Best-effort 5-digit US ZIP code trailing the address, if present. */
  zip?: string | null;
  /** Venue name paired to this address, when a name-shaped phrase sits
   *  immediately before it in the caption. Populated by the evidence
   *  layer (extractEvidence), not by the extractor itself — the raw
   *  extractor leaves this null. */
  venue?: string | null;
};

// Conservative US street-address regex. Requires a leading number, a
// street word boundary, and one of a list of common suffixes. We do NOT
// claim international coverage — that's deferred until we have evidence
// it's worth the false-positive cost. International addresses without a
// recognized suffix simply won't trigger the address-first path; they
// still flow through the normal name-based extraction.
const STREET_SUFFIXES =
  '(?:street|st|avenue|ave|av|road|rd|boulevard|blvd|drive|dr|lane|ln|way|wy|court|ct|place|pl|terrace|ter|highway|hwy|parkway|pkwy|circle|cir|plaza|plz|square|sq|alley|aly|broadway|road|route|rte|trail|trl|loop|walk|row|path|pike|expressway|expy|freeway|fwy)';
// Optional unit / suite token that may trail the street portion. Captured
// INTO the raw address so "379 W Central Ave Ste A" keeps its suite.
const UNIT_SUFFIX =
  `(?:\\s*(?:,|\\.)?\\s*(?:suite|ste|apt|apartment|unit|bldg|building|fl|floor|rm|room|#)\\.?\\s*[A-Za-z0-9\\-]+)?`;
// "Suffix-last" US form: number + 1-5 word street name + street suffix.
// e.g. "30012 Crown Valley Pkwy", "126 Main St", "8502 Telegraph Rd".
const STREET_SUFFIX_FORM =
  `\\d{1,6}(?:\\-\\d+)?\\s+[A-Za-z0-9'\\.]+(?:\\s+[A-Za-z0-9'\\.]+){0,4}\\s+${STREET_SUFFIXES}`;
// "Type-first" form used by Spanish / French street naming common in CA/TX/
// FL/LA ("31872 Paseo Adelanto", "123 Calle Real", "45 Via Lido"). The type
// keyword is matched case-INSENSITIVELY but the following street name MUST be
// Title-cased so casual prose ("order 5 via fedex", "3 camino tacos") does not
// trigger. Kept as a separate case-sensitive pass (see extractLikelyAddresses).
const STREET_TYPE_PREFIXES =
  '(?:Paseo|Camino|Calle|Avenida|Via|Rue|Plaza|Carrera|Cami[nñ]o)';
const STREET_PREFIX_FORM =
  `\\d{1,6}(?:\\-\\d+)?\\s+${STREET_TYPE_PREFIXES}\\s+[A-Z][A-Za-z'\\.]+(?:\\s+[A-Z][A-Za-z'\\.]+){0,3}`;

const STREET_SUFFIX_RE = new RegExp(`\\b(${STREET_SUFFIX_FORM})\\b${UNIT_SUFFIX}`, 'gi');
// Case-SENSITIVE (no 'i' flag) so the Title-cased street-name requirement is
// enforced — this is what keeps false positives low for the type-first form.
const STREET_PREFIX_RE = new RegExp(`\\b(${STREET_PREFIX_FORM})\\b${UNIT_SUFFIX}`, 'g');

const STATE_RE = /\b([A-Z]{2})\b/;
const ZIP_RE = /\b(\d{5})(?:-\d{4})?\b/;

// Full US state names → USPS abbreviation. Used to normalize captions that
// spell the state out ("San Juan Capistrano, California 92675").
const STATE_NAME_TO_ABBR: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS',
  missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV',
  'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM',
  'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI',
  'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX',
  utah: 'UT', vermont: 'VT', virginia: 'VA', washington: 'WA',
  'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};
const STATE_ABBRS = new Set(Object.values(STATE_NAME_TO_ABBR).concat('DC'));

const CITY_FIRST_WORD_STOP =
  /^(best|new|open|fresh|amazing|good|great|happy|the|a|an|top|our|my|your|this|that|suite|ste|unit|apt|apartment|bldg|building|floor|fl|room|rm)$/;

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

  // Collect raw matches from BOTH the suffix-last and type-first passes,
  // tagged with their position so we can return them in source order and
  // dedupe overlaps deterministically.
  type RawHit = { raw: string; index: number; end: number };
  const hits: RawHit[] = [];
  for (const re of [STREET_SUFFIX_RE, STREET_PREFIX_RE]) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const captured = (m[1] ?? '').trim();
      if (!captured) continue;
      // The full match (m[0]) includes any trailing unit token; keep it in
      // `raw` so "379 W Central Ave Ste A" preserves its suite.
      const raw = m[0].trim().replace(/[\s,]+$/, '');
      hits.push({ raw, index: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
    }
  }
  hits.sort((a, b) => a.index - b.index);

  const out: LikelyAddress[] = [];
  const seen = new Set<string>();
  const takenSpans: Array<[number, number]> = [];
  for (const hit of hits) {
    if (out.length >= max) break;
    // Skip a hit that overlaps a span we already emitted (the two passes can
    // both match the same street).
    if (takenSpans.some(([s, e]) => hit.index < e && hit.end > s)) continue;
    const key = streetKey(hit.raw);
    if (seen.has(key)) continue;
    seen.add(key);
    takenSpans.push([hit.index, hit.end]);

    const tail = text.slice(hit.end, hit.end + 80);
    const head = text.slice(Math.max(0, hit.index - 48), hit.index);

    let city: string | null = null;
    let state: string | null = null;
    let zip: string | null = null;

    // 1. Trailing "<address>, <city>, <ST> <zip>" form.
    const cityMatch = tail.match(
      /^\s*,?\s*([A-Z][A-Za-z\.\- ]{1,40}?)(?:\s*,\s*([A-Za-z]{2,})\b|\s*$|[\.,;\n])/,
    );
    if (cityMatch) {
      city = cleanCity(cityMatch[1]);
      state = normalizeState(cityMatch[2] ?? null);
    }
    // 2. Full state name anywhere in the tail ("..., California 92675").
    if (!state) {
      const fullState = matchFullStateName(tail);
      if (fullState) state = fullState;
    }
    // 3. Two-letter state token in the tail.
    if (!state) {
      const stateM = tail.match(STATE_RE);
      if (stateM && STATE_ABBRS.has(stateM[1].toUpperCase())) state = stateM[1].toUpperCase();
    }
    // 4. Leading "<city>, <address>" form ("📍 Downey, 8502 Telegraph Rd.").
    //    Restricted to a city that is directly prefixed by a pin / bullet
    //    marker so a venue-before-address ("Joe's, 123 Main St") is NOT
    //    mistaken for a city. Only used when the trailing parse found no city.
    if (!city) {
      const leadCity = head.match(/(?:📍|•|·|\|)\s*([A-Z][A-Za-z.'\- ]{1,40}?)\s*,\s*$/u);
      if (leadCity) city = cleanCity(leadCity[1]);
    }
    // 5. ZIP anywhere in the tail (independent of city/state parsing).
    const zipM = tail.match(ZIP_RE);
    if (zipM) zip = zipM[1];

    out.push({ raw: hit.raw, city, state, zip, venue: null });
  }
  return out;
}

/** Normalized dedupe key for a street address (lowercase, drop unit,
 *  collapse whitespace). */
function streetKey(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/\b(?:suite|ste|apt|apartment|unit|bldg|building|fl|floor|rm|room|#)\.?\s*[a-z0-9\-]+\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Trim + reject a city candidate whose first word is filler / a descriptor. */
function cleanCity(value: string | null | undefined): string | null {
  if (!value) return null;
  const city = value.trim().replace(/[\s,]+$/, '');
  if (!city) return null;
  const first = city.toLowerCase().split(' ')[0];
  if (CITY_FIRST_WORD_STOP.test(first)) return null;
  return city;
}

/** Normalize a captured state token (abbr or full name) to a USPS abbr. */
function normalizeState(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (/^[A-Za-z]{2}$/.test(v) && STATE_ABBRS.has(v.toUpperCase())) return v.toUpperCase();
  const full = STATE_NAME_TO_ABBR[v.toLowerCase()];
  return full ?? null;
}

/** Find a full state name ("California", "New York") in text → abbr. */
function matchFullStateName(text: string): string | null {
  const lower = text.toLowerCase();
  for (const [name, abbr] of Object.entries(STATE_NAME_TO_ABBR)) {
    const re = new RegExp(`\\b${name.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (re.test(lower)) return abbr;
  }
  return null;
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
