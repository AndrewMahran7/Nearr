/**
 * Authoritative saved-place share-target resolution.
 *
 * A saved place's original public source is the valuable payload. Provider
 * maps are only a fallback. This module is pure and deliberately accepts only
 * the public fields needed by the native share sheet.
 */

import { buildExternalMapsUrl } from './externalMapsUrl';
import { normalizeShareUrl } from './shareAgent/tiktokUrl';

export type ShareablePlace = {
  name?: string | null;
  formatted_address?: string | null;
  google_place_id?: string | null;
  google_maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SavedPlaceShareContext = {
  source_type?: string | null;
  source_url?: string | null;
  place: ShareablePlace;
};

export type SavedPlaceShareTarget = {
  kind: 'original_post' | 'original_source' | 'provider' | 'unavailable';
  url: string | null;
  platform: 'instagram' | 'tiktok' | 'youtube' | 'twitter' | 'link' | null;
};

export type SavedPlaceShareContent = SavedPlaceShareTarget & {
  title: string;
  message: string;
};

const BLOCKED_HOST_SUFFIXES = [
  'cdninstagram.com',
  'fbcdn.net',
  'tiktokcdn.com',
  'tiktokcdn-us.com',
  'tiktokv.com',
  'byteoversea.com',
  'ibytedtos.com',
  'muscdn.com',
  'googleusercontent.com',
  'storage.googleapis.com',
  'firebasestorage.googleapis.com',
  'amazonaws.com',
  'blob.core.windows.net',
  'cloudfront.net',
  'r2.dev',
  'supabase.co',
  'supabase.in',
  'railway.app',
  'workers.dev',
] as const;

const SECRET_QUERY_KEY = /(^|[-_])(access[-_]?token|auth|authorization|credential|exp|expires|expiry|jwt|key|policy|secret|session|signature|signed|sig|token)([-_]|$)/i;
const INTERNAL_PATH = /^\/(api|functions\/v1|rest\/v1|storage\/v1)(\/|$)/i;
const TEMPORARY_MEDIA_PATH = /\.(m3u8|m4a|m4v|mov|mp3|mp4|webm)(?:$|\/)/i;

function isHostOrSubdomain(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

function isPrivateIpv4(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const values = match.slice(1).map(Number);
  if (values.some((value) => value < 0 || value > 255)) return true;
  const a = values[0] ?? -1;
  const b = values[1] ?? -1;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168);
}

function parseSafePublicUrl(raw: string | null | undefined): URL | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.includes(':') ||
    isPrivateIpv4(host) ||
    BLOCKED_HOST_SUFFIXES.some((domain) => isHostOrSubdomain(host, domain)) ||
    /^(api|worker|media-worker|backend|internal)\./i.test(host)
  ) return null;
  if (INTERNAL_PATH.test(parsed.pathname) || TEMPORARY_MEDIA_PATH.test(parsed.pathname)) return null;
  for (const key of parsed.searchParams.keys()) {
    if (SECRET_QUERY_KEY.test(key) && !/^igsh(id)?$/i.test(key)) return null;
    if (/^x-(amz|goog)-/i.test(key)) return null;
  }
  if (/(access[-_]?token|authorization|credential|secret|signature)=/i.test(parsed.hash)) return null;
  return parsed;
}

type SocialPlatform = Exclude<SavedPlaceShareTarget['platform'], 'link' | null>;

