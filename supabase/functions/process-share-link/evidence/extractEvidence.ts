// supabase/functions/process-share-link/evidence/extractEvidence.ts
//
// Build a normalized `Evidence` record from raw post metadata + the
// already-extracted handles. This is the single artifact the
// resolver consumes — it never re-parses captions directly.

import {
  extractLikelyAddress,
  extractLikelyAddresses,
  type LikelyAddress,
} from './addressExtraction.ts';
import {
  extractCaptionVenueHints,
  derivePlaceNameHintFromHandle,
} from './venueHints.ts';
import { extractCityStateContext } from '../places/locationGuards.ts';
import { looksLikeRoundupPost } from './roundupDetection.ts';
import type { ExtractedHandles } from './handleExtraction.ts';
import type { TaggedLocationSignal } from './taggedLocation.ts';
import type { SourcePlatform } from '../types.ts';

export type Evidence = {
  platform: SourcePlatform;
  rawTitle: string | null;
  rawDescription: string | null;
  /** Combined title + description, normalized whitespace. */
  captionText: string;
  /** Deterministic US street address pulled from the caption.
   *  Kept for back-compat with single-place callers; equals
   *  `addresses[0] ?? null`. */
  address: LikelyAddress | null;
  /** ALL deterministic US street addresses pulled from the caption,
   *  in order of appearance, deduped by normalized raw text. Capped
   *  at 10. Empty when no address is detected. */
  addresses: LikelyAddress[];
  /** City/state anchor from caption hashtags or prose. */
  cityState: { city: string; state: string } | null;
  /** Conservative venue name hints from caption ("📍 X", "X, City"). */
  venueNameHints: string[];
  /** Poster + tagged handles. */
  handles: ExtractedHandles;
  /** True for "top N" / list / roundup posts. */
  isRoundup: boolean;
  /** First-class platform-tagged location (YouTube recordingDetails, TikTok
   *  POI, IG location tag). Null unless a provider supplied one. Highest-
   *  priority evidence source in the resolver, but still verified against
   *  Google Places before any candidate is surfaced. */
  taggedLocation: TaggedLocationSignal | null;
  /** Atomic evidence keys (subset of EvidenceKey from
   *  lib/shareAgent/types.ts) for the safety / decision policy. */
  keys: string[];
};

export function extractEvidence(args: {
  platform: SourcePlatform;
  title: string | null;
  description: string | null;
  handles: ExtractedHandles;
  /** Optional structured tagged-location signal from the platform. */
  taggedLocation?: TaggedLocationSignal | null;
}): Evidence {
  const captionText = [args.title, args.description]
    .filter(Boolean)
    .join('\n')
    .replace(/\s+/g, ' ')
    .trim();

  const addresses = extractLikelyAddresses(captionText, 10);
  const address = addresses[0] ?? null;
  // City/state extraction is greedy ("new york" substring matches
  // even in "new york style pastrami"). Re-validate that the literal
  // appears with a structural delimiter (comma, hashtag, "in/at",
  // line edge) before trusting it.
  const cityStateRaw = extractCityStateContext(captionText);
  const cityState = cityStateRaw && cityStateAppearsAsLocation(captionText, cityStateRaw.city)
    ? cityStateRaw
    : null;
  const venueNameHints = extractCaptionVenueHints(captionText)
    .filter((h) => !isKnownCityName(h))
    .filter((h) => !looksLikeStreetFragmentVenueHint(h, addresses));
  // Hint priority (high precision first):
  //   1. extractCaptionVenueHints  (📍 / "Name, City" patterns)
  //      with known-city false positives filtered out.
  //   2. derivePlaceNameHintFromHandle on a tagged venue handle
  //      (e.g. @loadedcafe → "Loaded Cafe") — the handle is owner-
  //      asserted so it's much more reliable than free-text guessing.
  //   3. extractNameBeforeAddress  — last-resort heuristic that
  //      scans the words preceding the detected street address.
  if (venueNameHints.length === 0 && args.handles.venueHandles[0]) {
    const fromHandle = derivePlaceNameHintFromHandle(args.handles.venueHandles[0]);
    if (fromHandle) venueNameHints.push(fromHandle);
  }
  if (address && venueNameHints.length === 0) {
    const pre = extractNameBeforeAddress(captionText, address.raw);
    if (
      pre &&
      !isKnownCityName(pre) &&
      !looksLikeStreetFragmentVenueHint(pre, addresses)
    ) {
      venueNameHints.push(pre);
    }
  }

  // Pair the nearest preceding venue name to each extracted address so the
  // resolver can build a "<venue> <address>" query per address (multi-address
  // captions like Tacos Don Goyo list several venue/address pairs). Pure and
  // deterministic — position-based, never uses poster handle/name.
  pairVenuesToAddresses(captionText, addresses, venueNameHints, args.handles);

  const isRoundup = looksLikeRoundupPost(captionText, {
    posterHandle: args.handles.posterHandle ?? '',
    taggedHandles: args.handles.taggedHandles,
    allHandles: [
      ...(args.handles.posterHandle ? [args.handles.posterHandle] : []),
      ...args.handles.taggedHandles,
    ],
  });

  const keys: string[] = [];
  if (address) keys.push('caption_explicit_address');
  if (addresses.length >= 2) keys.push('caption_multiple_addresses');
  if (cityState) keys.push('caption_city_state');
  if (venueNameHints.length > 0) keys.push('caption_venue_hint');
  if (args.handles.posterHandle) keys.push('poster_handle_present');
  if (args.handles.venueHandles.length > 0) keys.push('venue_handle_tagged');
  if (args.handles.posterNameHint) keys.push('poster_name_hint');
  if (isRoundup) keys.push('roundup_post');

  const taggedLocation = args.taggedLocation ?? null;
  if (taggedLocation) keys.push('tagged_location');

  return {
    platform: args.platform,
    rawTitle: args.title,
    rawDescription: args.description,
    captionText,
    address,
    addresses,
    cityState,
    venueNameHints,
    handles: args.handles,
    isRoundup,
    taggedLocation,
    keys,
  };
}

