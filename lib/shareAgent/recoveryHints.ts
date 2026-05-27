/**
 * lib/shareAgent/recoveryHints.ts
 *
 * Pure helpers for the timeout-recovery / Places query-building
 * pipeline. Extracted so both the Deno Edge Function
 * (supabase/functions/process-share-link/shadowRun.ts) and Node-side
 * unit tests can share the same logic.
 *
 * Keep this file dependency-free.
 *
 * Scope:
 *   - Derive a usable Places "place-name hint" from an Instagram /
 *     TikTok handle (e.g. `@paradisedynasty_usa` → "Paradise Dynasty").
 *   - Identify mall / shopping-center / context handles that should
 *     never be used as the venue (e.g. `@southcoastplaza`).
 *   - Detect Google's generic "<number> <street>" address card so it
 *     never beats a real business candidate.
 *
 * Out of scope:
 *   - Calling Places / Gemini / fetch.
 *   - Mutating the safety decision (safety.ts owns that).
 */

import type { DetectedHandles } from './tools';
import type { LikelyAddress } from './queryCleaner';

/** Tokens that are not part of the venue name and should be stripped
 *  from the trailing edge of a handle before producing a place-name
 *  hint. Includes region codes commonly tacked on by US franchise
 *  marketing teams (`_usa`, `_oc`, `_la`) and generic suffixes
 *  (`_official`). */
export const VENUE_HANDLE_REGION_SUFFIXES: ReadonlySet<string> = new Set([
  'usa', 'us', 'ca', 'ny', 'nj', 'tx', 'fl',
  'hb', 'nb', 'lb', 'oc',
  'sf', 'la', 'nyc', 'bk', 'sd', 'pdx', 'chi',
  'atx', 'dfw', 'bos', 'sea', 'dc', 'mia',
  'official',
]);

/** Suffix pattern that identifies mall / shopping-center / open-air
 *  retail context handles. We never treat these as the actual venue
 *  to save — they're the location of many venues. */
export const MALL_CONTEXT_HANDLE_RE =
  /(plaza|mall|center|centre|outlets|outlet|square|commons|towncenter|marketplace)$/i;

export function isMallContextHandle(handle: string): boolean {
  const compact = handle.toLowerCase().replace(/[^a-z0-9]/g, '');
  return MALL_CONTEXT_HANDLE_RE.test(compact);
}

/**
 * Permissive handle → place-name hint. Strips region / marketing
 * suffixes from underscore-separated handles (`paradisedynasty_usa`
 * → `paradisedynasty`) and from compact handles where the suffix is
 * glued onto the last token (`paradisedynastyusa` → `paradisedynasty`).
 * Returns title-cased tokens joined by spaces, or `null` if nothing
 * meaningful is left.
 *
 * This is intentionally NOT a perfect word-splitter for compact
 * handles like `paradisedynasty` — Google Places' fuzzy match handles
 * that pretty reliably when the query also carries the address.
 */
