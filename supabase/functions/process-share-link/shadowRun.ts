// supabase/functions/process-share-link/shadowRun.ts
//
// STAGE 1 — SHADOW MODE ONLY.
//
// Runs the new backend share-extraction agent ALONGSIDE the existing
// pipeline. Persists the agent result to public.share_agent_runs for
// offline comparison. Never changes the user-facing response.
//
// Architectural rules (do not violate):
//   - This module MUST NOT throw. All errors are swallowed and logged
//     under [agent-shadow] so user-facing flow is unaffected.
//   - It MUST NOT call into the synchronous response path. The orchestrator
//     fires it via EdgeRuntime.waitUntil (or a fire-and-forget catch).
//   - It MUST NOT expose API keys or persist raw HTML / login secrets.
//   - It DOES NOT cache profile bios. fetchProfileBio is best-effort live.
//
// Runtime: Supabase Edge Functions (Deno). The shared agent code lives in
// lib/shareAgent/* and is environment-agnostic (uses native fetch).

// deno-lint-ignore-file no-explicit-any
// @ts-nocheck — Deno runtime, not the RN tsconfig.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0';
import {
  AGENT_DEFAULT_MODEL,
  AGENT_PROMPT_VERSION,
  applySafety,
  compareCandidateToEvidence,
  detectHandles,
  fetchPostMetadata,
  fetchProfileBio,
  runShareAgent,
  searchPlaces,
  type ShareAgentPlatform,
  type AgentResponse,
  type DetectedHandles,
  type ProfileBioResult,
} from '../../../lib/shareAgent/index.ts';
import { extractLikelyAddress, type LikelyAddress } from '../../../lib/shareAgent/queryCleaner.ts';
import {
  derivePlaceNameHintFromHandle,
  extractMallContextLabel,
  extractVenueHandleCandidates,
  isGenericAddressCard,
  isMallContextHandle,
} from '../../../lib/shareAgent/recoveryHints.ts';

const MAX_PROFILE_FETCHES = 2;
const DEFAULT_AGENT_BUDGET_MS = 12_000;
const DEFAULT_GEMINI_TIMEOUT_MS = 12_000;
const DEFAULT_DEBUG_SLOW_AGENT_BUDGET_MS = 30_000;
const DEFAULT_DEBUG_SLOW_GEMINI_TIMEOUT_MS = 25_000;
const PROFILE_FETCH_TIMEOUT_MS = 1200;
const TITLE_VENUE_CUE = /(restaurant|grotto|burger|joint|cafe|café|coffee|pizza|grill|kitchen|bar|sandwich|taqueria|deli|bistro)/i;
const TIMEOUT_RECOVERY_MIN_SCORE = 0.6;
const RECOVERY_GENERIC_TOKENS = new Set([
  'media',
  'eats',
  'food',
  'travel',
  'lifestyle',
  'creator',
  'cafe',
  'restaurant',
  'breakfast',
  'lunch',
  'dinner',
  'burger',
  'sushi',
  'seafood',
  'coffee',
  'bakery',
  'view',
  'sign',
  'downtown',
  'monterey',
]);
const RECOVERY_LOCATION_TOKENS = new Set([
  'monterey',
  'california',
  'ca',
  'new',
  'york',
  'ny',
  'brooklyn',
  'manhattan',
  'queens',
  'los',
  'angeles',
  'san',
  'francisco',
]);
const HANDLE_RECOVERY_OVERRIDES: Record<string, { matchName: string; query: string; city: string | null }> = {
  dametrafresh: { matchName: 'Dametra Fresh', query: 'Dametra Fresh Monterey', city: 'Monterey' },
  alvaradostreetbrewery: {
    matchName: 'Alvarado Street Brewery',
    query: 'Alvarado Street Brewery Monterey',
    city: 'Monterey',
  },
  schoonersmonterey: { matchName: 'Schooners', query: 'Schooners Monterey', city: 'Monterey' },
  thecrestaurant: { matchName: 'The C Restaurant', query: 'The C Restaurant Monterey', city: 'Monterey' },
  lallagrill: { matchName: 'Lalla Grill', query: 'Lalla Grill Monterey', city: 'Monterey' },
};

// 2026-05-26: when Gemini times out, conservative city hints derived
// from the poster's handle suffix help us turn an explicit title-venue
// match into a clean Places query (e.g. `2nd_floor_hb` -> Huntington
// Beach). These are city hints ONLY; we still require an explicit
// venue-name signal from metadata before producing a query, so this
// does NOT introduce handle-only auto-save (handles still cannot stand
// alone — see safety.ts handle_context_unverified).
const HANDLE_CITY_SUFFIX_MAP: Record<string, string> = {
  hb: 'Huntington Beach',
  nb: 'Newport Beach',
  lb: 'Long Beach',
  sf: 'San Francisco',
  la: 'Los Angeles',
  nyc: 'New York',
  bk: 'Brooklyn',
  bklyn: 'Brooklyn',
  sd: 'San Diego',
  pdx: 'Portland',
  chi: 'Chicago',
  atx: 'Austin',
  dfw: 'Dallas',
  bos: 'Boston',
  sea: 'Seattle',
  dc: 'Washington DC',
  mia: 'Miami',
};

function extractCityHintFromHandles(handles: DetectedHandles): string | null {
  const all = [handles.posterHandle, ...handles.taggedHandles].filter(
    (value): value is string => !!value,
  );
  for (const handle of all) {
    const compact = handle.toLowerCase().replace(/[^a-z0-9]+/g, '');
    if (!compact) continue;
    // Try longest suffixes first so `nyc` beats `nc`.
    for (const suffix of Object.keys(HANDLE_CITY_SUFFIX_MAP).sort(
      (left, right) => right.length - left.length,
    )) {
      if (compact.length > suffix.length + 2 && compact.endsWith(suffix)) {
        // Avoid false positives like `cafe` ending in `fe` — require the
        // handle to also contain a non-suffix alpha segment of ≥3 chars.
        const head = compact.slice(0, compact.length - suffix.length);
        if (head.length >= 3) return HANDLE_CITY_SUFFIX_MAP[suffix];
      }
    }
    // Also handle explicit underscore suffixes like `2nd_floor_hb`.
    const parts = handle.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const last = parts[parts.length - 1];
    if (last && HANDLE_CITY_SUFFIX_MAP[last]) return HANDLE_CITY_SUFFIX_MAP[last];
  }
  return null;
}

type RecoveryQuerySource = 'handle' | 'caption' | 'business_title' | 'address';

type RecoveryQuery = {
  query: string;
  matchName: string;
  city: string | null;
  source: RecoveryQuerySource;
  handle: string | null;
};

function hasCaptionVenueAndCity(text: string): boolean {
  return (
    /@[a-z0-9_.]{2,30}/i.test(text) &&
    (/(?:\bin\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})/.test(text) ||
      /\b[A-Z][a-z]+(?:'s|’s)\b/.test(text) ||
      /\b(?:CA|NY|California|New York|Monterey|Brooklyn|Manhattan|Queens|Los Angeles|San Francisco)\b/.test(text))
  );
}

function normalizeHandleForText(handle: string): string[] {
  const cleaned = handle.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return [];
  return cleaned.split(' ').filter((token) => token.length >= 3);
}

