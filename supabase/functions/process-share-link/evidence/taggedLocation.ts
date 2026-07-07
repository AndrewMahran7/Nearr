// supabase/functions/process-share-link/evidence/taggedLocation.ts
//
// First-class "tagged location" evidence — a structured place/location a
// platform attaches to a post OUTSIDE the caption text (e.g. YouTube
// `recordingDetails.location`, a TikTok POI/anchor, an Instagram location tag).
//
// STATUS: interface boundary only. `extractTaggedLocation` returns null for
// every platform today because no provider is wired and we are deliberately
// NOT adding new providers or unsafe scraping yet. Because it always returns
// null, current extraction behavior is unchanged. When a provider becomes
// available, populate a `TaggedLocationSignal` here — the resolver already
// treats it as the highest-priority evidence source (see
// `resolver/resolveSharedPlace.ts`) and still verifies it against Google
// Places before surfacing a candidate (never auto-saves on the tag alone).
//
// This module is intentionally dependency-free and side-effect-free.

import type { SourcePlatform } from '../types.ts';

/** Where a piece of evidence originated. */
export type EvidenceSourceType =
  | 'tagged_location'
  | 'description'
  | 'transcript'
  | 'ocr'
  | 'creator_bio'
  | 'comments'
  | 'user_input';

/** The platform an evidence signal came from (narrower than SourcePlatform). */
export type EvidenceSourcePlatform =
  | 'instagram'
  | 'tiktok'
  | 'youtube'
  | 'generic';

/** Confidence the PROVIDER assigns to the raw signal (pre-verification). */
export type EvidenceConfidence = 'high' | 'medium' | 'low';

/**
 * A structured location signal attached to a post by the platform, separate
 * from free-text caption/description. Any subset of the optional fields may be
 * present depending on the provider — the resolver uses whatever is available
 * (name/address/coords/external id) to VERIFY against Google Places.
 */
export type TaggedLocationSignal = {
  sourceType: EvidenceSourceType;
  sourcePlatform: EvidenceSourcePlatform;
  /** Human-readable label, e.g. "Blue Bottle Coffee, Oakland". */
  rawText?: string | null;
  /** The provider's raw object, kept for diagnostics (no secrets). */
  rawMetadata?: Record<string, unknown> | null;
  confidence: EvidenceConfidence;
  placeName?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  /** Provider place id (e.g. Google `place_id`, Foursquare `fsq_id`). */
  externalPlaceId?: string | null;
};

/** Map the resolver's `SourcePlatform` to the narrower evidence platform. */
export function toEvidencePlatform(
  platform: SourcePlatform,
): EvidenceSourcePlatform {
  switch (platform) {
    case 'instagram':
      return 'instagram';
    case 'tiktok':
      return 'tiktok';
    case 'youtube':
      return 'youtube';
    default:
      return 'generic';
  }
}

/**
 * Extract a platform-tagged location, if one is available WITHOUT any new
 * provider or unsafe scraping.
 *
 * Returns null today for every platform — this is the interface boundary a
 * future provider plugs into. Because it always returns null, current
 * extraction behavior is unchanged.
 */
export function extractTaggedLocation(_args: {
  platform: SourcePlatform;
  html: string;
  resolvedUrl: string;
  title: string | null;
  description: string | null;
}): TaggedLocationSignal | null {
  switch (_args.platform) {
    case 'youtube':
      // TODO(tagged-location/youtube): when a YouTube Data API v3 provider is
      // available, call `videos.list?part=recordingDetails` and map
      // `recordingDetails.location` { latitude, longitude } +
      // `recordingDetails.locationDescription` into a TaggedLocationSignal
      // (sourceType: 'tagged_location', sourcePlatform: 'youtube',
      // confidence: 'high'). Requires an API key + provider; NOT wired here.
      // Returning null falls back to the existing caption/description path.
      return null;
    case 'tiktok':
      // TODO(tagged-location/tiktok): when the provider returns a tagged
      // place/POI object (anchor / poi_info), map its name/address/coords
      // here. The keyless oEmbed endpoint does NOT expose it and the mobile
      // API requires auth, so no signal is available yet. Returning null
      // falls back to caption/transcript extraction.
      return null;
    case 'instagram':
      // TODO(tagged-location/instagram): IG location tags exist but require
      // authenticated Graph API access. Not wired. Falls back to caption.
      return null;
    default:
      return null;
  }
}
