/**
 * lib/wrongPlaceCorrection.ts
 *
 * PURE policy for correcting a place Nearr resolved incorrectly.
 *
 * Because Nearr now saves first and asks later, correcting a wrong save must be
 * trivial and completely safe:
 *   - only the owner may correct their own row
 *   - the original social-post context and the user's note are preserved
 *   - the provider identity, coordinates, address, and category are replaced
 *   - no duplicate saved_places row is created
 *
 * The correction is also recorded as product feedback so Phase 2 accuracy can be
 * calibrated later. Only the two provider results, the gate rule version, and a
 * timestamp are stored — never hidden model reasoning.
 *
 * No React Native imports and no I/O so it is unit-testable from ts-node.
 */

export type CorrectionPlace = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
};

export type CorrectionContext = {
  savedPlaceId: string;
  /** Owner of the saved_places row. */
  ownerUserId: string;
  /** The signed-in user attempting the correction. */
  actingUserId: string;
  /** Provider identity currently associated with the save. */
  currentGooglePlaceId: string | null;
  /** The user's own note, which a correction must never discard. */
  userNote: string | null;
  /** Original social post the place came from. */
  sourceType: string | null;
  sourceUrl: string | null;
  /** Gate rule version that produced the original (wrong) association. */
  ruleVersion: string | null;
};

export type CorrectionRejection =
  | 'not_owner'
  | 'same_place'
  | 'invalid_replacement';

export type CorrectionFeedback = {
  originalGooglePlaceId: string | null;
  correctedGooglePlaceId: string;
  ruleVersion: string | null;
  correctedAt: string;
};

export type CorrectionPlan =
  | { ok: false; reason: CorrectionRejection }
  | {
      ok: true;
      savedPlaceId: string;
      /** Fields to write onto the existing saved place — never a new row. */
      replacement: CorrectionPlace;
      /** Preserved verbatim. */
      preserved: {
        userNote: string | null;
        sourceType: string | null;
        sourceUrl: string | null;
      };
      feedback: CorrectionFeedback;
      /** Caches that must be invalidated so the marker moves immediately. */
      invalidate: readonly ['saved_places', 'place_rich_details', 'map_markers'];
    };

function validReplacement(place: CorrectionPlace | null | undefined): place is CorrectionPlace {
  if (!place) return false;
  if (!place.googlePlaceId.trim() || !place.name.trim()) return false;
  if (!Number.isFinite(place.latitude) || !Number.isFinite(place.longitude)) return false;
  const lat = place.latitude as number;
  const lng = place.longitude as number;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Build the correction plan. Returns a typed rejection instead of throwing so
 * the UI can render an honest message for every refusal.
 */
export function planWrongPlaceCorrection(
  context: CorrectionContext,
  replacement: CorrectionPlace | null | undefined,
  now: Date = new Date(),
): CorrectionPlan {
  if (!context.actingUserId || context.actingUserId !== context.ownerUserId) {
    return { ok: false, reason: 'not_owner' };
  }
  if (!validReplacement(replacement)) {
    return { ok: false, reason: 'invalid_replacement' };
  }
  if (
    context.currentGooglePlaceId &&
    context.currentGooglePlaceId === replacement.googlePlaceId
  ) {
    return { ok: false, reason: 'same_place' };
  }
  return {
    ok: true,
    savedPlaceId: context.savedPlaceId,
    replacement,
    preserved: {
      userNote: context.userNote,
      sourceType: context.sourceType,
      sourceUrl: context.sourceUrl,
    },
    feedback: {
      originalGooglePlaceId: context.currentGooglePlaceId,
      correctedGooglePlaceId: replacement.googlePlaceId,
      ruleVersion: context.ruleVersion,
      correctedAt: now.toISOString(),
    },
    invalidate: ['saved_places', 'place_rich_details', 'map_markers'],
  };
}

export const CORRECTION_COPY = {
  action: 'Wrong place?',
  title: 'Which place is it?',
  body: 'Pick the right one and Nearr will fix this save.',
  notOwner: 'You can only correct places on your own map.',
  samePlace: 'That is already the saved place.',
  invalid: 'That result is missing location details. Try another.',
} as const;

export function correctionRejectionMessage(reason: CorrectionRejection): string {
  switch (reason) {
    case 'not_owner':
      return CORRECTION_COPY.notOwner;
    case 'same_place':
      return CORRECTION_COPY.samePlace;
    case 'invalid_replacement':
    default:
      return CORRECTION_COPY.invalid;
  }
}

/**
 * The query the correction sheet should run automatically. Prefers the AI's
 * extracted place name so the user rarely has to type anything.
 */
export function correctionInitialQuery(args: {
  extractedName?: string | null;
  currentName?: string | null;
  locality?: string | null;
}): string {
  const base = (args.extractedName ?? args.currentName ?? '').trim();
  if (!base) return '';
  const locality = (args.locality ?? '').trim();
  return locality ? `${base} ${locality}` : base;
}
