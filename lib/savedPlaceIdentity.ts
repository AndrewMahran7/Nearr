/** UUID boundary shared by onboarding, transfer and saved-place mutations. */
const SAVED_PLACE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isRealSavedPlaceId(value: unknown): value is string {
  return typeof value === 'string' && SAVED_PLACE_UUID.test(value.trim());
}

export function savedPlaceUuidOrNull(value: unknown): string | null {
  return isRealSavedPlaceId(value) ? value.trim() : null;
}

export function realSavedPlaceIds(values: readonly unknown[]): string[] {
  return [...new Set(values.map(savedPlaceUuidOrNull).filter((id): id is string => !!id))];
}

export function requireRealSavedPlaceId(value: unknown, operation: string): string {
  const id = savedPlaceUuidOrNull(value);
  if (!id) throw new Error(`local_saved_place_not_server_addressable:${operation}`);
  return id;
}
