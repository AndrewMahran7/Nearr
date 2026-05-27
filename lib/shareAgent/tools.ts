/**
 * Server-side tools the share-extraction agent may invoke.
 *
 * STAGE 1 — SHADOW MODE ONLY.
 *
 * Rules:
 *   - No React Native imports. Runs in Deno (Edge Function) and Node (eval).
 *   - Never throw. Every tool returns a structured result with status.
 *   - No client-side scraping. All HTTP happens here.
 *   - No profile cache. fetchProfileBio is best-effort live only.
 *   - fetchTranscript is intentionally stubbed as 'unsupported'.
 *   - No secrets in returned payloads. Truncate raw HTML/bio in outputs.
 */

import type { ShareAgentPlatform, ToolInvocation } from './types.ts';

declare const process: { env: Record<string, string | undefined> } | undefined;

const USER_AGENT =
  'Mozilla/5.0 (compatible; NearrAgent/1.0 shadow; +https://nearr.app)';
const DEFAULT_TIMEOUT_MS = 8000;
const MAX_BODY_SNIPPET = 240;

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function truncate(value: string | null | undefined, max = MAX_BODY_SNIPPET): string | null {
  if (!value) return null;
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) return null;
  return collapsed.length > max ? `${collapsed.slice(0, max)}…` : collapsed;
}

