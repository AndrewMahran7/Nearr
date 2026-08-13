/**
 * Apple only returns the user's name on the FIRST authorization. Every later
 * sign-in returns nulls. These pure helpers decide what (if anything) is safe
 * to write into Supabase user metadata.
 *
 * Rule: only non-empty Apple values are written. A null/empty Apple value can
 * never clear or overwrite a name we already have.
 */

export type AppleFullNameLike = {
  namePrefix?: string | null;
  givenName?: string | null;
  middleName?: string | null;
  familyName?: string | null;
  nameSuffix?: string | null;
  nickname?: string | null;
} | null | undefined;

export type AppleNameMetadata = {
  full_name?: string;
  given_name?: string;
  family_name?: string;
};

function clean(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Join the parts Apple gave us into a display name.
 *
 * `Intl.ListFormat`/locale-specific name ordering is not available across all
 * Hermes builds, so we use the order Apple hands back (which already reflects
 * the user's own locale settings) and simply drop the empty parts.
 */
export function formatAppleFullName(fullName: AppleFullNameLike): string {
  if (!fullName) return '';
  return [
    clean(fullName.givenName),
    clean(fullName.middleName),
    clean(fullName.familyName),
  ]
    .filter(Boolean)
    .join(' ')
    .trim();
}

/**
 * Build the `supabase.auth.updateUser({ data })` payload for an Apple
 * credential, or `null` when there is nothing worth writing.
 *
 * `existingMetadata` is the user's current `user_metadata`; a key is skipped
 * when Apple gave nothing for it, so a subsequent (nameless) Apple sign-in
 * leaves the stored name untouched.
 */
export function buildAppleNameMetadata(
  fullName: AppleFullNameLike,
  existingMetadata?: Record<string, unknown> | null,
): AppleNameMetadata | null {
  const given = clean(fullName?.givenName);
  const family = clean(fullName?.familyName);
  const composed = formatAppleFullName(fullName);

  const next: AppleNameMetadata = {};
  if (composed) next.full_name = composed;
  if (given) next.given_name = given;
  if (family) next.family_name = family;

  if (Object.keys(next).length === 0) return null;

  // Skip the write entirely when every value already matches what is stored,
  // so a re-authorization doesn't produce a pointless network call.
  const existing = existingMetadata ?? {};
  const unchanged = (Object.keys(next) as (keyof AppleNameMetadata)[]).every(
    (key) => clean(existing[key]) === next[key],
  );
  return unchanged ? null : next;
}
