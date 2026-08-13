/**
 * lib/placeShare.ts
 *
 * Pure builder for the *ordinary* place-sharing payload used by the native
 * Share sheet on the saved-place details panel.
 *
 * IMPORTANT: this is plain place sharing — the place name, address, and a
 * public Google Maps link — NOT a Nearr deep link. Nearr currently has no
 * universal-link / associated-domain infrastructure, so a `nearr://` link would
 * not be reliably clickable inside messaging apps. Until that infrastructure
 * exists we deliberately do not ship a Nearr link (see the "Save to Nearr"
 * design in the change report). This keeps the feature honest: it shares a
 * place the way any maps app would.
 *
 * The payload intentionally excludes every private field — notes, reminder
 * settings, user id, saved_place row id, source URL, and analytics. Only the
 * public identity of the place (name + address) plus a public Google Maps link
 * (which may include the public `google_place_id`) is shared.
 *
 * PURE — the only import is the pure Google Maps URL builder — so it is unit
 * testable from ts-node.
 */

import { buildExternalMapsUrl } from './externalMapsUrl';

/** The public place fields that are safe to share. */
export type ShareablePlace = {
  name?: string | null;
  formatted_address?: string | null;
  google_place_id?: string | null;
  google_maps_url?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

/** Where the place originally came from, when Nearr saved it from social content. */
export type ShareSourceContext = {
  source_type?: string | null;
  source_url?: string | null;
};

export type ShareTarget = {
  kind: 'original_post' | 'provider';
  url: string | null;
  platform: 'instagram' | 'tiktok' | 'link' | null;
};

/**
 * Hosts that serve TEMPORARY media (CDN clips, signed object URLs). Nearr must
 * never share these: they expire, they can carry credentials, and they are not
 * the post the user actually saved.
 */
const TRANSIENT_MEDIA_HOST = /(^|\.)(cdninstagram\.com|fbcdn\.net|tiktokcdn\.com|tiktokcdn-us\.com|googleusercontent\.com|storage\.googleapis\.com)$/i;
const TRANSIENT_MEDIA_HOST_PREFIX = /^v\d+[-\w]*\.tiktok\.com$/i;
/** Query keys that indicate a signed / credentialed URL. */
const SIGNED_QUERY_KEY = /^(signature|x-goog-signature|x-amz-signature|token|access_token|sig|policy|expires)$/i;

/**
 * True when a stored source URL is a safe, durable, public post link.
 * Rejects non-https, transient CDN hosts, signed URLs, and storage object paths.
 */
export function isShareableSourceUrl(raw: string | null | undefined): boolean {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) return false;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  const host = parsed.hostname.toLowerCase();
  if (TRANSIENT_MEDIA_HOST.test(host) || TRANSIENT_MEDIA_HOST_PREFIX.test(host)) return false;
  if (/\/storage\/v1\/object\//i.test(parsed.pathname)) return false;
  if (/\.(mp4|m3u8|mov|webm)$/i.test(parsed.pathname)) return false;
  for (const key of parsed.searchParams.keys()) {
    if (SIGNED_QUERY_KEY.test(key)) return false;
  }
  return true;
}

function platformOf(sourceType: string | null | undefined): ShareTarget['platform'] {
  switch ((sourceType ?? '').toLowerCase()) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'tiktok';
    case 'link':
      return 'link';
    default:
      return null;
  }
}

/**
 * Decide what a share action should actually send.
 *
 * Nearr exists because the place came from social content, so the ORIGINAL post
 * is the priority. The public provider (Google Maps) URL is only a fallback for
 * places that have no original social source.
 */
export function resolveShareTarget(
  place: ShareablePlace,
  source?: ShareSourceContext | null,
): ShareTarget {
  const sourceUrl = (source?.source_url ?? '').trim();
  if (isShareableSourceUrl(sourceUrl)) {
    return {
      kind: 'original_post',
      url: sourceUrl,
      platform: platformOf(source?.source_type) ?? 'link',
    };
  }
  return {
    kind: 'provider',
    url: buildExternalMapsUrl({
      name: place.name ?? null,
      formatted_address: place.formatted_address ?? null,
      google_place_id: place.google_place_id ?? null,
      google_maps_url: place.google_maps_url ?? null,
      latitude: place.latitude ?? null,
      longitude: place.longitude ?? null,
    }),
    platform: null,
  };
}

export type PlaceShareContent = {
  /** Dialog title (Android share sheet). */
  title: string;
  /** The shared text: name, address (if any), and the resolved link (if any). */
  message: string;
  /** The resolved public URL, or null if one couldn't be built. */
  url: string | null;
  /** Which link the payload actually carries. */
  kind: ShareTarget['kind'];
};

/**
 * Build the place-share content. Never throws; always returns a usable,
 * private-field-free payload that prefers the original social post.
 */
export function buildPlaceShareContent(
  place: ShareablePlace,
  source?: ShareSourceContext | null,
): PlaceShareContent {
  const name = (place.name ?? '').trim() || 'A place';
  const address = (place.formatted_address ?? '').trim();
  const target = resolveShareTarget(place, source);

  const lines = [name];
  if (address) lines.push(address);
  if (target.url) lines.push(target.url);

  return {
    title: name,
    message: lines.join('\n'),
    url: target.url,
    kind: target.kind,
  };
}