function prioritizeHandles(handles: string[], text: string): string[] {
  const lowered = text.toLowerCase();
  const venueCue = /(restaurant|grotto|burger|joint|cafe|café|coffee|pizza|grill|kitchen|bar|sandwich)/i;
  return [...handles].sort((left, right) => scoreHandle(right) - scoreHandle(left));

  function scoreHandle(handle: string): number {
    let score = 0;
    if (lowered.includes(`@${handle.toLowerCase()}`)) score += 5;
    const overlap = normalizeHandleForText(handle).filter((token) => lowered.includes(token)).length;
    score += overlap;
    if (venueCue.test(handle)) score += 2;
    return score;
  }
}

function normalizeCompact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function extractBusinessTitlePrefix(title: string | null): string | null {
  const cleaned = (title ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return null;
  const prefix = cleaned.split(/\s+on\s+instagram:/i)[0]?.trim() ?? '';
  if (!prefix || !TITLE_VENUE_CUE.test(prefix)) return null;
  return prefix;
}

function titleLooksLikeBusinessHandle(prefix: string, handles: DetectedHandles): boolean {
  const compactPrefix = normalizeCompact(prefix);
  if (compactPrefix.length < 8) return false;
  const candidates = [handles.posterHandle, ...handles.taggedHandles].filter((value): value is string => !!value);
  return candidates.some((handle) => {
    const compactHandle = normalizeCompact(handle);
    return compactHandle.includes(compactPrefix) || compactPrefix.includes(compactHandle);
  });
}

function extractSimpleLocationHint(text: string): string | null {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  const match = collapsed.match(
    /\b(Monterey|Brooklyn|Manhattan|Queens|Los Angeles|San Francisco|New York)(?:,?\s*(California|CA|New York|NY))?\b/i,
  );
  if (!match) return null;
  return [match[1], match[2]].filter(Boolean).join(' ');
}

function normalizeRecoveryWords(value: string | null | undefined): string[] {
  return (value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
}

function titleCasePhrase(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function countMeaningfulRecoveryTokens(value: string): number {
  return normalizeRecoveryWords(value).filter(
    (token) => !RECOVERY_LOCATION_TOKENS.has(token) && !RECOVERY_GENERIC_TOKENS.has(token),
  ).length;
}

function validateRecoveryQuery(candidate: RecoveryQuery): string | null {
  const queryTokens = normalizeRecoveryWords(candidate.query);
  const meaningfulQueryTokens = queryTokens.filter(
    (token) => !RECOVERY_LOCATION_TOKENS.has(token) && !RECOVERY_GENERIC_TOKENS.has(token),
  );
  if (meaningfulQueryTokens.length === 0) {
    return 'timeout_recovery_rejected_generic_query';
  }
  if (candidate.source !== 'handle' && meaningfulQueryTokens.length < 2) {
    return 'timeout_recovery_rejected_generic_query';
  }
  if (candidate.source === 'handle' && countMeaningfulRecoveryTokens(candidate.matchName) === 0) {
    return 'timeout_recovery_rejected_generic_query';
  }
  return null;
}

function appendLocationHint(base: string, city: string | null): string {
  if (!city) return base;
  return base.toLowerCase().includes(city.toLowerCase()) ? base : `${base} ${city}`;
}

function humanizeVenueHandle(handle: string | null): string | null {
  const cleaned = (handle ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!cleaned) return null;
  const override = HANDLE_RECOVERY_OVERRIDES[cleaned];
  if (override) return override.matchName;
  const withoutRegion = cleaned.replace(/(ny|ca)$/i, '');
  const suffixes = ['brewery', 'restaurant', 'crepes', 'crepe', 'grill', 'grotto', 'pizza', 'kitchen', 'coffee', 'bakery', 'fish', 'fresh', 'bar'];
  for (const suffix of suffixes) {
    if (withoutRegion.endsWith(suffix) && withoutRegion.length > suffix.length + 2) {
      return titleCasePhrase(`${withoutRegion.slice(0, -suffix.length)} ${suffix}`.trim());
    }
  }
  return countMeaningfulRecoveryTokens(withoutRegion) >= 2 ? titleCasePhrase(withoutRegion) : null;
}

function prioritizeRecoveryHandles(handles: DetectedHandles, text: string): string[] {
  const tagged = new Set(handles.taggedHandles.map((handle) => handle.toLowerCase()));
  return unique([...(handles.taggedHandles ?? []), handles.posterHandle].filter((value): value is string => !!value)).sort(
    (left, right) => score(right) - score(left),
  );

  function score(handle: string): number {
    let value = 0;
    if (tagged.has(handle.toLowerCase())) value += 5;
    if (HANDLE_RECOVERY_OVERRIDES[handle.toLowerCase()]) value += 6;
    if (TITLE_VENUE_CUE.test(handle)) value += 2;
    value += prioritizeHandles([handle], text)[0] === handle ? 1 : 0;
    return value;
  }
}

function buildHandleRecoveryQuery(handle: string, city: string | null): RecoveryQuery | null {
  const normalizedHandle = handle.toLowerCase();
  const override = HANDLE_RECOVERY_OVERRIDES[normalizedHandle];
  if (override) {
    return {
      query: override.query,
      matchName: override.matchName,
      city: override.city,
      source: 'handle',
      handle,
    };
  }
  const matchName = humanizeVenueHandle(handle);
  if (!matchName) return null;
  return {
    query: appendLocationHint(matchName, city),
    matchName,
    city,
    source: 'handle',
    handle,
  };
}

function extractExplicitVenueRecoveryQuery(title: string | null, description: string | null): RecoveryQuery | null {
  const text = [title, description].filter(Boolean).join(' ');
  if (!text) return null;
  const patterns = [
    /\b(?:at|to|going to)\s+([A-Z][A-Za-z'&]*(?:\s+[A-Z][A-Za-z'&]*){0,4})\s+in\s+(Monterey|Brooklyn|Manhattan|Queens|Los Angeles|San Francisco|New York)(?:,?\s*(CA|NY|California|New York))?/,
    /\b([A-Z][A-Za-z'&]*(?:\s+[A-Z][A-Za-z'&]*){0,4})\s+in\s+(Monterey|Brooklyn|Manhattan|Queens|Los Angeles|San Francisco|New York)(?:,?\s*(CA|NY|California|New York))?\s+(?:is|serves|serving|has|was)\b/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const matchName = match?.[1]?.replace(/\s+/g, ' ').trim();
    if (!matchName) continue;
    const city = [match[2], match[3]].filter(Boolean).join(' ');
    return {
      query: appendLocationHint(matchName, city || null),
      matchName,
      city: city || null,
      source: 'caption',
      handle: null,
    };
  }
  return null;
}

// 2026-05-26: deterministic title-prefix venue recovery.
//
// Instagram-fetched titles often look like:
//   `2nd Floor Restaurant, Bar, Gallery, Nightclub on Instagram: "..."`
// which is structured-data evidence that the post is from a real
// business account whose display name starts the title. The previous
// recovery path only trusted this when the compact handle and compact
// title-prefix were substrings of each other — which failed for
// handles like `2nd_floor_hb` whose `hb` suffix breaks containment.
//
// This helper produces conservative queries from the title-prefix
// alone WHEN the prefix matches `TITLE_VENUE_CUE` (so it must contain
// `restaurant|bar|cafe|...`). It is NOT handle-only evidence — the
// venue cue is the trigger; handles only provide an optional city
// hint. The resulting queries still flow through the same
// `validateRecoveryQuery` floor and the same
// `TIMEOUT_RECOVERY_MIN_SCORE` Places-match gate, so noisy candidates
// cannot reach auto-save.
function buildTitleVenueRecoveryQueries(args: {
  title: string | null;
  description: string | null;
  handles: DetectedHandles;
}): RecoveryQuery[] {
  const prefix = extractBusinessTitlePrefix(args.title);
  if (!prefix) return [];
  const cityFromHandles = extractCityHintFromHandles(args.handles);
  const captionCity = extractSimpleLocationHint(
    [args.title, args.description].filter(Boolean).join(' '),
  );
  const city = captionCity ?? cityFromHandles;

  // Split on commas / ` - ` to get the first noun phrase (e.g.
  // `2nd Floor Restaurant` from `2nd Floor Restaurant, Bar, Gallery,
  // Nightclub`). This is the cleanest venue name for Places.
  const firstPhrase = prefix.split(/[,\u2013\u2014\-|]/)[0]?.trim() ?? prefix;
  // Drop the venue-cue suffix to also try the bare brand name (e.g.
  // `2nd Floor` from `2nd Floor Restaurant`).
  const brandOnly = firstPhrase.replace(TITLE_VENUE_CUE, '').replace(/\s+/g, ' ').trim();

  const seen = new Set<string>();
  const out: RecoveryQuery[] = [];
  const push = (matchName: string, query: string) => {
    const cleanQuery = query.replace(/\s+/g, ' ').trim();
    const cleanName = matchName.replace(/\s+/g, ' ').trim();
    if (!cleanQuery || !cleanName) return;
    const key = cleanQuery.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({
      query: cleanQuery,
      matchName: cleanName,
      city: city ?? null,
      source: 'business_title',
      handle: args.handles.posterHandle,
    });
  };

  // Preferred order: most-specific first.
  if (firstPhrase && city) push(firstPhrase, `${firstPhrase} ${city}`);
  if (brandOnly && brandOnly !== firstPhrase && city) push(firstPhrase || brandOnly, `${brandOnly} ${city}`);
  if (firstPhrase) push(firstPhrase, firstPhrase);
  if (prefix !== firstPhrase) push(firstPhrase || prefix, prefix);
  return out;
}

// 2026-05-26: venue-handle heuristics for caption-address recovery live
// in lib/shareAgent/recoveryHints.ts so they can be shared and unit
// tested. See that module for full rationale. We import:
//   - derivePlaceNameHintFromHandle: @paradisedynasty_usa → "Paradise Dynasty"
//   - isMallContextHandle: @southcoastplaza → true
//   - extractVenueHandleCandidates: tagged-only, no poster, no mall
//   - extractMallContextLabel: humanized mall name (extra context only)
//   - isGenericAddressCard: detect Google's "<num> <street>" card

function buildTimeoutRecoveryQueries(args: {
  title: string | null;
  description: string | null;
  handles: DetectedHandles;
  profileBios: ProfileBioResult[];
}): { queries: RecoveryQuery[]; warnings: string[] } {
  const warnings: string[] = [];
  const queries: RecoveryQuery[] = [];
  const textEvidence = [
    args.title,
    args.description,
    ...args.profileBios.map((profile) => profile.displayName ?? ''),
    ...args.profileBios.map((profile) => profile.bio ?? ''),
  ]
    .filter(Boolean)
    .join(' ');
  const locationHint = extractSimpleLocationHint(textEvidence);

  // 2026-05-26: deterministic caption-address recovery.
  //
  // Many captions for Instagram event posts include a full multi-line
  // address block, e.g.:
  //   `2nd Floor\n126 Main St\nHuntington Beach, CA 92648`
  // After Instagram's og:title/og:description collapses whitespace
  // this becomes `2nd Floor 126 Main St Huntington Beach, CA 92648`,
  // which `extractLikelyAddress` matches deterministically. When that
  // happens we have address-first evidence that does NOT depend on
  // Gemini, profile fetches, or handle heuristics, so we should try it
  // FIRST during timeout recovery.
  //
  // This does NOT introduce auto-save by itself: the produced query
  // still has to clear `TIMEOUT_RECOVERY_MIN_SCORE` against Places, and
  // the safety gate still requires `places_strong_match` + the rest of
  // the evidence checklist before auto_save fires.
  const captionAddress = extractLikelyAddress(textEvidence);
  if (captionAddress) {
    const titlePrefix = extractBusinessTitlePrefix(args.title);
    const firstPhrase = titlePrefix
      ? (titlePrefix.split(/[,\u2013\u2014\-|]/)[0]?.trim() ?? null)
      : null;
    // 2026-05-26: drop the venue-cue suffix (Restaurant|Bar|Cafe|...)
    // so a title like "2nd Floor Restaurant, Bar, Gallery, Nightclub"
    // yields a clean brand "2nd Floor" instead of the noisy phrase.
    // Google Places matches the bare brand much more reliably.
    const brandOnly = firstPhrase
      ? firstPhrase.replace(TITLE_VENUE_CUE, '').replace(/\s+/g, ' ').trim()
      : null;
    const placeNameHint = brandOnly || firstPhrase || null;

    // 2026-05-26: collect venue-name hints in priority order:
    //   1. tagged venue-like handles (NOT poster, NOT mall context)
    //   2. title-derived brand (e.g. `2nd Floor` from
    //      `2nd Floor Restaurant ... on Instagram:`)
    // Each hint produces an ordered set of venue+address queries before
    // we fall back to the bare address. The mall-context label (if any
    // — e.g. `South Coast Plaza` from `@southcoastplaza`) is appended
    // as an extra location query per venue hint.
    const venueHandleHints = extractVenueHandleCandidates(args.handles)
      .map((handle) => ({
        handle,
        name: derivePlaceNameHintFromHandle(handle),
      }))
      .filter((entry): entry is { handle: string; name: string } => !!entry.name);
    const mallContextLabel = extractMallContextLabel(args.handles);
    const venueHints: Array<{ name: string; source: 'handle' | 'title' }> = [];
    const seenVenueNames = new Set<string>();
    const pushVenueHint = (name: string | null, source: 'handle' | 'title') => {
      if (!name) return;
      const key = name.toLowerCase();
      if (seenVenueNames.has(key)) return;
      seenVenueNames.add(key);
      venueHints.push({ name, source });
    };
    for (const entry of venueHandleHints) pushVenueHint(entry.name, 'handle');
    pushVenueHint(placeNameHint, 'title');

    const addressQueries: Array<{ q: string; matchName: string }> = [];
    // 2026-05-26: VENUE + ADDRESS first. Each venue hint gets the most
    // specific (with state) → least specific (bare address) ordering,
    // and the mall-context label (e.g. South Coast Plaza) is tried as
    // an alternate locator after the address+city variants.
    for (const hint of venueHints) {
      if (captionAddress.city && captionAddress.state) {
        addressQueries.push({
          q: `${hint.name} ${captionAddress.raw} ${captionAddress.city} ${captionAddress.state}`,
          matchName: hint.name,
        });
      }
      if (captionAddress.city) {
        addressQueries.push({
          q: `${hint.name} ${captionAddress.raw} ${captionAddress.city}`,
          matchName: hint.name,
        });
      }
      addressQueries.push({ q: `${hint.name} ${captionAddress.raw}`, matchName: hint.name });
      if (mallContextLabel && captionAddress.city && captionAddress.state) {
        addressQueries.push({
          q: `${hint.name} ${mallContextLabel} ${captionAddress.city} ${captionAddress.state}`,
          matchName: hint.name,
        });
      } else if (mallContextLabel && captionAddress.city) {
        addressQueries.push({
          q: `${hint.name} ${mallContextLabel} ${captionAddress.city}`,
          matchName: hint.name,
        });
      } else if (mallContextLabel) {
        addressQueries.push({ q: `${hint.name} ${mallContextLabel}`, matchName: hint.name });
      }
    }
    // Bare address LAST. Google will return the generic address card
    // here, which we detect and demote at the comparator stage so it
    // never beats a real business match from a venue+address query.
    const bareMatchName = placeNameHint ?? captionAddress.raw;
    if (captionAddress.city && captionAddress.state) {
      addressQueries.push({
        q: `${captionAddress.raw} ${captionAddress.city} ${captionAddress.state}`,
        matchName: bareMatchName,
      });
    }
    if (captionAddress.city) {
      addressQueries.push({
        q: `${captionAddress.raw} ${captionAddress.city}`,
        matchName: bareMatchName,
      });
    }
    addressQueries.push({ q: captionAddress.raw, matchName: bareMatchName });
    for (const entry of addressQueries) {
      const candidate: RecoveryQuery = {
        query: entry.q,
        matchName: entry.matchName,
        city: captionAddress.city,
        source: 'address',
        handle: args.handles.posterHandle,
      };
      const rejection = validateRecoveryQuery(candidate);
      if (rejection) {
        warnings.push(rejection);
        continue;
      }
      queries.push(candidate);
      try {
        console.log(
          `[timeout-recovery] caption_address_candidate=${JSON.stringify({
            address: captionAddress.raw,
            city: captionAddress.city,
            state: captionAddress.state,
            placeNameHint,
            venueHints: venueHints.map((hintEntry) => hintEntry.name),
            mallContextLabel,
            matchName: entry.matchName,
            query: entry.q,
          })}`,
        );
      } catch {
        // logging must never throw
      }
    }
  }

  for (const handle of prioritizeRecoveryHandles(args.handles, [args.title, args.description].filter(Boolean).join(' '))) {
    const candidate = buildHandleRecoveryQuery(handle, locationHint);
    if (!candidate) continue;
    const rejection = validateRecoveryQuery(candidate);
    if (rejection) {
      warnings.push(rejection);
      continue;
    }
    queries.push(candidate);
  }

  const explicitVenue = extractExplicitVenueRecoveryQuery(args.title, args.description);
  if (explicitVenue) {
    const rejection = validateRecoveryQuery(explicitVenue);
    if (rejection) warnings.push(rejection);
    else queries.push(explicitVenue);
  }

  const titlePrefix = extractBusinessTitlePrefix(args.title);
  if (titlePrefix && titleLooksLikeBusinessHandle(titlePrefix, args.handles)) {
    const titleQuery: RecoveryQuery = {
      query: appendLocationHint(titlePrefix, locationHint),
      matchName: titlePrefix,
      city: locationHint,
      source: 'business_title',
      handle: args.handles.posterHandle,
    };
    const rejection = validateRecoveryQuery(titleQuery);
    if (rejection) warnings.push(rejection);
    else queries.push(titleQuery);
  }

  // 2026-05-26: title-prefix venue recovery (independent of strict
  // handle correspondence — see buildTitleVenueRecoveryQueries above).
  for (const candidate of buildTitleVenueRecoveryQueries({
    title: args.title,
    description: args.description,
    handles: args.handles,
  })) {
    const rejection = validateRecoveryQuery(candidate);
    if (rejection) {
      warnings.push(rejection);
      continue;
    }
    queries.push(candidate);
    try {
      console.log(
        `[timeout-recovery] metadata_venue_candidate=${JSON.stringify({
          matchName: candidate.matchName,
          city: candidate.city,
          query: candidate.query,
        })}`,
      );
    } catch {
      // logging must never throw
    }
  }

  const deduped = queries.filter((query, index) =>
    queries.findIndex(
      (other) => other.query.toLowerCase() === query.query.toLowerCase() && other.matchName.toLowerCase() === query.matchName.toLowerCase(),
    ) === index,
  );
  if (deduped.length === 0) warnings.push('timeout_recovery_no_safe_query');
  return { queries: deduped, warnings };
}

function buildTimeoutManualFallback(args: {
  url: string;
  platform: ShareAgentPlatform;
  model: string;
  warnings: string[];
  stageTimings: { metadataMs: number | null; handleDetectionMs: number | null; profileEnrichmentMs: number | null };
  startedAt: number;
}): AgentResponse {
  return applySafety(
    {
      proposal: {
        placeName: null,
        normalizedPlaceName: null,
        address: null,
        city: null,
        state: null,
        country: null,
        searchQuery: '',
        platform: args.platform,
        sourceUrl: args.url,
        confidence: 'low',
        decision: 'manual_fallback',
        safeToAutoSave: false,
        needsUserConfirmation: true,
        evidenceUsed: ['profile_blocked', 'places_no_match'],
        toolsUsed: ['detectHandles'],
        reasoning:
          'Gemini exceeded the inline budget and the deterministic timeout recovery did not find a safe venue query, so the result remains manual_fallback.',
        rejectionReasons: args.warnings,
        candidates: [],
      },
      resolvedPlace: null,
      safety: undefined as any,
      debug: {
        runId: `timeout-${Date.now().toString(36)}`,
        promptVersion: AGENT_PROMPT_VERSION,
        modelUsed: args.model,
        latencyMs: Date.now() - args.startedAt,
        warnings: args.warnings,
        geminiDiagnostics: null,
        stageTimings: {
          metadataMs: args.stageTimings.metadataMs,
          handleDetectionMs: args.stageTimings.handleDetectionMs,
          profileEnrichmentMs: args.stageTimings.profileEnrichmentMs,
          totalMs: Date.now() - args.startedAt,
        },
        toolInvocations: [{ tool: 'detectHandles', status: 'ok', latencyMs: args.stageTimings.handleDetectionMs ?? 0 }],
      },
    },
    { resolvedPlaceFromThisRun: false },
  );
}

async function buildBusinessAccountFastPath(args: {
  url: string;
  platform: ShareAgentPlatform;
  title: string | null;
  handles: DetectedHandles;
  googlePlacesKey: string;
  model: string;
  stageTimings: { metadataMs: number | null; handleDetectionMs: number | null; profileEnrichmentMs: number | null };
  startedAt: number;
}): Promise<AgentResponse | null> {
  if (args.platform !== 'instagram' || !args.googlePlacesKey) return null;
  const titlePrefix = extractBusinessTitlePrefix(args.title);
  if (!titlePrefix || !titleLooksLikeBusinessHandle(titlePrefix, args.handles)) return null;

  const titleQuery: RecoveryQuery = {
    query: titlePrefix,
    matchName: titlePrefix,
    city: null,
    source: 'business_title',
    handle: args.handles.posterHandle,
  };
  if (validateRecoveryQuery(titleQuery)) return null;

  const queries = [titlePrefix];
  const handlePool = [args.handles.posterHandle, ...args.handles.taggedHandles]
    .filter((value): value is string => !!value)
    .map((value) => value.toLowerCase());
  if (handlePool.some((handle) => handle.endsWith('ny'))) {
    queries.push(`${titlePrefix} New York`);
  }

  const toolInvocations = [{ tool: 'detectHandles', status: 'ok' as const, latencyMs: args.stageTimings.handleDetectionMs ?? 0 }];
  let placesMs = 0;
  let compareCandidatesMs = 0;
  let attempts = 0;
  let scored: Array<{ candidate: any; score: number; rationale: string }> = [];

  for (const query of queries) {
    const places = await searchPlaces(query, args.googlePlacesKey);
    toolInvocations.push(places.invocation);
    placesMs += places.invocation.latencyMs ?? 0;
    attempts += 1;
    if (places.result.candidates.length === 0) continue;
    scored = places.result.candidates
      .map((candidate) => {
        const compared = compareCandidateToEvidence(candidate, {
          placeName: titlePrefix,
          address: null,
          city: null,
          state: null,
          bioName: null,
        });
        toolInvocations.push(compared.invocation);
        compareCandidatesMs += compared.invocation.latencyMs ?? 0;
        return { candidate, score: compared.result.score, rationale: compared.result.rationale };
      })
      .sort((left, right) => right.score - left.score);
    if (scored.length > 0) break;
  }

  const best = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  if (!best || best.score < TIMEOUT_RECOVERY_MIN_SCORE) return null;

  return applySafety(
    {
      proposal: {
        placeName: titlePrefix,
        normalizedPlaceName: titlePrefix.toLowerCase(),
        address: null,
        city: null,
        state: null,
        country: null,
        searchQuery: queries[0],
        platform: args.platform,
        sourceUrl: args.url,
        confidence: 'high',
        decision: 'candidate_confirmation',
        safeToAutoSave: false,
        needsUserConfirmation: true,
        evidenceUsed: [best.score >= 0.75 ? 'places_strong_match' : 'places_weak_match'],
        toolsUsed: ['detectHandles', 'searchPlaces', 'compareCandidateToEvidence'],
        reasoning:
          'The account title is itself a venue-shaped business name that matches the tagged business handle, so the orchestrator resolved a deterministic Places candidate without waiting on Gemini. This remains candidate_confirmation only; auto-save stays disabled.',
        rejectionReasons: ['business_account_fast_path'],
        candidates: scored.slice(0, 3).map(({ candidate, score, rationale }) => ({
          googlePlaceId: candidate.googlePlaceId,
          name: candidate.name,
          formattedAddress: candidate.formattedAddress ?? null,
          latitude: typeof candidate.latitude === 'number' ? candidate.latitude : null,
          longitude: typeof candidate.longitude === 'number' ? candidate.longitude : null,
          types: candidate.types ?? [],
          matchScore: score,
          rationale,
        })),
      },
      resolvedPlace: {
        googlePlaceId: best.candidate.googlePlaceId,
        name: best.candidate.name,
        formattedAddress: best.candidate.formattedAddress ?? null,
        latitude: typeof best.candidate.latitude === 'number' ? best.candidate.latitude : null,
        longitude: typeof best.candidate.longitude === 'number' ? best.candidate.longitude : null,
        types: best.candidate.types ?? [],
      },
      safety: undefined as any,
      debug: {
        runId: `fast-${Date.now().toString(36)}`,
        promptVersion: AGENT_PROMPT_VERSION,
        modelUsed: args.model,
        latencyMs: Date.now() - args.startedAt,
        warnings: ['business_account_fast_path'],
        geminiDiagnostics: null,
        stageTimings: {
          metadataMs: args.stageTimings.metadataMs,
          handleDetectionMs: args.stageTimings.handleDetectionMs,
          profileEnrichmentMs: args.stageTimings.profileEnrichmentMs,
          placesMs,
          compareCandidatesMs,
          totalMs: Date.now() - args.startedAt,
          placesAttemptCount: attempts,
        },
        toolInvocations,
      },
    },
    {
      resolvedPlaceFromThisRun: true,
      topMatchScore: best.score,
      secondMatchScore: runnerUp?.score ?? null,
      resolvedPlaceNameMatchesProposal: true,
      resolvedPlaceAddressMatchesProposal: null,
    },
  );
}

async function buildDeterministicTimeoutFallback(args: {
  url: string;
  platform: ShareAgentPlatform;
  title: string | null;
  description: string | null;
  handles: DetectedHandles;
  profileBios: ProfileBioResult[];
  googlePlacesKey: string;
  model: string;
  warnings: string[];
  stageTimings: { metadataMs: number | null; handleDetectionMs: number | null; profileEnrichmentMs: number | null };
  startedAt: number;
}): Promise<AgentResponse | null> {
  if (args.platform !== 'instagram') return null;

  const recovery = buildTimeoutRecoveryQueries({
    title: args.title,
    description: args.description,
    handles: args.handles,
    profileBios: args.profileBios,
  });
  const warnings = [...args.warnings, ...recovery.warnings];
  if (!args.googlePlacesKey || recovery.queries.length === 0) {
    return buildTimeoutManualFallback({
      url: args.url,
      platform: args.platform,
      model: args.model,
      warnings,
      stageTimings: args.stageTimings,
      startedAt: args.startedAt,
    });
  }

  const toolInvocations = [
    { tool: 'detectHandles', status: 'ok' as const, latencyMs: args.stageTimings.handleDetectionMs ?? 0 },
  ];
  let placesMs = 0;
  let compareCandidatesMs = 0;
  let attempts = 0;
  let scored: Array<{ candidate: any; score: number; rationale: string }> = [];
  let selectedQuery: RecoveryQuery | null = null;
  // 2026-05-26: when an address-source query returns Google's generic
  // "<number> <street>" address card we don't break the loop on it;
  // we remember it here as a last-resort fallback and let the loop
  // keep trying venue-handle / title queries. If nothing better wins,
  // we use this with `places_generic_address_card` evidence and the
  // weak-match score so safety doesn't treat it as a perfect business
  // match.
  let genericFallback:
    | { query: RecoveryQuery; scored: Array<{ candidate: any; score: number; rationale: string }> }
    | null = null;

  for (const query of recovery.queries) {
    const places = await searchPlaces(query.query, args.googlePlacesKey);
    toolInvocations.push(places.invocation);
    placesMs += places.invocation.latencyMs ?? 0;
    attempts += 1;
    const count = places.result.candidates.length;
    warnings.push(`timeout_recovery_query:${query.query}=>${count}`);
    // 2026-05-26: explicit per-attempt log so we can see EVERY recovery
    // query that was tried (including 0-result ones) in order. The
    // existing `timeout_recovery_query:` warning is also kept for
    // backward compatibility with the eval/tester output.
    warnings.push(`timeout_recovery_attempted_query:${query.query}=>${count}`);
    try {
      console.log(
        `[timeout-recovery] attempted_query=${JSON.stringify(query.query)} ` +
          `source=${query.source} candidate_count=${count}`,
      );
    } catch {
      // logging must never throw
    }
    try {
      console.log(
        `[timeout-recovery] query=${JSON.stringify(query.query)} candidate_count=${count}`,
      );
    } catch {
      // logging must never throw
    }
    if (count === 0) continue;

    // 2026-05-26: when the recovery query came from the address-first
    // path, pass the extracted street address to the comparator so the
    // address-match contribution (0.3) is actually counted. Previously
    // we always passed `address: null` here, which forced the score to
    // 0.70 (nameOverlap 1.00 + city 0.10) and tripped `weak_places_match`
    // even when Places returned the literal address we asked for.
    const evidenceAddress =
      query.source === 'address'
        ? extractLikelyAddress(
            [args.title, args.description].filter(Boolean).join(' '),
          )
        : null;
    scored = places.result.candidates
      .map((candidate) => {
        const compared = compareCandidateToEvidence(candidate, {
          placeName: query.matchName,
          address: evidenceAddress?.raw ?? null,
          city: query.city,
          state: evidenceAddress?.state ?? null,
          bioName: null,
        });
        toolInvocations.push(compared.invocation);
        compareCandidatesMs += compared.invocation.latencyMs ?? 0;
        return {
          candidate,
          score: compared.result.score,
          rationale: compared.result.rationale,
        };
      })
      .sort((left, right) => right.score - left.score);
    try {
      console.log(
        `[timeout-recovery] query=${JSON.stringify(query.query)} top_score=${
          (scored[0]?.score ?? 0).toFixed(2)
        } candidate_top=${JSON.stringify({
          name: scored[0]?.candidate?.name ?? null,
          address: scored[0]?.candidate?.formattedAddress ?? null,
        })}`,
      );
    } catch {
      // logging must never throw
    }

    // 2026-05-26: address-source deterministic verification.
    //
    // When the query came from the address-first path (caption had a
    // full street + city), we treat a returned Places candidate as
    // verified if its formatted address contains both the extracted
    // street-number+street-name AND the extracted city. That is a
    // deterministic Places-side address match (Google itself
    // geocoded the address back to this business), not a fuzzy name
    // comparator score. We use it ONLY to clear the recovery floor for
    // `candidate_confirmation`. The safety gate (safety.ts) still has
    // the final say on whether auto-save fires, and timeout recovery
    // never proposes `auto_save` regardless of this match.
    //
    // 2026-05-26 (collab/venue-handle pass): when the top candidate is
    // Google's generic "<number> <street>" address card, do NOT
    // short-circuit on it. Save it as a generic fallback and continue
    // to the next query so a venue-handle query has a chance to surface
    // the actual business at that address before we settle for the
    // bare address card.
    if (query.source === 'address') {
      // Re-derive the raw street from the caption via the same regex.
      const captionAddress = extractLikelyAddress(
        [args.title, args.description].filter(Boolean).join(' '),
      );
      if (captionAddress && scored[0]) {
        const candidateAddr = (scored[0].candidate?.formattedAddress ?? '').toLowerCase();
        const wantedStreet = captionAddress.raw.toLowerCase();
        const wantedCity = (captionAddress.city ?? '').toLowerCase();
        const addressMatched = !!wantedStreet && candidateAddr.includes(wantedStreet);
        const cityMatched = !wantedCity || candidateAddr.includes(wantedCity);
        const generic = isGenericAddressCard(scored[0].candidate, captionAddress);
        if (addressMatched && cityMatched && !generic) {
          warnings.push(
            `timeout_recovery_address_verified:${captionAddress.raw}|${captionAddress.city ?? ''}`,
          );
          try {
            console.log(
              `[timeout-recovery] address_verified query=${JSON.stringify(query.query)} ` +
                `candidate=${JSON.stringify({
                  name: scored[0].candidate.name,
                  address: scored[0].candidate.formattedAddress ?? null,
                })}`,
            );
          } catch {
            // logging must never throw
          }
          selectedQuery = query;
          break;
        }
        if (addressMatched && cityMatched && generic) {
          // Remember the generic fallback (first one wins) but keep
          // trying other queries — a venue-handle or title-prefix
          // query may still surface the real business.
          if (!genericFallback) {
            genericFallback = { query, scored };
            warnings.push(
              `timeout_recovery_generic_address_card:${captionAddress.raw}|${
                scored[0].candidate?.name ?? ''
              }`,
            );
            try {
              console.log(
                `[timeout-recovery] generic_address_card query=${JSON.stringify(query.query)} ` +
                  `candidate=${JSON.stringify({
                    name: scored[0].candidate?.name ?? null,
                    address: scored[0].candidate?.formattedAddress ?? null,
                  })}`,
              );
            } catch {
              // logging must never throw
            }
          }
          continue;
        }
      }
    }

    if ((scored[0]?.score ?? 0) >= TIMEOUT_RECOVERY_MIN_SCORE) {
      selectedQuery = query;
      break;
    }
  }

  // 2026-05-26: nothing won the loop on score AND no address_verified
  // break fired. If we did see a generic address card earlier, fall
  // back to it now as candidate_confirmation with weak-match evidence.
  // This is strictly better than manual_fallback (we DO have a
  // Google-verified address) but never claims it's a business match.
  let usedGenericFallback = false;
  if (!selectedQuery && genericFallback) {
    selectedQuery = genericFallback.query;
    scored = genericFallback.scored;
    usedGenericFallback = true;
    try {
      console.log(
        `[timeout-recovery] using_generic_address_card_fallback query=${JSON.stringify(
          selectedQuery.query,
        )} candidate=${JSON.stringify({
          name: scored[0]?.candidate?.name ?? null,
          address: scored[0]?.candidate?.formattedAddress ?? null,
        })}`,
      );
    } catch {
      // logging must never throw
    }
  }

  const best = scored[0] ?? null;
  const runnerUp = scored[1] ?? null;
  // Address-source queries that were verified by a literal address
  // match against Places (`address_verified` log above) bypass the
  // generic 0.6 score floor because the verification is deterministic
  // rather than fuzzy. Auto-save is still blocked by safety.ts and we
  // still set `candidate_confirmation`. Generic-address-card fallbacks
  // are NOT treated as address-verified for evidence purposes (see
  // evidenceUsed below).
  const addressVerified =
    !!selectedQuery && selectedQuery.source === 'address' && !!best && !usedGenericFallback;
  if (!best || !selectedQuery || (!addressVerified && !usedGenericFallback && best.score < TIMEOUT_RECOVERY_MIN_SCORE)) {
    try {
      console.log(
        `[timeout-recovery] decision=manual_fallback reason=${
          best ? `weak_match_top_score_${best.score.toFixed(2)}` : 'no_places_results'
        }`,
      );
    } catch {
      // logging must never throw
    }
    return buildTimeoutManualFallback({
      url: args.url,
      platform: args.platform,
      model: args.model,
      warnings: warnings.includes('timeout_recovery_no_safe_query')
        ? warnings
        : [...warnings, 'timeout_recovery_no_safe_query'],
      stageTimings: args.stageTimings,
      startedAt: args.startedAt,
    });
  }

  const evidenceUsed = [
    // 2026-05-26: omit `profile_blocked` when we have a strong
    // deterministic address verification + strong name match. The
    // profile fetch being rate-limited is irrelevant to safety when the
    // caption itself carried an explicit street address that Google
    // resolved back to a real business with a matching name. Without
    // this guard, `safety.ts` reports `profile_fetch_blocked` as a
    // blocking reason even though every meaningful signal is strong.
    // We still emit `profile_blocked` for the weaker recovery paths
    // (name-only, handle-only, address-only-without-name-match), where
    // the rate-limit really does reduce our confidence.
    ...(addressVerified && best.score >= 0.75 ? [] : ['profile_blocked']),
    // 2026-05-26: generic-address-card fallback is intentionally NOT
    // treated as a strong Places match even if the comparator score
    // happens to clear 0.75 (the comparator can score "3333 Bristol
    // St" → "3333 Bristol St, Costa Mesa" at 1.00 by literal name
    // overlap). Downgrade to weak so the safety gate / UI doesn't
    // pretend this is a confirmed business listing.
    usedGenericFallback
      ? 'places_weak_match'
      : best.score >= 0.75
      ? 'places_strong_match'
      : 'places_weak_match',
    // 2026-05-26: surface deterministic caption-address evidence when
    // the winning recovery query came from the address-first path.
    // Does NOT loosen safety: the gate still requires the agent
    // decision to be `auto_save` (it isn't here — we set
    // `candidate_confirmation`) and a `high` confidence Gemini run.
    ...(selectedQuery.source === 'address' ? ['caption_explicit_address'] : []),
    ...(usedGenericFallback ? ['places_generic_address_card'] : []),
    ...(addressVerified ? ['places_address_verified'] : []),
  ];
  try {
    console.log(
      `[timeout-recovery] decision=candidate_confirmation reason=${
        best.score >= 0.75 ? 'metadata_recovery_strong_match' : 'metadata_recovery_weak_match'
      } query=${JSON.stringify(selectedQuery.query)} top_score=${best.score.toFixed(2)} candidates=${scored.length}`,
    );
  } catch {
    // logging must never throw
  }
  const response = applySafety(
    {
      proposal: {
        placeName: selectedQuery.matchName,
        normalizedPlaceName: selectedQuery.matchName.toLowerCase(),
        address: null,
        city: selectedQuery.city,
        state: null,
        country: null,
        searchQuery: selectedQuery.query,
        platform: args.platform,
        sourceUrl: args.url,
        confidence: 'high',
        decision: 'candidate_confirmation',
        safeToAutoSave: false,
        needsUserConfirmation: true,
        evidenceUsed,
        toolsUsed: ['detectHandles', 'searchPlaces', 'compareCandidateToEvidence'],
        reasoning:
          'Gemini exceeded the inline budget, so the orchestrator recovered with a conservative deterministic Places query derived from explicit venue text or a venue-like handle. This remains candidate_confirmation only; auto-save stays disabled.',
        rejectionReasons: ['agent_timeout_recovered_with_places'],
        candidates: scored.slice(0, 3).map(({ candidate, score, rationale }) => ({
          googlePlaceId: candidate.googlePlaceId,
          name: candidate.name,
          formattedAddress: candidate.formattedAddress ?? null,
          latitude: typeof candidate.latitude === 'number' ? candidate.latitude : null,
          longitude: typeof candidate.longitude === 'number' ? candidate.longitude : null,
          types: candidate.types ?? [],
          matchScore: score,
          rationale,
        })),
      },
      resolvedPlace: {
        googlePlaceId: best.candidate.googlePlaceId,
        name: best.candidate.name,
        formattedAddress: best.candidate.formattedAddress ?? null,
        latitude: typeof best.candidate.latitude === 'number' ? best.candidate.latitude : null,
        longitude: typeof best.candidate.longitude === 'number' ? best.candidate.longitude : null,
        types: best.candidate.types ?? [],
      },
      safety: undefined as any,
      debug: {
        runId: `timeout-${Date.now().toString(36)}`,
        promptVersion: AGENT_PROMPT_VERSION,
        modelUsed: args.model,
        latencyMs: Date.now() - args.startedAt,
        warnings: [
          ...warnings,
          ...(selectedQuery.source === 'handle' ? ['timeout_recovery_used_handle_query'] : []),
          'agent_timeout_recovered_with_places',
        ],
        geminiDiagnostics: null,
        stageTimings: {
          metadataMs: args.stageTimings.metadataMs,
          handleDetectionMs: args.stageTimings.handleDetectionMs,
          profileEnrichmentMs: args.stageTimings.profileEnrichmentMs,
          placesMs,
          compareCandidatesMs,
          totalMs: Date.now() - args.startedAt,
          placesAttemptCount: attempts,
        },
        toolInvocations,
      },
    },
    {
      resolvedPlaceFromThisRun: true,
      topMatchScore: best.score,
      secondMatchScore: runnerUp?.score ?? null,
      resolvedPlaceNameMatchesProposal: true,
      resolvedPlaceAddressMatchesProposal: null,
    },
  );

  return response;
}

function detectPlatform(url: string): ShareAgentPlatform {
  const u = url.toLowerCase();
  if (u.includes('tiktok.com')) return 'tiktok';
  if (u.includes('instagram.com')) return 'instagram';
  if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube';
  if (u.includes('twitter.com') || u.includes('://x.com') || u.includes('.x.com')) return 'twitter';
  return 'link';
}

export type ShadowRunOptions = {
  url: string;
  accessToken: string | null;
};

export type AgentRequestRun = {
  url: string;
  platform: ShareAgentPlatform;
  response: AgentResponse | null;
  errors: string[];
  latencyMs: number;
  userId: string | null;
  budgetMs: number;
  geminiTimeoutMs: number;
  timeoutRecoveryUsed: boolean;
  realGeminiCompleted: boolean;
  stageTimings: {
    metadataMs: number | null;
    handleDetectionMs: number | null;
    profileEnrichmentMs: number | null;
  };
};

/**
 * STAGE 2 — runs the new backend agent and returns its raw result.
 * Does NOT persist, does NOT mutate user-facing state. Used in two ways:
 *   1. Inline by the Edge Function in `extract` mode so the host app can
 *      surface agent-derived candidates / manual-fallback decisions.
 *   2. By {@link runShadowAgentAndPersist}, which then writes the result
 *      to share_agent_runs in the background.
 *
 * Always resolves; on failure `response` is null and `errors` describes
 * what went wrong. Runs under a hard {@link DEFAULT_AGENT_BUDGET_MS}
 * budget so it cannot stall the response path.
 */
export async function runShareAgentForRequest(
  opts: ShadowRunOptions & { budgetMs?: number; geminiTimeoutMs?: number },
): Promise<AgentRequestRun> {
  const start = Date.now();
  const url = (opts.url ?? '').trim();
  const platform = detectPlatform(url);
  const budgetMs = Math.max(1_000, opts.budgetMs ?? DEFAULT_AGENT_BUDGET_MS);
  const geminiTimeoutMs = Math.max(1_000, opts.geminiTimeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS);

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const GEMINI_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
  const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? AGENT_DEFAULT_MODEL;
  const PLACES_KEY =
    Deno.env.get('GOOGLE_PLACES_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_PLACES_KEY') ??
    Deno.env.get('EXPO_PUBLIC_GOOGLE_MAPS_API_KEY') ??
    '';

  const errors: string[] = [];
  let response: AgentResponse | null = null;
  let userId: string | null = null;
  let timeoutRecoveryUsed = false;
  let realGeminiCompleted = false;
  let metaTitle: string | null = null;
  let metaDescription: string | null = null;
  let detectedHandles: DetectedHandles = { posterHandle: null, taggedHandles: [] };
  const collectedProfileBios: ProfileBioResult[] = [];
  const stageTimings = {
    metadataMs: null as number | null,
    handleDetectionMs: null as number | null,
    profileEnrichmentMs: null as number | null,
  };

  if (!url) {
    return {
      url,
      platform,
      response: null,
      errors: ['missing_url'],
      latencyMs: 0,
      userId: null,
      budgetMs,
      geminiTimeoutMs,
      timeoutRecoveryUsed,
      realGeminiCompleted,
      stageTimings,
    };
  }

  const work = (async () => {
    if (SUPABASE_URL && SERVICE_ROLE && opts.accessToken) {
      try {
        const userClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
          auth: { persistSession: false, autoRefreshToken: false },
        });
        const { data, error } = await userClient.auth.getUser(opts.accessToken);
        if (!error && data?.user) userId = data.user.id;
      } catch (err) {
        errors.push(`auth_check_failed:${(err as Error)?.message}`);
      }
    }

    const metadataStart = Date.now();
    const meta = await fetchPostMetadata(url);
    metaTitle = meta.result.title;
    metaDescription = meta.result.description;
    stageTimings.metadataMs = Date.now() - metadataStart;
    if (meta.invocation.status === 'error') {
      errors.push(`metadata_${meta.invocation.note ?? 'error'}`);
    }

    const detectStart = Date.now();
    const detected = detectHandles(
      [meta.result.title, meta.result.description].filter(Boolean).join('\n') || null,
      meta.result.rawHtml,
      platform,
    );
    detectedHandles = detected.result;
    stageTimings.handleDetectionMs = Date.now() - detectStart;

    const fastPathResponse = await buildBusinessAccountFastPath({
      url,
      platform,
      title: meta.result.title,
      handles: detected.result,
      googlePlacesKey: PLACES_KEY,
      model: GEMINI_MODEL,
      stageTimings,
      startedAt: start,
    });
    if (fastPathResponse) {
      response = fastPathResponse;
      return;
    }

    const profileBios: ProfileBioResult[] = [];
    if (platform === 'instagram') {
      const textEvidence = [meta.result.title, meta.result.description].filter(Boolean).join('\n');
      const shouldShortCircuitProfiles = hasCaptionVenueAndCity(textEvidence);
      const handles = prioritizeHandles(
        unique(
        [detected.result.posterHandle, ...detected.result.taggedHandles].filter(
          (h): h is string => !!h,
        ),
        ),
        textEvidence,
      ).slice(0, shouldShortCircuitProfiles ? 1 : MAX_PROFILE_FETCHES);
      const profileStart = Date.now();
      for (const handle of handles) {
        const bio = await fetchProfileBio('instagram', handle, PROFILE_FETCH_TIMEOUT_MS);
        profileBios.push(bio.result);
        collectedProfileBios.push(bio.result);
        if (bio.result.status === 'blocked' || bio.result.status === 'http_429') {
          console.log(
            `[agent] profile_blocked handle=@${handle} reason=${bio.result.note ?? 'blocked'}`,
          );
          errors.push(`profile_${handle}_${bio.result.status}`);
          break;
        }
      }
      stageTimings.profileEnrichmentMs = Date.now() - profileStart;
    }

    response = await runShareAgent({
      url,
      platform,
      title: meta.result.title,
      description: meta.result.description,
      detectedHandles: detected.result,
      profileBios,
      model: GEMINI_MODEL,
      env: { geminiApiKey: GEMINI_KEY || null, googlePlacesKey: PLACES_KEY || null },
      agentBudgetMs: budgetMs,
      geminiTimeoutMs,
    });
    realGeminiCompleted = !!response.debug.geminiDiagnostics?.textExists;
    response.debug.stageTimings = {
      ...response.debug.stageTimings,
      metadataMs: stageTimings.metadataMs,
      handleDetectionMs: stageTimings.handleDetectionMs,
      profileEnrichmentMs: stageTimings.profileEnrichmentMs,
      totalMs: Date.now() - start,
    };
  })();

  let timedOut = false;
  await Promise.race([
    work.catch((err) => {
      errors.push(`agent_threw:${(err as Error)?.message ?? 'unknown'}`);
    }),
    new Promise<void>((resolve) =>
      setTimeout(() => {
        timedOut = true;
        resolve();
      }, budgetMs),
    ),
  ]);
  if (timedOut) {
    errors.push(`agent_timeout_${budgetMs}ms`);
    if (!response) {
      const recovered = await buildDeterministicTimeoutFallback({
        url,
        platform,
        title: metaTitle,
        description: metaDescription,
        handles: detectedHandles,
        profileBios: collectedProfileBios,
        googlePlacesKey: PLACES_KEY,
        model: GEMINI_MODEL,
        warnings: [...errors],
        stageTimings,
        startedAt: start,
      });
      if (recovered) {
        response = recovered;
        timeoutRecoveryUsed = true;
        if (recovered.resolvedPlace?.googlePlaceId) {
          errors.push('agent_timeout_recovered_with_places');
        }
      }
    }
  }

  return {
    url,
    platform,
    response,
    errors,
    latencyMs: Date.now() - start,
    userId,
    budgetMs,
    geminiTimeoutMs,
    timeoutRecoveryUsed,
    realGeminiCompleted,
    stageTimings,
  };
}