export function derivePlaceNameHintFromHandle(
  handle: string | null | undefined,
): string | null {
  if (!handle) return null;
  const parts = handle
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((part) => !VENUE_HANDLE_REGION_SUFFIXES.has(part));
  if (parts.length === 0) return null;
  const tail = parts[parts.length - 1];
  for (const suffix of VENUE_HANDLE_REGION_SUFFIXES) {
    if (tail.length > suffix.length + 3 && tail.endsWith(suffix)) {
      parts[parts.length - 1] = tail.slice(0, -suffix.length);
      break;
    }
  }
  const cleaned = parts.filter(Boolean);
  if (cleaned.length === 0) return null;
  return cleaned
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

/**
 * Tagged-handle subset that may name an actual venue. Excludes:
 *   - the poster's own handle (the influencer, never the venue)
 *   - mall / context handles
 *
 * Order of the returned list preserves caption tag order, which tends
 * to put the most relevant business first.
 */
export function extractVenueHandleCandidates(
  handles: DetectedHandles,
): string[] {
  const posterLower = handles.posterHandle?.toLowerCase() ?? '';
  const seen = new Set<string>();
  const out: string[] = [];
  for (const handle of handles.taggedHandles ?? []) {
    if (!handle) continue;
    const lower = handle.toLowerCase();
    if (lower === posterLower) continue;
    if (isMallContextHandle(handle)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(handle);
  }
  return out;
}

/** Humanized mall/context label from the first mall-style tagged
 *  handle, if any. Used as extra location context paired with a
 *  venue handle (e.g. "Paradise Dynasty South Coast Plaza"), never as
 *  a venue. */
export function extractMallContextLabel(
  handles: DetectedHandles,
): string | null {
  for (const handle of handles.taggedHandles ?? []) {
    if (handle && isMallContextHandle(handle)) {
      return derivePlaceNameHintFromHandle(handle);
    }
  }
  return null;
}

/** Compact street suffixes used to canonicalize address strings
 *  before comparing the candidate name to the caption address. Keeps
 *  `3333 Bristol Street` and `3333 Bristol St` treated as the same
 *  generic address card. Mirrors the USPS pairs in tools.ts. */
const STREET_SUFFIX_STRIP_RE =
  /(?:street|st|avenue|ave|av|road|rd|boulevard|blvd|drive|dr|lane|ln|way|wy|court|ct|place|pl|terrace|ter|highway|hwy|parkway|pkwy|circle|cir|plaza|plz|square|sq|alley|aly|broadway)$/;

function compactStripSuffix(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '').replace(STREET_SUFFIX_STRIP_RE, '');
}

/**
 * True when a Places candidate's name is essentially the street
 * address itself — Google's generic "<number> <street>" /
 * "<number> <street>, Building" card. We use this to prevent the
 * generic card from out-ranking a real business at the same address
 * during timeout recovery.
 */
export function isGenericAddressCard(
  candidate: { name?: string | null } | null | undefined,
  captionAddress: LikelyAddress | null,
): boolean {
  if (!candidate || !captionAddress) return false;
  const nameRaw = (candidate.name ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const addrRaw = captionAddress.raw.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!nameRaw || !addrRaw) return false;
  const leadingDigits = (captionAddress.raw.match(/^\d+/) ?? [''])[0];
  if (!leadingDigits || !nameRaw.startsWith(leadingDigits)) return false;
  // Canonicalize street suffixes ("street" ↔ "st") on both sides so
  // "3333 Bristol Street" matches "3333 Bristol St".
  const nameCanon = compactStripSuffix(candidate.name ?? '');
  const addrCanon = compactStripSuffix(captionAddress.raw);
  if (!nameCanon || !addrCanon) return false;
  if (nameCanon === addrCanon) return true;
  return nameCanon.length <= addrCanon.length + 2 && (addrCanon.includes(nameCanon) || nameCanon.includes(addrCanon));
}

// ---------------------------------------------------------------------------
// 2026-05-27 — Patch 1: address-free recovery helpers.
//
// When Gemini times out on a post that has a clear venue name + city
// context but NO street address, the existing recovery paths fall
// through to `manual_fallback`. These pure helpers let the
// shadowRun.ts orchestrator construct a conservative `<name> <city>
// <state>` Places query and accept `candidate_confirmation` when the
// returned candidate's normalized name aligns with the caption hint
// and Places echoes the city back in the formatted address.
//
// Hard rules carried by the consumer (NOT enforced here):
//   - Never produce `auto_save` from this path (always
//     `candidate_confirmation`, `safeToAutoSave: false`).
//   - Skip the entire branch when `looksLikeRoundupPost` fires.
//   - Require the candidate's formatted address to contain the
//     caption city before accepting.
// ---------------------------------------------------------------------------

/** Lowercase, accent-stripped, alphanum-only form. Used to compare
 *  caption-derived venue hints (often compact, e.g. `seabrightdeli`)
 *  to Places candidate names (often spaced, e.g. `Seabright Deli`). */
export function normalizeCompactName(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

// 2026-05-27 — Patch 2: compact-name matching for venue hints.
//
// Captions and handles routinely carry compact, marketing-suffixed
// venue tokens (e.g. `bajasharkeeznb`, `taquerialospericossocial`,
// `kenosrestaurant`) that Places returns in their spaced canonical
// form ("Baja Sharkeez", "Taqueria Los Pericos", "Keno's
// Restaurant"). Direct substring containment misses these because of
// trailing region/social suffixes (`nb`, `social`) or generic-word
// padding (`restaurant`, `cafe`, `bar`) on one side but not the
// other.
//
// `compactNameMatches` is the shared decision used by the timeout
// recovery acceptance gate (`shadowRun.ts`) and the gold eval's
// name comparator. It is intentionally NOT used to inflate
// `compareCandidateToEvidence` scores — that would change
// auto-save thresholds in safety.ts.

/** Region / social / marketing tokens routinely appended to handles.
 *  Stripped only from the TAIL of a compact string, and only when
 *  enough of the original token remains to be meaningful. */
const COMPACT_SUFFIX_TOKENS: readonly string[] = [
  'official', 'social',
  'usa', 'us', 'ca', 'ny', 'nj', 'tx', 'fl',
  'hb', 'nb', 'lb', 'oc', 'sf', 'la', 'nyc', 'bk',
  'sd', 'pdx', 'chi', 'atx', 'dfw', 'bos', 'sea', 'dc', 'mia',
];

/** Generic descriptor words that often pad a Places canonical name
 *  (`Pho Bamboo Vietnamese Restaurant`) but are absent from the
 *  caption-side hint (`phobamboorestaurant`). Stripped from BOTH
 *  sides when present so the discriminative tokens align. We are
 *  deliberately conservative here: words like `bbq`, `pizza`,
 *  `sushi`, `taco`, `burger` are NOT in this set because they often
 *  ARE the discriminative token (e.g. "Aptos St BBQ" vs "Aptos St").
 */
const COMPACT_GENERIC_WORDS: readonly string[] = [
  'restaurant', 'restaurants', 'vietnamese', 'mexican', 'italian',
  'chinese', 'japanese', 'thai', 'korean', 'american',
  'eatery', 'kitchen', 'official', 'social',
];

function stripCompactSuffixes(compact: string): string {
  let current = compact;
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of COMPACT_SUFFIX_TOKENS) {
      // Require the post-strip head to be at least 4 chars so we
      // never strip away the whole brand (e.g. `usa` is not stripped
      // from `usanail`).
      if (current.length >= suffix.length + 4 && current.endsWith(suffix)) {
        current = current.slice(0, current.length - suffix.length);
        changed = true;
        break;
      }
    }
  }
  return current;
}