// Extract up-to-6-word Title-Cased phrase appearing immediately
// before the address in the caption. Pure heuristic — keep
// conservative; reject all-lowercase or filler-led phrases.
function extractNameBeforeAddress(
  caption: string,
  addressRaw: string,
): string | null {
  if (!caption || !addressRaw) return null;
  const idx = caption.indexOf(addressRaw);
  if (idx <= 0) return null;
  const before = caption.slice(0, idx).trim();
  if (!before) return null;
  // Take the last non-empty sentence/line before the address.
  // (Captions often end the previous sentence with a "?" or "!"
  // immediately before the address line — naive split would yield
  // an empty tail.)
  const parts = before.split(/[\n.!?…]/).map((p) => p.trim()).filter(Boolean);
  const tail = parts.pop();
  if (!tail) return null;
  // Pattern A: "<...> at|in|from|to <Name>" — pull the trailing
  // 2-6 words after the preposition. Catches mixed-case phrases
  // like "fave at Las Palmas taco bar" that the all-caps loop
  // below would miss.
  const prep = tail.match(/\b(?:at|in|from|visit(?:ing)?)\s+([A-Z][A-Za-z0-9'&\.\-]*(?:\s+[A-Za-z0-9'&\.\-]+){0,5})\s*$/);
  if (prep) {
    const phrase = prep[1].replace(/\s+/g, ' ').trim();
    if (phrase.length >= 3 && phrase.length <= 60) return phrase;
  }
  // Pattern B: trailing run of Title-Cased words.
  // Pull the last 1..6 capitalized words.
  const words = tail.split(/\s+/).filter(Boolean);
  const cap: string[] = [];
  for (let i = words.length - 1; i >= 0 && cap.length < 6; i -= 1) {
    const w = words[i];
    if (/^[A-Z][A-Za-z0-9'&\.\-]*$/.test(w)) {
      cap.unshift(w);
    } else if (/^\d{1,2}(?:st|nd|rd|th)$/i.test(w) && cap.length > 0) {
      // Allow ordinal prefix + TitleCase venue names ("2nd Floor").
      cap.unshift(w);
    } else {
      break;
    }
  }
  if (cap.length === 0) return null;
  const NOISE = new Set([
    'A', 'An', 'The', 'My', 'Our', 'Your', 'Their',
    'Best', 'Better', 'Good', 'Great', 'Amazing', 'New', 'Open',
    'I', 'We', 'You', 'They', 'It',
  ]);
  if (NOISE.has(cap[0])) cap.shift();
  if (cap.length === 0) return null;
  const phrase = cap.join(' ');
  if (phrase.length < 3 || phrase.length > 60) return null;
  return phrase;
}

