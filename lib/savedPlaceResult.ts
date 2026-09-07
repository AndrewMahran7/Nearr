import { splitPlaceAddress } from './sharePhase1Ui';
import { resolvePlaceSource, type PlaceSourceAttribution } from './placeSource';
import type { SavedPlaceSource, SavedPlaceWithPlace } from '@/types';

export type SavedPlaceResultProvenance = 'automatic' | 'user_confirmed' | string | null;

export type SavedPlaceResultCandidate = {
  googlePlaceId?: string | null;
  name?: string | null;
  formattedAddress?: string | null;
  shortFormattedAddress?: string | null;
  photoUrl?: string | null;
  sourceFrameUrl?: string | null;
};

export type SavedPlaceResultViewModel = {
  savedPlaceId: string;
  name: string;
  location: string | null;
  googlePlaceId: string | null;
  statusLabel: 'Saved automatically' | 'Saved';
  source: PlaceSourceAttribution | null;
  sourceCopy: string | null;
  sourceThumbnailUrl: string | null;
  candidatePhotoUrl: string | null;
  sourceFrameUrl: string | null;
};

function clean(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function sourceUrlKeys(url: string | null | undefined): string[] {
  const value = clean(url);
  if (!value) return [];
  try {
    const parsed = new URL(value);
    parsed.hash = '';
    parsed.search = '';
    return [value, parsed.toString().replace(/\/$/, '')];
  } catch {
    return [value];
  }
}

/** Match media to this discovery, never to an arbitrary source on the place. */
export function sourceForSavedResult(
  sources: readonly SavedPlaceSource[] | undefined,
  jobSourceUrl: string | null | undefined,
): SavedPlaceSource | null {
  if (!sources?.length) return null;
  const wanted = new Set(sourceUrlKeys(jobSourceUrl));
  if (wanted.size === 0) return null;
  return sources.find((source) =>
    [...sourceUrlKeys(source.canonical_url), ...sourceUrlKeys(source.original_url)]
      .some((key) => wanted.has(key)),
  ) ?? null;
}

export function savedResultStatusLabel(args: {
  savedPlaceId?: string | null;
  status?: string | null;
  primaryOrigin?: SavedPlaceResultProvenance;
  decision?: string | null;
}): 'Saved automatically' | 'Saved' | null {
  if (args.status !== 'completed' || !clean(args.savedPlaceId)) return null;
  if (args.primaryOrigin === 'automatic') return 'Saved automatically';
  if (args.primaryOrigin) return 'Saved';
  return args.decision === 'auto_save' ? 'Saved automatically' : 'Saved';
}

export function compactSavedResultLocation(
  saved: SavedPlaceWithPlace | null | undefined,
  candidate: SavedPlaceResultCandidate | null | undefined,
): string | null {
  const savedShort = clean(saved?.place.short_formatted_address);
  if (savedShort) return savedShort;
  const savedLocality = splitPlaceAddress(saved?.place.formatted_address).locality;
  if (savedLocality) return savedLocality;
  const candidateShort = clean(candidate?.shortFormattedAddress);
  if (candidateShort) return candidateShort;
  return splitPlaceAddress(candidate?.formattedAddress).locality
    ?? clean(saved?.place.formatted_address)
    ?? clean(candidate?.formattedAddress);
}

export function buildSavedPlaceResultViewModel(args: {
  status: string | null | undefined;
  savedPlaceId: string | null | undefined;
  decision: string | null | undefined;
  primaryOrigin: SavedPlaceResultProvenance;
  saved: SavedPlaceWithPlace | null | undefined;
  candidate: SavedPlaceResultCandidate | null | undefined;
  sourcePlatform: string | null | undefined;
  sourceUrl: string | null | undefined;
}): SavedPlaceResultViewModel | null {
  const savedPlaceId = clean(args.savedPlaceId);
  const statusLabel = savedResultStatusLabel(args);
  if (!savedPlaceId || !statusLabel) return null;

  const name = clean(args.saved?.place.name) ?? clean(args.candidate?.name) ?? 'Saved place';
  const source = resolvePlaceSource({
    source_type: args.sourcePlatform,
    source_url: args.sourceUrl,
  });
  const matchedSource = sourceForSavedResult(args.saved?.sources, args.sourceUrl);

  return {
    savedPlaceId,
    name,
    location: compactSavedResultLocation(args.saved, args.candidate),
    googlePlaceId: clean(args.saved?.place.google_place_id) ?? clean(args.candidate?.googlePlaceId),
    statusLabel,
    source,
    sourceCopy: source ? `Saved from ${source.platformName === 'Link' ? 'a shared link' : source.platformName}` : null,
    sourceThumbnailUrl: clean(matchedSource?.thumbnail_url),
    candidatePhotoUrl: clean(args.candidate?.photoUrl),
    sourceFrameUrl: clean(args.candidate?.sourceFrameUrl),
  };
}

