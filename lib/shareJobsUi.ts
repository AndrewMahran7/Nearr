/**
 * lib/shareJobsUi.ts
 *
 * PURE presentation helpers for the in-app share-job queue and per-job
 * confirmation screens. No React Native imports, no I/O — unit-testable from
 * ts-node. These centralise the small decisions the screens make so the queue
 * count, the section membership, the back-navigation fallback, and the
 * candidate normalisation all have one tested source of truth.
 *
 * IMPORTANT: this only changes PRESENTATION grouping. Queue *visibility* is
 * still owned by lib/shareJobRouting.ts (`filterQueueVisible` hides terminal
 * completed/cancelled jobs). `failed` remains a visible, actionable status here
 * — it is grouped with `needs_help` under one "Needs your help" heading so the
 * user always sees a job that still needs them, without a separate debug-style
 * section.
 */

/** Actionable jobs the user can resolve now: awaiting a decision (needs_help)
 *  or a failure they can still fix by hand (failed). needs_help first so the
 *  most-typical action leads. Order within a status is preserved from input. */
export function actionableJobs<T extends { status: string }>(jobs: T[]): T[] {
  const needsHelp = jobs.filter((j) => j.status === 'needs_help');
  const failed = jobs.filter((j) => j.status === 'failed');
  return [...needsHelp, ...failed];
}

/** Jobs still being worked by the durable worker (not tappable). */
export function processingJobs<T extends { status: string }>(jobs: T[]): T[] {
  return jobs.filter((j) => j.status === 'queued' || j.status === 'processing_metadata');
}

/** The count shown in the header badge — the number of VISIBLE, ACTIONABLE
 *  jobs (processing jobs are visible but not actionable, so excluded). */
export function actionableCount(jobs: { status: string }[]): number {
  return jobs.filter((j) => j.status === 'needs_help' || j.status === 'failed').length;
}

/** True when nothing actionable and nothing processing is visible. */
export function isQueueEmpty(jobs: { status: string }[]): boolean {
  return actionableJobs(jobs).length === 0 && processingJobs(jobs).length === 0;
}

/**
 * Friendly, non-technical heading for the actionable section — singular/plural
 * aware. Avoids system vocabulary ("needs_help", "candidate"). Example:
 *   1 → "One place needs a quick check"
 *   3 → "3 places need a quick check"
 */
export function actionableSectionHeading(count: number): string {
  if (count <= 1) return 'One place needs a quick check';
  return `${count} places need a quick check`;
}

export type QuickCheckReviewCopy = { title: string; body: string };

/** Never describe a known backend contradiction as an unqualified likely match. */
export function quickCheckReviewCopy(
  needsHelpReason: string | null | undefined,
  fallback: QuickCheckReviewCopy,
): QuickCheckReviewCopy {
  switch (needsHelpReason) {
    case 'metadata_location_conflict':
      return {
        title: 'This match needs a closer check',
        body: "The provider address conflicts with the address in the post. Confirm it before saving.",
      };
    case 'metadata_provider_permanently_closed':
      return {
        title: 'This place may be closed',
        body: 'The provider marks this place permanently closed. Confirm it before saving.',
      };
    case 'metadata_provider_coordinates_invalid':
    case 'metadata_provider_id_missing':
    case 'metadata_provider_name_missing':
    case 'metadata_provider_address_missing':
    case 'metadata_provider_identity_invalid':
    case 'metadata_provider_clearly_unrelated':
      return {
        title: 'This match needs a closer check',
        body: 'The provider result is incomplete or may not identify the place from the post.',
      };
    default:
      return fallback;
  }
}

// ---------------------------------------------------------------------------
// Back-navigation fallback. A queue/confirmation screen reached via a cold
// deep link (the extension's "View queue", a notification) has no previous
// Nearr route, so `router.back()` would trap the user. Fall back to a safe
// route instead.
// ---------------------------------------------------------------------------

export type BackTarget = { kind: 'back' } | { kind: 'replace'; route: string };

export function backTarget(canGoBack: boolean, fallbackRoute: string): BackTarget {
  return canGoBack ? { kind: 'back' } : { kind: 'replace', route: fallbackRoute };
}

// ---------------------------------------------------------------------------
// Candidate normalisation. `candidate_payload.candidates` is JSON from the
// server and may be missing, non-array, or contain malformed rows. Never throw;
// drop anything that can't be rendered/saved.
// ---------------------------------------------------------------------------

export type NormalizedCandidate = {
  googlePlaceId: string;
  name: string;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  types: string[];
  matchScore: number | null;
  aiNote: string | null;
};

export function normalizeShareJobCandidates(input: unknown): NormalizedCandidate[] {
  const rows = Array.isArray(input)
    ? input
    : input && typeof input === 'object'
    ? (() => {
        const payload = input as Record<string, unknown>;
        if (Array.isArray(payload.candidates)) return payload.candidates;
        if (Array.isArray(payload.options)) return payload.options;
        if (payload.candidate && typeof payload.candidate === 'object') return [payload.candidate];
        return [];
      })()
    : [];
  return rows
    .filter((row): row is Record<string, unknown> => !!row && typeof row === 'object')
    .map((row) => {
      const providerId = row.googlePlaceId ?? row.google_place_id ?? row.placeId ?? row.providerId;
      const displayName = row.name ?? row.displayName;
      const address = row.formattedAddress ?? row.formatted_address ?? row.address;
      const latitude = row.latitude ?? row.lat;
      const longitude = row.longitude ?? row.lng;
      return {
        googlePlaceId: typeof providerId === 'string' ? providerId.trim() : '',
        name: typeof displayName === 'string' ? displayName.trim() : '',
        formattedAddress: typeof address === 'string' && address.trim() ? address.trim() : null,
        latitude: typeof latitude === 'number' ? latitude : null,
        longitude: typeof longitude === 'number' ? longitude : null,
        types: Array.isArray(row.types)
          ? row.types.filter((v): v is string => typeof v === 'string')
          : [],
        matchScore: typeof row.matchScore === 'number' ? row.matchScore : null,
        aiNote: typeof row.aiNote === 'string' && row.aiNote.trim() ? row.aiNote.trim() : null,
      };
    })
    .filter((row) => row.googlePlaceId.length > 0 && row.name.length > 0);
}

// ---------------------------------------------------------------------------
// Already-saved detection. If the proposed place is already on the user's map
// (matched by canonical google_place_id), the confirmation screen offers
// "View place" instead of a duplicate save. Best-effort from the local cache;
// the save path stays idempotent regardless.
// ---------------------------------------------------------------------------

type SavedForMatch = { id: string; place: { google_place_id: string | null } };

export function findSavedPlaceIdByGooglePlaceId(
  googlePlaceId: string | null | undefined,
  saved: SavedForMatch[] | null | undefined,
): string | null {
  if (!googlePlaceId || !Array.isArray(saved)) return null;
  const match = saved.find((s) => s?.place?.google_place_id === googlePlaceId);
  return match ? match.id : null;
}
