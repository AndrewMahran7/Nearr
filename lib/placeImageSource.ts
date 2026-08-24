export function selectPlaceImageUri(
  sourceUri: string | null | undefined,
  placePhotoUrls: readonly string[],
  failedUris: Readonly<Record<string, boolean>>,
  options: {
    preferPlacePhoto?: boolean;
    fallbackSourceUri?: string | null;
  } = {},
): string | null {
  const placePhoto = placePhotoUrls.find((uri) => !!uri && !failedUris[uri]) ?? null;
  const source = sourceUri && !failedUris[sourceUri] ? sourceUri : null;
  const fallback = options.fallbackSourceUri && !failedUris[options.fallbackSourceUri]
    ? options.fallbackSourceUri
    : null;
  return options.preferPlacePhoto
    ? placePhoto ?? source ?? fallback
    : source ?? placePhoto ?? fallback;
}