// True iff `city` appears in `caption` as a structural location
// reference (after a comma, in a hashtag, after "in"/"at"/"from",
// or wrapped by line edges) rather than as a free-text noun phrase
// like "new york style pastrami".
function cityStateAppearsAsLocation(caption: string, city: string): boolean {
  if (!caption || !city) return false;
  const safe = city.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // common positive contexts
  const patterns = [
    new RegExp(`,\\s*${safe}\\b`, 'i'),                  // "..., New York"
    new RegExp(`#${safe.replace(/\s+/g, '')}\\b`, 'i'),  // "#NewYork"
    new RegExp(`\\b(?:in|at|from|to|visit|visiting)\\s+${safe}\\b`, 'i'),
    new RegExp(`\\b${safe}\\s*,\\s*[A-Z]{2}\\b`),        // "New York, NY"
    new RegExp(`(?:^|\\n)\\s*${safe}\\s*(?:$|\\n)`, 'i'), // line-isolated
  ];
  return patterns.some((re) => re.test(caption));
}

// Reject pre-address hints that match common US city names —
// captions like "...also has locations in Placentia, Santa Ana,
// Long Beach... 1834 N Tustin St" otherwise produce "Santa Ana"
// as a false venue name.
const KNOWN_CITY_NAMES = new Set(
  [
    'New York', 'Los Angeles', 'San Francisco', 'San Diego', 'San Jose',
    'Santa Cruz', 'Santa Ana', 'Santa Monica', 'Santa Barbara',
    'Long Beach', 'Newport Beach', 'Huntington Beach', 'Costa Mesa',
    'Orange', 'Anaheim', 'Irvine', 'Placentia', 'Fullerton', 'Brea',
    'Pasadena', 'Burbank', 'Glendale', 'Hollywood', 'Beverly Hills',
    'Chicago', 'Houston', 'Phoenix', 'Philadelphia', 'Dallas', 'Austin',
    'Seattle', 'Portland', 'Denver', 'Boston', 'Miami', 'Atlanta',
    'Las Vegas', 'Nashville', 'Minneapolis', 'Detroit',
    'Toronto', 'Vancouver', 'Montreal',
  ].map((s) => s.toLowerCase()),
);

function isKnownCityName(phrase: string): boolean {
  return KNOWN_CITY_NAMES.has(phrase.trim().toLowerCase());
}

const STREET_SUFFIX_TOKENS = new Set(
  [
    'st',
    'street',
    'ave',
    'avenue',
    'blvd',
    'boulevard',
    'rd',
    'road',
    'pkwy',
    'parkway',
    'dr',
    'drive',
    'ln',
    'lane',
    'way',
    'hwy',
    'highway',
  ],
);

const STREET_BIZ_WORD_RE =
  /\b(cafe|restaurant|kitchen|market|grill|bar|pizza|pizzeria|taqueria|deli|bakery|bistro|house|kbbq|bbq|ramen|sushi|eatery|cucina|korean|mexican|italian|thai|pho|coffee|brew|pub|cantina|kebab)\b/i;