function stripCompactGenerics(compact: string): string {
  let current = compact;
  // Greedy global remove (not just trailing) — generic words can
  // appear in the middle ("phobamboovietnameserestaurant" → strip
  // "restaurant" anywhere). Length floor keeps us from nuking a
  // short brand whose name IS a generic ("Bar" alone wouldn't match
  // anyway because of the 4-char gate below).
  for (const word of COMPACT_GENERIC_WORDS) {
    if (current.length - word.length < 4) continue;
    current = current.split(word).join('');
  }
  return current;
}

// 2026-05-27 — Patch 3: connector-word stripper.
//
// Some captions render `&` as the word `and` ("POINT MARKET AND
// CAFE"), while the Places canonical name keeps the ampersand
// ("Point Market & Cafe"). Normalizing both sides into compact form
// produces `pointmarketandcafe` vs `pointmarketcafe` which the
// suffix/generic tiers won't reconcile. We CAN'T add `and` to
// `COMPACT_GENERIC_WORDS` because that strip operates on the
// already-compacted string and would mangle brands whose names
// CONTAIN those letters as a substring (e.g. `Sandwich` → `swich`,
// `Theater` → `ater`). Instead we tokenize on non-alphanum FIRST,
// drop whole connector tokens, then re-compact. This is safe even
// for inputs that arrive already compact: a single-token input is
// unaffected because there are no internal connector tokens to
// drop. Symmetric by construction.
const COMPACT_CONNECTOR_WORDS: ReadonlySet<string> = new Set([
  'and', 'the', 'of',
]);

