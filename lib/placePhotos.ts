export const MAX_PLACE_PHOTOS = 5;

export type PlacePhotoSource =
  | 'candidate'
  | 'provider'
  | 'saved_snapshot'
  | 'tutorial_bundle'
  | 'source_media';

export type PlacePhotoSet = {
  primary: string | null;
  photos: string[];
  source: PlacePhotoSource;
  persistedAt: string | null;
};

function photoIdentity(uri: string): string {
  try {
    const url = new URL(uri);
    const providerReference = url.searchParams.get('photo_reference')
      ?? url.searchParams.get('photoreference')
      ?? url.searchParams.get('name');
    if (providerReference) return `${url.origin}${url.pathname}:ref:${providerReference}`;
    for (const key of ['maxwidth', 'maxheight', 'w', 'h', 'width', 'height']) {
      url.searchParams.delete(key);
    }
    url.hash = '';
    return url.toString();
  } catch {
    return uri;
  }
}

export function distinctPlacePhotoUris(
  values: readonly (string | null | undefined)[],
): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const uri = value?.trim();
    if (!uri) continue;
    const identity = photoIdentity(uri);
    if (seen.has(identity)) continue;
    seen.add(identity);
    result.push(uri);
    if (result.length === MAX_PLACE_PHOTOS) break;
  }
  return result;
}

export function placePhotoSet(args: {
  photos: readonly (string | null | undefined)[];
  source: PlacePhotoSource;
  persistedAt?: string | null;
}): PlacePhotoSet {
  const photos = distinctPlacePhotoUris(args.photos);
  return {
    primary: photos[0] ?? null,
    photos,
    source: args.source,
    persistedAt: args.persistedAt ?? null,
  };
}