function normalizeAlphaNum(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stripAddressPrefix(addressRaw: string): string {
  return normalizeAlphaNum(addressRaw)
    .replace(/^\d{1,6}(?:\s*\-\s*\d+)?\s+/, '')
    .replace(/\b(?:suite|ste|apt|apartment|unit|bldg|building|fl|floor|rm|room|#)\b.*$/i, '')
    .trim();
}

function looksLikeStreetFragmentVenueHint(hint: string, addresses: LikelyAddress[]): boolean {
  const hintNorm = normalizeAlphaNum(hint);
  if (!hintNorm) return true;
  const hintTokens = hintNorm.split(' ').filter(Boolean);
  if (hintTokens.length === 0) return true;

  const hintEndsWithStreetSuffix = STREET_SUFFIX_TOKENS.has(
    hintTokens[hintTokens.length - 1],
  );
  const hasBusinessWord = STREET_BIZ_WORD_RE.test(hintNorm);
  if (hintEndsWithStreetSuffix && !hasBusinessWord) {
    return true;
  }

  for (const addr of addresses) {
    const addrStreet = stripAddressPrefix(addr.raw);
    if (!addrStreet) continue;
    if (hintNorm === addrStreet) return true;
    if (addrStreet.includes(hintNorm)) {
      // If the hint is fully inside the street text and does not look
      // business-like, treat it as an address fragment (e.g. Beach Blvd).
      if (!hasBusinessWord || hintNorm.length >= Math.max(6, Math.floor(addrStreet.length * 0.45))) {
        return true;
      }
    }
  }

  return false;
}

// Generic / non-venue phrases that must never be paired to an address as a
// venue name even if they slipped through the venue-hint extractor.
const GENERIC_VENUE_PHRASES = new Set(
  [
    'foodie', 'foodies', 'instagram', 'tiktok', 'youtube', 'media',
    'reel', 'reels', 'video', 'best spots', 'best spot', 'come with me',
    'this place', 'this place is awesome', 'this spot', 'pretty cool spot',
    'pretty cool', 'must try', 'check this out', 'link in bio', 'new spot',
    'my favorite', 'our favorite', 'the best', 'so good',
  ].map((s) => s.toLowerCase()),
);

function isGenericVenuePhrase(phrase: string): boolean {
  const p = phrase.trim().toLowerCase();
  if (GENERIC_VENUE_PHRASES.has(p)) return true;
  // Single filler words that read as sentiment, not a name.
  if (/^(foodie|media|reel|reels|video|instagram|tiktok|youtube)$/.test(p)) return true;
  return false;
}

// For each address, attach the venue-name hint that appears CLOSEST BEFORE it
// in the caption (position-based). Falls back to the single global hint only
// when there is exactly one address and one hint. Never pairs a generic /
// city / non-venue phrase. Mutates `addresses[i].venue` in place.
function pairVenuesToAddresses(
  caption: string,
  addresses: LikelyAddress[],
  venueHints: string[],
  handles: ExtractedHandles,
): void {
  if (addresses.length === 0) return;
  const usableHints = venueHints.filter(
    (h) =>
      h &&
      !isGenericVenuePhrase(h) &&
      !isKnownCityName(h) &&
      !looksLikeStreetFragmentVenueHint(h, addresses),
  );

  const handleHints = handles.venueHandles
    .map((handle) => {
      const derived = derivePlaceNameHintFromHandle(handle);
      if (!derived) return null;
      return {
        handle,
        name: derived,
      };
    })
    .filter(
      (row): row is { handle: string; name: string } =>
        !!row &&
        !isGenericVenuePhrase(row.name) &&
        !isKnownCityName(row.name) &&
        !looksLikeStreetFragmentVenueHint(row.name, addresses),
    );

  if (usableHints.length === 0 && handleHints.length === 0) return;

  const captionLower = caption.toLowerCase();

  // Precompute the first position of each hint in the caption.
  const hintPos = usableHints.map((h) => ({
    name: h,
    pos: captionLower.indexOf(h.toLowerCase()),
  }));

  for (const addr of addresses) {
    const addrPos = captionLower.indexOf(addr.raw.toLowerCase());

    // Preferred pairing: tagged venue handle immediately before the address,
    // e.g. "@capones_cucina - 19688 Beach Blvd ...".
    const adjacentHandle = findAdjacentVenueHandleName(
      caption,
      captionLower,
      addrPos,
      handleHints,
    );
    if (adjacentHandle) {
      addr.venue = adjacentHandle;
      continue;
    }

    if (addrPos < 0) {
      // Address text not locatable (rare) — pair the only hint if unambiguous.
      if (usableHints.length === 1 && addresses.length === 1) addr.venue = usableHints[0];
      continue;
    }
    // Nearest hint strictly before the address.
    let best: { name: string; pos: number } | null = null;
    for (const h of hintPos) {
      if (h.pos < 0 || h.pos >= addrPos) continue;
      if (!best || h.pos > best.pos) best = h;
    }
    if (best) {
      addr.venue = best.name;
    } else if (usableHints.length === 1 && addresses.length === 1) {
      // Single hint, single address: pair even if the hint sits after the
      // address (e.g. "📍 2nd Floor 126 Main St" where the pin/name leads).
      addr.venue = usableHints[0];
    }
  }
}

function findAdjacentVenueHandleName(
  caption: string,
  captionLower: string,
  addrPos: number,
  handleHints: Array<{ handle: string; name: string }>,
): string | null {
  if (addrPos < 0 || handleHints.length === 0) return null;

  let best: { name: string; gap: number } | null = null;
  for (const item of handleHints) {
    const token = `@${item.handle.toLowerCase()}`;
    if (!token || token === '@') continue;
    let fromIndex = 0;
    while (fromIndex < addrPos) {
      const idx = captionLower.indexOf(token, fromIndex);
      if (idx < 0 || idx >= addrPos) break;
      const end = idx + token.length;
      const between = caption.slice(end, addrPos);
      const gap = addrPos - end;
      const separatorOnly = /^[\s\-–—|:,.•·()]*$/.test(between);
      if (gap <= 64 && separatorOnly) {
        if (!best || gap < best.gap) {
          best = { name: item.name, gap };
        }
      }
      fromIndex = idx + 1;
    }
  }
  return best?.name ?? null;
}