async function timedFetch(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,*/*', ...(init.headers ?? {}) },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------------------
// fetchPostMetadata — pull og:title / og:description from the share URL.
// ---------------------------------------------------------------------------

export type FetchPostMetadataResult = {
  status: 'ok' | 'error';
  title: string | null;
  description: string | null;
  rawHtml: string | null;
  finalUrl: string | null;
  note?: string;
};

function pickMetaTag(html: string, prop: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m) return decodeHtmlEntities(m[1]);
  }
  return null;
}

function pickHtmlTitle(html: string): string | null {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? decodeHtmlEntities(m[1]) : null;
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export async function fetchPostMetadata(url: string): Promise<{
  result: FetchPostMetadataResult;
  invocation: ToolInvocation;
}> {
  const start = nowMs();
  try {
    const res = await timedFetch(url);
    if (!res.ok) {
      const inv: ToolInvocation = {
        tool: 'fetchPostMetadata',
        input: { url: safeUrl(url) },
        output: { httpStatus: res.status },
        status: 'error',
        note: `HTTP ${res.status}`,
        latencyMs: Math.round(nowMs() - start),
      };
      return {
        result: { status: 'error', title: null, description: null, rawHtml: null, finalUrl: res.url ?? null, note: inv.note },
        invocation: inv,
      };
    }
    const html = await res.text();
    const title =
      pickMetaTag(html, 'og:title') ??
      pickMetaTag(html, 'twitter:title') ??
      pickHtmlTitle(html);
    const description =
      pickMetaTag(html, 'og:description') ??
      pickMetaTag(html, 'twitter:description') ??
      null;
    const inv: ToolInvocation = {
      tool: 'fetchPostMetadata',
      input: { url: safeUrl(url) },
      output: {
        title: truncate(title),
        description: truncate(description),
        finalUrl: safeUrl(res.url ?? url),
      },
      status: 'ok',
      latencyMs: Math.round(nowMs() - start),
    };
    return {
      result: {
        status: 'ok',
        title,
        description,
        rawHtml: html,
        finalUrl: res.url ?? url,
      },
      invocation: inv,
    };
  } catch (err) {
    const inv: ToolInvocation = {
      tool: 'fetchPostMetadata',
      input: { url: safeUrl(url) },
      status: 'error',
      note: (err as Error)?.message ?? 'fetch_failed',
      latencyMs: Math.round(nowMs() - start),
    };
    return {
      result: { status: 'error', title: null, description: null, rawHtml: null, finalUrl: null, note: inv.note },
      invocation: inv,
    };
  }
}

function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return truncate(value);
  }
}

// ---------------------------------------------------------------------------
// detectHandles — pull @handles + tagged accounts from text/html.
// ---------------------------------------------------------------------------

const HANDLE_RE = /@([A-Za-z0-9_.]{2,30})/g;

export type DetectedHandles = {
  posterHandle: string | null;
  taggedHandles: string[];
  allHandles: string[];
};

export function detectHandles(
  text: string | null | undefined,
  html: string | null | undefined,
  platform: ShareAgentPlatform,
): { result: DetectedHandles; invocation: ToolInvocation } {
  const start = nowMs();
  const sources: string[] = [];
  if (text) sources.push(text);
  if (html) sources.push(html.slice(0, 50_000));
  const found = new Set<string>();
  for (const src of sources) {
    let match: RegExpExecArray | null;
    HANDLE_RE.lastIndex = 0;
    while ((match = HANDLE_RE.exec(src)) !== null) {
      const handle = match[1].toLowerCase();
      if (!handle) continue;
      // Skip obvious non-handle noise.
      if (handle.length < 2 || /^\d+$/.test(handle)) continue;
      found.add(handle);
    }
  }
  const all = Array.from(found);
  // Poster handle: best-effort — the og:title pattern is "Name (@handle)".
  let posterHandle: string | null = null;
  if (text) {
    const m = text.match(/\(@([A-Za-z0-9_.]{2,30})\)/);
    if (m) posterHandle = m[1].toLowerCase();
  }
  if (!posterHandle && platform === 'instagram' && all.length === 1) {
    posterHandle = all[0];
  }
  const taggedHandles = all.filter((h) => h !== posterHandle);
  const inv: ToolInvocation = {
    tool: 'detectHandles',
    input: { platform, hasText: !!text, hasHtml: !!html },
    output: { posterHandle, taggedCount: taggedHandles.length, allCount: all.length },
    status: 'ok',
    latencyMs: Math.round(nowMs() - start),
  };
  return { result: { posterHandle, taggedHandles, allHandles: all }, invocation: inv };
}

// ---------------------------------------------------------------------------
// fetchProfileBio — live, best-effort, NO CACHE. Never throws.
// ---------------------------------------------------------------------------

export type ProfileBioStatus = 'ok' | 'blocked' | 'http_429' | 'unsupported' | 'not_found' | 'error';

export type ProfileBioResult = {
  status: ProfileBioStatus;
  handle: string;
  platform: ShareAgentPlatform;
  displayName: string | null;
  category: string | null;
  bio: string | null;
  website: string | null;
  note?: string;
};

export async function fetchProfileBio(
  platform: ShareAgentPlatform,
  handle: string,
  timeoutMs = 4000,
): Promise<{ result: ProfileBioResult; invocation: ToolInvocation }> {
  const start = nowMs();
  const cleanHandle = handle.replace(/^@/, '').trim();
  const baseResult = (status: ProfileBioStatus, note?: string): ProfileBioResult => ({
    status,
    handle: cleanHandle,
    platform,
    displayName: null,
    category: null,
    bio: null,
    website: null,
    note,
  });
  if (!cleanHandle) {
    return {
      result: baseResult('error', 'empty_handle'),
      invocation: {
        tool: 'fetchProfileBio',
        input: { platform, handle: cleanHandle },
        status: 'error',
        note: 'empty_handle',
        latencyMs: Math.round(nowMs() - start),
      },
    };
  }
  if (platform !== 'instagram') {
    const note = 'platform_unsupported';
    return {
      result: baseResult('unsupported', note),
      invocation: {
        tool: 'fetchProfileBio',
        input: { platform, handle: cleanHandle },
        status: 'unsupported',
        note,
        latencyMs: Math.round(nowMs() - start),
      },
    };
  }
  const profileUrl = `https://www.instagram.com/${encodeURIComponent(cleanHandle)}/`;
  try {
    const res = await timedFetch(profileUrl, {}, timeoutMs);
    if (res.status === 429) {
      return {
        result: baseResult('http_429', 'rate_limited'),
        invocation: {
          tool: 'fetchProfileBio',
          input: { platform, handle: cleanHandle },
          output: { httpStatus: 429 },
          status: 'blocked',
          note: 'http_429',
          latencyMs: Math.round(nowMs() - start),
        },
      };
    }
    if (res.status === 404) {
      return {
        result: baseResult('not_found', 'http_404'),
        invocation: {
          tool: 'fetchProfileBio',
          input: { platform, handle: cleanHandle },
          output: { httpStatus: 404 },
          status: 'ok',
          note: 'not_found',
          latencyMs: Math.round(nowMs() - start),
        },
      };
    }
    if (!res.ok) {
      return {
        result: baseResult('error', `http_${res.status}`),
        invocation: {
          tool: 'fetchProfileBio',
          input: { platform, handle: cleanHandle },
          output: { httpStatus: res.status },
          status: 'error',
          note: `http_${res.status}`,
          latencyMs: Math.round(nowMs() - start),
        },
      };
    }
    const html = await res.text();
    // Detect IG login wall / interstitial.
    const lower = html.toLowerCase();
    if (
      lower.includes('"login_and_signup"') ||
      lower.includes('please wait a few minutes before you try again') ||
      lower.includes('login • instagram')
    ) {
      return {
        result: baseResult('blocked', 'login_wall'),
        invocation: {
          tool: 'fetchProfileBio',
          input: { platform, handle: cleanHandle },
          status: 'blocked',
          note: 'login_wall',
          latencyMs: Math.round(nowMs() - start),
        },
      };
    }
    const description = pickMetaTag(html, 'og:description');
    const title = pickMetaTag(html, 'og:title');
    // og:description is usually "X Followers, Y Following — Display Name (@handle) on Instagram: \"bio\""
    let displayName: string | null = null;
    let bio: string | null = null;
    if (description) {
      const dnMatch = description.match(/[—\-]\s*([^@()]+?)\s*\(@/);
      if (dnMatch) displayName = dnMatch[1].trim();
      const bioMatch = description.match(/Instagram:\s*"([^"]+)"/);
      if (bioMatch) bio = bioMatch[1].trim();
    }
    if (!displayName && title) {
      const m = title.match(/^([^@()]+?)\s*\(@/);
      if (m) displayName = m[1].trim();
    }
    return {
      result: {
        status: 'ok',
        handle: cleanHandle,
        platform,
        displayName,
        category: null,
        bio,
        website: null,
      },
      invocation: {
        tool: 'fetchProfileBio',
        input: { platform, handle: cleanHandle },
        output: {
          hasDisplayName: !!displayName,
          hasBio: !!bio,
          bioPreview: truncate(bio, 80),
        },
        status: 'ok',
        latencyMs: Math.round(nowMs() - start),
      },
    };
  } catch (err) {
    return {
      result: baseResult('error', (err as Error)?.message ?? 'fetch_failed'),
      invocation: {
        tool: 'fetchProfileBio',
        input: { platform, handle: cleanHandle },
        status: 'error',
        note: (err as Error)?.message ?? 'fetch_failed',
        latencyMs: Math.round(nowMs() - start),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// fetchTranscript — STUB. Stage 1 returns 'unsupported' deterministically.
// ---------------------------------------------------------------------------

export type TranscriptResult = {
  status: 'unsupported';
  transcript: null;
  note: string;
};

export function fetchTranscript(url: string): {
  result: TranscriptResult;
  invocation: ToolInvocation;
} {
  return {
    result: {
      status: 'unsupported',
      transcript: null,
      note: 'transcript_unsupported_in_stage_1',
    },
    invocation: {
      tool: 'fetchTranscript',
      input: { url: safeUrl(url) },
      status: 'unsupported',
      note: 'transcript_unsupported_in_stage_1',
      latencyMs: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// searchPlaces — Google Places Text Search.
// ---------------------------------------------------------------------------

export type PlacesSearchCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress?: string;
  latitude?: number;
  longitude?: number;
  types?: string[];
};

export type LocationBias = { lat: number; lng: number; radiusMeters?: number };

export type SearchPlacesResult = {
  status: 'ok' | 'error' | 'no_key';
  candidates: PlacesSearchCandidate[];
  note?: string;
};

export async function searchPlaces(
  query: string,
  apiKey: string | null | undefined,
  locationBias?: LocationBias,
): Promise<{ result: SearchPlacesResult; invocation: ToolInvocation }> {
  const start = nowMs();
  if (!apiKey) {
    return {
      result: { status: 'no_key', candidates: [], note: 'GOOGLE_PLACES_KEY missing' },
      invocation: {
        tool: 'searchPlaces',
        input: { query: truncate(query, 80) },
        status: 'error',
        note: 'no_key',
        latencyMs: Math.round(nowMs() - start),
      },
    };
  }
  const cleaned = (query ?? '').trim();
  if (!cleaned) {
    return {
      result: { status: 'ok', candidates: [] },
      invocation: {
        tool: 'searchPlaces',
        input: { query: '' },
        output: { count: 0 },
        status: 'ok',
        note: 'query="" count=0',
        latencyMs: Math.round(nowMs() - start),
      },
    };
  }
  const params = new URLSearchParams({ query: cleaned, key: apiKey });
  if (locationBias) {
    params.set('location', `${locationBias.lat},${locationBias.lng}`);
    params.set('radius', String(locationBias.radiusMeters ?? 50000));
  }
  try {
    const res = await timedFetch(
      `https://maps.googleapis.com/maps/api/place/textsearch/json?${params.toString()}`,
      {},
      6000,
    );
    if (!res.ok) {
      return {
        result: { status: 'error', candidates: [], note: `HTTP ${res.status}` },
        invocation: {
          tool: 'searchPlaces',
          input: { query: truncate(cleaned, 80) },
          status: 'error',
          note: `query=${JSON.stringify(truncate(cleaned, 60))} HTTP ${res.status}`,
          latencyMs: Math.round(nowMs() - start),
        },
      };
    }
    const json = (await res.json()) as {
      status?: string;
      results?: Array<{
        place_id: string;
        name: string;
        formatted_address?: string;
        geometry?: { location?: { lat: number; lng: number } };
        types?: string[];
      }>;
      error_message?: string;
    };
    if (json.status && json.status !== 'OK' && json.status !== 'ZERO_RESULTS') {
      return {
        result: {
          status: 'error',
          candidates: [],
          note: `${json.status}: ${json.error_message ?? ''}`,
        },
        invocation: {
          tool: 'searchPlaces',
          input: { query: truncate(cleaned, 80) },
          status: 'error',
          note: `query=${JSON.stringify(truncate(cleaned, 60))} ${json.status}`,
          latencyMs: Math.round(nowMs() - start),
        },
      };
    }
    const candidates: PlacesSearchCandidate[] = (json.results ?? []).slice(0, 8).map((r) => ({
      googlePlaceId: r.place_id,
      name: r.name,
      formattedAddress: r.formatted_address,
      latitude: r.geometry?.location?.lat,
      longitude: r.geometry?.location?.lng,
      types: Array.isArray(r.types) ? r.types : undefined,
    }));
    return {
      result: { status: 'ok', candidates },
      invocation: {
        tool: 'searchPlaces',
        input: { query: truncate(cleaned, 80), bias: !!locationBias },
        output: { count: candidates.length, names: candidates.slice(0, 5).map((c) => c.name) },
        status: 'ok',
        note: `query=${JSON.stringify(truncate(cleaned, 60))} count=${candidates.length}`,
        latencyMs: Math.round(nowMs() - start),
      },
    };
  } catch (err) {
    return {
      result: { status: 'error', candidates: [], note: (err as Error)?.message ?? 'fetch_failed' },
      invocation: {
        tool: 'searchPlaces',
        input: { query: truncate(cleaned, 80) },
        status: 'error',
        note: `query=${JSON.stringify(truncate(cleaned, 60))} ${(err as Error)?.message ?? 'fetch_failed'}`,
        latencyMs: Math.round(nowMs() - start),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// compareCandidateToEvidence — pure scoring. No I/O.
// ---------------------------------------------------------------------------

export type CompareEvidence = {
  placeName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  bioName?: string | null;
  bioCity?: string | null;
};

export type CompareCandidateResult = {
  score: number; // 0..1
  nameOverlap: number; // 0..1
  hasAddressMatch: boolean;
  hasCityMatch: boolean;
  rationale: string;
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value: string | null | undefined): Set<string> {
  return new Set(normalizeText(value).split(' ').filter((t) => t.length >= 2));
}

// 2026-05-26: USPS-style street-suffix abbreviations. Used by
// `addressesMatch` so "126 Main St" matches "126 Main Street" and vice
// versa regardless of which side carries the full word. Pairs only —
// numeric-suffix oddities (1st/2nd/3rd) are NOT in here because they
// are part of street NAMES, not types.
const STREET_SUFFIX_ABBREVIATIONS: Record<string, string> = {
  st: 'street',
  street: 'st',
  ave: 'avenue',
  av: 'avenue',
  avenue: 'ave',
  rd: 'road',
  road: 'rd',
  blvd: 'boulevard',
  boulevard: 'blvd',
  dr: 'drive',
  drive: 'dr',
  ln: 'lane',
  lane: 'ln',
  wy: 'way',
  way: 'wy',
  ct: 'court',
  court: 'ct',
  pl: 'place',
  place: 'pl',
  ter: 'terrace',
  terrace: 'ter',
  hwy: 'highway',
  highway: 'hwy',
  pkwy: 'parkway',
  parkway: 'pkwy',
  cir: 'circle',
  circle: 'cir',
  plz: 'plaza',
  plaza: 'plz',
  sq: 'square',
  square: 'sq',
};

/**
 * Deterministic street-address comparator that tolerates real-world
 * formatting variation: USPS suffix abbreviations (St ↔ Street),
 * trailing ZIP/country, commas, double spaces, case, and accents.
 *
 * Returns true iff the candidate's formatted address contains both
 * (a) the expected street number AND (b) every meaningful street-name
 * token from the expected address (with the suffix matched in either
 * its abbreviated or full form).
 *
 * Conservative on purpose: a missing street number or a missing street
 * word returns false. We never want a false-positive "address match"
 * because that's the strongest evidence the safety gate consumes.
 */
export function addressesMatch(
  expected: string | null | undefined,
  candidate: string | null | undefined,
): boolean {
  const wantedRaw = normalizeText(expected);
  const haveRaw = normalizeText(candidate);
  if (!wantedRaw || !haveRaw) return false;
  const wantedTokens = wantedRaw.split(' ').filter((t) => t.length > 0);
  if (wantedTokens.length === 0) return false;
  // First token must be the street number (digits, optionally hyphenated).
  const numberToken = wantedTokens[0];
  if (!/^\d/.test(numberToken)) return false;
  const haveTokens = new Set(haveRaw.split(' ').filter((t) => t.length > 0));
  if (!haveTokens.has(numberToken)) return false;
  // Every subsequent street-name word must appear in the candidate
  // address, matching either the literal token OR its USPS pair (St ↔
  // Street). Drop trailing unit markers (apt/ste/#) AND any tokens
  // that appear after one of those markers — unit-number variation
  // (Suite 200 vs Ste 2A) should never block a street match.
  const unitMarkerIdx = wantedTokens.findIndex((t) =>
    /^(apt|ste|suite|unit)$/.test(t),
  );
  const tailEnd = unitMarkerIdx >= 0 ? unitMarkerIdx : wantedTokens.length;
  const nameTokens = wantedTokens
    .slice(1, tailEnd)
    .filter((t) => !/^(apt|ste|suite|unit|#)$/.test(t));
  if (nameTokens.length === 0) return false;
  for (const tok of nameTokens) {
    if (haveTokens.has(tok)) continue;
    const pair = STREET_SUFFIX_ABBREVIATIONS[tok];
    if (pair && haveTokens.has(pair)) continue;
    return false;
  }
  return true;
}

export function compareCandidateToEvidence(
  candidate: PlacesSearchCandidate,
  evidence: CompareEvidence,
): { result: CompareCandidateResult; invocation: ToolInvocation } {
  const start = nowMs();
  const expectedName = evidence.placeName ?? evidence.bioName ?? null;
  let nameOverlap = 0;
  if (expectedName) {
    const a = tokens(candidate.name);
    const b = tokens(expectedName);
    if (b.size > 0) {
      let hits = 0;
      for (const t of b) if (a.has(t)) hits++;
      nameOverlap = hits / b.size;
    }
  }
  // 2026-05-26: use the suffix/ZIP/country-tolerant comparator instead
  // of a brittle 12-char prefix `includes`. Fixes the case where a
  // caption address "126 Main St" failed to match Google's formatted
  // "126 Main St, Huntington Beach, CA 92648, USA" because of the
  // trailing comma byte being inside the slice window, etc.
  const hasAddressMatch = addressesMatch(
    evidence.address ?? null,
    candidate.formattedAddress ?? null,
  );
  const addrLower = (candidate.formattedAddress ?? '').toLowerCase();
  const cityNeedle =
    normalizeText(evidence.city ?? evidence.bioCity ?? '').split(' ')[0] ?? '';
  const hasCityMatch = !!cityNeedle && addrLower.includes(cityNeedle);
  let score = nameOverlap * 0.6;
  if (hasAddressMatch) score += 0.3;
  if (hasCityMatch) score += 0.1;
  if (score > 1) score = 1;
  const rationale = [
    `nameOverlap=${nameOverlap.toFixed(2)}`,
    `address=${hasAddressMatch ? 'match' : 'miss'}`,
    `city=${hasCityMatch ? 'match' : 'miss'}`,
  ].join(' ');
  return {
    result: { score, nameOverlap, hasAddressMatch, hasCityMatch, rationale },
    invocation: {
      tool: 'compareCandidateToEvidence',
      input: { candidateName: candidate.name, expectedName: truncate(expectedName, 60) },
      output: { score: Number(score.toFixed(3)), nameOverlap: Number(nameOverlap.toFixed(3)) },
      status: 'ok',
      note: rationale,
      latencyMs: Math.round(nowMs() - start),
    },
  };
}
