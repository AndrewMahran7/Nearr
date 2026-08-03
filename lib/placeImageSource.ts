export function selectPlaceImageUri(
  sourceUri: string | null | undefined,
  placePhotoUrls: readonly string[],
  failedUris: Readonly<Record<string, boolean>>,
): string | null {
  if (sourceUri && !failedUris[sourceUri]) return sourceUri;
  return placePhotoUrls.find((uri) => !!uri && !failedUris[uri]) ?? null;
}