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

export type PlaceShareContent = {
  /** Dialog title (Android share sheet). */
  title: string;
  /** The shared text: name, address (if any), and the Maps link (if any). */
  message: string;
  /** The public Google Maps URL, or null if one couldn't be built. */
  url: string | null;
};

/**
 * Build the ordinary place-share content. Never throws; always returns a
 * usable, private-field-free payload.
 */
export function buildPlaceShareContent(place: ShareablePlace): PlaceShareContent {
  const name = (place.name ?? '').trim() || 'A place';
  const address = (place.formatted_address ?? '').trim();
  const url = buildExternalMapsUrl({
    name: place.name ?? null,
    formatted_address: place.formatted_address ?? null,
    google_place_id: place.google_place_id ?? null,
    google_maps_url: place.google_maps_url ?? null,
    latitude: place.latitude ?? null,
    longitude: place.longitude ?? null,
  });

  const lines = [name];
  if (address) lines.push(address);
  if (url) lines.push(url);

  return {
    title: name,
    message: lines.join('\n'),
    url,
  };
}