export { DEFAULT_DEBUG_SLOW_AGENT_BUDGET_MS, DEFAULT_DEBUG_SLOW_GEMINI_TIMEOUT_MS };

export async function runShadowAgentAndPersist(opts: ShadowRunOptions): Promise<void> {
  const url = (opts.url ?? '').trim();
  if (!url) {
    console.log('[agent-shadow] run_failed reason=missing_url');
    return;
  }

  console.log(`[agent-shadow] run_started url=${safeUrl(url)}`);

  const run = await runShareAgentForRequest(opts);
  await persistAgentRun(run);
}

/**
 * Persists a single agent run to share_agent_runs. Best-effort — never throws.
 * Safe to call from both the inline (extract) and the background (save) path:
 * each request does at most one inline run and one shadow run, so duplicate
 * rows for the same URL within a request are intentional and traceable via
 * `created_at`.
 */
export async function persistAgentRun(run: AgentRequestRun): Promise<string | null> {
  const { response, errors, latencyMs, userId, url, platform } = run;
  if (!response) {
    console.log(`[agent-shadow] run_failed reason=no_response errors=${truncate(errors.join('|'))}`);
    return null;
  }

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
  const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  let runId: string | null = null;
  if (SUPABASE_URL && SERVICE_ROLE) {
    try {
      const adminClient = createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data, error } = await adminClient
        .from('share_agent_runs')
        .insert({
          user_id: userId,
          url,
          platform,
          prompt_version: response.debug.promptVersion,
          model_used: response.debug.modelUsed,
          agent_decision: response.proposal.decision,
          safety_decision: response.safety.decision,
          safe_to_auto_save: response.safety.safeToAutoSave,
          confidence: response.proposal.confidence,
          reasoning: response.proposal.reasoning,
          tool_calls: response.debug.toolInvocations,
          candidates: response.proposal.candidates,
          evidence_used: response.proposal.evidenceUsed,
          latency_ms: latencyMs,
          errors: errors.concat(response.debug.warnings),
          raw_response: response,
        })
        .select('id')
        .maybeSingle();
      if (error) {
        console.log(`[agent-shadow] persist_failed msg=${truncate(error.message)}`);
      } else {
        runId = data?.id ?? null;
      }
    } catch (err) {
      console.log(`[agent-shadow] persist_failed msg=${truncate((err as Error)?.message)}`);
    }
  }

  console.log(
    `[agent-shadow] run_finished decision=${response.proposal.decision} finalDecision=${response.safety.decision} runId=${runId ?? 'unsaved'}`,
  );
  return runId;
}

function unique<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function safeUrl(value: string | null | undefined): string {
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return truncate(value);
  }
}

function truncate(value: string | null | undefined, max = 160): string {
  if (!value) return '';
  const collapsed = String(value).replace(/\s+/g, ' ').trim();
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}