function socialPlatform(parsed: URL): SocialPlatform | 'invalid_social' | null {
  const host = parsed.hostname.toLowerCase();
  const path = parsed.pathname;

  if (isHostOrSubdomain(host, 'instagram.com')) {
    return /^\/(p|reel|reels|tv)\/[^/]+\/?$/i.test(path) ? 'instagram' : 'invalid_social';
  }
  if (isHostOrSubdomain(host, 'tiktok.com')) {
    const durable = /^\/@[^/]+\/video\/\d+\/?$/i.test(path);
    const short = host === 'vm.tiktok.com' || host === 'vt.tiktok.com' || /^\/t\/[^/]+\/?$/i.test(path);
    return durable || short ? 'tiktok' : 'invalid_social';
  }
  if (isHostOrSubdomain(host, 'youtube.com')) {
    const durable = (/^\/watch\/?$/i.test(path) && !!parsed.searchParams.get('v')) ||
      /^\/(shorts|live)\/[^/]+\/?$/i.test(path);
    return durable ? 'youtube' : 'invalid_social';
  }
  if (host === 'youtu.be') {
    return /^\/[^/]+\/?$/i.test(path) ? 'youtube' : 'invalid_social';
  }
  if (isHostOrSubdomain(host, 'twitter.com') || isHostOrSubdomain(host, 'x.com')) {
    return /^\/[^/]+\/status\/\d+\/?$/i.test(path) ? 'twitter' : 'invalid_social';
  }
  return null;
}

function normalizeOriginalSource(raw: string | null | undefined): {
  url: string;
  platform: SavedPlaceShareTarget['platform'];
  social: boolean;
} | null {
  const safe = parseSafePublicUrl(raw);
  if (!safe) return null;
  const social = socialPlatform(safe);
  if (social === 'invalid_social') return null;

  const normalized = normalizeShareUrl(safe.toString()).url;
  const parsed = parseSafePublicUrl(normalized);
  if (!parsed) return null;
  parsed.hash = '';

  if (social === 'instagram' || social === 'tiktok' || social === 'twitter') {
    parsed.search = '';
  } else if (social === 'youtube') {
    const videoId = parsed.searchParams.get('v');
    const start = parsed.searchParams.get('t') ?? parsed.searchParams.get('start');
    parsed.search = '';
    if (videoId) parsed.searchParams.set('v', videoId);
    if (start) parsed.searchParams.set('t', start);
  }

  return {
    url: parsed.toString(),
    platform: social ?? 'link',
    social: social !== null,
  };
}

function validProviderUrl(raw: string | null | undefined): string | null {
  const parsed = parseSafePublicUrl(raw);
  if (!parsed) return null;
  const host = parsed.hostname.toLowerCase();
  const valid =
    host === 'maps.google.com' ||
    (isHostOrSubdomain(host, 'google.com') && /^\/maps(?:\/|$)/i.test(parsed.pathname)) ||
    (host === 'maps.app.goo.gl') ||
    (host === 'goo.gl' && /^\/maps(?:\/|$)/i.test(parsed.pathname));
  return valid ? parsed.toString() : null;
}

/** Resolve the one public URL the native saved-place Share action may send. */
export function getSavedPlaceShareTarget(savedPlace: SavedPlaceShareContext): SavedPlaceShareTarget {
  const original = normalizeOriginalSource(savedPlace.source_url);
  if (original) {
    return {
      kind: original.social ? 'original_post' : 'original_source',
      url: original.url,
      platform: original.platform,
    };
  }

  const place = savedPlace.place;
  const provider = buildExternalMapsUrl({
    name: place.name ?? null,
    formatted_address: place.formatted_address ?? null,
    google_place_id: place.google_place_id ?? null,
    google_maps_url: validProviderUrl(place.google_maps_url),
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
  });
  const safeProvider = validProviderUrl(provider);
  if (safeProvider) return { kind: 'provider', url: safeProvider, platform: null };
  return { kind: 'unavailable', url: null, platform: null };
}

/** Minimal, private-field-free native share payload. */
export function buildSavedPlaceShareContent(savedPlace: SavedPlaceShareContext): SavedPlaceShareContent {
  const title = (savedPlace.place.name ?? '').trim() || 'A place';
  const target = getSavedPlaceShareTarget(savedPlace);
  return {
    ...target,
    title,
    message: target.url ? `${title}\n${target.url}` : title,
  };
}