function compactWithoutConnectors(value: string | null | undefined): string {
  const tokens = (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token && !COMPACT_CONNECTOR_WORDS.has(token));
  return tokens.join('');
}

/** Aggressive connector strip on already-compact form. Used as a
 *  last-resort tier when one side of the comparison arrived purely
 *  compact (e.g. caption text "POINT MARKET AND CAFE" → compact
 *  `pointmarketandcafe` after caller's own normalization) and the
 *  other side has explicit token boundaries. Only invoked when the
 *  post-strip head still clears the 4-char floor, and the matcher
 *  itself never relies on this tier alone — preceding equality and
 *  substring tiers must have already failed. */
function dropConnectorSubstrings(compact: string): string {
  let current = compact;
  for (const word of COMPACT_CONNECTOR_WORDS) {
    if (current.length - word.length < 4) continue;
    current = current.split(word).join('');
  }
  return current;
}

/**
 * Returns true when two place-name strings are plausibly the same
 * venue despite compact-vs-spaced formatting, marketing/region
 * suffixes, or generic-descriptor padding on either side. The
 * comparison is symmetric (`compactNameMatches(a, b) ===
 * compactNameMatches(b, a)`) and never mutates input.
 *
 * Decision ladder (any tier passing → match):
 *   1. Pure compact equality / substring containment after
 *      `normalizeCompactName` alone.
 *   2. Same ladder after stripping `COMPACT_SUFFIX_TOKENS` from the
 *      tail of each side (handles `bajasharkeeznb` ↔ `Baja Sharkeez`).
 *   3. Same ladder after additionally removing `COMPACT_GENERIC_WORDS`
 *      anywhere (handles `phobamboorestaurant` ↔ `Pho Bamboo
 *      Vietnamese Restaurant`).
 *
 * Returns false for any string shorter than 4 normalized characters
 * to avoid false positives on stub tokens.
 */
export function compactNameMatches(
  expected: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const ea = normalizeCompactName(expected);
  const ca = normalizeCompactName(candidate);
  if (ea.length < 4 || ca.length < 4) return false;
  if (ea === ca) return true;
  if (ea.includes(ca) || ca.includes(ea)) return true;

  // 2026-05-27 — Patch 3: connector-aware re-compaction so
  // `pointmarketandcafe` ↔ `Point Market & Cafe` (caption renders
  // `&` as the word "and"). Safe because connectors are dropped at
  // the TOKEN level on the original string, not as substrings of
  // the compact form — `Sandwich` stays `sandwich`.
  const ec = compactWithoutConnectors(expected);
  const cc = compactWithoutConnectors(candidate);
  if (ec.length >= 4 && cc.length >= 4 && (ec === cc || ec.includes(cc) || cc.includes(ec))) {
    return true;
  }
  // 2026-05-27 — Patch 3 follow-up: when one side arrived ALREADY
  // compact ("POINT MARKET AND CAFE" rendered without spaces
  // somewhere upstream) the token-level strip above is a no-op on
  // that side. Try one more pass that removes `and`/`the`/`of` as
  // substrings, but only against the OPPOSITE side's
  // already-connector-stripped compact form. This avoids the false-
  // positive where stripping inside "Sandwich" → "swich" matches
  // something unrelated, because both equality and substring
  // containment must still hold and the 4-char floor is preserved.
  const eAggr = dropConnectorSubstrings(ea);
  const cAggr = dropConnectorSubstrings(ca);
  if (eAggr.length >= 4 && cAggr.length >= 4) {
    if (eAggr === cc || cAggr === ec) return true;
    if (eAggr === cAggr) return true;
  }

  const eb = stripCompactSuffixes(ea);
  const cb = stripCompactSuffixes(ca);
  if (eb.length >= 4 && cb.length >= 4) {
    if (eb === cb) return true;
    if (eb.includes(cb) || cb.includes(eb)) return true;
  }

  const eg = stripCompactGenerics(eb);
  const cg = stripCompactGenerics(cb);
  if (eg.length >= 4 && cg.length >= 4) {
    if (eg === cg) return true;
    if (eg.includes(cg) || cg.includes(eg)) return true;
  }

  return false;
}

