/** Canonical identity contract shared by every client-side place save. */

export type CanonicalSaveOutcome =
  | 'created'
  | 'reused'
  | 'enriched'
  | 'already_attached';

export type CanonicalSaveSuccess = {
  success: true;
  savedPlaceId: string;
  outcome: CanonicalSaveOutcome;
};

export type CanonicalSaveFailure = {
  success: false;
  errorCode: string;
  message: string;
};

/**
 * Make the success invariant executable instead of relying on every caller to
 * remember a nullable-id check. A blank identity is a programmer/server
 * contract violation and can never escape as `success: true`.
 */
export function canonicalSaveSuccess<O extends CanonicalSaveOutcome, T extends object>(
  savedPlaceId: unknown,
  outcome: O,
  details: T,
): Omit<CanonicalSaveSuccess, 'outcome'> & { outcome: O } & T {
  const canonicalId = typeof savedPlaceId === 'string' ? savedPlaceId.trim() : '';
  if (!canonicalId) {
    throw new Error('Canonical save completed without a saved-place identity.');
  }
  return {
    ...details,
    success: true,
    savedPlaceId: canonicalId,
    outcome,
  };
}
