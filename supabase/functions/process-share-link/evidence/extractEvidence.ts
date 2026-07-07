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
    .filter((h) => !isKnownCityName(h));
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
    if (pre && !isKnownCityName(pre)) venueNameHints.push(pre);
  }
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