/** Known US city/state pairs that the address-free recovery branch
 *  is willing to use as anchor context. Intentionally a closed list
 *  (not a freeform city detector) so we never invent a city that
 *  Google would resolve incorrectly. Add new entries as eval failures
 *  surface them. */
const KNOWN_CITY_STATE_LITERALS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/\bSanta\s+Cruz\b/i, 'Santa Cruz', 'CA'],
  [/\bHuntington\s+Beach\b/i, 'Huntington Beach', 'CA'],
  [/\bNewport\s+Beach\b/i, 'Newport Beach', 'CA'],
  [/\bLong\s+Beach\b/i, 'Long Beach', 'CA'],
  [/\bCosta\s+Mesa\b/i, 'Costa Mesa', 'CA'],
  [/\bSan\s+Diego\b/i, 'San Diego', 'CA'],
  [/\bSan\s+Jose\b/i, 'San Jose', 'CA'],
  [/\bSan\s+Francisco\b/i, 'San Francisco', 'CA'],
  [/\bLos\s+Angeles\b/i, 'Los Angeles', 'CA'],
  [/\bMonterey\b/i, 'Monterey', 'CA'],
  [/\bBrooklyn\b/i, 'Brooklyn', 'NY'],
  [/\bManhattan\b/i, 'Manhattan', 'NY'],
  [/\bQueens\b/i, 'Queens', 'NY'],
  [/\bNew\s+York\b/i, 'New York', 'NY'],
];

/** Hashtag forms (no spaces) that map back to a known city. We only
 *  accept these when they appear as actual `#hashtag` tokens so the
 *  pattern can't fire on a substring of an unrelated word. */
