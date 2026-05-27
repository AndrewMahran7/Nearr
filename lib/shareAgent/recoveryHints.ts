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
