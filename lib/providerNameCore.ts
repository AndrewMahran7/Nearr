export type StructuredProviderNames = { firstName: string | null; lastName: string | null };
export type ProviderNamePatch = { first_name?: string; last_name?: string };

export function cleanStructuredName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.trim();
  return cleaned || null;
}

/** Structured fields only: never guess names by splitting a display name. */
export function structuredProviderNames(metadata: Record<string, unknown> | null | undefined): StructuredProviderNames {
  return {
    firstName: cleanStructuredName(metadata?.given_name ?? metadata?.givenName),
    lastName: cleanStructuredName(metadata?.family_name ?? metadata?.familyName),
  };
}

/** Provider wins only when it supplies a non-empty structured value. */
export function providerNamePatch(names: StructuredProviderNames): ProviderNamePatch {
  const firstName = cleanStructuredName(names.firstName);
  const lastName = cleanStructuredName(names.lastName);
  return {
    ...(firstName ? { first_name: firstName } : {}),
    ...(lastName ? { last_name: lastName } : {}),
  };
}