const KNOWN_CITY_HASHTAGS: ReadonlyArray<readonly [RegExp, string, string]> = [
  [/#santacruz\b/i, 'Santa Cruz', 'CA'],
  [/#downtownsantacruz\b/i, 'Santa Cruz', 'CA'],
  [/#visitsantacruz\b/i, 'Santa Cruz', 'CA'],
  [/#huntingtonbeach\b/i, 'Huntington Beach', 'CA'],
  [/#newportbeach\b/i, 'Newport Beach', 'CA'],
  [/#longbeach\b/i, 'Long Beach', 'CA'],
  [/#costamesa\b/i, 'Costa Mesa', 'CA'],
  [/#sandiego\b/i, 'San Diego', 'CA'],
  [/#sanjose\b/i, 'San Jose', 'CA'],
  [/#sanfrancisco\b/i, 'San Francisco', 'CA'],
  [/#losangeles\b/i, 'Los Angeles', 'CA'],
  [/#monterey\b/i, 'Monterey', 'CA'],
  [/#brooklyn\b/i, 'Brooklyn', 'NY'],
  [/#manhattan\b/i, 'Manhattan', 'NY'],
  [/#nyc\b/i, 'New York', 'NY'],
];

export type CityStateContext = { city: string; state: string };

/**
 * Detect a city/state anchor in caption text. Looks for:
 *   1. An explicit `<City>, <ST>` form ("Santa Cruz, CA").
 *   2. A known city literal in prose ("in Newport Beach").
 *   3. A known hashtag form ("#santacruz", "#huntingtonbeach").
 *
 * Returns `null` when no recognized city is found. The result is
 * intentionally conservative — unknown cities are NOT inferred from
 * arbitrary `[A-Z][a-z]+, [A-Z]{2}` matches because Google Places
 * will happily resolve a wrong city to the wrong state.
 */
export function extractCityStateContext(
  text: string | null | undefined,
): CityStateContext | null {
  if (!text) return null;
  // 1. Explicit "Known City, ST" — strongest signal, check first.
  for (const [re, city, state] of KNOWN_CITY_STATE_LITERALS) {
    const literalRe = new RegExp(re.source + String.raw`\s*,\s*` + state + String.raw`\b`, 'i');
    if (literalRe.test(text)) return { city, state };
  }
  // 2. Known city literal anywhere in prose.
  for (const [re, city, state] of KNOWN_CITY_STATE_LITERALS) {
    if (re.test(text)) return { city, state };
  }
  // 3. Known hashtag form.
  for (const [re, city, state] of KNOWN_CITY_HASHTAGS) {
    if (re.test(text)) return { city, state };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 2026-05-27 — Patch 8: wrong-location guard.
//
// When the caption carries a clear US city/state context (or even just
// a state from an extracted address) but Google returns a candidate in
// a different country (e.g. Toronto for "55 Front St" + Santa Cruz
// hashtag) or a different US state (e.g. Verde Media in Michigan for
// "1525 Mesa Verde Dr E, Costa Mesa, CA"), the candidate is almost
// certainly the wrong place. Block these from being surfaced as
// `candidate_confirmation` / `auto_save`.
//
// Pure helpers — they NEVER produce a decision; callers in agent.ts
// and shadowRun.ts use them to filter / demote / drop candidates.
// ---------------------------------------------------------------------------

const NON_US_COUNTRY_RE =
  /\b(canada|mexico|united\s+kingdom|england|scotland|wales|ireland|france|germany|spain|italy|portugal|netherlands|belgium|switzerland|austria|australia|new\s+zealand|japan|china|korea|india|brazil|argentina|chile|colombia|peru)\b/i;

const US_STATE_ABBREVIATIONS: ReadonlySet<string> = new Set([
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY','DC',
]);

/** Pull the trailing US state abbreviation from a formatted address
 *  string like "..., Costa Mesa, CA 92626, USA". Returns the
 *  two-letter code (uppercase) or null. */
export function extractStateFromFormattedAddress(
  address: string | null | undefined,
): string | null {
  if (!address) return null;
  const matches = address.match(/\b([A-Z]{2})\b(?=\s+\d{5}(?:-\d{4})?|\s*,\s*USA\b|\s*$)/g);
  if (!matches) return null;
  for (let i = matches.length - 1; i >= 0; i -= 1) {
    const code = matches[i].toUpperCase();
    if (US_STATE_ABBREVIATIONS.has(code)) return code;
  }
  return null;
}

/** True when `address` clearly names a non-US country. */
export function addressIsNonUS(address: string | null | undefined): boolean {
  if (!address) return false;
  return NON_US_COUNTRY_RE.test(address);
}

/**
 * 2026-05-27 — Patch 8 core helper.
 *
 * Returns true when the Places candidate's formatted address is in a
 * different country/state than the caption's expected location
 * context. Conservative: if either side is unknown, returns false
 * (i.e. do NOT block).
 *
 * @param candidateAddress  candidate.formattedAddress (e.g.
 *   "55 Front St W, Toronto, ON M5J 0G3, Canada")
 * @param expectedState     two-letter US state inferred from caption
 *   (`extractCityStateContext` city/state, or address-extracted
 *   state). Pass null if unknown.
 */
export function isWrongLocationCandidate(
  candidateAddress: string | null | undefined,
  expectedState: string | null | undefined,
): boolean {
  if (!candidateAddress) return false;
  const expected = (expectedState ?? '').toUpperCase().trim();
  // If expected is a US state, candidate in a non-US country is wrong.
  if (expected && US_STATE_ABBREVIATIONS.has(expected)) {
    if (addressIsNonUS(candidateAddress)) return true;
    const candidateState = extractStateFromFormattedAddress(candidateAddress);
    if (candidateState && candidateState !== expected) return true;
    return false;
  }
  return false;
}

/**
 * Heuristic detector for roundup / list / "top N" posts. The
 * address-free recovery branch MUST skip these — picking any single
 * candidate would attribute the post to one venue when it discusses
 * several.
 *
 * 2026-05-27 — Patch 5 tightening: false-positive triage of the
 * gold set showed obvious single-venue posts ("2nd Floor, 126 Main
 * St, Huntington Beach"; "Seabright Deli, 415 Seabright Ave, Santa
 * Cruz") were being skipped because the caption tagged a handful of
 * collab / supplier / neighborhood handles. The previous "3+ tagged
 * handles alone" trigger is removed. We now require STRONG list
 * evidence:
 *   - "top N", "best N", "N best/places/spots/...", "roundup",
 *     "list of", "our picks" — clear list language.
 *   - "#N from @handle" ranking pattern (e.g. "#5 from
 *     @woodennickel_wv").
 *   - 3+ numbered list items at line start ("1. ... 2. ... 3.").
 *   - 3+ distinct non-mall tagged venue handles AND list language
 *     (handles alone are no longer sufficient).
 * Additionally: when the caption already carries an explicit venue
 * name AND a full street address, only ranked/numbered list
 * patterns can still flip it to roundup — incidental list keywords
 * ("the best burger we've ever had") cannot.
 */
export function looksLikeRoundupPost(
  text: string | null | undefined,
  handles?: DetectedHandles | null,
): boolean {
  const body = (text ?? '').trim();
  if (body.length === 0) return false;

  // --- "hard" list signals that ALWAYS classify as roundup ---------
  // Ranked list ("#5 from @woodennickel_wv ... #4 from @...")
  const rankedFrom = body.match(/#\d{1,2}\s+from\s+@\w+/gi);
  if (rankedFrom && rankedFrom.length >= 1) return true;
  // Numbered list items (3+ at line start).
  const numbered = body.match(/(?:^|\n)\s*\d{1,2}[.)]\s+\S/g);
  if (numbered && numbered.length >= 3) return true;

  // --- "soft" list signals (keywords) — may be suppressed by a
  //     single-place anchor below ---------------------------------
  const softListSignal =
    /\btop\s+\d{1,2}\b/i.test(body) ||
    /\b(?:best|favorite|favourite)\s+\d{1,2}\b/i.test(body) ||
    /\b\d{1,2}\s+(?:best|spots|places|restaurants|cafes|joints|burgers|tacos|sandwiches|sandos|pizzas|sushi)\b/i.test(body) ||
    // 2026-05-27 — Patch 5b: only `roundup` / `round-up` (no space).
    // The two-word "round up" is overwhelmingly idiomatic ("round up
    // your crew", "round up the gang") and was producing false
    // positives on single-place event posts that happened to use it.
    /\bround-?up\b/i.test(body) ||
    /\blist\s+of\b/i.test(body) ||
    /\bour\s+picks\b/i.test(body);

  // Single-place anchor: an explicit pin or "Name, Known City" plus
  // a likely full street address. If both are present we treat this
  // as a single-place post even if a soft list keyword sneaks in.
  const hasPinOrCommaCity =
    /📍/.test(body) ||
    extractCaptionVenueHints(body).length > 0;
  const hasFullStreetAddress = /\b\d{2,6}\s+[A-Z][A-Za-z0-9'.\- ]{1,40}\s+(?:St|Ave|Av|Blvd|Rd|Dr|Ln|Way|Wy|Ct|Pl|Ter|Hwy|Pkwy|Cir|Plz|Sq|Aly|Broadway)\b/i.test(body);
  const singlePlaceAnchor = hasPinOrCommaCity && hasFullStreetAddress;

  if (softListSignal) {
    if (!singlePlaceAnchor) return true;
    // Anchor present — only a HARD list signal (already checked
    // above) flips this to roundup.
  }

  // --- handle-count signal: only when paired with list language --
  if (handles) {
    const tagged = (handles.taggedHandles ?? []).filter(
      (handle) => !!handle && !isMallContextHandle(handle),
    );
    const unique = Array.from(new Set(tagged.map((h) => h.toLowerCase())));
    // 3+ venue-like handles ALONE are not enough — collab/supplier
    // tags are common on single-place posts. We require coincident
    // soft list language. (Hard signals already returned above.)
    if (unique.length >= 3 && softListSignal && !singlePlaceAnchor) return true;
  }

  return false;
}

/**
 * Extract candidate venue-name strings from caption/title text using
 * conservative deterministic patterns. Returns an ordered list of
 * unique title-ish phrases, most-trustworthy first:
 *
 *   1. `📍 <Name>` pin marker (very strong — the poster literally
 *      tagged the venue).
 *   2. `<Name>, <Known City>` form ("POINT MARKET AND CAFE, Santa
 *      Cruz, CA").
 *   3. `<Name>` followed by `In <Known City>` ("Seabright Deli In
 *      Santa Cruz").
 *   4. `📍 <Name>` at end of line with `<Name>` BEFORE the pin
 *      ("POINT MARKET AND CAFE, Santa Cruz, CA📍").
 *
 * Only emits hints that look name-shaped (2–6 words, starts with a
 * capital letter, no `@` or URL fragments). Empty input → `[]`.
 */
export function extractCaptionVenueHints(
  text: string | null | undefined,
): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  // 2026-05-27 — Patch 6 follow-up: stoplist of descriptor / filler
  // first-words that real venue names almost never start with.
  // Without this, "Easily the best sandwich spot in Santa Cruz"
  // produced "Easily the best sandwich spot" as a venue hint and
  // the synchronous-path seed query used it as a literal place
  // name, returning unrelated places (e.g. a sandwich shop in
  // Austin, TX). Keep this list short and high-confidence —
  // anything that COULD legitimately start a venue name (e.g.
  // "Big", "Little", "Old") is NOT here.
  const NOISE_FIRST_WORDS = new Set([
    'easily', 'a', 'an', 'the', 'this', 'that', 'these', 'those',
    'my', 'our', 'your', 'their', 'his', 'her',
    'best', 'better', 'good', 'great', 'amazing', 'awesome',
    'fresh', 'happy', 'open', 'new',
    'am', 'pm',
  ]);
  const push = (raw: string | null | undefined) => {
    if (!raw) return;
    let cleaned = raw.replace(/\s+/g, ' ').trim();
    // Trim trailing punctuation/emoji-ish chars.
    cleaned = cleaned.replace(/[\s,.;:!?\-–—|]+$/u, '').trim();
    if (!cleaned) return;
    if (cleaned.length < 3 || cleaned.length > 60) return;
    if (/[@\/]/.test(cleaned)) return;
    if (!/^[A-Za-z0-9]/.test(cleaned)) return;
    // Reject time-fragment captures like "AM - 3PM", "11AM - 3PM".
    if (/\b\d{1,2}\s*[ap]m\b/i.test(cleaned)) return;
    // Reject phrases whose first word is a descriptor/filler word.
    const firstWord = cleaned.split(/\s+/)[0].toLowerCase().replace(/[^a-z]/g, '');
    if (firstWord && NOISE_FIRST_WORDS.has(firstWord)) return;
    const wordCount = cleaned.split(/\s+/).length;
    if (wordCount < 1 || wordCount > 6) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  // Pattern 1: 📍 <Name> until newline / @ / end-of-line.
  const pinAhead = text.matchAll(/📍\s*([A-Z][^\n@,📍]{2,60})/gu);
  for (const m of pinAhead) push(m[1]);

  // Pattern 2: <Name>, <Known City>, ST  (allow trailing pin emoji).
  for (const [cityRe, , state] of KNOWN_CITY_STATE_LITERALS) {
    const pattern = new RegExp(
      String.raw`([A-Z][A-Z0-9a-z'&\.\- ]{2,60}?)\s*,\s*` + cityRe.source + String.raw`(?:\s*,\s*` + state + String.raw`)?`,
      'g',
    );
    for (const m of text.matchAll(pattern)) push(m[1]);
  }

  // Pattern 3: <Name> In <Known City> ("Seabright Deli In Santa Cruz").
  for (const [cityRe] of KNOWN_CITY_STATE_LITERALS) {
    const pattern = new RegExp(
      String.raw`([A-Z][A-Z0-9a-z'&\.\- ]{2,60}?)\s+(?:In|in|IN|AT|At|at)\s+` + cityRe.source,
      'g',
    );
    for (const m of text.matchAll(pattern)) push(m[1]);
  }

  // Pattern 4: <Name>📍 (pin AFTER name, common on shorter captions).
  const pinBehind = text.matchAll(/([A-Z][A-Z0-9a-z'&\.\- ]{2,60}?)\s*📍/gu);
  for (const m of pinBehind) push(m[1]);

  return out;
}

